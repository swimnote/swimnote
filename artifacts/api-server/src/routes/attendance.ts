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

    // ② 배정됐거나 완료된 보충수업 학생 (makeup_sessions 테이블)
    // completed도 포함: 출석 처리 없이 complete만 된 케이스 대비
    const msRows = (await db.execute(sql`
      SELECT ms.student_id AS id, s.name, s.birth_year, s.weekly_count,
             'makeup' AS session_type, ms.status AS att_status,
             (ms.status = 'assigned') AS is_pending, ms.id AS makeup_session_id
      FROM makeup_sessions ms
      JOIN students s ON s.id = ms.student_id
      WHERE ms.swimming_pool_id = ${poolId}
        AND ms.assigned_class_group_id = ${class_group_id as string}
        AND ms.assigned_date = ${date as string}
        AND ms.status IN ('assigned', 'completed')
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
    const startDateStr = start_date as string;
    const cgIdStr = class_group_id as string | undefined;

    // student_class_history 기반으로 해당 주에 한 번이라도 active한 회원 조회
    // DISTINCT ON 제거: 연기→복귀 학생의 각 기간을 모두 반영
    const histRows = (await db.execute(sql.raw(`
      SELECT s.id, s.name, h.class_group_id, h.enrolled_at, h.left_at
      FROM student_class_history h
      JOIN students s ON s.id = h.student_id
      WHERE h.swimming_pool_id = '${poolId}'
        ${cgIdStr ? `AND h.class_group_id = '${cgIdStr}'` : ""}
        AND h.enrolled_at <= '${endDate}'
        AND (h.left_at IS NULL OR h.left_at > '${startDateStr}')
        AND s.deleted_at IS NULL
      ORDER BY s.id, h.class_group_id, h.enrolled_at
    `))).rows as any[];

    const allRecords = await db.select().from(attendanceTable)
      .where(and(
        eq(attendanceTable.swimming_pool_id, poolId),
        gte(attendanceTable.date, startDateStr),
        lte(attendanceTable.date, endDate)
      ));

    const classGroups = await db.select().from(classGroupsTable)
      .where(eq(classGroupsTable.swimming_pool_id, poolId));
    const cgMap: Record<string, string> = {};
    classGroups.forEach(cg => { cgMap[cg.id] = cg.name; });

    // date 타입 안전 변환 (pg가 Date 객체 또는 문자열로 반환할 수 있음)
    const toDateStr = (v: any): string | null => {
      if (!v) return null;
      if (typeof v === "string") return v.slice(0, 10);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    };

    // (student_id, class_group_id)별로 days 집계 — hist row별로 해당 기간 출결만 포함
    const aggregated: Record<string, { student_id: string; student_name: string; class_group_id: string; class_name: string | null; days: Record<string, string> }> = {};
    for (const s of histRows) {
      const key = `${s.id}__${s.class_group_id}`;
      if (!aggregated[key]) {
        aggregated[key] = { student_id: s.id, student_name: s.name, class_group_id: s.class_group_id, class_name: s.class_group_id ? (cgMap[s.class_group_id] || null) : null, days: {} };
      }
      const enrStr = toDateStr(s.enrolled_at)!;
      const lftStr = toDateStr(s.left_at);
      const studentRecords = allRecords.filter(r => {
        if (r.student_id !== s.id) return false;
        if (r.class_group_id === null || r.class_group_id !== s.class_group_id) return false;
        const rDate = toDateStr(r.date)!;
        if (rDate < enrStr) return false;
        if (lftStr !== null && rDate >= lftStr) return false;
        return true;
      });
      studentRecords.forEach(r => { aggregated[key].days[toDateStr(r.date)!] = r.status; });
    }
    const result = Object.values(aggregated);

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
    const monthStart = `${monthStr}-01`;
    const monthEnd = `${monthStr}-31`;
    const cgIdStr = class_group_id as string | undefined;

    // student_class_history 기반으로 해당 월에 한 번이라도 active한 회원 조회
    // DISTINCT ON 제거: 연기→복귀 학생의 각 기간을 모두 반영
    const histRows = (await db.execute(sql.raw(`
      SELECT s.id, s.name, h.class_group_id, h.enrolled_at, h.left_at
      FROM student_class_history h
      JOIN students s ON s.id = h.student_id
      WHERE h.swimming_pool_id = '${poolId}'
        ${cgIdStr ? `AND h.class_group_id = '${cgIdStr}'` : ""}
        AND h.enrolled_at <= '${monthEnd}'
        AND (h.left_at IS NULL OR h.left_at > '${monthStart}')
        AND s.deleted_at IS NULL
      ORDER BY s.id, h.class_group_id, h.enrolled_at
    `))).rows as any[];

    const allRecords = await db.select().from(attendanceTable)
      .where(and(
        eq(attendanceTable.swimming_pool_id, poolId),
        gte(attendanceTable.date, monthStart),
        lte(attendanceTable.date, monthEnd)
      ));

    const classGroups = await db.select().from(classGroupsTable)
      .where(eq(classGroupsTable.swimming_pool_id, poolId));
    const cgMap: Record<string, string> = {};
    classGroups.forEach(cg => { cgMap[cg.id] = cg.name; });

    // date 타입 안전 변환
    const toDateStr = (v: any): string | null => {
      if (!v) return null;
      if (typeof v === "string") return v.slice(0, 10);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    };

    // (student_id, class_group_id)별로 집계 — hist row별로 해당 기간 출결만 포함
    const aggregated: Record<string, { student_id: string; student_name: string; class_group_id: string; class_name: string | null; present: number; absent: number; late: number; total: number }> = {};
    for (const s of histRows) {
      const key = `${s.id}__${s.class_group_id}`;
      if (!aggregated[key]) {
        aggregated[key] = { student_id: s.id, student_name: s.name, class_group_id: s.class_group_id, class_name: s.class_group_id ? (cgMap[s.class_group_id] || null) : null, present: 0, absent: 0, late: 0, total: 0 };
      }
      const enrStr = toDateStr(s.enrolled_at)!;
      const lftStr = toDateStr(s.left_at);
      const studentRecords = allRecords.filter(r => {
        if (r.student_id !== s.id) return false;
        if (r.class_group_id === null || r.class_group_id !== s.class_group_id) return false;
        const rDate = toDateStr(r.date)!;
        if (rDate < enrStr) return false;
        if (lftStr !== null && rDate >= lftStr) return false;
        return true;
      });
      studentRecords.forEach(r => {
        if (r.status === "present") aggregated[key].present++;
        else if (r.status === "absent") aggregated[key].absent++;
        else if (r.status === "late") aggregated[key].late++;
        aggregated[key].total++;
      });
    }
    const result = Object.values(aggregated).map(s => ({
      student_id: s.student_id,
      student_name: s.student_name,
      class_group_id: s.class_group_id,
      class_name: s.class_name,
      present: s.present,
      absent: s.absent,
      late: s.late,
      total: s.total,
    }));

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
): Promise<{ created: boolean; reason?: string }> {
  // previousStatus 가 absent 여도 기존 세션이 cancelled/expired 면 새로 생성해야 함
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) {
    console.warn(`[autoCreateMakeup] student not found: ${studentId}`);
    return { created: false, reason: "student_not_found" };
  }
  const [existing] = ((await (db as any).execute(sql`
    SELECT id, status FROM makeup_sessions
    WHERE student_id = ${studentId} AND absence_date = ${date} AND status NOT IN ('cancelled','expired')
    LIMIT 1
  `)) as any).rows as any[];
  if (existing) {
    console.log(`[autoCreateMakeup] 이미 보강세션 존재 (id=${existing.id}, status=${existing.status}) → 스킵`);
    return { created: false, reason: "already_exists" };
  }

  // 풀 정책 조회 (swimming_pools는 superAdminDb) — 컬럼 누락 시 기본값으로 폴백
  let poolRow: any = null;
  try {
    const rows = ((await (superAdminDb as any).execute(sql`
      SELECT make_up_expiry_type, make_up_expiry_days,
             make_up_limit_weekly_1, make_up_limit_weekly_2, make_up_limit_weekly_3
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)) as any).rows as any[];
    poolRow = rows[0] ?? null;
  } catch {
    // 컬럼 미존재 등 → 기본값 사용
    try {
      const rows = ((await (superAdminDb as any).execute(sql`
        SELECT make_up_expiry_type, make_up_expiry_days
        FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `)) as any).rows as any[];
      poolRow = rows[0] ?? null;
    } catch { poolRow = null; }
  }

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
  if (currentCount >= maxPerMonth) {
    console.warn(`[autoCreateMakeup] 월간 보강 한도 초과 → 스킵. student=${studentId}, month=${monthPrefix}, current=${currentCount}, max=${maxPerMonth}`);
    return { created: false, reason: "monthly_limit_exceeded" };
  }

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
  // 담당 선생님 없으면 pool_admin을 기본 담당자로 설정 (결석자 리스트 조회 필터 작동 보장)
  if (!teacherId) {
    try {
      const rows = ((await (superAdminDb as any).execute(sql`
        SELECT id, name FROM users
        WHERE swimming_pool_id = ${poolId} AND role = 'pool_admin' LIMIT 1
      `)) as any).rows as any[];
      if (rows[0]) { teacherId = rows[0].id; teacherName = teacherName || rows[0].name || null; }
    } catch { /* ignore */ }
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
  console.log(`[autoCreateMakeup] 보강세션 생성 완료: id=${mkId}, student=${student.name}, date=${date}`);
  return { created: true };
}

// TODO: 향후 출결 생성 시 student_class_history 서버 검증 추가 필요
//   - student_id + class_group_id + date가 history 유효기간 내인지 확인
//   - 현재는 today-schedule(history 기반)을 통해서만 생성되어 간접 보호됨
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const { class_group_id, student_id, date, status } = req.body;
  if (!student_id || !date || !status) {
    res.status(400).json({ success: false, message: "student_id, date, status가 필요합니다." }); return;
  }
  if (!["present", "absent", "late"].includes(status)) {
    res.status(400).json({ success: false, message: "status는 present, absent, late 중 하나여야 합니다." }); return;
  }
  const _attStartedAt = Date.now();
  try {
    const role = (req.user as { role: string }).role;
    const poolId = await getPoolId(req.user!.userId, role, req.user!.poolId);
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
      let makeupResult: { created: boolean; reason?: string } | null = null;
      if (status === "absent") {
        try {
          makeupResult = await autoCreateMakeup(poolId, student_id, date, class_group_id || existing.class_group_id, existing.id, prevStatus);
        } catch(e) { console.error("[autoCreateMakeup] 보강세션 생성 실패:", e); }
      } else if ((status === "present" || status === "late") && prevStatus === "absent") {
        db.execute(sql`
          UPDATE makeup_sessions
          SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'absent_cleared'
          WHERE student_id = ${student_id} AND absence_date = ${date}
            AND status IN ('waiting', 'assigned', 'transferred')
        `).catch(e => console.error("[cancelMakeup] 취소 실패:", e));
      }
      console.log("[PERF][attendance-post]", { elapsed_ms: Date.now() - _attStartedAt, op: "update", status });
      res.json({ success: true, data: { ...updated, student_name: s?.name || null }, makeup_queued: makeupResult?.created ?? null, makeup_skip_reason: makeupResult?.reason ?? null }); return;
    }

    const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [record] = await db.insert(attendanceTable).values({
      id, swimming_pool_id: poolId, class_group_id: class_group_id || null, student_id, date, status,
    }).returning();
    const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
    let makeupResult2: { created: boolean; reason?: string } | null = null;
    if (status === "absent") {
      try {
        makeupResult2 = await autoCreateMakeup(poolId, student_id, date, class_group_id, id, null);
      } catch(e) { console.error("[autoCreateMakeup] 보강세션 생성 실패:", e); }
    }
    logPoolEvent({
      pool_id: poolId, event_type: `attendance.${status}`, entity_type: "attendance",
      entity_id: id, actor_id: req.user!.userId,
      payload: { student_id, student_name: s?.name, date, status },
    }).catch(() => {});
    console.log("[PERF][attendance-post]", { elapsed_ms: Date.now() - _attStartedAt, op: "insert", status });
    res.status(201).json({ success: true, data: { ...record, student_name: s?.name || null }, makeup_queued: makeupResult2?.created ?? null, makeup_skip_reason: makeupResult2?.reason ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
  }
});

export default router;
