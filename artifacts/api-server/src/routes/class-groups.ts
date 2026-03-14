import { Router } from "express";
import { db } from "@workspace/db";
import { classGroupsTable, studentsTable, attendanceTable, usersTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
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

    // 선생님 역할이면 자신이 담당하는 반만 반환
    let groups;
    if (req.user!.role === "teacher") {
      const rawRows = await db.execute(
        sql`SELECT * FROM class_groups WHERE swimming_pool_id = ${poolId} AND teacher_user_id = ${req.user!.userId}`
      );
      groups = rawRows.rows as any[];
    } else {
      groups = await db.select().from(classGroupsTable).where(eq(classGroupsTable.swimming_pool_id, poolId));
    }

    const enriched = await Promise.all(groups.map(async (g: any) => {
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(studentsTable)
        .where(and(eq(studentsTable.swimming_pool_id, poolId), eq(studentsTable.class_group_id, g.id)));
      return { ...g, student_count: Number(count) };
    }));

    res.json(enriched);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, schedule_days, schedule_time, instructor, level, capacity, description } = req.body;
  if (!name || !schedule_days || !schedule_time) {
    res.status(400).json({ error: "이름, 수업 요일, 수업 시간을 입력해주세요." }); return;
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const id = `cg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [group] = await db.insert(classGroupsTable).values({
      id,
      swimming_pool_id: poolId,
      name,
      schedule_days,
      schedule_time,
      instructor: instructor || null,
      level: level || null,
      capacity: capacity || null,
      description: description || null,
    }).returning();
    res.status(201).json({ ...group, student_count: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [group] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!group) { res.status(404).json({ error: "수업 그룹을 찾을 수 없습니다." }); return; }
    res.json(group);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/:id/students", requireAuth, async (req: AuthRequest, res) => {
  try {
    const students = await db.select().from(studentsTable).where(eq(studentsTable.class_group_id, req.params.id));
    res.json(students);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  const { date } = req.query;
  if (!date) { res.status(400).json({ error: "date 파라미터가 필요합니다." }); return; }
  try {
    const students = await db.select().from(studentsTable).where(eq(studentsTable.class_group_id, req.params.id));
    const attRecords = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.class_group_id, req.params.id), eq(attendanceTable.date, date as string)));

    const attMap = Object.fromEntries(attRecords.map(a => [a.student_id, a.status]));

    const result = students.map(s => ({
      student_id: s.id,
      student_name: s.name,
      status: attMap[s.id] || null,
    }));

    res.json(result);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, schedule_days, schedule_time, instructor, level, capacity, description } = req.body;
  try {
    const [group] = await db.update(classGroupsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(schedule_days !== undefined && { schedule_days }),
        ...(schedule_time !== undefined && { schedule_time }),
        ...(instructor !== undefined && { instructor }),
        ...(level !== undefined && { level }),
        ...(capacity !== undefined && { capacity }),
        ...(description !== undefined && { description }),
        updated_at: new Date(),
      })
      .where(eq(classGroupsTable.id, req.params.id))
      .returning();
    res.json(group);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.update(studentsTable).set({ class_group_id: null }).where(eq(studentsTable.class_group_id, req.params.id));
    await db.delete(classGroupsTable).where(eq(classGroupsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

export default router;
