import { Router } from "express";
import { db } from "@workspace/db";
import { swimmingPoolsTable, usersTable, membersTable, subscriptionsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

router.post("/apply", requireAuth, async (req: AuthRequest, res) => {
  const { name, address, phone, owner_name } = req.body;
  if (!name || !address || !phone || !owner_name) {
    res.status(400).json({ error: "모든 필드를 입력해주세요." });
    return;
  }
  try {
    const user = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user[0]) { res.status(404).json({ error: "사용자를 찾을 수 없습니다." }); return; }

    const id = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [pool] = await db.insert(swimmingPoolsTable).values({
      id,
      name,
      address,
      phone,
      owner_name,
      owner_email: user[0].email,
      approval_status: "pending",
      subscription_status: "trial",
    }).returning();

    await db.update(usersTable).set({ swimming_pool_id: pool.id }).where(eq(usersTable.id, req.user!.userId));
    res.status(201).json(pool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/my", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user[0]?.swimming_pool_id) {
      res.status(404).json({ error: "소속된 수영장이 없습니다." });
      return;
    }
    const [pool] = await db.select().from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, user[0].swimming_pool_id)).limit(1);
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
