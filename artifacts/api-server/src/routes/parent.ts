import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { parentAccountsTable, parentStudentsTable, studentsTable, attendanceTable, noticesTable, classGroupsTable, swimmingPoolsTable, studentRegistrationRequestsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function requireParent(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "parent_account") {
    res.status(403).json({ error: "학부모 계정만 접근 가능합니다." }); return;
  }
  next();
}

router.get("/me", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const [pool] = await db.select({ id: swimmingPoolsTable.id, name: swimmingPoolsTable.name }).from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, pa.swimming_pool_id)).limit(1);
    res.json({ id: pa.id, name: pa.name, phone: pa.phone, swimming_pool_id: pa.swimming_pool_id, pool_name: pool?.name || null });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/students", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const links = await db.select().from(parentStudentsTable).where(
      and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.status, "approved"))
    );
    const students = await Promise.all(links.map(async (link) => {
      const [s] = await db.select().from(studentsTable).where(eq(studentsTable.id, link.student_id)).limit(1);
      if (!s) return null;
      let class_group: { name: string; schedule_days: string; schedule_time: string } | null = null;
      if (s.class_group_id) {
        const [grp] = await db.select({ name: classGroupsTable.name, schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time })
          .from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
        if (grp) class_group = grp;
      }
      return { ...s, class_group };
    }));
    res.json(students.filter(Boolean));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/students/:id", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [s] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!s) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

    let class_group: any = null;
    if (s.class_group_id) {
      const [grp] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
      class_group = grp || null;
    }
    res.json({ ...s, class_group });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/students/:id/attendance", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { month } = req.query;
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    let records = await db.select().from(attendanceTable).where(eq(attendanceTable.student_id, req.params.id));
    if (month) records = records.filter(r => r.date.startsWith(month as string));
    res.json(records.sort((a, b) => b.date.localeCompare(a.date)));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/student-requests", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const reqs = await db.select().from(studentRegistrationRequestsTable)
      .where(eq(studentRegistrationRequestsTable.parent_id, req.user!.userId));
    res.json(reqs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/student-requests", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { child_name, child_birth_date, memo } = req.body;
  if (!child_name) { res.status(400).json({ error: "자녀 이름을 입력해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const id = `srr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [newReq] = await db.insert(studentRegistrationRequestsTable).values({
      id, swimming_pool_id: pa.swimming_pool_id, parent_id: pa.id,
      child_name, child_birth_date: child_birth_date || null, memo: memo || null, status: "pending",
    }).returning();
    res.status(201).json(newReq);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/notices", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const notices = await db.select().from(noticesTable).where(
      and(eq(noticesTable.swimming_pool_id, pa.swimming_pool_id), eq(noticesTable.notice_type, "general"))
    );

    const readRows = await db.execute(sql`SELECT notice_id FROM notice_reads WHERE parent_id = ${pa.id}`);
    const readSet = new Set((readRows.rows as any[]).map((r: any) => r.notice_id));

    const result = notices.map(n => ({ ...n, is_read: readSet.has(n.id) }));
    result.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/notices/:id/read", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const readId = `nr_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    await db.execute(sql`
      INSERT INTO notice_reads (id, notice_id, parent_id)
      VALUES (${readId}, ${req.params.id}, ${pa.id})
      ON CONFLICT (notice_id, parent_id) DO NOTHING
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 자녀 수영일지 조회 (class_diaries 기반) ───────────────────
router.get("/students/:id/diary", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [student] = await db.select({ id: studentsTable.id, class_group_id: studentsTable.class_group_id })
      .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student?.class_group_id) { res.json([]); return; }

    const { month } = req.query;

    // 공통 일지 조회 (삭제된 것 제외)
    const diaryRows = await db.execute(sql`
      SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.is_edited, cd.created_at
      FROM class_diaries cd
      WHERE cd.class_group_id = ${student.class_group_id}
        AND cd.is_deleted = false
        ${month ? sql`AND cd.lesson_date LIKE ${month + "%"}` : sql``}
      ORDER BY cd.lesson_date DESC, cd.created_at DESC
      LIMIT 50
    `);

    // 각 일지에서 해당 학생의 추가 일지 조인
    const result = await Promise.all((diaryRows.rows as any[]).map(async (diary) => {
      const noteRows = await db.execute(sql`
        SELECT id, note_content, is_edited, created_at
        FROM class_diary_student_notes
        WHERE diary_id = ${diary.id} AND student_id = ${req.params.id} AND is_deleted = false
        LIMIT 1
      `);
      return {
        id: diary.id,
        lesson_date: diary.lesson_date,
        common_content: diary.common_content,
        teacher_name: diary.teacher_name,
        is_edited: diary.is_edited,
        created_at: diary.created_at,
        student_note: (noteRows.rows[0] as any) || null,
      };
    }));

    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 모든 자녀 일지 조회 ─────────────────────────────────────────
router.get("/diary", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const links = await db.select().from(parentStudentsTable).where(
      and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.status, "approved"))
    );
    if (!links.length) { res.json([]); return; }

    const studentIds = links.map(l => l.student_id);
    const studentsData: any[] = [];
    for (const sid of studentIds) {
      const [s] = await db.select({ id: studentsTable.id, class_group_id: studentsTable.class_group_id, name: studentsTable.name })
        .from(studentsTable).where(eq(studentsTable.id, sid)).limit(1);
      if (s?.class_group_id) studentsData.push(s);
    }
    if (!studentsData.length) { res.json([]); return; }

    const result: any[] = [];
    for (const student of studentsData) {
      const diaryRows = await db.execute(sql`
        SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.is_edited, cd.created_at, cd.class_group_id
        FROM class_diaries cd
        WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC, cd.created_at DESC
        LIMIT 20
      `);
      for (const diary of diaryRows.rows as any[]) {
        const noteRows = await db.execute(sql`
          SELECT id, note_content, is_edited FROM class_diary_student_notes
          WHERE diary_id = ${diary.id} AND student_id = ${student.id} AND is_deleted = false LIMIT 1
        `);
        result.push({
          ...diary, student_id: student.id, student_name: student.name,
          student_note: (noteRows.rows[0] as any) || null,
        });
      }
    }
    result.sort((a, b) => b.lesson_date.localeCompare(a.lesson_date));
    res.json(result.slice(0, 50));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

export default router;
