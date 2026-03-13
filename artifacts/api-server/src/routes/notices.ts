import { Router } from "express";
import { db } from "@workspace/db";
import { noticesTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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

    const notices = await db.select().from(noticesTable)
      .where(eq(noticesTable.swimming_pool_id, poolId))
      .orderBy(noticesTable.created_at);
    res.json(notices.reverse());
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned } = req.body;
  if (!title || !content) { res.status(400).json({ error: "제목과 내용을 입력해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

    const id = `notice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [notice] = await db.insert(noticesTable).values({
      id,
      swimming_pool_id: poolId,
      title,
      content,
      author_id: req.user!.userId,
      author_name: user?.name || "관리자",
      is_pinned: is_pinned === true,
    }).returning();
    res.status(201).json(notice);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(noticesTable).where(eq(noticesTable.id, req.params.id));
    res.json({ success: true, message: "공지사항이 삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
