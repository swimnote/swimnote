import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable, classGroupsTable, parentStudentsTable, parentAccountsTable, usersTable } from "@workspace/db/schema";
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
      id,
      swimming_pool_id: poolId,
      name,
      phone: phone || null,
      birth_date: birth_date || null,
      class_group_id: class_group_id || null,
      memo: memo || null,
      notes: notes || null,
    }).returning();
    res.status(201).json({ ...student, class_group_name: null });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

    let class_group_name: string | null = null;
    if (student.class_group_id) {
      const [grp] = await db.select({ name: classGroupsTable.name }).from(classGroupsTable).where(eq(classGroupsTable.id, student.class_group_id)).limit(1);
      class_group_name = grp?.name || null;
    }

    const parentLinks = await db.select({ parent_id: parentStudentsTable.parent_id })
      .from(parentStudentsTable).where(eq(parentStudentsTable.student_id, student.id));

    const parents = await Promise.all(parentLinks.map(async (link) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, link.parent_id)).limit(1);
      return pa;
    }));

    res.json({ ...student, class_group_name, parents: parents.filter(Boolean) });
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
      .where(eq(studentsTable.id, req.params.id))
      .returning();
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

router.post("/:id/parents", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { parent_id } = req.body;
  if (!parent_id) { res.status(400).json({ error: "parent_id가 필요합니다." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }
    const id = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [link] = await db.insert(parentStudentsTable).values({ id, parent_id, student_id: req.params.id, swimming_pool_id: poolId }).returning();
    res.status(201).json(link);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique")) { res.status(400).json({ error: "이미 연결된 학부모입니다." }); }
    else { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
  }
});

export default router;
