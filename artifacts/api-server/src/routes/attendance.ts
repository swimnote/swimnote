import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { attendanceTable, studentsTable, usersTable, parentAccountsTable, classGroupsTable, makeupSessionsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, like, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

async function getPoolId(userId: string, role: string, tokenPoolId?: string | null): Promise<string | null> {
  if (role === "parent_account") return userId;
  if (tokenPoolId) return tokenPoolId;
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

async function getPoolIdForParent(parentId: string): Promise<string | null> {
  const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, parentId)).limit(1);
  return pa?.swimming_pool_id || null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = (req.user as { role: string }).role;
    let poolId: string | null;
    if (role === "parent_account") {
      poolId = await getPoolIdForParent(req.user!.userId);
    } else {
      poolId = await getPoolId(req.user!.userId, role, req.user!.poolId);
    }
    if (!poolId) { res.status(403).json({ success: false, message: "소속된 수영장이 없습니다." }); return; }

    const { class_group_id, student_id, date, month } = req.query;

    // DB 레벨 필터링 (메모리 필터 제거 → 네트워크 전송량 감소)
    const conditions: any[] = [eq(attendanceTable.swimming_pool_id, poolId)];
    if (class_group_id) conditions.push(eq(attendanceTable.class_group_id, class_group_id as string));
    if (student_id) conditions.push(eq(attendanceTable.student_id, student_id as string));
    if (date) conditions.push(eq(attendanceTable.date, date as string));
    if (month) conditions.push(sql`${attendanceTable.date} LIKE ${(month as string) + "%"}`);

    const records = await db.select().from(attendanceTable).where(and(...conditions));

    // 학생 이름 배치 조회 (N+1 → 1회)
    const studentIds = [...new Set(records.map(r => r.student_id).filter(Boolean))] as string[];
    const nameMap = new Map<string, string>();
    if (studentIds.length > 0) {
      const idList = studentIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
      const nameRows = (await db.execute(sql`
        SELECT id, name FROM students WHERE id = ANY(ARRAY[${sql.raw(idList)}]::text[])
      `)).rows as any[];
      nameRows.forEach((r: any) => nameMap.set(r.id, r.name));
    }

    const enriched = records.map(r => ({
      ...r,
      student_name: r.student_id ? (nameMap.get(r.student_id) || null) : null,
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

// 보충수업 학생 조회: ?class_group_id=X&date=Y (일지 화면에서 보충학생 표시용)
router.get("/makeup-students", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = (req.user as { role: string }).role;
    const poolId = await getPoolId(req.user!.userId, role, req.user!.poolId);
    if (!poolId) { res.status(403).json({ error: "소속 없음" }); return; }
    const { class_group_id, date } = req.query;
    if (!class_group_id || !date) { res.status(400).json({ error: "class_group_id, date 필요" }); return; }

    // ① 이미 출석 처리된 보충수업 학생 (attendance 테이블)
    const attRows = (await db.execute(sql`
      SELECT a.student_id AS id, s.name, s.birth_year, s.weekly_count,
             a.session_type, a.status AS att_status, false AS is_pending
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      WHERE a.swimming_pool_id = ${poolId}
        AND a.class_group_id = ${class_group_id as string}
        AND a.date = ${date as string}
        AND a.session_type = 'makeup'
        AND a.status = 'present'
    `)).rows as any[];

    const attendedIds = new Set(attRows.map((r: any) => r.id));

    // ② 배정됐지만 아직 출석 처리 안 된 보충수업 학생 (makeup_sessions 테이블)
    const msRows = (await db.execute(sql`
      SELECT ms.student_id AS id, s.name, s.birth_year, s.weekly_count,
             'makeup' AS session_type, 'assigned' AS att_status,
             true AS is_pending, ms.id AS makeup_session_id
      FROM makeup_sessions ms
      JOIN students s ON s.id = ms.student_id
      WHERE ms.swimming_pool_id = ${poolId}
        AND ms.assigned_class_group_id = ${class_group_id as string}
        AND ms.assigned_date = ${date as string}
        AND ms.status = 'assigned'
        AND ms.cancelled_at IS NULL
    `)).rows as any[];

    // 중복 제거: 이미 출석 처리된 학생은 ②에서 제외
    const pendingRows = msRows.filter((r: any) => !attendedIds.has(r.id));

    res.json([...attRows, ...pendingRows]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 주간 출결 조회: ?start_date=YYYY-MM-DD&class_group_id=...
router.get("/weekly", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = (req.user as { role: string }).role;
    let poolId: string | null;
    if (role === "parent_account") {
      poolId = await getPoolIdForParent(req.user!.userId);
    } else {
      poolId = await getPoolId(req.user!.userId, role, req.user!.poolId);
    }
    if (!poolId) { res.status(403).json({ success: false, message: "소속된 수영장이 없습니다." }); return; }

    const { start_date, class_group_id } = req.query;
    if (!start_date) { res.status(400).json({ success: false, message: "start_date가 필요합니다." }); return; }

    const endDate = addDays(start_date as string, 6);

    const allStudents = await db.select().from(studentsTable)
      .where(eq(studentsTable.swimming_pool_id, poolId));

    const filteredStudents = class_group_id
      ? allStudents.filter(s => s.class_group_id === class_group_id)
      : allStudents;

    const allRecords = await db.select().from(attendanceTable)
      .where(and(
        eq(attendanceTable.swimming_pool_id, poolId),
        gte(attendanceTable.date, start_date as string),
        lte(attendanceTable.date, endDate)
      ));

    const classGroupIds = [...new Set(filteredStudents.map(s => s.class_group_id).filter(Boolean))];
    const classGroups = await db.select().from(classGroupsTable)
      .where(eq(classGroupsTable.swimming_pool_id, poolId));
    const cgMap: Record<string, string> = {};
    classGroups.forEach(cg => { cgMap[cg.id] = cg.name; });

    const result = filteredStudents.map(s => {
      const studentRecords = allRecords.filter(r => r.student_id === s.id);
      const days: Record<string, string> = {};
      studentRecords.forEach(r => { days[r.date] = r.status; });
      return {
        student_id: s.id,
        student_name: s.name,
        class_group_id: s.class_group_id,
        class_name: s.class_group_id ? (cgMap[s.class_group_id] || null) : null,
        days,
      };
    });

    res.json({ success: true, data: result, start_date, end_date: endDate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

// 월간 요약: ?year=2026&month=3&class_group_id=...
router.get("/monthly-summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = (req.user as { role: string }).role;
    let poolId: string | null;
    if (role === "parent_account") {
      poolId = await getPoolIdForParent(req.user!.userId);
    } else {
      poolId = await getPoolId(req.user!.userId, role, req.user!.poolId);
    }
    if (!poolId) { res.status(403).json({ success: false, message: "소속된 수영장이 없습니다." }); return; }

    const { year, month, class_group_id } = req.query;
    if (!year || !month) { res.status(400).json({ success: false, message: "year와 month가 필요합니다." }); return; }

    const monthStr = `${year}-${String(month).padStart(2, "0")}`;

    const allStudents = await db.select().from(studentsTable)
      .where(eq(studentsTable.swimming_pool_id, poolId));

    const filteredStudents = class_group_id
      ? allStudents.filter(s => s.class_group_id === class_group_id)
      : allStudents;

    const allRecords = await db.select().from(attendanceTable)
      .where(and(
        eq(attendanceTable.swimming_pool_id, poolId),
        gte(attendanceTable.date, `${monthStr}-01`),
        lte(attendanceTable.date, `${monthStr}-31`)
      ));

    const classGroups = await db.select().from(classGroupsTable)
      .where(eq(classGroupsTable.swimming_pool_id, poolId));
    const cgMap: Record<string, string> = {};
    classGroups.forEach(cg => { cgMap[cg.id] = cg.name; });

    const result = filteredStudents.map(s => {
      const studentRecords = allRecords.filter(r => r.student_id === s.id);
      let present = 0, absent = 0, late = 0;
      studentRecords.forEach(r => {
        if (r.status === "present") present++;
        else if (r.status === "absent") absent++;
        else if (r.status === "late") late++;
      });
      return {
        student_id: s.id,
        student_name: s.name,
        class_group_id: s.class_group_id,
        class_name: s.class_group_id ? (cgMap[s.class_group_id] || null) : null,
        present,
        absent,
        late,
        total: studentRecords.length,
      };
    });

    res.json({ success: true, data: result, year, month });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

// 이름 검색: ?name=이름&days=30(7/30/0=전체)
router.get("/search", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = (req.user as { role: string }).role;
    let poolId: string | null;
    if (role === "parent_account") {
      poolId = await getPoolIdForParent(req.user!.userId);
    } else {
      poolId = await getPoolId(req.user!.userId, role, req.user!.poolId);
    }
    if (!poolId) { res.status(403).json({ success: false, message: "소속된 수영장이 없습니다." }); return; }

    const { name, days } = req.query;
    if (!name) { res.status(400).json({ success: false, message: "name이 필요합니다." }); return; }

    const matchingStudents = await db.select().from(studentsTable)
      .where(and(
        eq(studentsTable.swimming_pool_id, poolId),
        like(studentsTable.name, `%${name}%`)
      ));

    if (matchingStudents.length === 0) {
      res.json({ success: true, data: [] }); return;
    }

    const daysNum = days ? parseInt(days as string) : 30;
    const studentIds = matchingStudents.map(s => s.id);

    // DB 레벨에서 student_id 필터 + 날짜 필터 적용 (전체 조회 후 JS 필터 제거)
    const attConditions: any[] = [
      eq(attendanceTable.swimming_pool_id, poolId),
      sql`${attendanceTable.student_id} = ANY(ARRAY[${sql.raw(studentIds.map(id => `'${id.replace(/'/g, "''")}'`).join(","))}]::text[])`,
    ];
    if (daysNum > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysNum);
      attConditions.push(gte(attendanceTable.date, cutoff.toISOString().split("T")[0]));
    }

    const allRecords = (await db.select().from(attendanceTable)
      .where(and(...attConditions)))
      .sort((a, b) => b.date.localeCompare(a.date));

    const classGroups = await db.select().from(classGroupsTable)
      .where(eq(classGroupsTable.swimming_pool_id, poolId));
    const cgMap: Record<string, string> = {};
    classGroups.forEach(cg => { cgMap[cg.id] = cg.name; });

    const studentMap: Record<string, string> = {};
    matchingStudents.forEach(s => { studentMap[s.id] = s.name; });

    const result = allRecords.map(r => ({
      id: r.id,
      date: r.date,
      status: r.status,
      student_id: r.student_id,
      student_name: r.student_id ? (studentMap[r.student_id] || null) : null,
      class_group_id: r.class_group_id,
      class_name: r.class_group_id ? (cgMap[r.class_group_id] || null) : null,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

function calcExpireAt(expiryType: string | null, expiryDays: number | null, absenceDate: string): string | null {
  const base = new Date(absenceDate);
  if (expiryType === "fixed_days" && expiryDays && expiryDays > 0) {
    base.setDate(base.getDate() + expiryDays);
    return base.toISOString();
  }
  if (expiryType === "end_of_month") {
    const y = base.getFullYear(), m = base.getMonth();
    return new Date(y, m + 1, 0, 23, 59, 59).toISOString();
  }
  if (expiryType === "next_month_end") {
    const y = base.getFullYear(), m = base.getMonth();
    return new Date(y, m + 2, 0, 23, 59, 59).toISOString();
  }
  return null;
}

async function autoCreateMakeup(
  poolId: string,
  studentId: string,
  date: string,
  classGroupId: string | null | undefined,
  attendanceId: string,
  previousStatus?: string | null
) {
  if (previousStatus === "absent") return;
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) return;
  const [existing] = ((await (db as any).execute(sql`
    SELECT id FROM makeup_sessions
    WHERE student_id = ${studentId} AND absence_date = ${date} AND status NOT IN ('cancelled','expired')
    LIMIT 1
  `)) as any).rows as any[];
  if (existing) return;

  // 풀 정책 조회 (swimming_pools는 superAdminDb)
  const [poolRow] = ((await (superAdminDb as any).execute(sql`
    SELECT make_up_expiry_type, make_up_expiry_days,
           make_up_limit_weekly_1, make_up_limit_weekly_2, make_up_limit_weekly_3
    FROM swimming_pools WHERE id = ${poolId} LIMIT 1
  `)) as any).rows as any[];

  const weeklyCount: number = (student as any).weekly_count ?? 1;
  const expiryType: string | null = poolRow?.make_up_expiry_type ?? "end_of_month";
  const expiryDays: number | null = poolRow?.make_up_expiry_days ?? null;
  const expireAt: string | null = calcExpireAt(expiryType, expiryDays, date);

  // 주간 보강 한도 체크
  const limitKey = weeklyCount >= 3 ? "make_up_limit_weekly_3" : weeklyCount === 2 ? "make_up_limit_weekly_2" : "make_up_limit_weekly_1";
  const maxPerMonth: number = poolRow?.[limitKey] ?? (weeklyCount >= 3 ? 5 : weeklyCount === 2 ? 4 : 2);
  const monthPrefix = date.slice(0, 7); // YYYY-MM
  const [countRow] = ((await (db as any).execute(sql`
    SELECT COUNT(*)::int AS cnt FROM makeup_sessions
    WHERE student_id = ${studentId}
      AND absence_date LIKE ${monthPrefix + "%"}
      AND status NOT IN ('cancelled','expired')
  `)) as any).rows as any[];
  const currentCount: number = countRow?.cnt ?? 0;
  if (currentCount >= maxPerMonth) return; // 한도 초과 시 자동 생성 안함

  let teacherId: string | null = null;
  let teacherName: string | null = null;
  let cgName: string | null = null;
  const cgId = classGroupId || student.class_group_id;
  if (cgId) {
    const [cg] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, cgId)).limit(1);
    if (cg) {
      teacherId = cg.teacher_user_id || null;
      teacherName = cg.instructor || null;
      cgName = cg.name || null;
    }
  }
  const mkId = `mk_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  await (db as any).execute(sql`
    INSERT INTO makeup_sessions (
      id, swimming_pool_id, student_id, student_name,
      original_class_group_id, original_class_group_name,
      original_teacher_id, original_teacher_name,
      absence_date, absence_attendance_id, status,
      expire_at, weekly_frequency
    ) VALUES (
      ${mkId}, ${poolId}, ${studentId}, ${student.name},
      ${cgId || null}, ${cgName}, ${teacherId}, ${teacherName},
      ${date}, ${attendanceId}, 'waiting',
      ${expireAt}, ${weeklyCount}
    )
  `);
}

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const { class_group_id, student_id, date, status } = req.body;
  if (!student_id || !date || !status) {
    res.status(400).json({ success: false, message: "student_id, date, status가 필요합니다." }); return;
  }
  if (!["present", "absent", "late"].includes(status)) {
    res.status(400).json({ success: false, message: "status는 present, absent, late 중 하나여야 합니다." }); return;
  }
  try {
    const role = (req.user as { role: string }).role;
    const poolId = await getPoolId(req.user!.userId, role);
    if (!poolId) { res.status(403).json({ success: false, message: "소속된 수영장이 없습니다." }); return; }

    const [existing] = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.student_id, student_id), eq(attendanceTable.date, date))).limit(1);

    if (existing) {
      const prevStatus = existing.status;
      const [updated] = await db.update(attendanceTable)
        .set({ status, class_group_id: class_group_id || existing.class_group_id })
        .where(eq(attendanceTable.id, existing.id))
        .returning();
      const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
      if (status === "absent") {
        await autoCreateMakeup(poolId, student_id, date, class_group_id || existing.class_group_id, existing.id, prevStatus);
      } else if (status === "present" && prevStatus === "absent") {
        await db.execute(sql`
          UPDATE makeup_sessions
          SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'absent_cleared'
          WHERE student_id = ${student_id} AND absence_date = ${date} AND status = 'waiting'
        `);
      }
      res.json({ success: true, data: { ...updated, student_name: s?.name || null } }); return;
    }

    const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [record] = await db.insert(attendanceTable).values({
      id, swimming_pool_id: poolId, class_group_id: class_group_id || null, student_id, date, status,
    }).returning();
    const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
    if (status === "absent") {
      await autoCreateMakeup(poolId, student_id, date, class_group_id, id, null);
    }
    logPoolEvent({
      pool_id: poolId, event_type: `attendance.${status}`, entity_type: "attendance",
      entity_id: id, actor_id: req.user!.userId,
      payload: { student_id, student_name: s?.name, date, status },
    }).catch(() => {});
    res.status(201).json({ success: true, data: { ...record, student_name: s?.name || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

export default router;
