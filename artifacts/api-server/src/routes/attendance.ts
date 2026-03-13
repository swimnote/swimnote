import { Router } from "express";
import { db } from "@workspace/db";
import { attendanceTable, studentsTable, usersTable, parentAccountsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

async function getPoolId(userId: string, role: string): Promise<string | null> {
  if (role === "parent_account") return userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

async function getPoolIdForParent(parentId: string): Promise<string | null> {
  const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, parentId)).limit(1);
  return pa?.swimming_pool_id || null;
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = (req.user as { role: string }).role;
    let poolId: string | null;
    if (role === "parent_account") {
      poolId = await getPoolIdForParent(req.user!.userId);
    } else {
      poolId = await getPoolId(req.user!.userId, role);
    }
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const { class_group_id, student_id, date, month } = req.query;

    let records = await db.select().from(attendanceTable).where(eq(attendanceTable.swimming_pool_id, poolId));

    if (class_group_id) records = records.filter(r => r.class_group_id === class_group_id);
    if (student_id) records = records.filter(r => r.student_id === student_id);
    if (date) records = records.filter(r => r.date === date as string);
    if (month) records = records.filter(r => r.date.startsWith(month as string));

    const enriched = await Promise.all(records.map(async (r) => {
      let student_name: string | null = null;
      if (r.student_id) {
        const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, r.student_id)).limit(1);
        student_name = s?.name || null;
      }
      return { ...r, student_name };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const { class_group_id, student_id, date, status } = req.body;
  if (!student_id || !date || !status) {
    res.status(400).json({ error: "student_id, date, status가 필요합니다." }); return;
  }
  if (!["present", "absent"].includes(status)) {
    res.status(400).json({ error: "status는 present 또는 absent여야 합니다." }); return;
  }
  try {
    const role = (req.user as { role: string }).role;
    const poolId = await getPoolId(req.user!.userId, role);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [existing] = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.student_id, student_id), eq(attendanceTable.date, date))).limit(1);

    if (existing) {
      const [updated] = await db.update(attendanceTable)
        .set({ status, class_group_id: class_group_id || existing.class_group_id })
        .where(eq(attendanceTable.id, existing.id))
        .returning();
      const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
      res.json({ ...updated, student_name: s?.name || null }); return;
    }

    const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [record] = await db.insert(attendanceTable).values({
      id, swimming_pool_id: poolId, class_group_id: class_group_id || null, student_id, date, status,
    }).returning();
    const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
    res.status(201).json({ ...record, student_name: s?.name || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
