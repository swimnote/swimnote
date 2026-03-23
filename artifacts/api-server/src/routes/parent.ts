import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { parentAccountsTable, parentStudentsTable, studentsTable, attendanceTable, noticesTable, classGroupsTable, swimmingPoolsTable, studentRegistrationRequestsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword, comparePassword } from "../lib/auth.js";
import { logChange } from "../utils/change-logger.js";

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

router.put("/me", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { name, phone, current_password, new_password } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "이름을 입력해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    let newHash: string | undefined;
    if (new_password) {
      if (!current_password) { res.status(400).json({ error: "현재 비밀번호를 입력해주세요." }); return; }
      const valid = await comparePassword(current_password, pa.pin_hash);
      if (!valid) { res.status(400).json({ error: "현재 비밀번호가 올바르지 않습니다." }); return; }
      if (new_password.length < 4) { res.status(400).json({ error: "새 비밀번호는 4자 이상이어야 합니다." }); return; }
      newHash = await hashPassword(new_password);
    }

    await db.update(parentAccountsTable)
      .set({
        name: name.trim(),
        phone: phone?.trim() || pa.phone,
        ...(newHash ? { pin_hash: newHash } : {}),
        updated_at: new Date(),
      })
      .where(eq(parentAccountsTable.id, pa.id));

    await logChange({ tenantId: pa.swimming_pool_id, tableName: "parent_accounts", recordId: pa.id, changeType: "update", payload: { name: name.trim() } });
    res.json({ success: true });
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
      // 아카이브 또는 최종퇴원(access_blocked): 학부모 접근 차단
      if ((s as any).status === "archived" || (s as any).archived_reason === "access_blocked") {
        // pool 이름 조회 (차단 메시지 표시용)
        const [pool] = await db.select({ name: swimmingPoolsTable.name })
          .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, (s as any).swimming_pool_id)).limit(1);
        return {
          id: s.id, name: (s as any).name,
          access_blocked: true,
          pool_name: pool?.name || "이 수영장",
          status: (s as any).status,
        };
      }
      let class_group: { name: string; schedule_days: string; schedule_time: string } | null = null;
      if (s.class_group_id) {
        const [grp] = await db.select({ name: classGroupsTable.name, schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time })
          .from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
        if (grp) class_group = grp;
      }
      return { ...s, class_group, access_blocked: false };
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

// ─── 학부모 전체 출결 (연결된 모든 자녀의 출결 통합) ──────────────────────
router.get("/attendance", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const pa = await db.execute(sql`SELECT id FROM parent_accounts WHERE id = ${req.user!.userId} LIMIT 1`);
    if (!pa.rows.length) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    const linkedStudents = await db.execute(sql`
      SELECT ps.student_id, s.name as student_name
      FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id = ${req.user!.userId} AND ps.status = 'approved'
    `);
    const studentIds = (linkedStudents.rows as any[]).map(r => r.student_id);
    const studentNames = Object.fromEntries((linkedStudents.rows as any[]).map(r => [r.student_id, r.student_name]));

    if (!studentIds.length) { res.json([]); return; }

    const records: any[] = [];
    for (const sid of studentIds) {
      const rows = await db.execute(sql`
        SELECT id, student_id as member_id, date, status
        FROM attendance
        WHERE student_id = ${sid}
        ORDER BY date DESC
      `);
      for (const r of rows.rows as any[]) {
        records.push({ ...r, member_name: studentNames[sid] || "" });
      }
    }
    records.sort((a, b) => b.date.localeCompare(a.date));
    res.json(records);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
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
    // general + class 모두 포함
    const notices = await db.select().from(noticesTable).where(eq(noticesTable.swimming_pool_id, pa.swimming_pool_id));

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

// ── 레벨 기록 ──────────────────────────────────────────────────────────────
router.get("/students/:id/levels", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    const rows = await db.execute(sql`
      SELECT id, level, achieved_date, note, teacher_name, created_at
      FROM student_levels WHERE student_id = ${req.params.id}
      ORDER BY achieved_date DESC, created_at DESC
    `);
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// GET /parent/students/:id/level-info — 현재 레벨 + 레벨 설명/학습내용/승급기준
const DEFAULT_LEVELS_P = Array.from({ length: 10 }, (_, i) => ({
  level_order: i + 1, level_name: String(i + 1),
  level_description: "", learning_content: "", promotion_test_rule: "",
  badge_type: "text", badge_label: String(i + 1),
  badge_color: "#1F8F86", badge_text_color: "#FFFFFF",
}));

router.get("/students/:id/level-info", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    const studRow = await db.execute(sql`
      SELECT current_level_order, swimming_pool_id FROM students WHERE id = ${req.params.id}
    `);
    const student = studRow.rows[0] as any;
    const poolId = student?.swimming_pool_id;
    const currentOrder = student?.current_level_order ?? null;
    const levelRows = await db.execute(sql`
      SELECT level_order, level_name, level_description, learning_content,
             promotion_test_rule, badge_type, badge_label, badge_color, badge_text_color, is_active
      FROM pool_level_settings WHERE pool_id = ${poolId}
      ORDER BY level_order ASC
    `);
    const allDefs = levelRows.rows.length > 0 ? (levelRows.rows as any[]) : DEFAULT_LEVELS_P;
    const activeDefs = allDefs.filter((l: any) => l.is_active !== false);
    const currentDef = currentOrder ? (allDefs.find((l: any) => l.level_order === currentOrder) ?? null) : null;
    const nextDef = currentOrder ? (activeDefs.find((l: any) => l.level_order > currentOrder) ?? null) : null;
    res.json({ current_level_order: currentOrder, current_level: currentDef, next_level: nextDef, all_levels: activeDefs });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 반응 (좋아요/감사합니다) ───────────────────────────────────────────────
router.get("/diary/:diaryId/reactions", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT reaction_type FROM diary_reactions
      WHERE diary_id = ${req.params.diaryId} AND parent_id = ${req.user!.userId}
    `);
    const myReactions = (rows.rows as any[]).map((r: any) => r.reaction_type);
    res.json({ myReactions });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.post("/diary/:diaryId/reactions", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { reaction_type } = req.body;
  if (!["like", "thank"].includes(reaction_type)) {
    res.status(400).json({ error: "유효하지 않은 반응 유형입니다." }); return;
  }
  try {
    const existing = await db.execute(sql`
      SELECT id FROM diary_reactions WHERE diary_id=${req.params.diaryId} AND parent_id=${req.user!.userId} AND reaction_type=${reaction_type}
    `);
    if (existing.rows.length > 0) {
      await db.execute(sql`DELETE FROM diary_reactions WHERE diary_id=${req.params.diaryId} AND parent_id=${req.user!.userId} AND reaction_type=${reaction_type}`);
      res.json({ active: false });
    } else {
      await db.execute(sql`
        INSERT INTO diary_reactions (diary_id, parent_id, reaction_type) VALUES (${req.params.diaryId}, ${req.user!.userId}, ${reaction_type})
        ON CONFLICT (diary_id, parent_id, reaction_type) DO NOTHING
      `);
      res.json({ active: true });
    }
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 쪽지 (메시지) ─────────────────────────────────────────────────────────
router.get("/diary/:diaryId/messages", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, sender_id, sender_name, sender_role, content, is_deleted, created_at
      FROM diary_messages WHERE diary_id = ${req.params.diaryId}
      ORDER BY created_at ASC
    `);
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.post("/diary/:diaryId/messages", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "내용을 입력해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const result = await db.execute(sql`
      INSERT INTO diary_messages (diary_id, sender_id, sender_name, sender_role, content)
      VALUES (${req.params.diaryId}, ${req.user!.userId}, ${pa.name}, 'parent', ${content.trim()})
      RETURNING *
    `);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.delete("/diary/:diaryId/messages/:msgId", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, sender_id FROM diary_messages WHERE id=${req.params.msgId} AND diary_id=${req.params.diaryId}
    `);
    if (!rows.rows.length) { res.status(404).json({ error: "메시지를 찾을 수 없습니다." }); return; }
    const msg = rows.rows[0] as any;
    if (msg.sender_id !== req.user!.userId) { res.status(403).json({ error: "본인 메시지만 삭제 가능합니다." }); return; }
    await db.execute(sql`UPDATE diary_messages SET is_deleted=true, deleted_at=now() WHERE id=${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.post("/diary/:diaryId/messages/:msgId/restore", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`SELECT sender_id FROM diary_messages WHERE id=${req.params.msgId}`);
    if (!rows.rows.length) { res.status(404).json({ error: "메시지를 찾을 수 없습니다." }); return; }
    const msg = rows.rows[0] as any;
    if (msg.sender_id !== req.user!.userId) { res.status(403).json({ error: "본인 메시지만 복구 가능합니다." }); return; }
    await db.execute(sql`UPDATE diary_messages SET is_deleted=false, deleted_at=null WHERE id=${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.delete("/diary/:diaryId/messages/:msgId/permanent", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`SELECT sender_id, is_deleted FROM diary_messages WHERE id=${req.params.msgId}`);
    if (!rows.rows.length) { res.status(404).json({ error: "메시지를 찾을 수 없습니다." }); return; }
    const msg = rows.rows[0] as any;
    if (msg.sender_id !== req.user!.userId) { res.status(403).json({ error: "본인 메시지만 영구삭제 가능합니다." }); return; }
    if (!msg.is_deleted) { res.status(400).json({ error: "먼저 삭제 처리 후 영구삭제 가능합니다." }); return; }
    await db.execute(sql`DELETE FROM diary_messages WHERE id=${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 최신소식 피드 (공지 + 수업일지 통합, 최대 10개) ─────────────────────
router.get("/students/:id/news", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);

    const readRows = await db.execute(sql`SELECT notice_id FROM notice_reads WHERE parent_id = ${pa.id}`);
    const readSet = new Set((readRows.rows as any[]).map((r: any) => r.notice_id));

    const news: any[] = [];

    // 공지사항 (최근 20개 → 피드에 섞기)
    const noticeRows = await db.select().from(noticesTable)
      .where(eq(noticesTable.swimming_pool_id, pa.swimming_pool_id));
    for (const n of noticeRows) {
      news.push({
        kind: "notice",
        id: n.id,
        title: n.title,
        content: n.content,
        notice_type: n.notice_type,
        is_read: readSet.has(n.id),
        is_pinned: n.is_pinned,
        author_name: n.author_name,
        created_at: n.created_at,
      });
    }

    // 수업일지 (최근 20개)
    if (student?.class_group_id) {
      const diaryRows = await db.execute(sql`
        SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.created_at,
               csn.note_content AS student_note
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn
          ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC LIMIT 20
      `);
      for (const d of diaryRows.rows as any[]) {
        news.push({
          kind: "diary",
          id: d.id,
          lesson_date: d.lesson_date,
          common_content: d.common_content,
          teacher_name: d.teacher_name,
          student_note: d.student_note || null,
          created_at: d.created_at,
        });
      }
    }

    news.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(news.slice(0, 10));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 안읽은 카운트 (공지 미열람 수) ───────────────────────────────────────
router.get("/students/:id/unread-counts", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);

    // 안읽은 공지 수
    const totalNotices = await db.execute(sql`SELECT COUNT(*) AS cnt FROM notices WHERE swimming_pool_id = ${pa.swimming_pool_id}`);
    const readNotices = await db.execute(sql`SELECT COUNT(*) AS cnt FROM notice_reads nr JOIN notices n ON n.id = nr.notice_id WHERE nr.parent_id = ${pa.id} AND n.swimming_pool_id = ${pa.swimming_pool_id}`);
    const unreadNotices = Number((totalNotices.rows[0] as any).cnt) - Number((readNotices.rows[0] as any).cnt);

    res.json({ unread_notices: Math.max(0, unreadNotices), unread_messages: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 교육 프로그램 (수영장별 1개 문서) ─────────────────────────────────────
router.get("/program", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    // pool_programs 테이블이 없으면 null 반환
    const rows = await db.execute(sql`
      SELECT id, title, content, updated_at, author_name
      FROM pool_programs WHERE swimming_pool_id = ${pa.swimming_pool_id} LIMIT 1
    `).catch(() => ({ rows: [] }));
    res.json(rows.rows[0] || null);
  } catch (err) { res.json(null); }
});

// ── 홈 피드 (최근 수업일지 + 사진) ──────────────────────────────────────
router.get("/students/:id/feed", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    const cgId = student?.class_group_id;

    const feed: any[] = [];

    if (cgId) {
      const diaryRows = await db.execute(sql`
        SELECT cd.id, cd.lesson_date AS date, cd.common_content, cd.teacher_name, cd.created_at,
               csn.note_content AS student_note
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        WHERE cd.class_group_id = ${cgId} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC LIMIT 10
      `);
      for (const d of diaryRows.rows as any[]) {
        feed.push({ type: "diary", id: d.id, date: d.date, teacher_name: d.teacher_name,
          content: d.common_content, student_note: d.student_note, created_at: d.created_at });
      }
    }

    const photoRows = await db.execute(sql`
      SELECT id, caption, uploader_name, created_at, storage_key, album_type
      FROM student_photos WHERE student_id = ${req.params.id}
      ORDER BY created_at DESC LIMIT 10
    `);
    for (const p of photoRows.rows as any[]) {
      feed.push({ type: "photo", id: p.id, date: (p.created_at as string).split("T")[0],
        teacher_name: p.uploader_name, content: p.caption, created_at: p.created_at, album_type: p.album_type });
    }

    feed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(feed.slice(0, 20));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── 학부모 호칭(닉네임) 수정 ─────────────────────────────────────────────
router.put("/nickname", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { nickname } = req.body;
  if (!nickname?.trim()) { res.status(400).json({ error: "호칭을 입력해주세요." }); return; }
  try {
    await db.execute(sql`UPDATE parent_accounts SET nickname = ${nickname.trim()}, updated_at = now() WHERE id = ${req.user!.userId}`);
    res.json({ success: true, nickname: nickname.trim() });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ─── 학부모 온보딩: 수영장 연결 + 자녀 자동 연결 ─────────────────────────
// POST /parent/onboard-pool
// body: { swimming_pool_id }
// 처리: 내 phone과 일치하는 student(parent_phone/parent_phone2) 검색
//       - 일치 → parent_students 생성(approved) + 학부모 swimming_pool_id 업데이트
//       - 불일치 → student_registration_requests 생성(pending)
router.post("/onboard-pool", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { swimming_pool_id } = req.body;
  if (!swimming_pool_id) { res.status(400).json({ error: "수영장을 선택해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    // 수영장 존재 확인
    const [pool] = await db.select({ id: swimmingPoolsTable.id, name: swimmingPoolsTable.name })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, swimming_pool_id)).limit(1);
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const myPhone = pa.phone;

    // 이미 이 수영장에 연결되어 있으면 스킵
    if (pa.swimming_pool_id && pa.swimming_pool_id !== swimming_pool_id) {
      // 다른 수영장 → 거부 (현재 MVP에서 다수 수영장 미지원)
    }

    // 해당 수영장에서 phone 일치하는 학생 검색
    const matchRows = await db.execute(sql`
      SELECT id, name FROM students
      WHERE swimming_pool_id = ${swimming_pool_id}
        AND (parent_phone = ${myPhone} OR parent_phone2 = ${myPhone})
        AND deleted_at IS NULL
    `);
    const matchedStudents = matchRows.rows as Array<{ id: string; name: string }>;

    // 이미 연결된 student 제외
    const existingLinks = await db.execute(sql`
      SELECT student_id FROM parent_students WHERE parent_id = ${pa.id}
    `);
    const linkedStudentIds = new Set((existingLinks.rows as any[]).map(r => r.student_id));

    let autoApproved = false;
    const linkedStudentNames: string[] = [];

    if (matchedStudents.length > 0) {
      // 자동 승인: 연결되지 않은 학생들 연결
      for (const student of matchedStudents) {
        if (linkedStudentIds.has(student.id)) continue;
        const linkId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.execute(sql`
          INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at, created_at)
          VALUES (${linkId}, ${pa.id}, ${student.id}, ${swimming_pool_id}, 'approved', now(), now())
          ON CONFLICT DO NOTHING
        `);
        linkedStudentNames.push(student.name);
      }
      autoApproved = true;
    } else {
      // 수동 승인 요청
      const reqId = `srr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO student_registration_requests (id, swimming_pool_id, parent_id, child_names, status, created_at)
        VALUES (${reqId}, ${swimming_pool_id}, ${pa.id}, ${"[]"}, 'pending', now())
        ON CONFLICT DO NOTHING
      `);
    }

    // 학부모 계정의 swimming_pool_id 업데이트 (없으면)
    if (!pa.swimming_pool_id) {
      await db.execute(sql`UPDATE parent_accounts SET swimming_pool_id = ${swimming_pool_id}, updated_at = now() WHERE id = ${pa.id}`);
    }

    res.json({
      success: true,
      auto_approved: autoApproved,
      pool_name: pool.name,
      linked_students: linkedStudentNames,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ─── 수영정보 (수영장 기본 정보 + 안내 콘텐츠) ─────────────────────────────
router.get("/pool-info", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select({ swimming_pool_id: parentAccountsTable.swimming_pool_id })
      .from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    const [pool] = await db.select({
      id: swimmingPoolsTable.id,
      name: swimmingPoolsTable.name,
      address: swimmingPoolsTable.address,
      phone: swimmingPoolsTable.phone,
    }).from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, pa.swimming_pool_id)).limit(1);

    if (!pool) { res.status(404).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    res.json({
      pool_name: pool.name,
      address: pool.address,
      phone: pool.phone,
      introduction: null,
      tuition_info: null,
      level_test_info: null,
      event_info: null,
      equipment_info: null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

export default router;

