/**
 * 선생님 계정 관리 (pool_admin 전용)
 * - 선생님 계정 조회 / 생성 / 삭제 / 비밀번호 재설정
 * - OTP 기반 계정 활성화 (MVP: 관리자가 코드를 선생님에게 전달)
 * - 관리자 본인용 선생님 계정은 최대 1개
 */
import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";
import { sendPushToUser } from "../lib/push-service.js";

const router = Router();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function getAdminPoolId(adminId: string, tokenPoolId?: string | null): Promise<string | null> {
  if (tokenPoolId) return tokenPoolId;
  const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, adminId)).limit(1);
  return me?.swimming_pool_id || null;
}

// ── 선생님 목록 ───────────────────────────────────────────────────────
router.get("/teachers", requireAuth, requireRole("pool_admin", "super_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId, req.user!.poolId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teachers = await superAdminDb.execute(sql`
        SELECT id, name, email, phone, is_activated, is_admin_self_teacher, created_at
        FROM users
        WHERE swimming_pool_id = ${poolId}
          AND role = 'teacher'
        ORDER BY is_admin_self_teacher DESC, created_at DESC
      `);
      res.json(teachers.rows);
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 선생님 계정 생성 ──────────────────────────────────────────────────
router.post("/teachers", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { name, email, password, phone, is_admin_self_teacher } = req.body;
      if (!name?.trim() || !email?.trim() || !password) {
        res.status(400).json({ error: "이름, 이메일, 비밀번호는 필수입니다." }); return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다." }); return;
      }
      if (!phone?.trim()) {
        res.status(400).json({ error: "연락처를 입력해주세요. 인증코드 전달에 사용됩니다." }); return;
      }

      const poolId = await getAdminPoolId(req.user!.userId, req.user!.poolId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      // 관리자 본인 계정 중복 확인 (최대 1개)
      if (is_admin_self_teacher) {
        const existing = await superAdminDb.execute(sql`
          SELECT id FROM users
          WHERE swimming_pool_id = ${poolId}
            AND role = 'teacher'
            AND is_admin_self_teacher = true
            AND created_by = ${req.user!.userId}
          LIMIT 1
        `);
        if (existing.rows.length) {
          res.status(409).json({ error: "관리자 본인용 선생님 계정은 1개만 만들 수 있습니다." }); return;
        }
      }

      // 이메일 중복 확인
      const dup = await superAdminDb.execute(sql`SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}`);
      if (dup.rows.length) {
        res.status(409).json({ error: "이미 사용 중인 이메일입니다." }); return;
      }

      const passwordHash = await hashPassword(password);
      const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await superAdminDb.execute(sql`
        INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated, is_admin_self_teacher, created_by)
        VALUES (
          ${id},
          ${email.trim().toLowerCase()},
          ${passwordHash},
          ${name.trim()},
          ${phone.trim()},
          'teacher',
          ${poolId},
          false,
          ${!!is_admin_self_teacher},
          ${req.user!.userId}
        )
      `);

      // OTP 생성 (24시간 유효)
      const otp = generateOTP();
      const otpId = `otv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await db.execute(sql`
        INSERT INTO phone_verifications (id, phone, code, purpose, ref_id, expires_at)
        VALUES (
          ${otpId},
          ${phone.trim()},
          ${otp},
          'teacher_activation',
          ${id},
          now() + interval '24 hours'
        )
      `);

      res.status(201).json({
        teacher: { id, name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), is_activated: false, is_admin_self_teacher: !!is_admin_self_teacher },
        activation_code: otp,
        message: "선생님에게 인증코드를 전달해주세요. 인증코드는 24시간 유효합니다.",
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 선생님 인증코드 조회 (미활성 계정) ────────────────────────────────
router.get("/teachers/:id/activation-code", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId, req.user!.poolId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await superAdminDb.execute(sql`
        SELECT id, name, is_activated FROM users
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      const t = teacher.rows[0] as any;
      if (t.is_activated) { res.status(400).json({ error: "이미 활성화된 계정입니다." }); return; }

      const verif = await db.execute(sql`
        SELECT code, expires_at FROM phone_verifications
        WHERE ref_id = ${req.params.id}
          AND purpose = 'teacher_activation'
          AND is_used = false
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (!verif.rows.length) {
        // 만료된 경우 새 코드 생성
        const otp = generateOTP();
        const otpId = `otv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const phone = (await superAdminDb.execute(sql`SELECT phone FROM users WHERE id = ${req.params.id}`)).rows[0] as any;
        await db.execute(sql`
          INSERT INTO phone_verifications (id, phone, code, purpose, ref_id, expires_at)
          VALUES (${otpId}, ${phone?.phone || ''}, ${otp}, 'teacher_activation', ${req.params.id}, now() + interval '24 hours')
        `);
        res.json({ activation_code: otp, teacher_name: t.name, expires_in: "24시간" });
      } else {
        const v = verif.rows[0] as any;
        const expiresAt = new Date(v.expires_at);
        const hoursLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 3600000);
        res.json({ activation_code: v.code, teacher_name: t.name, expires_in: `${hoursLeft}시간` });
      }
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 선생님 비밀번호 재설정 ────────────────────────────────────────────
router.patch("/teachers/:id/password", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 6) {
        res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다." }); return;
      }
      const poolId = await getAdminPoolId(req.user!.userId, req.user!.poolId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await superAdminDb.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      const passwordHash = await hashPassword(password);
      await superAdminDb.execute(sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 선생님 정보 수정 (이름/연락처/직급) ───────────────────────────────
router.patch("/teachers/:id", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { name, phone, position } = req.body;
      const poolId = await getAdminPoolId(req.user!.userId, req.user!.poolId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await superAdminDb.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      await superAdminDb.execute(sql`
        UPDATE users SET
          name     = COALESCE(${name?.trim() || null}, name),
          phone    = COALESCE(${phone?.trim() || null}, phone),
          position = COALESCE(${position ?? null}, position),
          updated_at = now()
        WHERE id = ${req.params.id}
      `);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 선생님 계정 삭제 ──────────────────────────────────────────────────
router.delete("/teachers/:id", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId, req.user!.poolId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      // role 제한 없이 같은 수영장 소속 여부만 확인
      const teacher = await superAdminDb.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      const uid = req.params.id;
      // pool DB 관련 레코드 먼저 정리 (FK 방지)
      await db.execute(sql`DELETE FROM phone_verifications WHERE ref_id = ${uid}`).catch(() => {});
      await db.execute(sql`DELETE FROM teacher_invites WHERE user_id = ${uid}`).catch(() => {});
      await db.execute(sql`UPDATE class_groups SET teacher_user_id = NULL WHERE teacher_user_id = ${uid}`).catch(() => {});
      // 유저 삭제
      await superAdminDb.execute(sql`DELETE FROM users WHERE id = ${uid}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[teacher DELETE]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ══════════════════════════════════════════════════════════════════
//  선생님 자기관리 API (teacher 본인 전용)
// ══════════════════════════════════════════════════════════════════

/** KST 기준 오늘 날짜 YYYY-MM-DD */
function kstTodayStr(): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** timestamptz or date → KST YYYY-MM-DD (UTC 변환 없이 Asia/Seoul 기준) */
function toKstDateStr(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find(p => p.type === "year")!.value;
  const mo = parts.find(p => p.type === "month")!.value;
  const dy = parts.find(p => p.type === "day")!.value;
  return `${y}-${mo}-${dy}`;
}

/** YYYY-MM-DD 문자열 → 요일 번호 (0=일, UTC/KST 혼용 없이 로컬 파싱) */
function dayOfWeekFromDateStr(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).getDay();
}

/** schedule_days("월,수,금") → 요일 번호 Set */
function parseDayNums(scheduleDays: string): Set<number> {
  const map: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
  const nums = new Set<number>();
  scheduleDays.split(",").map(d => d.trim()).forEach(d => { if (map[d] !== undefined) nums.add(map[d]); });
  return nums;
}

// ── 보강 회차 공통 타입 ───────────────────────────────────────────
interface MakeupSessionRow {
  absence_date: string;
  expire_at: string | null;
  swimming_pool_id: string;
  status: string;
}
interface MakeupClassGroupRow {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  capacity: number | null;
  teacher_user_id: string;
  teacher_name?: string | null;
  swimming_pool_id: string;
}
interface OccurrenceValidationResult {
  classGroup: MakeupClassGroupRow;
  occurrenceDate: string;
  kstToday: string;
  availableSlots: number;
  isFull: boolean;
  isPast: boolean;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * 보강 회차 공통 검증 함수
 * assign / complete-direct 양쪽에서 동일하게 사용한다.
 * 검증 실패 시 { code, message, status } 형태의 오류를 throw한다.
 * 클라이언트가 전송한 is_future/is_full/available_slots는 신뢰하지 않고 서버에서 재계산한다.
 */
async function validateMakeupOccurrence(params: {
  makeupSession: MakeupSessionRow;
  classGroupId: string;
  occurrenceDate: string;
  poolId: string;
  /** true 이면 expire_at 초과 검사를 건너뜀 (기간 지난 보강 명시적 처리 허용) */
  allowExpired?: boolean;
}): Promise<OccurrenceValidationResult> {
  const { makeupSession: mk, classGroupId, occurrenceDate, poolId } = params;

  // 1. 날짜 형식 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) {
    throw { code: "INVALID_ASSIGNED_DATE", message: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)", status: 400 };
  }
  // 2. 실제 존재하는 날짜인지
  const [yy, mmo, dd] = occurrenceDate.split("-").map(Number);
  const testD = new Date(yy, mmo - 1, dd);
  if (testD.getFullYear() !== yy || testD.getMonth() !== mmo - 1 || testD.getDate() !== dd) {
    throw { code: "INVALID_ASSIGNED_DATE", message: "존재하지 않는 날짜입니다.", status: 400 };
  }

  // 3. 결석일 이후여야 함 (결석 당일 포함 차단)
  if (occurrenceDate <= mk.absence_date) {
    throw { code: "DATE_BEFORE_OR_ON_ABSENCE", message: "결석일 이후 날짜만 선택할 수 있습니다.", status: 400 };
  }

  // 4. expire_at 이내여야 함 (KST 기준 변환) — allowExpired=true 이면 스킵
  if (!params.allowExpired) {
    if (mk.expire_at) {
      const expireKst = toKstDateStr(new Date(mk.expire_at));
      if (occurrenceDate > expireKst) {
        throw { code: "MAKEUP_EXPIRED", message: "보강 유효기간이 지난 날짜입니다.", status: 400 };
      }
    } else {
      // expire_at 없으면 결석일 기준 +56일
      const fallbackD = new Date(mk.absence_date + "T00:00:00");
      fallbackD.setDate(fallbackD.getDate() + 56);
      if (occurrenceDate > fallbackD.toISOString().slice(0, 10)) {
        throw { code: "MAKEUP_EXPIRED", message: "보강 유효기간이 지난 날짜입니다.", status: 400 };
      }
    }
  }

  // 5~6. 반 존재·같은 수영장·삭제 여부
  const cgRows = (await superAdminDb.execute(sql`
    SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity,
           cg.teacher_user_id, u.name AS teacher_name, cg.swimming_pool_id
    FROM class_groups cg
    LEFT JOIN users u ON cg.teacher_user_id = u.id
    WHERE cg.id = ${classGroupId}
      AND cg.swimming_pool_id = ${poolId}
      AND cg.is_deleted = false
      AND (cg.is_one_time = false OR cg.is_one_time IS NULL)
    LIMIT 1
  `)).rows as any[];
  if (!cgRows.length) {
    throw { code: "CLASS_NOT_FOUND", message: "반을 찾을 수 없습니다.", status: 404 };
  }
  const cg = cgRows[0] as MakeupClassGroupRow;

  // 7. 수업 요일 검증 (YYYY-MM-DD 문자열 기준, UTC 변환 없음)
  if (cg.schedule_days) {
    const targetDays = parseDayNums(cg.schedule_days);
    if (!targetDays.has(dayOfWeekFromDateStr(occurrenceDate))) {
      throw { code: "CLASS_NOT_SCHEDULED_ON_DATE", message: "해당 날짜는 반의 수업 요일이 아닙니다.", status: 400 };
    }
  }

  // 8. 풀 휴일 검증
  const holidayRows = (await db.execute(sql`
    SELECT 1 FROM pool_holidays
    WHERE pool_id = ${poolId} AND holiday_date = ${occurrenceDate}::date LIMIT 1
  `)).rows;
  if (holidayRows.length > 0) {
    throw { code: "POOL_HOLIDAY", message: "해당 날짜는 수영장 휴일입니다.", status: 400 };
  }

  // 9. 정원 계산 (eligible-classes 표준과 동일 — class_group_id + assigned_class_ids 모두 포함)
  const memberRows = (await db.execute(sql`
    SELECT COUNT(s.id)::int AS cnt FROM students s
    WHERE (s.class_group_id = ${classGroupId} OR s.assigned_class_ids @> to_jsonb(${classGroupId}::text))
      AND s.status IN ('active', 'pending_parent_link', 'unregistered')
      AND s.deleted_at IS NULL
  `)).rows as any[];
  const currentMembers = (memberRows[0] as any)?.cnt ?? 0;
  const capacity: number = (cg.capacity as number) ?? 0;
  const availableSlots = capacity > 0 ? Math.max(0, capacity - currentMembers) : 999;
  const isFull = capacity > 0 && availableSlots <= 0;

  // 10. KST 오늘 기준 past/today/future
  const kstToday = kstTodayStr();
  return {
    classGroup: cg,
    occurrenceDate,
    kstToday,
    availableSlots,
    isFull,
    isPast:   occurrenceDate < kstToday,
    isToday:  occurrenceDate === kstToday,
    isFuture: occurrenceDate > kstToday,
  };
}

/** 현재 로그인한 사용자의 pool_id 조회 */
async function getMyPoolId(userId: string): Promise<string | null> {
  const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return me?.swimming_pool_id || null;
}

// ── 내 프로필 조회 ─────────────────────────────────────────────
router.get("/teacher/me", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const me = await superAdminDb.execute(sql`
        SELECT id, name, email, phone, position, role, swimming_pool_id, is_activated
        FROM users WHERE id = ${req.user!.userId}
      `);
      if (!me.rows.length) { res.status(404).json({ error: "사용자를 찾을 수 없습니다." }); return; }
      res.json(me.rows[0]);
    } catch { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 내 프로필 수정 ─────────────────────────────────────────────
router.patch("/teacher/me", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { name, phone, position } = req.body;
      await superAdminDb.execute(sql`
        UPDATE users SET
          name     = COALESCE(${name?.trim() || null}, name),
          phone    = COALESCE(${phone?.trim() || null}, phone),
          position = COALESCE(${position ?? null}, position),
          updated_at = now()
        WHERE id = ${req.user!.userId}
      `);
      res.json({ success: true });
    } catch { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 내반 통계: 요일별 회원 수 + 회원현황 ─────────────────────
router.get("/teacher/me/stats", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;

      // 내 반 목록
      const myClasses = await db.execute(sql`
        SELECT id, schedule_days FROM class_groups
        WHERE teacher_user_id = ${userId} AND is_deleted = false
      `);

      // 요일별 회원 수 집계
      const days = ["월","화","수","목","금","토","일"];
      const dayCount: Record<string, Set<string>> = {};
      days.forEach(d => { dayCount[d] = new Set(); });

      for (const cls of myClasses.rows as any[]) {
        const clsDays: string[] = (cls.schedule_days || "").split(",").map((d: string) => d.trim());
        // 이 반 학생들 조회
        const students = await db.execute(sql`
          SELECT id FROM students
          WHERE (
            class_group_id = ${cls.id}
            OR assigned_class_ids @> to_jsonb(${cls.id}::text)
          )
          AND deleted_at IS NULL AND status IN ('active', 'pending_parent_link', 'unregistered')
        `);
        for (const st of students.rows as any[]) {
          for (const d of clsDays) {
            if (dayCount[d]) dayCount[d].add(st.id);
          }
        }
      }
      const dayStats = days.map(d => ({ day: d, count: dayCount[d].size }));

      // 회원 현황 (내 반 소속 기준)
      const classIds = (myClasses.rows as any[]).map(c => c.id);
      let active = 0, withdrawn = 0, suspended = 0;
      if (classIds.length > 0) {
        const classIdList = classIds.map(id => `'${id}'`).join(",");
        const statusRows = await db.execute(sql`
          SELECT status, deleted_at FROM students
          WHERE (class_group_id IN (SELECT id FROM class_groups WHERE teacher_user_id = ${userId})
            OR EXISTS (
              SELECT 1 FROM class_groups cg WHERE cg.teacher_user_id = ${userId}
              AND students.assigned_class_ids @> to_jsonb(cg.id::text)
            ))
        `);
        for (const row of statusRows.rows as any[]) {
          if (row.deleted_at) { withdrawn++; }
          else if (row.status === 'active') { active++; }
          else { suspended++; }
        }
      }

      res.json({
        day_stats: dayStats,
        member_status: { active, suspended, withdrawn, paid_count: active + suspended },
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 미디어 사용량 ──────────────────────────────────────────────
// photo_assets_meta / video_assets_meta 가 실제 사진·영상 저장 테이블
// (구 student_photos / student_videos 는 사용하지 않음)
// 집계 기준: uploaded_by = 로그인 선생님, media_status != 'deleted' (삭제 완료 제외)
router.get("/teacher/me/media-usage", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;

      const [photoRow, videoRow, monthPhotoRow, monthVideoRow] = await Promise.all([
        db.execute(sql`
          SELECT
            COALESCE(SUM(file_size), 0)::bigint AS total_bytes,
            COUNT(*)::int                       AS count
          FROM photo_assets_meta
          WHERE uploaded_by = ${userId}
            AND media_status != 'deleted'
        `),
        db.execute(sql`
          SELECT
            COALESCE(SUM(file_size), 0)::bigint AS total_bytes,
            COUNT(*)::int                       AS count
          FROM video_assets_meta
          WHERE uploaded_by = ${userId}
            AND media_status != 'deleted'
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(file_size), 0)::bigint AS total
          FROM photo_assets_meta
          WHERE uploaded_by = ${userId}
            AND media_status != 'deleted'
            AND created_at >= date_trunc('month', now())
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(file_size), 0)::bigint AS total
          FROM video_assets_meta
          WHERE uploaded_by = ${userId}
            AND media_status != 'deleted'
            AND created_at >= date_trunc('month', now())
        `),
      ]);

      const photoBytes = Number((photoRow.rows[0] as any)?.total_bytes ?? 0);
      const videoBytes = Number((videoRow.rows[0] as any)?.total_bytes ?? 0);
      const photoCount = Number((photoRow.rows[0] as any)?.count ?? 0);
      const videoCount = Number((videoRow.rows[0] as any)?.count ?? 0);
      const monthBytes = Number((monthPhotoRow.rows[0] as any)?.total ?? 0)
                       + Number((monthVideoRow.rows[0] as any)?.total ?? 0);

      res.json({
        photo_bytes: photoBytes, photo_count: photoCount,
        video_bytes: videoBytes, video_count: videoCount,
        total_bytes: photoBytes + videoBytes,
        month_bytes: monthBytes,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 퇴직/권한 탈퇴 요청 ───────────────────────────────────────
router.post("/teacher/resign-request", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      const userId = req.user!.userId;
      const poolId = await getMyPoolId(userId);
      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const teacherName = (userRow.rows[0] as any)?.name || "";
      const id = `resign_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await db.execute(sql`
        INSERT INTO resign_requests (id, teacher_id, teacher_name, pool_id, reason, status, created_at)
        VALUES (${id}, ${userId}, ${teacherName}, ${poolId}, ${reason || null}, 'pending', now())
      `);
      res.json({ success: true, message: "퇴직 요청이 접수되었습니다. 관리자가 확인 후 처리합니다." });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 내 풀 보강 대기 목록 ───────────────────────────────────────
router.get("/teacher/makeups", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { status } = req.query as any;
      // status=waiting(또는 미지정/pending) → waiting + expired 모두 반환
      // 기간 지난 보강도 목록에서 계속 표시
      const isWaitingQuery = !status || status === "waiting" || status === "pending";
      const dbStatus = isWaitingQuery ? null : (status === "pending" ? "waiting" : status);
      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const statusClause = isWaitingQuery
        ? `AND ms.status IN ('waiting', 'expired')`
        : `AND ms.status = '${dbStatus}'`;

      const rows = ((await (db as any).execute(sql.raw(`
        SELECT ms.*, u.name AS student_name_from_user
        FROM makeup_sessions ms
        LEFT JOIN users u ON u.id = ms.student_id
        WHERE ms.swimming_pool_id = '${poolId}'
          ${statusClause}
          AND ms.cancelled_at IS NULL
          AND (
            ms.handed_to_teacher_id = '${userId}'
            OR (
              ms.handed_to_teacher_id IS NULL
              AND (
                ms.original_teacher_id = '${userId}'
                OR EXISTS (
                  SELECT 1 FROM class_groups cg
                  WHERE cg.id = ms.original_class_group_id
                    AND cg.co_teacher_ids @> to_jsonb('${userId}'::text)
                )
              )
            )
          )
        ORDER BY ms.absence_date ASC, ms.created_at ASC
      `))) as any).rows as any[];

      // is_expired 필드 추가: status=expired 또는 expire_at이 KST 현재 시각 이전
      const kstNow = toKstDateStr(new Date());
      const result = rows.map((r: any) => ({
        ...r,
        is_expired:
          r.status === "expired" ||
          (r.expire_at != null && toKstDateStr(new Date(r.expire_at)) < kstNow),
      }));
      res.json(result);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 보강 배정 가능 반 목록 (teacher용) ────────────────────────
router.get("/teacher/makeups/eligible-classes", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      // ?all=true 이면 수영장 전체 반, 기본값은 내 반만
      const showAll = req.query.all === "true";

      const rows = await superAdminDb.execute(sql`
        SELECT
          cg.id, cg.name, cg.schedule_days, cg.schedule_time,
          cg.capacity, cg.teacher_user_id,
          u.name AS instructor,
          COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pending_parent_link', 'unregistered') AND s.deleted_at IS NULL) AS current_members,
          GREATEST(0, cg.capacity - COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pending_parent_link', 'unregistered') AND s.deleted_at IS NULL)) AS available_slots,
          (cg.teacher_user_id = ${userId} OR cg.co_teacher_ids @> to_jsonb(${userId}::text)) AS is_mine
        FROM class_groups cg
        LEFT JOIN users u ON cg.teacher_user_id = u.id
        LEFT JOIN students s ON s.class_group_id = cg.id OR s.assigned_class_ids @> to_jsonb(cg.id::text)
        WHERE cg.swimming_pool_id = ${poolId}
          AND cg.is_deleted = false
          AND (cg.is_one_time = false OR cg.is_one_time IS NULL)
          AND (${showAll} OR cg.teacher_user_id = ${userId})
        GROUP BY cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity, cg.teacher_user_id, cg.co_teacher_ids, u.name
        HAVING GREATEST(0, cg.capacity - COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pending_parent_link', 'unregistered') AND s.deleted_at IS NULL)) > 0
        ORDER BY is_mine DESC, cg.schedule_days, cg.schedule_time
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 보강 가능 수업 회차 목록 (teacher용) ──────────────────────
// in-memory 요청/오류 저장소 (최근 30건)
const _occErrLog: Array<{ts: string; stage: string; code: string|null; message: string|null; makeup_id: string; class_group_id: string|null; user_id: string}> = [];
const _occReqLog: Array<{ts: string; makeup_id: string; class_group_id: string|null; user_id: string; status: number; elapsed_ms: number; error?: string}> = [];

// 인증 없이 super admin 비밀번호로 조회
router.get("/teacher/makeups/debug-occ-log", (req, res) => {
  const pw = req.query.pw as string | undefined;
  if (!pw || pw !== process.env.SUPER_ADMIN_PASSWORD) {
    res.status(401).json({ error: "unauthorized" }); return;
  }
  res.json({ requests: _occReqLog.slice(-30), errors: _occErrLog.slice(-20) });
});

router.get("/teacher/makeups/debug-occ-errors", requireAuth, (req, res) => {
  res.json(_occErrLog.slice(-20));
});

// GET /teacher/makeups/:makeupId/eligible-occurrences?class_group_id=...
router.get("/teacher/makeups/:makeupId/eligible-occurrences", requireAuth,
  async (req: AuthRequest, res) => {
    const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
    const startedAt = Date.now();
    let stage = "start";
    try {
      const { makeupId } = req.params;
      const { class_group_id } = req.query as { class_group_id?: string };
      const userId = req.user!.userId;

      // STEP 3: 오류 코드 명확화
      stage = "get_pool";
      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "POOL_NOT_FOUND" }); return; }
      if (!class_group_id) { res.status(400).json({ error: "class_group_id가 필요합니다." }); return; }

      // 1. 보강 세션 조회
      stage = "load_makeup";
      const mkRows = (await db.execute(sql`
        SELECT absence_date, expire_at, swimming_pool_id
        FROM makeup_sessions WHERE id = ${makeupId} LIMIT 1
      `)).rows as any[];
      if (!mkRows.length) { res.status(404).json({ error: "보강 건을 찾을 수 없습니다." }); return; }
      const mk = mkRows[0];
      if (mk.swimming_pool_id !== poolId) { res.status(403).json({ error: "MAKEUP_POOL_MISMATCH" }); return; }

      // 2. 반 정보 조회 (수영장 소속·삭제되지 않은 반)
      stage = "load_class";
      const cgRows = (await superAdminDb.execute(sql`
        SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity,
          cg.teacher_user_id, u.name AS instructor,
          (cg.teacher_user_id = ${userId} OR cg.co_teacher_ids @> to_jsonb(${userId}::text)) AS is_mine
        FROM class_groups cg
        LEFT JOIN users u ON cg.teacher_user_id = u.id
        WHERE cg.id = ${class_group_id}
          AND cg.swimming_pool_id = ${poolId}
          AND cg.is_deleted = false
          AND (cg.is_one_time = false OR cg.is_one_time IS NULL)
        LIMIT 1
      `)).rows as any[];
      if (!cgRows.length) { res.status(404).json({ error: "CLASS_NOT_FOUND" }); return; }
      const cg = cgRows[0];

      // 3. 정원 계산 (eligible-classes 표준 — class_group_id + assigned_class_ids 모두 포함)
      stage = "count_members";
      const memberRows = (await db.execute(sql`
        SELECT COUNT(s.id)::int AS cnt FROM students s
        WHERE (s.class_group_id = ${class_group_id} OR s.assigned_class_ids @> to_jsonb(${class_group_id}::text))
          AND s.status IN ('active', 'pending_parent_link', 'unregistered')
          AND s.deleted_at IS NULL
      `)).rows as any[];
      const currentMembers = (memberRows[0] as any)?.cnt ?? 0;
      const capacity: number = cg.capacity ?? 0;
      const availableSlots = capacity > 0 ? Math.max(0, capacity - currentMembers) : 999;
      const isFull = capacity > 0 && availableSlots <= 0;

      // 4. 범위 계산 (결석일 다음 날 ~ expire_at or 결석일+56일) — KST 기준, UTC 혼용 없음
      const absenceDate: string = mk.absence_date; // YYYY-MM-DD
      const kstToday = kstTodayStr();
      // expire_at은 timestamptz이므로 KST 기준 날짜로 변환
      const expireAtDate = mk.expire_at ? toKstDateStr(new Date(mk.expire_at)) : null;
      const endDate = expireAtDate || (() => {
        // 결석일(YYYY-MM-DD) 기준 +56일 — YYYY-MM-DD 파싱 후 로컬 Date 사용
        const [ey, em, ed] = absenceDate.split("-").map(Number);
        const d = new Date(ey, em - 1, ed);
        d.setDate(d.getDate() + 56);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd2 = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd2}`;
      })();

      // 5. 풀 휴일 조회
      stage = "load_holidays";
      const holidayRows = (await db.execute(sql`
        SELECT TO_CHAR(holiday_date, 'YYYY-MM-DD') AS hd
        FROM pool_holidays
        WHERE pool_id = ${poolId}
          AND holiday_date >= ${absenceDate}::date
          AND holiday_date <= ${endDate}::date
      `)).rows as any[];
      const holidaySet = new Set(holidayRows.map((r: any) => r.hd as string));

      // 6. 요일 파싱 및 occurrence 생성
      const targetDays = parseDayNums((cg.schedule_days as string) || "");
      const occurrences: any[] = [];
      const cursor = new Date(`${absenceDate}T00:00:00`);
      cursor.setDate(cursor.getDate() + 1); // 결석일 다음 날부터
      const endD = new Date(`${endDate}T00:00:00`);

      while (cursor <= endD) {
        if (targetDays.has(cursor.getDay())) {
          const yyyy = cursor.getFullYear();
          const mm = String(cursor.getMonth() + 1).padStart(2, "0");
          const dd = String(cursor.getDate()).padStart(2, "0");
          const dateStr = `${yyyy}-${mm}-${dd}`;
          if (!holidaySet.has(dateStr)) {
            occurrences.push({
              class_group_id: cg.id,
              class_name: cg.name,
              occurrence_date: dateStr,
              schedule_time: cg.schedule_time,
              teacher_id: cg.teacher_user_id,
              teacher_name: cg.instructor,
              is_mine: Boolean(cg.is_mine),
              available_slots: availableSlots,
              is_full: isFull,
              is_past: dateStr < kstToday,
              is_today: dateStr === kstToday,
              is_future: dateStr > kstToday,
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      console.log("[PERF][eligible-occurrences]", {
        request_id: requestId,
        user_id: userId,
        pool_id: poolId,
        makeup_id: makeupId,
        class_group_id,
        occurrences_count: occurrences.length,
        status: 200,
        elapsed_ms: Date.now() - startedAt,
      });

      res.json({
        makeup_id: makeupId,
        absence_date: absenceDate,
        expire_at: mk.expire_at,
        class_group_id: cg.id,
        class_name: cg.name,
        is_mine: Boolean(cg.is_mine),
        occurrences,
      });
    } catch (err: any) {
      // STEP 3: DB 연결 한도 오류 구별
      const isDbConnLimit =
        err?.code === "EMAXCONNSESSION" ||
        (typeof err?.message === "string" && (
          err.message.includes("max clients reached") ||
          err.message.includes("EMAXCONNSESSION")
        ));
      const errEntry = {
        ts: new Date().toISOString(),
        stage,
        code: err?.code ?? null,
        message: err?.message ?? null,
        makeup_id: makeupId,
        class_group_id: class_group_id ?? null,
        user_id: userId,
      };
      _occErrLog.push(errEntry);
      if (_occErrLog.length > 20) _occErrLog.shift();
      console.error("[ERROR][eligible-occurrences]", {
        request_id: requestId,
        ...errEntry,
        elapsed_ms: Date.now() - startedAt,
      });
      if (isDbConnLimit) {
        res.status(503).json({ error: "DB_CONNECTION_LIMIT", message: "잠시 후 다시 시도해 주세요." });
      } else {
        res.status(500).json({ error: "ELIGIBLE_OCCURRENCES_FAILED" });
      }
    }
  }
);

// ── 보강 지정 (teacher용) — 미래 날짜 전용 ────────────────────
router.patch("/teacher/makeups/:id/assign", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { class_group_id, assigned_date, allow_expired } = req.body;
      const sessionId = req.params.id;
      const userId = req.user!.userId;

      if (!class_group_id || !assigned_date) {
        res.status(400).json({ error: "INVALID_REQUEST", message: "반과 날짜를 선택해주세요." }); return;
      }

      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const prevRows = (await db.execute(sql`
        SELECT student_id, student_name, status, assigned_class_group_id,
               absence_date, expire_at, swimming_pool_id
        FROM makeup_sessions WHERE id = ${sessionId} LIMIT 1
      `)).rows as any[];
      if (!prevRows.length) { res.status(404).json({ error: "보강 세션을 찾을 수 없습니다." }); return; }
      const prev = prevRows[0];

      if (prev.swimming_pool_id !== poolId) { res.status(403).json({ error: "접근 권한 없음" }); return; }
      if (prev.status === "completed") {
        res.status(409).json({ error: "MAKEUP_ALREADY_COMPLETED", message: "이미 완료된 보강 건입니다." }); return;
      }
      if (prev.status === "cancelled") {
        res.status(409).json({ error: "MAKEUP_ALREADY_CANCELLED", message: "취소된 보강 건입니다." }); return;
      }
      // expired 상태는 allow_expired=true 없이는 차단
      if (prev.status === "expired" && !allow_expired) {
        res.status(409).json({
          code: "MAKEUP_EXPIRED_CONFIRM_REQUIRED",
          error: "MAKEUP_EXPIRED_CONFIRM_REQUIRED",
          message: "보강 가능 기간이 지난 항목입니다. 그래도 처리하려면 allow_expired: true 를 포함하여 다시 요청하세요.",
        }); return;
      }

      // 공통 회차 검증 (날짜형식·결석일·만료일·반·요일·휴일·정원)
      let validation: OccurrenceValidationResult;
      try {
        validation = await validateMakeupOccurrence({
          makeupSession: prev as MakeupSessionRow,
          classGroupId: class_group_id,
          occurrenceDate: assigned_date,
          poolId,
          allowExpired: !!allow_expired,
        });
      } catch (e: any) {
        if (e.code && e.status) { res.status(e.status).json({ error: e.code, message: e.message }); return; }
        throw e;
      }

      // assign은 미래 날짜 전용 — 오늘·과거는 complete-direct로 처리
      if (!validation.isFuture) {
        res.status(400).json({
          error: "ASSIGN_REQUIRES_FUTURE_DATE",
          message: "배정 예약은 미래 날짜만 선택할 수 있습니다. 오늘 또는 과거 날짜는 '직접 완료'로 처리해주세요.",
        }); return;
      }

      // 미래 정원 마감은 서버에서 차단
      if (validation.isFull) {
        res.status(400).json({ error: "CLASS_FULL", message: "정원이 마감된 반에는 보강을 배정할 수 없습니다." }); return;
      }

      const isChange = prev.status === "assigned" && !!prev.assigned_class_group_id;
      const clsRow = validation.classGroup;

      await db.execute(sql`
        UPDATE makeup_sessions SET
          status                    = 'assigned',
          assigned_class_group_id   = ${class_group_id},
          assigned_class_group_name = ${clsRow.name},
          assigned_teacher_id       = ${clsRow.teacher_user_id},
          assigned_teacher_name     = ${clsRow.teacher_name ?? null},
          assigned_date             = ${assigned_date},
          updated_at                = now()
        WHERE id = ${sessionId}
      `);

      res.json({ success: true });

      // 학부모 푸시 알림 (백그라운드)
      try {
        const parents = (await db.execute(sql`
          SELECT ps.parent_account_id
          FROM parent_students ps
          WHERE ps.student_id = ${prev.student_id} AND ps.status = 'approved'
        `)).rows as any[];

        const title = isChange ? "📅 보충 수업 일정 변경" : "📅 보충 수업 일정 등록";
        const body  = isChange
          ? `${prev.student_name}의 보충 수업 일정이 변경되었습니다.\n${assigned_date} · ${clsRow.name}`
          : `${prev.student_name}의 보충 수업 일정이 등록되었습니다.\n${assigned_date} · ${clsRow.name}`;

        for (const p of parents) {
          await sendPushToUser(
            p.parent_account_id, true,
            "makeup_schedule",
            title, body,
            { type: isChange ? "makeup_changed" : "makeup_assigned", makeupId: sessionId, date: assigned_date },
            `makeup_assign_${sessionId}`
          );
        }
      } catch (e) { console.error("[makeup-assign] 푸시 알림 오류:", e); }
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 보강 인계 (담당선생님 → 다른 선생님) ─────────────────────
router.post("/teacher/makeups/:id/handover", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { receiver_teacher_id } = req.body as { receiver_teacher_id: string };
      if (!receiver_teacher_id) { res.status(400).json({ error: "receiver_teacher_id 필수" }); return; }

      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      // 보강 세션 확인
      const mkRows = (await db.execute(sql`
        SELECT id, student_name, absence_date, status, swimming_pool_id, original_teacher_id, original_class_group_id
        FROM makeup_sessions WHERE id = ${req.params.id} LIMIT 1
      `)).rows as any[];
      const mk = mkRows[0];
      if (!mk)                          { res.status(404).json({ error: "보강 건을 찾을 수 없습니다." }); return; }
      if (mk.swimming_pool_id !== poolId){ res.status(403).json({ error: "접근 권한 없음" }); return; }
      if (mk.status !== "waiting")       { res.status(409).json({ error: "이미 처리된 보강 건입니다." }); return; }

      // 권한 확인: 내가 담당 또는 co-teacher인지
      const isOriginal = mk.original_teacher_id === userId;
      let isCo = false;
      if (!isOriginal && mk.original_class_group_id) {
        const coRows = (await superAdminDb.execute(sql`
          SELECT 1 FROM class_groups WHERE id = ${mk.original_class_group_id}
            AND co_teacher_ids @> to_jsonb(${userId}::text) LIMIT 1
        `)).rows;
        isCo = coRows.length > 0;
      }
      if (!isOriginal && !isCo) { res.status(403).json({ error: "담당 선생님만 인계할 수 있습니다." }); return; }

      // 수신 선생님 정보
      const [receiverRow] = (await superAdminDb.execute(sql`
        SELECT id, name FROM users WHERE id = ${receiver_teacher_id} AND swimming_pool_id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (!receiverRow) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      // 인계 처리 — status 유지(waiting), handed_to 업데이트
      await db.execute(sql`
        UPDATE makeup_sessions SET
          handed_to_teacher_id   = ${receiver_teacher_id},
          handed_to_teacher_name = ${receiverRow.name as string},
          updated_at             = now()
        WHERE id = ${req.params.id}
      `);

      // 메신저 자동 알림
      const [actorRow] = (await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`)).rows as any[];
      const actorName: string = (actorRow as any)?.name || "선생님";
      await db.execute(sql`
        INSERT INTO work_messages (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content)
        VALUES (${poolId}, ${userId}, ${actorName}, ${req.user!.role}, 'text', 'talk', 'normal',
          ${`보강 인계\n학생: ${mk.student_name || "미상"}\n결석일: ${mk.absence_date || "-"}\n인계 → ${receiverRow.name as string} 선생님`})
      `);

      res.json({ success: true, handed_to_teacher_name: receiverRow.name as string });
    } catch (err) { console.error("[teacher/makeups/handover]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 배정된 보강 목록 (풀 전체) ────────────────────────────────
router.get("/teacher/makeups/assigned", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }
      const rows = await db.execute(sql`
        SELECT ms.*
        FROM makeup_sessions ms
        WHERE ms.swimming_pool_id = ${poolId}
          AND ms.status IN ('assigned','transferred')
          AND ms.cancelled_at IS NULL
        ORDER BY ms.assigned_date ASC, ms.absence_date ASC, ms.created_at ASC
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 특정 반/날짜의 배정된 보강 학생 목록 ──────────────────────
router.get("/teacher/makeups/by-class", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { class_group_id, date } = req.query as { class_group_id?: string; date?: string };
      if (!class_group_id || !date) {
        res.status(400).json({ error: "class_group_id와 date가 필요합니다." }); return;
      }

      // 1. 날짜 형식 검증: YYYY-MM-DD 실존 날짜만 허용
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRe.test(date)) {
        res.status(400).json({ error: "INVALID_DATE", message: "날짜는 YYYY-MM-DD 형식이어야 합니다." }); return;
      }
      const [y, m, d] = date.split("-").map(Number);
      const parsed = new Date(y, m - 1, d);
      if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
        res.status(400).json({ error: "INVALID_DATE", message: "존재하지 않는 날짜입니다." }); return;
      }

      // 2. 요청자의 poolId 확인
      const poolId = await getMyPoolId(req.user!.userId);
      if (!poolId) {
        res.status(403).json({ error: "POOL_MISMATCH", message: "소속 수영장이 없습니다." }); return;
      }

      // 3. class_group이 해당 풀 소속인지 검증
      const cgRows = (await db.execute(sql`
        SELECT id FROM class_groups
        WHERE id = ${class_group_id}
          AND swimming_pool_id = ${poolId}
          AND is_deleted = false
        LIMIT 1
      `)).rows;
      if (!cgRows.length) {
        res.status(404).json({ error: "CLASS_NOT_FOUND", message: "해당 수영장에서 찾을 수 없는 반입니다." }); return;
      }

      // 4. 동일 풀 소속 보강 세션만 조회
      const rows = (await db.execute(sql`
        SELECT ms.*
        FROM makeup_sessions ms
        WHERE ms.assigned_class_group_id = ${class_group_id}
          AND ms.assigned_date = ${date}
          AND ms.status = 'assigned'
          AND ms.cancelled_at IS NULL
          AND ms.swimming_pool_id = ${poolId}
        ORDER BY ms.student_name ASC
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "SERVER_ERROR", message: "서버 오류" }); }
  }
);

// ── 스케줄표에서 보강 직접 완료 (오늘·과거 날짜 전용) ────────────
router.patch("/teacher/makeups/:id/complete-direct", requireAuth,
  requireRole("teacher", "pool_admin", "sub_admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { date, class_group_id } = req.body as { date?: string; class_group_id?: string };

      if (!date) { res.status(400).json({ error: "INVALID_ASSIGNED_DATE", message: "date가 필요합니다." }); return; }
      if (!class_group_id) { res.status(400).json({ error: "CLASS_NOT_FOUND", message: "class_group_id가 필요합니다." }); return; }

      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const userName = (userRow.rows[0] as any)?.name || "";

      const rows = (await db.execute(sql`
        SELECT * FROM makeup_sessions WHERE id = ${req.params.id} LIMIT 1
      `)).rows as any[];
      if (!rows.length) { res.status(404).json({ error: "보강 없음" }); return; }
      const mk = rows[0];

      if (mk.swimming_pool_id && mk.swimming_pool_id !== poolId) {
        res.status(403).json({ error: "처리 권한이 없습니다." }); return;
      }
      if (mk.status === "completed") {
        res.status(400).json({ error: "MAKEUP_ALREADY_COMPLETED", message: "이미 완료된 보강입니다." }); return;
      }
      if (!["waiting", "assigned", "expired"].includes(mk.status)) {
        res.status(400).json({ error: "MAKEUP_ALREADY_CANCELLED", message: "취소된 보강입니다." }); return;
      }
      // expired 상태는 allow_expired=true 없이는 차단
      const { allow_expired } = req.body as { date?: string; class_group_id?: string; allow_expired?: boolean };
      if (mk.status === "expired" && !allow_expired) {
        res.status(409).json({
          code: "MAKEUP_EXPIRED_CONFIRM_REQUIRED",
          error: "MAKEUP_EXPIRED_CONFIRM_REQUIRED",
          message: "보강 가능 기간이 지난 항목입니다. 그래도 처리하려면 allow_expired: true 를 포함하여 다시 요청하세요.",
        }); return;
      }

      // 공통 회차 검증 (날짜형식·결석일·만료일·반·요일·휴일·정원)
      let validation: OccurrenceValidationResult;
      try {
        validation = await validateMakeupOccurrence({
          makeupSession: mk as MakeupSessionRow,
          classGroupId: class_group_id,
          occurrenceDate: date,
          poolId,
          allowExpired: !!allow_expired,
        });
      } catch (e: any) {
        if (e.code && e.status) { res.status(e.status).json({ error: e.code, message: e.message }); return; }
        throw e;
      }

      // complete-direct는 오늘·과거 날짜 전용 — 미래는 assign으로 처리
      if (validation.isFuture) {
        res.status(400).json({
          error: "COMPLETE_DIRECT_REQUIRES_TODAY_OR_PAST",
          message: "직접 완료는 오늘 또는 과거 날짜만 처리할 수 있습니다. 미래 날짜는 '보강반 배정'으로 예약해주세요.",
        }); return;
      }

      // 오늘·과거 정원 초과는 실제 참여 기록이므로 허용 (isFull 체크 없음)

      await db.execute(sql`
        UPDATE makeup_sessions SET
          status                    = 'completed',
          is_substitute             = TRUE,
          substitute_teacher_id     = ${userId},
          substitute_teacher_name   = ${userName},
          assigned_date             = ${date},
          assigned_class_group_id   = ${class_group_id},
          assigned_class_group_name = ${validation.classGroup.name},
          completed_at              = now(),
          updated_at                = now()
        WHERE id = ${req.params.id}
      `);

      const attId = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO attendance
          (id, swimming_pool_id, student_id, date, status, session_type,
           class_group_id, teacher_user_id, teacher_name, created_by, created_by_name)
        VALUES
          (${attId}, ${poolId}, ${mk.student_id}, ${date}, 'present', 'makeup',
           ${class_group_id}, ${userId}, ${userName}, ${userId}, ${userName})
        ON CONFLICT (student_id, date) DO UPDATE SET
          status = 'present', session_type = 'makeup',
          class_group_id = ${class_group_id},
          teacher_user_id = ${userId}, teacher_name = ${userName},
          updated_at = now()
      `);

      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 보강 배정 취소 (assigned → waiting) ──────────────────────────────
// 담당 수업(assigned_teacher_id 일치)의 보강 건만 취소 가능
router.patch("/teacher/makeups/:id/revert", requireAuth,
  requireRole("teacher", "pool_admin", "sub_admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId   = req.user!.userId;
      const userRole = req.user!.role;
      const poolId   = await getMyPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      console.log(`[teacher/makeups/revert] userId=${userId} role=${userRole} poolId=${poolId} mkId=${req.params.id}`);

      const rows = (await db.execute(sql`
        SELECT id, status, swimming_pool_id,
               assigned_class_group_id, assigned_class_group_name,
               assigned_teacher_id, assigned_teacher_name,
               assigned_date, absence_date, absence_time,
               student_name, created_at, updated_at
        FROM makeup_sessions WHERE id = ${req.params.id} LIMIT 1
      `)).rows as any[];
      if (!rows.length) { res.status(404).json({ error: "보강 건을 찾을 수 없습니다." }); return; }
      const mk = rows[0];
      console.log(`[teacher/makeups/revert] BEFORE:`, JSON.stringify(mk));

      console.log(`[teacher/makeups/revert] mk.status=${mk.status} mk.swimming_pool_id=${mk.swimming_pool_id} mk.assigned_teacher_id=${mk.assigned_teacher_id}`);

      // 다른 센터 데이터 접근 차단
      if (mk.swimming_pool_id !== poolId) {
        console.log(`[teacher/makeups/revert] pool mismatch: mk=${mk.swimming_pool_id} user=${poolId}`);
        res.status(403).json({ error: "접근 권한이 없습니다." }); return;
      }

      // 상태 검사
      if (mk.status === "completed") {
        res.status(400).json({ error: "완료된 보강은 배정 취소할 수 없습니다." }); return;
      }
      if (mk.status === "waiting") {
        res.status(400).json({ error: "이미 보강대기 상태입니다." }); return;
      }
      if (!["assigned", "transferred"].includes(mk.status)) {
        res.status(400).json({ error: "배정 취소할 수 없는 상태입니다." }); return;
      }

      // pool_admin / sub_admin: 소속 수영장 확인만으로 충분 (소유권 검사 면제)
      const isAdmin = userRole === "pool_admin" || userRole === "sub_admin";
      if (!isAdmin) {
        // teacher: assigned_teacher_id가 본인이거나 co-teacher여야 함
        const isAssignedTeacher = mk.assigned_teacher_id === userId;
        let isCo = false;
        if (!isAssignedTeacher && mk.assigned_class_group_id) {
          const coRows = (await superAdminDb.execute(sql`
            SELECT 1 FROM class_groups WHERE id = ${mk.assigned_class_group_id}
              AND co_teacher_ids @> to_jsonb(${userId}::text) LIMIT 1
          `)).rows;
          isCo = coRows.length > 0;
        }
        if (!isAssignedTeacher && !isCo) {
          console.log(`[teacher/makeups/revert] ownership fail: assigned_teacher=${mk.assigned_teacher_id} user=${userId}`);
          res.status(403).json({ error: "담당 수업의 보강만 취소할 수 있습니다." }); return;
        }
      }

      const updated = (await db.execute(sql`
        UPDATE makeup_sessions SET
          status                      = 'waiting',
          assigned_class_group_id     = NULL,
          assigned_class_group_name   = NULL,
          assigned_teacher_id         = NULL,
          assigned_teacher_name       = NULL,
          assigned_date               = NULL,
          transferred_to_teacher_id   = NULL,
          transferred_to_teacher_name = NULL,
          is_substitute               = FALSE,
          substitute_teacher_id       = NULL,
          substitute_teacher_name     = NULL,
          updated_at                  = now()
        WHERE id = ${req.params.id}
        RETURNING id, status,
                  assigned_class_group_id, assigned_class_group_name,
                  assigned_teacher_id, assigned_teacher_name,
                  assigned_date, updated_at
      `)).rows as any[];

      console.log(`[teacher/makeups/revert] rowCount=${updated.length} AFTER:`, JSON.stringify(updated[0] || null));

      if (!updated.length) {
        res.status(500).json({ error: "업데이트 실패 (0 rows affected)" }); return;
      }

      res.json({ success: true, rowCount: updated.length, before: mk, after: updated[0] });
    } catch (err) { console.error("[teacher/makeups/revert]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.patch("/teacher/makeups/:id/complete", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const userRow = await superAdminDb.execute(sql`SELECT name, role, roles FROM users WHERE id = ${userId}`);
      const userInfo = userRow.rows[0] as any;
      const userName = userInfo?.name || "";
      const isPoolAdmin = (userInfo?.role === "pool_admin") || (userInfo?.roles || "").includes("pool_admin");

      const rows = (await db.execute(sql`
        SELECT * FROM makeup_sessions WHERE id = ${req.params.id} LIMIT 1
      `)).rows as any[];
      if (!rows.length) { res.status(404).json({ error: "보강 없음" }); return; }
      const mk = rows[0];

      // pool_admin, original_teacher, assigned_teacher, transferred_teacher 모두 완료 처리 가능
      const canComplete = isPoolAdmin
        || mk.original_teacher_id === userId
        || mk.assigned_teacher_id === userId
        || mk.transferred_to_teacher_id === userId;
      if (!canComplete) {
        res.status(403).json({ error: "처리 권한이 없습니다." }); return;
      }

      const poolId = mk.swimming_pool_id;
      const targetDate = mk.assigned_date || mk.absence_date;
      const targetClassId = mk.assigned_class_group_id || mk.original_class_group_id || null;

      await db.execute(sql`
        UPDATE makeup_sessions SET
          status                  = 'completed',
          is_substitute           = TRUE,
          substitute_teacher_id   = ${userId},
          substitute_teacher_name = ${userName},
          completed_at            = now(),
          updated_at              = now()
        WHERE id = ${req.params.id}
      `);

      // 출석 기록 생성
      if (poolId && targetDate && mk.student_id) {
        const attId = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.execute(sql`
          INSERT INTO attendance
            (id, swimming_pool_id, student_id, date, status, session_type,
             class_group_id, teacher_user_id, teacher_name, created_by, created_by_name)
          VALUES
            (${attId}, ${poolId}, ${mk.student_id}, ${targetDate}, 'present', 'makeup',
             ${targetClassId}, ${userId}, ${userName}, ${userId}, ${userName})
          ON CONFLICT (student_id, date) DO UPDATE SET
            status = 'present', session_type = 'makeup',
            class_group_id = ${targetClassId},
            teacher_user_id = ${userId}, teacher_name = ${userName},
            updated_at = now()
        `);
      }

      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 결석소멸 (teacher용) ───────────────────────────────────────
router.post("/teacher/makeups/:id/extinguish", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { cancelled_reason, cancelled_custom } = req.body;
      const userId = req.user!.userId;
      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const userName = (userRow.rows[0] as any)?.name || "";
      await db.execute(sql`
        UPDATE makeup_sessions SET
          status           = 'extinguished',
          cancelled_reason = ${cancelled_reason || '보강원하지않음'},
          cancelled_custom = ${cancelled_custom || null},
          cancelled_at     = now(),
          cancelled_by     = ${userId},
          cancelled_by_name= ${userName},
          updated_at       = now()
        WHERE id = ${req.params.id}
      `);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 보강 현황 이력 (teacher 탭 3) ────────────────────────────
router.get("/teacher/makeup-requests", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const poolId = await getMyPoolId(userId);
      if (!poolId) { res.json([]); return; }
      const rows = (await db.execute(sql`
        SELECT
          id,
          student_name,
          original_class_group_name  AS class_name,
          absence_date               AS original_date,
          note                       AS reason,
          status,
          created_at                 AS requested_at,
          assigned_date              AS makeup_date,
          assigned_class_group_name  AS makeup_class_name
        FROM makeup_sessions
        WHERE swimming_pool_id = ${poolId}
          AND cancelled_at IS NULL
          AND (
            original_teacher_id = ${userId}
            OR EXISTS (
              SELECT 1 FROM class_groups cg
              WHERE cg.id = original_class_group_id
                AND cg.co_teacher_ids @> to_jsonb(${userId}::text)
            )
          )
        ORDER BY absence_date DESC, created_at DESC
      `)).rows as any[];

      const mapped = rows.map((r: any) => ({
        ...r,
        status:
          r.status === "waiting"    ? "pending"   :
          r.status === "assigned"   ? "approved"  :
          r.status === "completed"  ? "completed" :
          "rejected",
      }));

      res.json(mapped);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 탭별 카운트 (전체 탭 동시 표시용) ──────────────────────────
router.get("/teacher/me/members/counts", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const [userRow] = await superAdminDb.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId}
      `).then(r => r.rows as any[]);
      const poolId = userRow?.swimming_pool_id;
      if (!poolId) return res.json({ all: 0, unassigned: 0, suspend_pending: 0, withdraw_pending: 0, suspended: 0, withdrawn: 0 });

      const [row] = (await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND (
            status IN ('active','suspended','withdrawn','pending_parent_link','unregistered') OR pending_status_change IS NOT NULL
          ))::int AS all,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status IN ('active','pending_parent_link','unregistered')
            AND class_group_id IS NULL
            AND (assigned_class_ids IS NULL OR jsonb_array_length(assigned_class_ids) = 0)
          )::int AS unassigned,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND pending_status_change = 'suspended')::int AS suspend_pending,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND pending_status_change = 'withdrawn')::int AS withdraw_pending,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'suspended')::int AS suspended,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'withdrawn')::int AS withdrawn
        FROM students
        WHERE swimming_pool_id = ${poolId}
      `)).rows as any[];

      res.json({
        all:             Number(row?.all             ?? 0),
        unassigned:      Number(row?.unassigned      ?? 0),
        suspend_pending: Number(row?.suspend_pending ?? 0),
        withdraw_pending:Number(row?.withdraw_pending?? 0),
        suspended:       Number(row?.suspended       ?? 0),
        withdrawn:       Number(row?.withdrawn       ?? 0),
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 내 회원 목록 ──────────────────────────────────────────────
// tab: all | unassigned | suspend_pending | withdraw_pending
// 전체 탭에는 내 풀의 모든 활성 회원 + 예정 회원 표시
router.get("/teacher/me/members", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { tab = "all" } = req.query as any;

      const [userRow] = await superAdminDb.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId}
      `).then(r => r.rows as any[]);
      const poolId = userRow?.swimming_pool_id;
      if (!poolId) { return res.json([]); }

      const COLS = sql`
        s.id, s.name, s.status, s.birth_year, s.phone, s.parent_name,
        s.parent_user_id, s.weekly_count, s.class_group_id,
        s.assigned_class_ids, s.schedule_labels, s.last_class_group_name,
        s.pending_status_change, s.pending_effective_mode, s.pending_effective_month,
        s.updated_at, s.withdrawn_at, s.archived_reason,
        cg.name AS class_group_name
      `;

      let rows;

      if (tab === "unassigned") {
        // 미배정: active, pending_parent_link, unregistered 이지만 반 배정 없는 회원
        // (엑셀 업로드된 학생은 unregistered 상태로 생성되므로 포함)
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.status IN ('active', 'pending_parent_link', 'unregistered')
            AND s.deleted_at IS NULL
            AND s.class_group_id IS NULL
            AND (s.assigned_class_ids IS NULL OR jsonb_array_length(s.assigned_class_ids) = 0)
          ORDER BY s.name ASC
        `);
      } else if (tab === "suspend_pending") {
        // 연기예정: pending_status_change = 'suspended'
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.pending_status_change = 'suspended'
            AND s.deleted_at IS NULL
          ORDER BY s.name ASC
        `);
      } else if (tab === "withdraw_pending") {
        // 퇴원예정: pending_status_change = 'withdrawn'
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.pending_status_change = 'withdrawn'
            AND s.deleted_at IS NULL
          ORDER BY s.name ASC
        `);
      } else if (tab === "suspended") {
        // 연기: status = 'suspended' (현재 연기 중인 회원)
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.status = 'suspended'
            AND s.deleted_at IS NULL
          ORDER BY s.name ASC
        `);
      } else if (tab === "withdrawn") {
        // 퇴원: status = 'withdrawn' (퇴원 완료된 회원)
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.status = 'withdrawn'
            AND s.deleted_at IS NULL
          ORDER BY s.name ASC
        `);
      } else {
        // 전체: active/pending_parent_link/unregistered 상태이거나 pending_status_change 있는 회원
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.deleted_at IS NULL
            AND (
              s.status IN ('active', 'suspended', 'withdrawn', 'pending_parent_link', 'unregistered')
              OR s.pending_status_change IS NOT NULL
            )
          ORDER BY s.name ASC
        `);
      }

      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);


// ── 학생 레벨 조회/변경 (선생님) ─────────────────────────────────────────────
const DEFAULT_LEVELS_T = Array.from({ length: 10 }, (_, i) => ({
  level_order: i + 1,
  level_name: String(i + 1),
  level_description: "",
  learning_content: "",
  promotion_test_rule: "",
  badge_type: "text",
  badge_label: String(i + 1),
  badge_color: "#1F8F86",
  badge_text_color: "#FFFFFF",
}));

router.get("/teacher/students/:id/level", requireAuth, async (req: AuthRequest, res) => {
  try {
    const studRow = await db.execute(sql`
      SELECT s.id, s.name, s.current_level_order, s.swimming_pool_id
      FROM students s WHERE s.id = ${req.params.id}
    `);
    const student = studRow.rows[0] as any;
    if (!student) { res.status(404).json({ error: "학생 없음" }); return; }
    const poolId = student.swimming_pool_id;
    const currentOrder = student.current_level_order;
    const levelRows = await db.execute(sql`
      SELECT level_order, level_name, level_description, learning_content,
             promotion_test_rule, badge_type, badge_label, badge_color, badge_text_color, is_active
      FROM pool_level_settings WHERE pool_id = ${poolId}
      ORDER BY level_order ASC
    `);
    const allDefs = levelRows.rows.length > 0 ? (levelRows.rows as any[]) : DEFAULT_LEVELS_T;
    const activeDefs = allDefs.filter((l: any) => l.is_active !== false);
    const currentDef = currentOrder ? (allDefs.find((l: any) => l.level_order === currentOrder) ?? null) : null;
    res.json({ current_level_order: currentOrder ?? null, current_level: currentDef, all_levels: activeDefs });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

router.patch("/teacher/students/:id/level", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { level_order, note } = req.body;
    if (level_order == null) { res.status(400).json({ error: "level_order 필요" }); return; }
    const userId = req.user!.userId;
    const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
    const actorName = (userRow.rows[0] as any)?.name || "선생님";
    const studRow = await db.execute(sql`SELECT name, swimming_pool_id FROM students WHERE id = ${req.params.id}`);
    const student = studRow.rows[0] as any;
    if (!student) { res.status(404).json({ error: "학생 없음" }); return; }
    const poolId = student.swimming_pool_id;
    const lvRow = await db.execute(sql`
      SELECT level_name FROM pool_level_settings WHERE pool_id = ${poolId} AND level_order = ${level_order}
    `);
    const lvName = (lvRow.rows[0] as any)?.level_name ?? String(level_order);
    await db.execute(sql`
      UPDATE students SET current_level_order = ${level_order}, updated_at = NOW() WHERE id = ${req.params.id}
    `);
    // UPDATE 성공 즉시 응답 — INSERT는 비동기 처리 (테이블 미존재 등 실패해도 UX 영향 없음)
    res.json({ ok: true, level_order, level_name: lvName });
    db.execute(sql`
      INSERT INTO student_levels (id, student_id, swimming_pool_id, level, level_order, achieved_date, note, teacher_name, created_at)
      VALUES (gen_random_uuid()::text, ${req.params.id}, ${poolId}, ${lvName}, ${level_order},
              to_char(now(), 'YYYY-MM-DD'), ${note ?? null}, ${actorName}, NOW())
    `).catch((e: any) => console.error("[레벨변경] student_levels INSERT 실패:", e?.message));

    // 비동기 학부모 push 알림 (응답 후 처리)
    try {
      const parentRows = await db.execute(sql`
        SELECT DISTINCT ps.parent_id
        FROM parent_students ps
        WHERE ps.student_id = ${req.params.id} AND ps.status = 'approved'
      `);
      for (const p of parentRows.rows as any[]) {
        await sendPushToUser(
          p.parent_id, true, "level_change",
          "🎉 레벨이 변경됐어요!",
          `${student.name} 학생의 레벨이 "${lvName}"로 변경됐습니다.`,
          { screen: "level", studentId: req.params.id },
          userId
        );
      }
    } catch (pushErr) {
      console.error("[레벨변경 push]", pushErr);
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

export default router;

