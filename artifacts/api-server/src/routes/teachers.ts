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

async function getAdminPoolId(adminId: string): Promise<string | null> {
  const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, adminId)).limit(1);
  return me?.swimming_pool_id || null;
}

// ── 선생님 목록 ───────────────────────────────────────────────────────
router.get("/teachers", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId);
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

      const poolId = await getAdminPoolId(req.user!.userId);
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
      const poolId = await getAdminPoolId(req.user!.userId);
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
      const poolId = await getAdminPoolId(req.user!.userId);
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
      const poolId = await getAdminPoolId(req.user!.userId);
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
router.delete("/teachers/:id", requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const teacher = await superAdminDb.execute(sql`
        SELECT id FROM users WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} AND role = 'teacher'
      `);
      if (!teacher.rows.length) { res.status(404).json({ error: "선생님을 찾을 수 없습니다." }); return; }

      await db.execute(sql`DELETE FROM phone_verifications WHERE ref_id = ${req.params.id}`);
      await superAdminDb.execute(sql`DELETE FROM users WHERE id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ══════════════════════════════════════════════════════════════════
//  선생님 자기관리 API (teacher 본인 전용)
// ══════════════════════════════════════════════════════════════════

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

      const rows = await superAdminDb.execute(sql`
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

      // 기존 보강 세션 조회 (신규 배정 vs 변경 판단)
      const prevRows = (await db.execute(sql`
        SELECT student_id, student_name, status, assigned_class_group_id
        FROM makeup_sessions WHERE id = ${sessionId} LIMIT 1
      `)).rows as any[];
      if (!prevRows.length) { res.status(404).json({ error: "보강 세션을 찾을 수 없습니다." }); return; }
      const prev = prevRows[0];
      const isChange = prev.status === "assigned" && !!prev.assigned_class_group_id;

      const cls = await superAdminDb.execute(sql`
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

// ── 나에게 배정/이동된 보강 목록 (teacher용) ──────────────────
// transferred_to_teacher_id = me  OR  assigned_teacher_id = me (status: assigned/transferred)
router.get("/teacher/makeups/assigned", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const rows = await db.execute(sql`
        SELECT ms.*
        FROM makeup_sessions ms
        WHERE (ms.transferred_to_teacher_id = ${userId} OR ms.assigned_teacher_id = ${userId})
          AND ms.original_teacher_id != ${userId}
          AND ms.status IN ('assigned','transferred')
          AND ms.cancelled_at IS NULL
        ORDER BY ms.absence_date ASC, ms.created_at ASC
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 배정된 보강 완료 처리 (teacher용) ─────────────────────────
router.patch("/teacher/makeups/:id/complete", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const userName = (userRow.rows[0] as any)?.name || "";
      const rows = (await db.execute(sql`
        SELECT * FROM makeup_sessions WHERE id = ${req.params.id} LIMIT 1
      `)).rows as any[];
      if (!rows.length) { res.status(404).json({ error: "보강 없음" }); return; }
      const mk = rows[0];
      // 담당선생님이거나 이동된 선생님만 완료 처리 가능
      if (mk.transferred_to_teacher_id !== userId && mk.assigned_teacher_id !== userId) {
        res.status(403).json({ error: "처리 권한이 없습니다." }); return;
      }
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
        // 미배정: active 또는 pending_parent_link 이지만 반 배정 없는 회원
        // (관리자가 학부모 정보와 함께 등록한 학생은 pending_parent_link 상태이지만 미배정 목록에 표시)
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.status IN ('active', 'pending_parent_link')
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
      } else {
        // 전체: active/pending_parent_link 상태이거나 pending_status_change 있는 회원
        rows = await db.execute(sql`
          SELECT ${COLS}
          FROM students s
          LEFT JOIN class_groups cg ON s.class_group_id = cg.id
          WHERE s.swimming_pool_id = ${poolId}
            AND s.deleted_at IS NULL
            AND (
              s.status IN ('active', 'pending_parent_link')
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
    await db.execute(sql`
      INSERT INTO student_levels (id, student_id, swimming_pool_id, level, level_order, achieved_date, note, teacher_name, created_at)
      VALUES (gen_random_uuid()::text, ${req.params.id}, ${poolId}, ${lvName}, ${level_order},
              to_char(now(), 'YYYY-MM-DD'), ${note ?? null}, ${actorName}, NOW())
    `);
    res.json({ ok: true, level_order, level_name: lvName });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

export default router;

