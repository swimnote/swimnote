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

export default router;
