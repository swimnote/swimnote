/**
 * 선생님 계정 관리 (pool_admin 전용)
 * - 선생님 계정 조회 / 생성 / 삭제 / 비밀번호 재설정
 * - OTP 기반 계정 활성화 (MVP: 관리자가 코드를 선생님에게 전달)
 * - 관리자 본인용 선생님 계정은 최대 1개
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";

const router = Router();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function getAdminPoolId(adminId: string): Promise<string | null> {
  const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, adminId)).limit(1);
  return me?.swimming_pool_id || null;
}

// ── 선생님 목록 ───────────────────────────────────────────────────────
router.get("/teachers", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teachers = await db.execute(sql`
        SELECT id, name, email, phone, position, is_activated, is_admin_self_teacher, created_at
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

      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      // 관리자 본인 계정 중복 확인 (최대 1개)
      if (is_admin_self_teacher) {
        const existing = await db.execute(sql`
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
      const dup = await db.execute(sql`SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}`);
      if (dup.rows.length) {
        res.status(409).json({ error: "이미 사용 중인 이메일입니다." }); return;
      }

      const passwordHash = await hashPassword(password);
      const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await db.execute(sql`
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
      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await db.execute(sql`
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
        const phone = (await db.execute(sql`SELECT phone FROM users WHERE id = ${req.params.id}`)).rows[0] as any;
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
      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await db.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      const passwordHash = await hashPassword(password);
      await db.execute(sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 선생님 정보 수정 (이름/연락처/직급) ───────────────────────────────
router.patch("/teachers/:id", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { name, phone, position } = req.body;
      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await db.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      await db.execute(sql`
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
router.delete("/teachers/:id", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await db.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      await db.execute(sql`DELETE FROM phone_verifications WHERE ref_id = ${req.params.id}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ══════════════════════════════════════════════════════════════════
//  선생님 자기관리 API (teacher 본인 전용)
// ══════════════════════════════════════════════════════════════════

/** 현재 로그인한 사용자의 pool_id 조회 */
async function getMyPoolId(userId: string): Promise<string | null> {
  const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return me?.swimming_pool_id || null;
}

// ── 내 프로필 조회 ─────────────────────────────────────────────
router.get("/teacher/me", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const me = await db.execute(sql`
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
      await db.execute(sql`
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
          AND deleted_at IS NULL AND status = 'active'
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
        member_status: { active, suspended, withdrawn },
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 미디어 사용량 ──────────────────────────────────────────────
router.get("/teacher/me/media-usage", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const photos = await db.execute(sql`
        SELECT COALESCE(SUM(file_size_bytes), 0) as total_bytes, COUNT(*) as count
        FROM student_photos WHERE uploader_id = ${userId}
      `);
      const videos = await db.execute(sql`
        SELECT COALESCE(SUM(file_size_bytes), 0) as total_bytes, COUNT(*) as count
        FROM student_videos WHERE uploader_id = ${userId}
      `);
      const photoRow = photos.rows[0] as any;
      const videoRow = videos.rows[0] as any;
      const photoBytes  = Number(photoRow?.total_bytes || 0);
      const videoBytes  = Number(videoRow?.total_bytes || 0);
      const photoCount  = Number(photoRow?.count || 0);
      const videoCount  = Number(videoRow?.count || 0);

      // 이번 달
      const monthPhotos = await db.execute(sql`
        SELECT COALESCE(SUM(file_size_bytes), 0) as total
        FROM student_photos
        WHERE uploader_id = ${userId}
          AND date_trunc('month', created_at) = date_trunc('month', now())
      `);
      const monthVideos = await db.execute(sql`
        SELECT COALESCE(SUM(file_size_bytes), 0) as total
        FROM student_videos
        WHERE uploader_id = ${userId}
          AND date_trunc('month', created_at) = date_trunc('month', now())
      `);
      const monthBytes = Number((monthPhotos.rows[0] as any)?.total || 0) + Number((monthVideos.rows[0] as any)?.total || 0);

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
      const userRow = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
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

// ── 내 반 보강 대기 목록 ────────────────────────────────────────
router.get("/teacher/makeups", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { status = "waiting" } = req.query as any;
      // "pending"은 "waiting"과 동일하게 처리
      const dbStatus = status === "pending" ? "waiting" : status;
      const rows = await db.execute(sql`
        SELECT ms.*
        FROM makeup_sessions ms
        WHERE ms.original_teacher_id = ${userId}
          AND ms.status = ${dbStatus}
          AND ms.cancelled_at IS NULL
        ORDER BY ms.absence_date ASC, ms.created_at ASC
      `);
      res.json(rows.rows);
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

      const rows = await db.execute(sql`
        SELECT
          cg.id, cg.name, cg.schedule_days, cg.schedule_time,
          cg.capacity, cg.teacher_user_id,
          u.name AS instructor,
          COUNT(s.id) FILTER (WHERE s.status = 'active' AND s.deleted_at IS NULL) AS current_members,
          GREATEST(0, cg.capacity - COUNT(s.id) FILTER (WHERE s.status = 'active' AND s.deleted_at IS NULL)) AS available_slots
        FROM class_groups cg
        LEFT JOIN users u ON cg.teacher_user_id = u.id
        LEFT JOIN students s ON s.class_group_id = cg.id OR s.assigned_class_ids @> to_jsonb(cg.id::text)
        WHERE cg.swimming_pool_id = ${poolId}
          AND cg.is_deleted = false
          AND (cg.is_one_time = false OR cg.is_one_time IS NULL)
        GROUP BY cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity, cg.teacher_user_id, u.name
        HAVING GREATEST(0, cg.capacity - COUNT(s.id) FILTER (WHERE s.status = 'active' AND s.deleted_at IS NULL)) > 0
        ORDER BY cg.schedule_days, cg.schedule_time
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 보강 지정 (teacher용) ──────────────────────────────────────
router.patch("/teacher/makeups/:id/assign", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { class_group_id, assigned_date } = req.body;
      const sessionId = req.params.id;
      if (!class_group_id || !assigned_date) {
        res.status(400).json({ error: "반과 날짜를 선택해주세요." }); return;
      }
      const cls = await db.execute(sql`
        SELECT cg.name, u.name AS teacher_name, cg.teacher_user_id
        FROM class_groups cg LEFT JOIN users u ON cg.teacher_user_id = u.id
        WHERE cg.id = ${class_group_id}
      `);
      if (!cls.rows.length) { res.status(404).json({ error: "반을 찾을 수 없습니다." }); return; }
      const clsRow = cls.rows[0] as any;
      await db.execute(sql`
        UPDATE makeup_sessions SET
          status = 'assigned',
          assigned_class_group_id   = ${class_group_id},
          assigned_class_group_name = ${clsRow.name},
          assigned_teacher_id       = ${clsRow.teacher_user_id},
          assigned_teacher_name     = ${clsRow.teacher_name},
          assigned_date             = ${assigned_date},
          updated_at                = now()
        WHERE id = ${sessionId}
      `);
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
      const userRow = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
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

// ── 내 회원 목록 (상태별) ──────────────────────────────────────
// status: active | pending | suspended | withdrawn | all
// 대기자명단(pending/suspended/withdrawn/all): 해당 pool 전체에서 조회
// active: 기존대로 선생님 담당 반 학생만
router.get("/teacher/me/members", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { status = "active" } = req.query as any;

      // 선생님의 pool_id 조회
      const [userRow] = await db.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId}
      `).then(r => r.rows as any[]);
      const poolId = userRow?.swimming_pool_id;

      // active: 기존 — 선생님 담당 반의 학생만
      if (status === "active") {
        const rows = await db.execute(sql`
          SELECT DISTINCT s.id, s.name, s.status, s.deleted_at, s.archived_reason,
            s.birth_year, s.phone, s.parent_user_id,
            cg.name AS class_name, s.updated_at
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE (
            cg.teacher_user_id = ${userId}
            OR EXISTS (
              SELECT 1 FROM class_groups cg2 WHERE cg2.teacher_user_id = ${userId}
              AND s.assigned_class_ids @> to_jsonb(cg2.id::text)
            )
          )
          AND s.status = 'active'
          ORDER BY s.name ASC
        `);
        return res.json(rows.rows);
      }

      // pending / suspended / withdrawn / all: pool 전체에서 해당 상태 조회
      if (!poolId) { return res.json([]); }

      let statusFilter: any;
      if (status === "all") {
        statusFilter = sql`s.status IN ('pending', 'suspended', 'withdrawn')`;
      } else if (["pending", "suspended", "withdrawn"].includes(status)) {
        statusFilter = sql`s.status = ${status}`;
      } else {
        statusFilter = sql`s.status = 'active'`;
      }

      const rows = await db.execute(sql`
        SELECT DISTINCT s.id, s.name, s.status, s.deleted_at, s.withdrawn_at,
          s.archived_reason, s.birth_year, s.phone, s.parent_user_id,
          s.last_class_group_name,
          cg.name AS class_name, s.updated_at
        FROM students s
        LEFT JOIN class_groups cg ON s.class_group_id = cg.id
        WHERE s.swimming_pool_id = ${poolId}
          AND ${statusFilter}
        ORDER BY s.updated_at DESC
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
