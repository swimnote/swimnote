import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { noticesTable, usersTable, studentsTable } from "@workspace/db/schema";
import { eq, and, ne, or, isNull } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  sendPushToPoolParents, sendPushToClassParents,
  sendPushToPoolAdmins, sendPushToPoolTeachers,
  sendPushToAllUsers,
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

// ── GET /notices ──────────────────────────────────────────────────────────────
// 공지 목록 조회:
//  - super_admin: pool_id 파라미터로 수영장별 조회 OR audience_scope=global 필터
//  - pool_admin/sub_admin/teacher: 전체 공지(global) + 소속 수영장 공지(pool) 모두 반환
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const scopeFilter = req.query.scope as string | undefined; // 'global' | 'pool' | undefined(전체)

    if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
      // 슈퍼관리자: scope=global → 전체 공지만, pool_id 있으면 해당 풀만, 없으면 전체
      const poolId = (req.query.pool_id as string) || null;

      let whereClause: any;
      if (scopeFilter === "global") {
        whereClause = and(
          eq(noticesTable.audience_scope, "global"),
          ne(noticesTable.status, "deleted"),
        );
      } else if (poolId) {
        whereClause = and(
          eq(noticesTable.swimming_pool_id, poolId),
          eq(noticesTable.audience_scope, "pool"),
          ne(noticesTable.status, "deleted"),
        );
      } else {
        // 전체 (global + pool 모두)
        whereClause = ne(noticesTable.status, "deleted");
      }

      const notices = await db.select().from(noticesTable).where(whereClause);
      return res.json(sortNotices(notices));
    }

    // pool 역할 (pool_admin, sub_admin, teacher): 전체 공지 + 소속 수영장 공지
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const notices = await db.select().from(noticesTable).where(
      and(
        ne(noticesTable.status, "deleted"),
        or(
          eq(noticesTable.audience_scope, "global"),
          and(
            eq(noticesTable.audience_scope, "pool"),
            eq(noticesTable.swimming_pool_id, poolId),
          ),
        ),
      )
    );
    return res.json(sortNotices(notices));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

function sortNotices(notices: any[]) {
  return notices.sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// ── POST /notices ─────────────────────────────────────────────────────────────
// 공지 등록
//  - audience_scope='global': 전체 공지 (swimming_pool_id 불필요)
//    → 푸시: 모든 수영장 관리자·선생님·학부모 전체
//    → 푸시 제목: [스윔노트] 공지사항
//  - audience_scope='pool': 수영장별 공지 (swimming_pool_id 필수)
//    → 푸시: 해당 수영장 관리자·선생님·학부모만
//    → 푸시 제목: [수영장명] 공지사항
router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const {
    title, content, is_pinned, notice_type, student_id, image_urls,
    pool_id: bodyPoolId,
    audience_scope: rawScope,
  } = req.body;
  if (!title || !content) return err(res, 400, "제목과 내용을 입력해주세요.");

  const scope: "global" | "pool" = rawScope === "global" ? "global" : "pool";
  const imgs: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 5) : [];
  const role = req.user!.role;

  try {
    let poolId: string | null = null;

    if (scope === "pool") {
      if (role === "super_admin" || role === "platform_admin" || role === "super_manager") {
        poolId = bodyPoolId || null;
        if (!poolId) return err(res, 400, "수영장별 공지에는 pool_id가 필요합니다.");
      } else {
        poolId = await getPoolId(req.user!.userId);
        if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");
      }
    }
    // global이면 poolId = null

    const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

    // 개인 공지 (수영장별만 허용)
    let studentName: string | null = null;
    if (scope === "pool" && notice_type === "individual" && student_id) {
      const [s] = await db.select({ name: studentsTable.name, swimming_pool_id: studentsTable.swimming_pool_id })
        .from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
      if (!s || s.swimming_pool_id !== poolId) return err(res, 403, "해당 학생은 이 수영장에 속하지 않습니다.");
      studentName = s.name;
    }

    const id = `notice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [notice] = await db.insert(noticesTable).values({
      id,
      audience_scope: scope,
      swimming_pool_id: poolId,   // global이면 null
      title, content,
      author_id: req.user!.userId,
      author_name: user?.name || "관리자",
      is_pinned: is_pinned === true,
      notice_type: notice_type === "individual" ? "individual" : "general",
      student_id: scope === "pool" && notice_type === "individual" ? (student_id || null) : null,
      student_name: studentName,
      image_urls: imgs,
    }).returning();

    // 푸시 발송 (비동기 — 저장은 항상 성공 먼저)
    setImmediate(async () => {
      try {
        if (scope === "global") {
          // ── 전체 공지 푸시 ────────────────────────────────────────
          const pushTitle = "[스윔노트] 공지사항";
          const pushBody  = title;
          await sendPushToAllUsers("notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`);

        } else if (poolId) {
          // ── 수영장별 공지 푸시 ────────────────────────────────────
          const poolInfoRows = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`).catch(() => null);
          const poolName = (poolInfoRows?.rows[0] as any)?.name || "수영장";
          const pushTitle = `[${poolName}] 공지사항`;
          const pushBody  = title;

          if (notice_type === "individual" && student_id) {
            const parentRows = await db.execute(sql`
              SELECT parent_id AS parent_account_id FROM parent_students
              WHERE student_id = ${student_id} AND status = 'approved'
            `);
            const { sendPushToUser } = await import("../lib/push-service.js");
            for (const p of parentRows.rows as any[]) {
              await sendPushToUser(p.parent_account_id, true, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`);
            }
          } else {
            await Promise.allSettled([
              sendPushToPoolParents(poolId, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`),
              sendPushToPoolAdmins(poolId, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`),
              sendPushToPoolTeachers(poolId, "notice", pushTitle, pushBody, { noticeId: id }, `notice_${id}`),
            ]);
          }
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

    const logPoolId = poolId || "global";
    logPoolEvent({ pool_id: logPoolId, event_type: "notice_create", entity_type: "notice", entity_id: notice.id, actor_id: req.user!.userId, actor_name: user?.name || "관리자", payload: { title, scope, notice_type: notice.notice_type } }).catch(console.error);
    res.status(201).json({ success: true, ...notice });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /:id/read-stats ───────────────────────────────────────────────────────
router.get("/:id/read-stats", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const poolId = (role === "super_admin" || role === "platform_admin")
      ? null
      : await getPoolId(req.user!.userId);

    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (poolId && notice.audience_scope === "pool" && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const readCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM notice_reads WHERE notice_id = ${req.params.id}`);
    const read = Number((readCount.rows[0] as any).cnt);

    let totalParents = 0;
    if (notice.audience_scope === "global") {
      const all = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_accounts WHERE swimming_pool_id IS NOT NULL`);
      totalParents = Number((all.rows[0] as any).cnt);
    } else if (notice.notice_type === "individual" && notice.student_id) {
      const links = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_students WHERE student_id = ${notice.student_id} AND status = 'approved'`);
      totalParents = Number((links.rows[0] as any).cnt);
    } else {
      const all = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_accounts WHERE swimming_pool_id = ${notice.swimming_pool_id}`);
      totalParents = Number((all.rows[0] as any).cnt);
    }

    res.json({ read_count: read, unread_count: Math.max(0, totalParents - read), total: totalParents });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /:id — 소프트 삭제 ────────────────────────────────────────────────
router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const poolId = (role === "super_admin" || role === "platform_admin")
      ? null
      : await getPoolId(req.user!.userId);

    const [notice] = await db.select({ swimming_pool_id: noticesTable.swimming_pool_id, status: noticesTable.status, audience_scope: noticesTable.audience_scope })
      .from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (notice.status === "deleted") return err(res, 404, "이미 삭제된 공지입니다.");
    // pool_admin은 자기 수영장 pool 공지만 삭제 가능 (global 공지는 super_admin만)
    if (poolId) {
      if (notice.audience_scope === "global") return err(res, 403, "전체 공지는 슈퍼관리자만 삭제할 수 있습니다.");
      if (notice.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.update(noticesTable)
      .set({ status: "deleted", updated_at: new Date() })
      .where(eq(noticesTable.id, req.params.id));

    const logPoolId = notice.swimming_pool_id || "global";
    logPoolEvent({ pool_id: logPoolId, event_type: "notice_delete", entity_type: "notice", entity_id: req.params.id, actor_id: req.user!.userId, payload: { audience_scope: notice.audience_scope } }).catch(console.error);
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PATCH /:id — 수정 (재발송 포함) ─────────────────────────────────────────
router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned, resend_push } = req.body;
  try {
    const role = req.user!.role;
    const poolId = (role === "super_admin" || role === "platform_admin")
      ? null
      : await getPoolId(req.user!.userId);

    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (poolId && notice.audience_scope === "pool" && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const updates: any = { updated_at: new Date() };
    if (title     !== undefined) updates.title     = title;
    if (content   !== undefined) updates.content   = content;
    if (is_pinned !== undefined) updates.is_pinned = is_pinned;

    await db.update(noticesTable).set(updates).where(eq(noticesTable.id, req.params.id));

    // 재발송 (스위치 ON 시에만, 기본 OFF)
    if (resend_push) {
      const finalTitle = title || notice.title;

      setImmediate(async () => {
        try {
          if (notice.audience_scope === "global") {
            await sendPushToAllUsers("notice", "[스윔노트] 공지사항 (수정)", finalTitle, { noticeId: req.params.id }, `notice_re_${req.params.id}`);
          } else if (notice.swimming_pool_id) {
            const targetPoolId = notice.swimming_pool_id;
            const poolInfoRows = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${targetPoolId} LIMIT 1`).catch(() => null);
            const poolName = (poolInfoRows?.rows[0] as any)?.name || "수영장";
            const pushTitle = `[${poolName}] 공지사항 (수정)`;
            await Promise.allSettled([
              sendPushToPoolParents(targetPoolId, "notice", pushTitle, finalTitle, { noticeId: req.params.id }, `notice_re_${req.params.id}`),
              sendPushToPoolAdmins(targetPoolId, "notice", pushTitle, finalTitle, { noticeId: req.params.id }, `notice_re_${req.params.id}`),
              sendPushToPoolTeachers(targetPoolId, "notice", pushTitle, finalTitle, { noticeId: req.params.id }, `notice_re_${req.params.id}`),
            ]);
          }
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
