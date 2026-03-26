import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { noticesTable, usersTable, studentsTable } from "@workspace/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  sendPushToPoolParents, sendPushToClassParents,
  sendPushToPoolAdmins, sendPushToPoolTeachers,
} from "../lib/push-service.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

// GET /notices — 수영장 공지 목록
// super_admin: pool_id 쿼리 파라미터 필수
// pool_admin/sub_admin: 소속 수영장 자동
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    let poolId: string | null = null;

    if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
      poolId = (req.query.pool_id as string) || null;
      if (!poolId) return err(res, 400, "pool_id 파라미터가 필요합니다.");
    } else {
      poolId = await getPoolId(req.user!.userId);
      if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");
    }

    const notices = await db.select().from(noticesTable).where(
      and(
        eq(noticesTable.swimming_pool_id, poolId),
        eq(noticesTable.notice_type, "general"),
        ne(noticesTable.status, "deleted"),
      )
    );
    res.json(notices.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// POST /notices — 공지 등록
// super_admin: body.pool_id 로 대상 수영장 직접 지정 가능
// 등록 시 수영장 내 관리자·선생님·학부모 전체에 자동 푸시 발송 (비동기)
router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned, notice_type, student_id, image_urls, pool_id: bodyPoolId } = req.body;
  if (!title || !content) return err(res, 400, "제목과 내용을 입력해주세요.");
  const imgs: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 5) : [];
  const role = req.user!.role;

  try {
    let poolId: string | null = null;

    if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
      // 슈퍼관리자는 body.pool_id 직접 지정
      poolId = bodyPoolId || null;
      if (!poolId) return err(res, 400, "pool_id가 필요합니다.");
    } else {
      poolId = await getPoolId(req.user!.userId);
      if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");
    }

    const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

    // 개인 공지의 경우 학생이 동일 풀에 속하는지 검증
    let studentName: string | null = null;
    if (notice_type === "individual" && student_id) {
      const [s] = await db.select({ name: studentsTable.name, swimming_pool_id: studentsTable.swimming_pool_id })
        .from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
      if (!s || s.swimming_pool_id !== poolId) return err(res, 403, "해당 학생은 이 수영장에 속하지 않습니다.");
      studentName = s.name;
    }

    const id = `notice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [notice] = await db.insert(noticesTable).values({
      id, swimming_pool_id: poolId, title, content,
      author_id: req.user!.userId, author_name: user?.name || "관리자",
      is_pinned: is_pinned === true,
      notice_type: notice_type === "individual" ? "individual" : "general",
      student_id: notice_type === "individual" ? (student_id || null) : null,
      student_name: studentName,
      image_urls: imgs,
    }).returning();

    // 공지 등록 시 수영장 전체 사용자에게 푸시 알림 (비동기, 실패해도 응답에 영향 없음)
    // 수영장명 조회
    const poolInfoRows = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`).catch(() => null);
    const poolName = (poolInfoRows?.rows[0] as any)?.name || "수영장";
    const pushTitle = `[${poolName}] 공지사항`;
    const pushBody = title;

    setImmediate(async () => {
      try {
        if (notice_type === "individual" && student_id) {
          // 개인 공지 → 해당 학생의 학부모에게만
          const parentRows = await db.execute(sql`
            SELECT parent_id AS parent_account_id FROM parent_students
            WHERE student_id = ${student_id} AND status = 'approved'
          `);
          const { sendPushToUser } = await import("../lib/push-service.js");
          for (const p of parentRows.rows as any[]) {
            await sendPushToUser(p.parent_account_id, true, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`);
          }
        } else {
          // 일반 공지 → 관리자 + 선생님 + 학부모 전체
          await Promise.allSettled([
            sendPushToPoolParents(poolId!, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`),
            sendPushToPoolAdmins(poolId!, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`),
            sendPushToPoolTeachers(poolId!, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`),
          ]);
        }
        // push_sent_at 기록
        await db.execute(sql`
          UPDATE notices SET push_sent_at = NOW(), push_sent_count = COALESCE(push_sent_count, 0) + 1
          WHERE id = ${id}
        `).catch(console.error);
      } catch (e) {
        console.error("[notices] 푸시 발송 오류:", e);
      }
    });

    logPoolEvent({ pool_id: poolId, event_type: "notice_create", entity_type: "notice", entity_id: notice.id, actor_id: req.user!.userId, actor_name: user?.name || "관리자", payload: { title, notice_type: notice.notice_type, student_id: notice.student_id } }).catch(console.error);
    res.status(201).json({ success: true, ...notice });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// GET /:id/read-stats — 읽음 통계
router.get("/:id/read-stats", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const poolId = (role === "super_admin" || role === "platform_admin")
      ? null
      : await getPoolId(req.user!.userId);

    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");

    // pool_admin은 자신의 풀 공지만 조회
    if (poolId && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const readCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM notice_reads WHERE notice_id = ${req.params.id}`);
    const read = Number((readCount.rows[0] as any).cnt);

    let totalParents = 0;
    if (notice.notice_type === "individual" && notice.student_id) {
      const links = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_students WHERE student_id = ${notice.student_id} AND status = 'approved'`);
      totalParents = Number((links.rows[0] as any).cnt);
    } else {
      const allParents = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_accounts WHERE swimming_pool_id = ${notice.swimming_pool_id}`);
      totalParents = Number((allParents.rows[0] as any).cnt);
    }

    res.json({ read_count: read, unread_count: Math.max(0, totalParents - read), total: totalParents });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// DELETE /:id — 공지 소프트 삭제 (status='deleted')
// 이력 추적 가능 · 푸시 발송 이력 보존 · 실수 복구 가능
// 완전 삭제(hard delete)는 별도 배치 정책으로만 수행
router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const poolId = (role === "super_admin" || role === "platform_admin")
      ? null
      : await getPoolId(req.user!.userId);

    const [notice] = await db.select({ swimming_pool_id: noticesTable.swimming_pool_id, status: noticesTable.status })
      .from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (notice.status === "deleted") return err(res, 404, "이미 삭제된 공지입니다.");
    if (poolId && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // 소프트 삭제: status='deleted' + updated_at 갱신
    await db.update(noticesTable)
      .set({ status: "deleted", updated_at: new Date() })
      .where(eq(noticesTable.id, req.params.id));

    const logPoolId = poolId ?? notice.swimming_pool_id;
    logPoolEvent({ pool_id: logPoolId, event_type: "notice_delete", entity_type: "notice", entity_id: req.params.id, actor_id: req.user!.userId, payload: {} }).catch(console.error);
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// PATCH /:id — 공지 수정 (상태·내용 변경, 재발송 포함)
router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned, resend_push } = req.body;
  try {
    const role = req.user!.role;
    const poolId = (role === "super_admin" || role === "platform_admin")
      ? null
      : await getPoolId(req.user!.userId);

    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (poolId && notice.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");

    const updates: any = { updated_at: new Date() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (is_pinned !== undefined) updates.is_pinned = is_pinned;

    await db.update(noticesTable).set(updates).where(eq(noticesTable.id, req.params.id));

    // 재발송 요청 시
    if (resend_push) {
      const targetPoolId = notice.swimming_pool_id;
      const poolInfoRows = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${targetPoolId} LIMIT 1`).catch(() => null);
      const poolName = (poolInfoRows?.rows[0] as any)?.name || "수영장";
      const pushTitle = `[${poolName}] 공지사항 (수정)`;
      const pushBody = title || notice.title;

      setImmediate(async () => {
        try {
          await Promise.allSettled([
            sendPushToPoolParents(targetPoolId, "notice", pushTitle, pushBody, { noticeId: req.params.id }, `notice_re_${req.params.id}`),
            sendPushToPoolAdmins(targetPoolId, "notice", pushTitle, pushBody, { noticeId: req.params.id }, `notice_re_${req.params.id}`),
            sendPushToPoolTeachers(targetPoolId, "notice", pushTitle, pushBody, { noticeId: req.params.id }, `notice_re_${req.params.id}`),
          ]);
          // 재발송 시에도 push_sent_count 증가 및 push_sent_at 갱신
          await db.execute(sql`
            UPDATE notices SET push_sent_at = NOW(), push_sent_count = COALESCE(push_sent_count, 0) + 1
            WHERE id = ${req.params.id}
          `).catch(console.error);
        } catch (e) {
          console.error("[notices] 재발송 오류:", e);
        }
      });
    }

    const [updated] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    res.json({ success: true, ...updated });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
