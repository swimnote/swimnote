import { Router } from "express";
import { db } from "@workspace/db";
import {
  studentsTable, classGroupsTable, parentStudentsTable,
  parentAccountsTable, usersTable, attendanceTable,
} from "@workspace/db/schema";
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

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** 반 배정 정보 enrichment */
async function enrichWithClasses(student: any) {
  const assignedIds: string[] = Array.isArray(student.assigned_class_ids)
    ? student.assigned_class_ids
    : (typeof student.assigned_class_ids === "string"
      ? JSON.parse(student.assigned_class_ids || "[]")
      : []);

  if (assignedIds.length === 0) return { ...student, assignedClasses: [] };

  const classes = await Promise.all(assignedIds.map(async (id: string) => {
    const [cg] = await db.select({
      id: classGroupsTable.id, name: classGroupsTable.name,
      schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time,
      instructor: classGroupsTable.instructor,
    }).from(classGroupsTable).where(eq(classGroupsTable.id, id)).limit(1);
    return cg || null;
  }));

  const validClasses = classes.filter(Boolean);

  // schedule_labels 자동 생성: 월4·목7 형식
  const labels = validClasses.map((c: any) => {
    if (!c) return "";
    const days = c.schedule_days.split(",").map((d: string) => d.trim());
    const hour = c.schedule_time.split(":")[0];
    return days.map((d: string) => `${d}${hour}`).join("·");
  }).filter(Boolean).join("·");

  return { ...student, assignedClasses: validClasses, schedule_labels: labels };
}

// ── GET / ──────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId && req.user!.role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    let students: any[];

    if (req.user!.role === "teacher") {
      // teacher: 본인이 담당하는 반에 배정된 학생만 반환 (삭제된 반 제외)
      const teacherClasses = await db.select({ id: classGroupsTable.id })
        .from(classGroupsTable)
        .where(and(
          eq(classGroupsTable.swimming_pool_id, poolId!),
          eq(classGroupsTable.teacher_user_id, req.user!.userId),
          eq(classGroupsTable.is_deleted, false)
        ));
      const classIds = teacherClasses.map(c => c.id);
      if (classIds.length === 0) {
        return res.json([]);
      }
      const classIdsLiteral = classIds.map(id => `'${id}'`).join(",");
      students = await db.select().from(studentsTable)
        .where(and(
          eq(studentsTable.swimming_pool_id, poolId!),
          sql`status NOT IN ('withdrawn', 'deleted')`,
          sql`(
            class_group_id = ANY(ARRAY[${sql.raw(classIdsLiteral)}])
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(assigned_class_ids, '[]'::jsonb)) AS cid
              WHERE cid = ANY(ARRAY[${sql.raw(classIdsLiteral)}])
            )
          )`
        ));
    } else {
      students = await db.select().from(studentsTable)
        .where(and(
          eq(studentsTable.swimming_pool_id, poolId!),
          sql`status NOT IN ('withdrawn', 'deleted')`
        ));
    }

    const enriched = await Promise.all(students.map(async (s) => {
      let class_group_name: string | null = null;
      if (s.class_group_id) {
        const [grp] = await db.select({ name: classGroupsTable.name }).from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
        class_group_name = grp?.name || null;
      }
      const withClasses = await enrichWithClasses({ ...s, class_group_name });
      return withClasses;
    }));

    res.json(enriched.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST / — 학생 등록 ────────────────────────────────────────────
router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const {
    name, phone, birth_date, birth_year, parent_name, parent_phone,
    parent_user_id, class_group_id, memo, weekly_count = 1,
    registration_path = "admin_created", force_create = false,
  } = req.body;

  if (!name?.trim()) return err(res, 400, "학생 이름을 입력해주세요.");

  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    // ── 중복 체크 ──────────────────────────────────────────────────
    if (!force_create && (birth_year || parent_phone)) {
      const dupRows = await db.execute(sql`
        SELECT id, name, birth_year, parent_phone, status
        FROM students
        WHERE swimming_pool_id = ${poolId}
          AND status != 'withdrawn'
          AND name = ${name.trim()}
          AND (
            ${birth_year ? sql`birth_year = ${birth_year}` : sql`FALSE`}
            OR ${parent_phone ? sql`parent_phone = ${parent_phone}` : sql`FALSE`}
          )
        LIMIT 5
      `);

      if (dupRows.rows.length > 0) {
        const exact = (dupRows.rows as any[]).find(r =>
          r.name === name.trim() &&
          (!birth_year || r.birth_year === birth_year) &&
          (!parent_phone || r.parent_phone === parent_phone)
        );
        if (exact) {
          return res.status(409).json({
            success: false,
            duplicate: true,
            existing: exact,
            message: "동일한 학생이 이미 등록되어 있습니다.",
          });
        }
        return res.status(200).json({
          success: false,
          possible_duplicate: true,
          candidates: dupRows.rows,
          message: "유사한 학생 정보가 있습니다. 계속 등록하시겠습니까?",
        });
      }
    }

    // ── 초대코드 생성 ──────────────────────────────────────────────
    const invite_code = registration_path === "admin_created" ? generateInviteCode() : null;

    // ── 상태 결정 ──────────────────────────────────────────────────
    const status = parent_user_id
      ? "active"
      : (registration_path === "admin_created" && (parent_phone || parent_name))
        ? "pending_parent_link"
        : "active";

    const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [student] = await db.insert(studentsTable).values({
      id,
      swimming_pool_id: poolId,
      name: name.trim(),
      phone: phone || null,
      birth_date: birth_date || null,
      birth_year: birth_year || null,
      parent_name: parent_name || null,
      parent_phone: parent_phone || null,
      parent_user_id: parent_user_id || null,
      class_group_id: class_group_id || null,
      memo: memo || null,
      status,
      registration_path,
      weekly_count: Number(weekly_count) || 1,
      invite_code,
      assigned_class_ids: [],
      schedule_labels: null,
    }).returning();

    const enriched = await enrichWithClasses({ ...student, class_group_name: null });
    res.status(201).json({ success: true, ...enriched });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /:id ───────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) return err(res, 404, "학생을 찾을 수 없습니다.");

    if (req.user!.role !== "super_admin" && poolId && student.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // 단일 class_group
    let class_group: any = null;
    if (student.class_group_id) {
      const [grp] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, student.class_group_id)).limit(1);
      class_group = grp || null;
    }

    // 학부모 연결
    const parentLinks = await db.select({ parent_id: parentStudentsTable.parent_id, status: parentStudentsTable.status })
      .from(parentStudentsTable).where(eq(parentStudentsTable.student_id, student.id));
    const parents = await Promise.all(parentLinks.map(async (link) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, link.parent_id)).limit(1);
      return pa ? { ...pa, link_status: link.status } : null;
    }));

    const enriched = await enrichWithClasses({ ...student, class_group, parents: parents.filter(Boolean) });
    res.json(enriched);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PATCH /:id — 기본 정보 수정 ─────────────────────────────────────
router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, birth_year, parent_name, parent_phone, class_group_id, memo, weekly_count, status } = req.body;
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
        ...(birth_year !== undefined && { birth_year }),
        ...(parent_name !== undefined && { parent_name }),
        ...(parent_phone !== undefined && { parent_phone }),
        ...(class_group_id !== undefined && { class_group_id: class_group_id || null }),
        ...(memo !== undefined && { memo }),
        ...(weekly_count !== undefined && { weekly_count: Number(weekly_count) }),
        ...(status !== undefined && { status }),
        updated_at: new Date(),
      })
      .where(eq(studentsTable.id, req.params.id))
      .returning();

    const enriched = await enrichWithClasses(student);
    res.json({ success: true, ...enriched });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PATCH /:id/assign — 반 배정 (관리자 + 선생님 허용) ─────────────
router.patch("/:id/assign", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { assigned_class_ids, weekly_count } = req.body;
  if (!Array.isArray(assigned_class_ids)) return err(res, 400, "assigned_class_ids는 배열이어야 합니다.");

  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // 선생님 scope check: 배정하려는 반이 모두 본인 담당인지 확인
    if (req.user!.role === "teacher" && assigned_class_ids.length > 0) {
      const myClasses = await db.select({ id: classGroupsTable.id })
        .from(classGroupsTable)
        .where(and(
          eq(classGroupsTable.swimming_pool_id, poolId!),
          eq(classGroupsTable.teacher_user_id, req.user!.userId),
          eq(classGroupsTable.is_deleted, false)
        ));
      const myClassIds = new Set(myClasses.map(c => c.id));
      const unauthorized = assigned_class_ids.filter((id: string) => !myClassIds.has(id));
      if (unauthorized.length > 0) {
        return err(res, 403, "본인이 담당하는 반에만 학생을 배정할 수 있습니다.");
      }
    }

    const wc = weekly_count !== undefined ? Number(weekly_count) : (existing.weekly_count || 1);

    // 배정된 class의 schedule_labels 계산
    const classes = await Promise.all(assigned_class_ids.map(async (id: string) => {
      const [cg] = await db.select({
        id: classGroupsTable.id, name: classGroupsTable.name,
        schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time,
      }).from(classGroupsTable).where(eq(classGroupsTable.id, id)).limit(1);
      return cg || null;
    }));

    const validClasses = classes.filter(Boolean) as any[];
    const labels = validClasses.map((c: any) => {
      const days = c.schedule_days.split(",").map((d: string) => d.trim());
      const hour = c.schedule_time.split(":")[0];
      return days.map((d: string) => `${d}${hour}`).join("·");
    }).join("·");

    // students에 first class_group_id도 업데이트 (하위 호환)
    const firstClassId = assigned_class_ids[0] || null;

    const [student] = await db.update(studentsTable)
      .set({
        assigned_class_ids: assigned_class_ids as any,
        weekly_count: wc,
        schedule_labels: labels || null,
        class_group_id: firstClassId,
        status: "active",
        updated_at: new Date(),
      })
      .where(eq(studentsTable.id, req.params.id))
      .returning();

    // class_groups의 student_count는 GET 때 집계이므로 별도 업데이트 불필요
    const enriched = await enrichWithClasses({ ...student, assignedClasses: validClasses });
    res.json({ success: true, ...enriched });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /:id — 운영목록에서 제거 (soft delete, 기록 보존) ────────
router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && (existing as any).swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    if ((existing as any).status === "deleted") {
      return res.json({ success: true, message: "이미 삭제회원으로 처리된 학생입니다." });
    }

    const sid = req.params.id;
    console.log(`[deleteStudent] clicked studentId: ${sid}`);

    // 마지막 반 이름 저장
    let lastClassName: string | null = (existing as any).last_class_group_name || null;
    if ((existing as any).class_group_id && !lastClassName) {
      const cgRes = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${(existing as any).class_group_id} LIMIT 1`);
      lastClassName = (cgRes.rows[0] as any)?.name ?? null;
    }

    // soft delete: status='deleted', 반배정 해제, 출결 대상 제외
    await db.execute(sql`
      UPDATE students
      SET
        status = 'deleted',
        deleted_at = NOW(),
        archived_reason = 'member_deleted',
        class_group_id = NULL,
        assigned_class_ids = '[]'::jsonb,
        schedule_labels = NULL,
        last_class_group_name = COALESCE(${lastClassName}, last_class_group_name),
        updated_at = NOW()
      WHERE id = ${sid}
    `);

    // parent_students는 유지 (학부모가 과거 기록 조회 가능해야 함)
    // swim_diary, attendance 기록도 유지
    console.log(`[deleteStudent] archived success: ${sid}`);
    res.json({ success: true, message: "회원이 삭제회원으로 처리되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── Attendance routes (unchanged) ─────────────────────────────────
router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { month } = req.query;
    let records = await db.select().from(attendanceTable).where(eq(attendanceTable.student_id, req.params.id));
    if (month) records = records.filter(r => r.date.startsWith(month as string));
    res.json(records.sort((a, b) => a.date.localeCompare(b.date)));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

async function autoCreateMakeupForAbsent(
  poolId: string, studentId: string, cgId: string | null, date: string, attendanceId: string
) {
  const existing = (await db.execute(sql`
    SELECT id FROM makeup_sessions
    WHERE student_id = ${studentId} AND absence_date = ${date} AND status != 'cancelled'
    LIMIT 1
  `)).rows as any[];
  if (existing.length > 0) return;
  const [student] = await db.select({ name: studentsTable.name })
    .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) return;
  let teacherId: string | null = null, teacherName: string | null = null, cgName: string | null = null;
  if (cgId) {
    const [cg] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, cgId)).limit(1);
    if (cg) { teacherId = cg.teacher_user_id || null; teacherName = cg.instructor || null; cgName = cg.name || null; }
  }
  const mkId = `mk_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  await db.execute(sql`
    INSERT INTO makeup_sessions (
      id, swimming_pool_id, student_id, student_name,
      original_class_group_id, original_class_group_name,
      original_teacher_id, original_teacher_name,
      absence_date, absence_attendance_id, status
    ) VALUES (
      ${mkId}, ${poolId}, ${studentId}, ${student.name},
      ${cgId}, ${cgName}, ${teacherId}, ${teacherName},
      ${date}, ${attendanceId}, 'waiting'
    )
  `);
}

async function cancelWaitingMakeup(studentId: string, date: string) {
  await db.execute(sql`
    UPDATE makeup_sessions
    SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'absent_cleared'
    WHERE student_id = ${studentId} AND absence_date = ${date} AND status = 'waiting'
  `);
}

router.post("/:id/attendance", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { date, status, class_group_id } = req.body;
  if (!date || !["present", "absent"].includes(status)) {
    return err(res, 400, "날짜와 출결 상태(present/absent)를 입력해주세요.");
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const [actor] = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const actorName = actor?.name || req.user!.userId;

    const [student] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    const cgId = class_group_id || student?.class_group_id || null;

    const existing = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.student_id, req.params.id), eq(attendanceTable.date, date))).limit(1);

    if (existing.length > 0) {
      const prevStatus = existing[0].status;
      const [updated] = await db.update(attendanceTable)
        .set({
          status,
          class_group_id: cgId || existing[0].class_group_id,
          updated_at: new Date(),
          modified_by: req.user!.userId,
          modified_by_name: actorName,
        })
        .where(eq(attendanceTable.id, existing[0].id)).returning();
      if (status === "absent" && prevStatus !== "absent") {
        await autoCreateMakeupForAbsent(poolId, req.params.id, cgId, date, existing[0].id);
      } else if (status === "present" && prevStatus === "absent") {
        await cancelWaitingMakeup(req.params.id, date);
      }
      res.json({ success: true, ...updated, was_modified: true });
    } else {
      const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const [created] = await db.insert(attendanceTable).values({
        id, student_id: req.params.id, swimming_pool_id: poolId,
        class_group_id: cgId || null,
        date, status, created_by: req.user!.userId, created_by_name: actorName,
      }).returning();
      if (status === "absent") {
        await autoCreateMakeupForAbsent(poolId, req.params.id, cgId, date, id);
      }
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
      .where(eq(attendanceTable.id, req.params.attendanceId)).returning();
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
