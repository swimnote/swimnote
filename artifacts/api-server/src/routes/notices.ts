import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { noticesTable, usersTable, studentsTable, parentAccountsTable, parentStudentsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }
    const notices = await db.select().from(noticesTable).where(eq(noticesTable.swimming_pool_id, poolId));
    res.json(notices.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned, notice_type, student_id, image_urls } = req.body;
  if (!title || !content) { res.status(400).json({ error: "제목과 내용을 입력해주세요." }); return; }
  const imgs: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 5) : [];
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

    let studentName: string | null = null;
    if (notice_type === "individual" && student_id) {
      const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
      studentName = s?.name || null;
    }

    const id = `notice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [notice] = await db.insert(noticesTable).values({
      id,
      swimming_pool_id: poolId,
      title,
      content,
      author_id: req.user!.userId,
      author_name: user?.name || "관리자",
      is_pinned: is_pinned === true,
      notice_type: notice_type === "individual" ? "individual" : "general",
      student_id: notice_type === "individual" ? (student_id || null) : null,
      student_name: studentName,
      image_urls: imgs,
    }).returning();
    res.status(201).json(notice);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/:id/read-stats", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) { res.status(404).json({ error: "공지를 찾을 수 없습니다." }); return; }

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
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(noticesTable).where(eq(noticesTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

export default router;
