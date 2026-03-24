import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { noticesTable, usersTable, studentsTable, parentAccountsTable, parentStudentsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { sendPushToPoolParents, sendPushToClassParents } from "../lib/push-service.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");
    const notices = await db.select().from(noticesTable).where(
      and(eq(noticesTable.swimming_pool_id, poolId), eq(noticesTable.notice_type, "general"))
    );
    res.json(notices.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned, notice_type, student_id, image_urls } = req.body;
  if (!title || !content) return err(res, 400, "제목과 내용을 입력해주세요.");
  const imgs: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 5) : [];
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");
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

    // 공지 등록 시 학부모에게 푸시 알림 (비동기, 실패해도 응답에 영향 없음)
    try {
      const poolSettings = await db.execute(sql`
        SELECT COALESCE(tpl_notice, '📢 새 공지사항이 등록되었습니다.') AS template
        FROM pool_push_settings WHERE pool_id = ${poolId} LIMIT 1
      `);
      const tpl = (poolSettings.rows[0] as any)?.template ?? "📢 새 공지사항이 등록되었습니다.";
      const pushBody = `[${user?.name || "관리자"}] ${title}`;

      if (notice_type === "individual" && student_id) {
        // 개인 공지 → 해당 학생의 학부모에게만
        const parentRows = await db.execute(sql`
          SELECT parent_id AS parent_account_id FROM parent_students
          WHERE student_id = ${student_id} AND status = 'approved'
        `);
        for (const p of parentRows.rows as any[]) {
          const { sendPushToUser } = await import("../lib/push-service.js");
          await sendPushToUser(p.parent_account_id, true, "notice", "📢 공지사항", pushBody, { noticeId: id }, `notice_${id}`);
        }
      } else {
        // 일반 공지 → 수영장 전체 학부모
        await sendPushToPoolParents(poolId, "notice", "📢 공지사항", pushBody, { noticeId: id }, `notice_${id}`);
      }
    } catch { /* 푸시 실패는 무시 */ }

    res.status(201).json({ success: true, ...notice });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/read-stats", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");

    // pool_admin은 자신의 풀 공지만 조회
    if (req.user!.role !== "super_admin" && poolId && notice.swimming_pool_id !== poolId) {
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

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [notice] = await db.select({ swimming_pool_id: noticesTable.swimming_pool_id })
      .from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.delete(noticesTable).where(eq(noticesTable.id, req.params.id));
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
