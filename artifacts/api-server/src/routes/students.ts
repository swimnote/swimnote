import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable, classGroupsTable, parentStudentsTable, parentAccountsTable, usersTable, attendanceTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
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
    const students = await db.select().from(studentsTable).where(eq(studentsTable.swimming_pool_id, poolId));
    const enriched = await Promise.all(students.map(async (s) => {
      let class_group_name: string | null = null;
      if (s.class_group_id) {
        const [grp] = await db.select({ name: classGroupsTable.name }).from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
        class_group_name = grp?.name || null;
      }
      return { ...s, class_group_name };
    }));
    res.json(enriched);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, class_group_id, memo, notes } = req.body;
  if (!name) return err(res, 400, "이름을 입력해주세요.");
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    // class_group_id가 제공된 경우 해당 반이 동일 풀에 속하는지 검증
    if (class_group_id) {
      const [cg] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
        .from(classGroupsTable).where(eq(classGroupsTable.id, class_group_id)).limit(1);
      if (!cg || cg.swimming_pool_id !== poolId) return err(res, 403, "해당 반은 이 수영장에 속하지 않습니다.");
    }

    const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [student] = await db.insert(studentsTable).values({
      id, swimming_pool_id: poolId, name,
      phone: phone || null, birth_date: birth_date || null,
      class_group_id: class_group_id || null, memo: memo || null, notes: notes || null,
    }).returning();
    res.status(201).json({ success: true, ...student, class_group_name: null });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) return err(res, 404, "학생을 찾을 수 없습니다.");

    // pool_admin, teacher는 자신의 풀 데이터만 조회 가능
    if (req.user!.role !== "super_admin" && poolId && student.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    let class_group: any = null;
    if (student.class_group_id) {
      const [grp] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, student.class_group_id)).limit(1);
      class_group = grp || null;
    }
    const parentLinks = await db.select({ parent_id: parentStudentsTable.parent_id, status: parentStudentsTable.status })
      .from(parentStudentsTable).where(eq(parentStudentsTable.student_id, student.id));
    const parents = await Promise.all(parentLinks.map(async (link) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, link.parent_id)).limit(1);
      return pa ? { ...pa, link_status: link.status } : null;
    }));
    res.json({ ...student, class_group, parents: parents.filter(Boolean) });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, class_group_id, memo, notes } = req.body;
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select({ swimming_pool_id: studentsTable.swimming_pool_id })
      .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const [student] = await db.update(studentsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(birth_date !== undefined && { birth_date }),
        ...(class_group_id !== undefined && { class_group_id: class_group_id || null }),
        ...(memo !== undefined && { memo }),
        ...(notes !== undefined && { notes }),
        updated_at: new Date(),
      })
      .where(eq(studentsTable.id, req.params.id)).returning();
    res.json({ success: true, ...student });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select({ swimming_pool_id: studentsTable.swimming_pool_id })
      .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.delete(parentStudentsTable).where(eq(parentStudentsTable.student_id, req.params.id));
    await db.delete(studentsTable).where(eq(studentsTable.id, req.params.id));
    res.json({ success: true, message: "학생이 삭제되었습니다." });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { month } = req.query;
    let records = await db.select().from(attendanceTable)
      .where(eq(attendanceTable.student_id, req.params.id));
    if (month) records = records.filter(r => r.date.startsWith(month as string));
    res.json(records.sort((a, b) => a.date.localeCompare(b.date)));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/:id/attendance", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { date, status } = req.body;
  if (!date || !["present", "absent"].includes(status)) {
    return err(res, 400, "날짜와 출결 상태(present/absent)를 입력해주세요.");
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const [actor] = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const actorName = actor?.name || req.user!.userId;
    const actorRole = actor?.role || req.user!.role;

    const existing = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.student_id, req.params.id), eq(attendanceTable.date, date))).limit(1);

    if (existing.length > 0) {
      if (actorRole !== "super_admin" && actorRole !== "pool_admin") {
        return err(res, 403, "이미 입력된 출결은 관리자만 수정할 수 있습니다.");
      }
      const [updated] = await db.update(attendanceTable)
        .set({ status, updated_at: new Date(), modified_by: req.user!.userId, modified_by_name: actorName })
        .where(eq(attendanceTable.id, existing[0].id))
        .returning();
      res.json({ success: true, ...updated, was_modified: true });
    } else {
      const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const [created] = await db.insert(attendanceTable).values({
        id, student_id: req.params.id, swimming_pool_id: poolId,
        date, status, created_by: req.user!.userId, created_by_name: actorName,
      }).returning();
      res.status(201).json({ success: true, ...created, was_modified: false });
    }
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.patch("/:id/attendance/:attendanceId", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { status } = req.body;
  if (!["present", "absent"].includes(status)) return err(res, 400, "출결 상태는 present 또는 absent여야 합니다.");
  try {
    const [actor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const [updated] = await db.update(attendanceTable)
      .set({ status, updated_at: new Date(), modified_by: req.user!.userId, modified_by_name: actor?.name || req.user!.userId })
      .where(eq(attendanceTable.id, req.params.attendanceId))
      .returning();
    if (!updated) return err(res, 404, "출결 기록을 찾을 수 없습니다.");
    res.json({ success: true, ...updated });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id/attendance/:attendanceId", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(attendanceTable).where(eq(attendanceTable.id, req.params.attendanceId));
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
