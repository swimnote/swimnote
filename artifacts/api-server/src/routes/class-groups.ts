import { Router } from "express";
import { db } from "@workspace/db";
import { classGroupsTable, studentsTable, attendanceTable, usersTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

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
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, schedule_days, schedule_time, instructor, level, capacity, description } = req.body;
  if (!name || !schedule_days || !schedule_time) {
    return err(res, 400, "이름, 수업 요일, 수업 시간을 입력해주세요.");
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const id = `cg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [group] = await db.insert(classGroupsTable).values({
      id, swimming_pool_id: poolId, name, schedule_days, schedule_time,
      instructor: instructor || null, level: level || null,
      capacity: capacity || null, description: description || null,
    }).returning();
    res.status(201).json({ success: true, ...group, student_count: 0 });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [group] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!group) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");

    // pool_admin, teacher는 자신의 풀 반만 조회 가능
    if (req.user!.role !== "super_admin" && poolId && group.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    res.json(group);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/students", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [group] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
      .from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!group) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && group.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    const students = await db.select().from(studentsTable).where(eq(studentsTable.class_group_id, req.params.id));
    res.json(students);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  const { date } = req.query;
  if (!date) return err(res, 400, "date 파라미터가 필요합니다.");
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [group] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
      .from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!group) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && group.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const students = await db.select().from(studentsTable).where(eq(studentsTable.class_group_id, req.params.id));
    const attRecords = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.class_group_id, req.params.id), eq(attendanceTable.date, date as string)));

    const attMap = Object.fromEntries(attRecords.map(a => [a.student_id, a.status]));
    const result = students.map(s => ({
      student_id: s.id, student_name: s.name, status: attMap[s.id] || null,
    }));
    res.json(result);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, schedule_days, schedule_time, instructor, level, capacity, description } = req.body;
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
      .from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

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
    res.json({ success: true, ...group });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
      .from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.update(studentsTable).set({ class_group_id: null }).where(eq(studentsTable.class_group_id, req.params.id));
    await db.delete(classGroupsTable).where(eq(classGroupsTable.id, req.params.id));
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
