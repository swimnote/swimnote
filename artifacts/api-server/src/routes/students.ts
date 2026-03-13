import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable, classGroupsTable, parentStudentsTable, parentAccountsTable, usersTable, attendanceTable } from "@workspace/db/schema";
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
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, class_group_id, memo, notes } = req.body;
  if (!name) { res.status(400).json({ error: "이름을 입력해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }
    const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [student] = await db.insert(studentsTable).values({
      id, swimming_pool_id: poolId, name,
      phone: phone || null, birth_date: birth_date || null,
      class_group_id: class_group_id || null, memo: memo || null, notes: notes || null,
    }).returning();
    res.status(201).json({ ...student, class_group_name: null });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }
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
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, class_group_id, memo, notes } = req.body;
  try {
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
    res.json(student);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(parentStudentsTable).where(eq(parentStudentsTable.student_id, req.params.id));
    await db.delete(studentsTable).where(eq(studentsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// 출결 조회 — 학생 개인 기준 누적 기록 (시간표 그룹 변경과 무관)
router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { month } = req.query;
    let records = await db.select().from(attendanceTable)
      .where(eq(attendanceTable.student_id, req.params.id));
    if (month) records = records.filter(r => r.date.startsWith(month as string));
    res.json(records.sort((a, b) => a.date.localeCompare(b.date)));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// 출결 최초 입력 (선생님·관리자 가능) — 이미 존재하면 관리자만 덮어쓸 수 있음
router.post("/:id/attendance", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { date, status } = req.body;
  if (!date || !["present", "absent"].includes(status)) {
    res.status(400).json({ error: "날짜와 출결 상태(present/absent)를 입력해주세요." }); return;
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [actor] = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const actorName = actor?.name || req.user!.userId;
    const actorRole = actor?.role || req.user!.role;

    const existing = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.student_id, req.params.id), eq(attendanceTable.date, date))).limit(1);

    if (existing.length > 0) {
      // 이미 기록 있음 → 관리자(super_admin, pool_admin)만 수정 가능
      if (actorRole !== "super_admin" && actorRole !== "pool_admin") {
        res.status(403).json({ error: "이미 입력된 출결은 관리자만 수정할 수 있습니다." }); return;
      }
      const [updated] = await db.update(attendanceTable)
        .set({
          status,
          updated_at: new Date(),
          modified_by: req.user!.userId,
          modified_by_name: actorName,
        })
        .where(eq(attendanceTable.id, existing[0].id))
        .returning();
      res.json({ ...updated, was_modified: true });
    } else {
      const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const [created] = await db.insert(attendanceTable).values({
        id,
        student_id: req.params.id,
        swimming_pool_id: poolId,
        date,
        status,
        created_by: req.user!.userId,
        created_by_name: actorName,
      }).returning();
      res.status(201).json({ ...created, was_modified: false });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// 출결 수정 (관리자 전용)
router.patch("/:id/attendance/:attendanceId", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { status } = req.body;
  if (!["present", "absent"].includes(status)) {
    res.status(400).json({ error: "출결 상태는 present 또는 absent여야 합니다." }); return;
  }
  try {
    const [actor] = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const actorName = actor?.name || req.user!.userId;
    const [updated] = await db.update(attendanceTable)
      .set({
        status,
        updated_at: new Date(),
        modified_by: req.user!.userId,
        modified_by_name: actorName,
      })
      .where(eq(attendanceTable.id, req.params.attendanceId))
      .returning();
    if (!updated) { res.status(404).json({ error: "출결 기록을 찾을 수 없습니다." }); return; }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// 출결 삭제 (관리자 전용)
router.delete("/:id/attendance/:attendanceId", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(attendanceTable).where(eq(attendanceTable.id, req.params.attendanceId));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

export default router;
