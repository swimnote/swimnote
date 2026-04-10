import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { db, superAdminDb } from "@workspace/db";
import { usersTable, parentAccountsTable, swimmingPoolsTable, studentRegistrationRequestsTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  normalizePhone as normPhoneV2,
  normalizeName as normNameV2,
  tryMatchStudentV2,
  linkParentToStudentV2,
  upsertParentV2Pending,
} from "../lib/auto-link-v2.js";
import { hashPassword, comparePassword, signToken, signTotpSession, verifyTotpSession } from "../lib/auth.js";
import { requireAuth, requireDbRoleCheck, type AuthRequest } from "../middlewares/auth.js";
import { generateSecret as totpGenerateSecret, verifySync as totpVerifySync, generateURI as totpGenerateURI } from "otplib";
import QRCode from "qrcode";
import {
  sendSms,
  sendDevVerification,
  getActiveProvider,
  isSmsConfigured,
  getSmsConfigError,
} from "../lib/sms/sendSms.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

// ── 관리자/선생님 로그인 ──────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return err(res, 400, "이메일과 비밀번호를 입력해주세요.");
  try {
    const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    if (!user) return err(res, 401, "이메일 또는 비밀번호가 올바르지 않습니다.");

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return err(res, 401, "이메일 또는 비밀번호가 올바르지 않습니다.");

    // pool_admin 역할은 수영장 승인 상태 확인
    if (user.role === "pool_admin" && user.swimming_pool_id) {
      const [pool] = await superAdminDb.select({ approval_status: swimmingPoolsTable.approval_status })
        .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, user.swimming_pool_id)).limit(1);
      
      if (!pool) return err(res, 403, "소속된 수영장을 찾을 수 없습니다.");
      
      if (pool.approval_status === "pending") {
        return res.status(403).json({
          success: false, message: "수영장이 아직 승인되지 않았습니다. 플랫폼 운영자의 승인을 기다려주세요.",
          error: "pool_approval_pending", pool_status: "pending",
        });
      }
      if (pool.approval_status === "rejected") {
        return res.status(403).json({
          success: false, message: "수영장 신청이 반려되었습니다. 플랫폼 운영자에게 문의하세요.",
          error: "pool_approval_rejected", pool_status: "rejected",
        });
      }
    }

    if (user.role === "teacher" && !(user as any).is_activated) {
      // 자체 가입 신청(대기중)인지 확인
      const pendingInvite = await superAdminDb.execute(sql`
        SELECT id FROM teacher_invites
        WHERE user_id = ${user.id} AND invite_status = 'joinedPendingApproval'
        LIMIT 1
      `);
      if (pendingInvite.rows.length > 0) {
        res.status(403).json({
          success: false,
          message: "관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.",
          error: "pending_teacher_approval",
          error_code: "pending_teacher_approval",
        });
      } else {
        res.status(403).json({
          success: false,
          message: "계정이 아직 활성화되지 않았습니다.",
          error: "계정이 아직 활성화되지 않았습니다.",
          error_code: "needs_activation",
          needs_activation: true,
          teacher_id: user.id,
          hint: "관리자로부터 받은 인증코드로 계정을 활성화해주세요.",
        });
      }
      return;
    }

    // platform_admin: permissions를 JWT에 포함
    let permissions;
    if ((user.role as string) === "platform_admin") {
      permissions = (user as any).permissions || { canViewPools: true, canEditPools: false, canApprovePools: false, canManageSubscriptions: false, canManagePlatformAdmins: false };
    }

    const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id, permissions });
    const { password_hash: _, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 관리자 계정 가입 ──────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { email, password, name, phone, role,
          pool_name, pool_address, pool_phone, pool_owner_name, pool_name_en } = req.body;
  if (!email || !password || !name) return err(res, 400, "필수 정보를 입력해주세요.");
  if (password.length < 4) return err(res, 400, "비밀번호는 4자 이상이어야 합니다.");
  const isPoolAdmin = role === "pool_admin";
  if (isPoolAdmin && (!pool_name || !pool_address || !pool_phone || !pool_owner_name)) {
    return err(res, 400, "수영장 정보를 모두 입력해주세요.");
  }
  try {
    const [existing] = await superAdminDb.select().from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    if (existing) return err(res, 400, "이미 사용 중인 이메일입니다.");

    const password_hash = await hashPassword(password);
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let poolId: string | null = null;

    if (isPoolAdmin) {
      // ── 1) 수영장 즉시 생성 (approved, trial) ───────────────────────
      poolId = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const resolvedNameEn = pool_name_en?.trim()
        ? pool_name_en.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")
        : pool_name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").substring(0, 30) || `pool_${Date.now()}`;

      await superAdminDb.execute(sql`
        INSERT INTO swimming_pools
          (id, name, name_en, address, phone, owner_name, owner_email,
           admin_name, admin_email, admin_phone, approval_status, subscription_status, trial_end_at)
        VALUES
          (${poolId}, ${pool_name.trim()}, ${resolvedNameEn}, ${pool_address.trim()},
           ${pool_phone.trim()}, ${pool_owner_name.trim()}, ${email.trim().toLowerCase()},
           ${name.trim()}, ${email.trim().toLowerCase()}, ${phone || null},
           'approved', 'trial', NOW() + INTERVAL '30 days')
      `);

      // ── 2) 관리자 계정 생성 (is_activated=true, is_admin_self_teacher=true) ─
      await superAdminDb.execute(sql`
        INSERT INTO users
          (id, email, password_hash, name, phone, role,
           swimming_pool_id, is_activated, is_admin_self_teacher,
           phone_verified, roles, created_at, updated_at)
        VALUES
          (${userId}, ${email.trim().toLowerCase()}, ${password_hash}, ${name.trim()},
           ${phone || null}, 'pool_admin'::user_role,
           ${poolId}, true, true,
           true, '{"pool_admin","teacher"}'::TEXT[], now(), now())
      `);

      // ── 3) 선생님 엔티티 자동 생성 (teacher_invites — approved 상태) ─
      const inviteId = `tinv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO teacher_invites
          (id, swimming_pool_id, name, phone, position,
           invite_token, invite_status, invited_by, user_id,
           approved_at, approved_by, approved_role, created_at, requested_at)
        VALUES
          (${inviteId}, ${poolId}, ${'관리자선생님'}, ${(phone || pool_phone || '').trim()}, ${'관리자'},
           ${inviteId}, ${'approved'}, ${userId}, ${userId},
           now(), ${userId}, ${'teacher'}, now(), now())
      `);

      const token = signToken({ userId, role: "pool_admin", poolId });
      res.status(201).json({
        success: true,
        token,
        activated: true,
        pool_created: true,
        teacher_profile_created: true,
        roles: ["pool_admin", "teacher"],
        user: {
          id: userId, email: email.trim().toLowerCase(), name: name.trim(),
          phone: phone || null, role: "pool_admin", swimming_pool_id: poolId,
          is_activated: true, is_admin_self_teacher: true,
          roles: ["pool_admin", "teacher"],
        },
      });
    } else {
      // 일반(parent/teacher) 가입 — 기존 로직 유지
      const [user] = await superAdminDb.insert(usersTable).values({
        id: userId, email: email.trim().toLowerCase(), password_hash, name,
        phone: phone || null, role: "parent",
      }).returning();
      const token = signToken({ userId: user.id, role: user.role, poolId: null });
      const { password_hash: _, ...safeUser } = user;
      res.status(201).json({ success: true, token, user: { ...safeUser, roles: [user.role] } });
    }
  } catch (e: any) {
    console.error("[register] 오류:", e?.message, e);
    // DB 제약 조건별 명확한 메시지 반환
    const msg = e?.message || "";
    const cause = e?.cause?.message || e?.cause?.detail || "";
    if (msg.includes("unique") || cause.includes("unique") || e?.code === "23505" || e?.cause?.code === "23505") {
      if (msg.includes("email") || cause.includes("email")) return err(res, 400, "이미 사용 중인 이메일입니다.");
      if (msg.includes("name_en") || cause.includes("name_en")) return err(res, 400, "수영장 영문명이 이미 사용 중입니다. 수영장 이름을 변경해주세요.");
      return err(res, 400, "이미 사용 중인 정보가 있습니다. 이메일을 확인해주세요.");
    }
    if (msg.includes("not-null") || cause.includes("not-null") || e?.code === "23502" || e?.cause?.code === "23502") {
      return err(res, 400, "필수 정보가 누락되었습니다.");
    }
    return err(res, 500, "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
});

// ── 슈퍼매니저 계정 생성 (super_admin 전용) ───────────────────────────
router.post("/create-super-manager", requireAuth, async (req: AuthRequest, res) => {
  if (!req.user || !["super_admin", "platform_admin"].includes(req.user.role)) {
    return err(res, 403, "권한이 없습니다.");
  }
  const { name, email, password } = req.body;
  if (!name || !email || !password) return err(res, 400, "이름, 이메일, 비밀번호는 필수입니다.");
  if (password.length < 8) return err(res, 400, "비밀번호는 8자 이상이어야 합니다.");
  try {
    const [existing] = await superAdminDb.select().from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    if (existing) return err(res, 400, "이미 사용 중인 이메일입니다.");
    const password_hash = await hashPassword(password);
    const id = `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [user] = await superAdminDb.insert(usersTable).values({
      id, email: email.trim().toLowerCase(), password_hash, name: name.trim(),
      phone: null, role: "super_manager" as any,
    } as any).returning();
    const { password_hash: _, ...safeUser } = user;
    res.status(201).json({ success: true, user: safeUser });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 선생님 계정 OTP 활성화 ────────────────────────────────────────────
router.post("/activate-teacher", async (req, res) => {
  const { teacher_id, otp } = req.body;
  if (!teacher_id || !otp) return err(res, 400, "teacher_id와 인증코드를 입력해주세요.");
  try {
    const [teacher] = await superAdminDb.select().from(usersTable)
      .where(and(eq(usersTable.id, teacher_id), eq(usersTable.role, "teacher"))).limit(1);
    if (!teacher) return err(res, 404, "선생님 계정을 찾을 수 없습니다.");
    if ((teacher as any).is_activated) return err(res, 400, "이미 활성화된 계정입니다.");

    const verif = await db.execute(sql`
      SELECT * FROM phone_verifications
      WHERE ref_id = ${teacher_id}
        AND code = ${otp.trim()}
        AND purpose = 'teacher_activation'
        AND is_used = false
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (!verif.rows.length) return err(res, 400, "인증코드가 올바르지 않거나 만료되었습니다.");

    await superAdminDb.execute(sql`UPDATE users SET is_activated = true, phone_verified = true, updated_at = now() WHERE id = ${teacher_id}`);
    await db.execute(sql`UPDATE phone_verifications SET is_used = true WHERE id = ${(verif.rows[0] as any).id}`);

    const token = signToken({ userId: teacher.id, role: teacher.role, poolId: teacher.swimming_pool_id });
    const { password_hash: _, ...safeUser } = teacher;
    res.json({ success: true, token, user: { ...safeUser, is_activated: true }, message: "계정이 활성화되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 학부모 로그인 ─────────────────────────────────────────────────────
router.post("/parent-login", async (req, res) => {
  const { identifier, loginId, phone, pin, password } = req.body;
  const id = (identifier || loginId || phone || "").trim();
  const pw = (password || pin || "").trim();
  if (!id || !pw) return err(res, 400, "아이디와 비밀번호를 입력해주세요.");
  try {
    // login_id 기반 조회 먼저, 없으면 phone 기반 조회
    const byLoginId = await db.execute(sql`SELECT * FROM parent_accounts WHERE login_id = ${id} LIMIT 1`);
    const byPhone = byLoginId.rows.length === 0
      ? await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.phone, id))
      : [];
    const accounts: any[] = byLoginId.rows.length > 0 ? byLoginId.rows : byPhone;
    if (accounts.length === 0) {
      return err(res, 401, "등록되지 않은 아이디 또는 전화번호입니다.");
    }
    let matched: any = null;
    // Apple 심사용 데모 학부모 계정 (demo_parent / Demo2024!) — 비밀번호 검증 우회
    if (accounts.length > 0 && accounts[0].login_id === "demo_parent" && pw === "Demo2024!") {
      matched = accounts[0];
      // swimming_pool_id가 없으면 승인된 첫 번째 수영장 자동 연결
      if (!matched.swimming_pool_id) {
        const poolRow = await db.execute(sql`
          SELECT id FROM swimming_pools WHERE approval_status = 'approved' ORDER BY created_at ASC LIMIT 1
        `);
        if ((poolRow.rows as any[]).length > 0) {
          const poolId = (poolRow.rows[0] as any).id;
          await db.execute(sql`UPDATE parent_accounts SET swimming_pool_id = ${poolId} WHERE id = ${matched.id}`);
          matched.swimming_pool_id = poolId;
        }
      }
    } else {
      for (const acc of accounts) {
        const valid = await comparePassword(pw, acc.pin_hash);
        if (valid) { matched = acc; break; }
      }
    }
    if (!matched) return err(res, 401, "비밀번호가 올바르지 않습니다.");
    // 수영장 이름 조회 (swimming_pool_id 없으면 join_request에서 poolId 추출)
    let resolvedPoolId: string | null = matched.swimming_pool_id || null;
    let poolDisplayName: string | null = null;
    if (!resolvedPoolId) {
      // student_registration_requests에서 마지막으로 요청한 pool 확인
      const reqRow = await db.execute(sql`
        SELECT swimming_pool_id FROM student_registration_requests
        WHERE parent_id = ${matched.id} ORDER BY created_at DESC LIMIT 1
      `);
      if ((reqRow.rows as any[]).length > 0) resolvedPoolId = (reqRow.rows[0] as any).swimming_pool_id || null;
    }
    if (resolvedPoolId) {
      const poolRow = await db.select({ name: swimmingPoolsTable.name })
        .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, resolvedPoolId)).limit(1);
      poolDisplayName = poolRow[0]?.name || null;
      // swimming_pool_id가 null이었으면 backfill
      if (!matched.swimming_pool_id) {
        await db.execute(sql`UPDATE parent_accounts SET swimming_pool_id = ${resolvedPoolId} WHERE id = ${matched.id}`);
        matched.swimming_pool_id = resolvedPoolId;
      }
    }
    const token = signToken({ userId: matched.id, role: "parent_account", poolId: matched.swimming_pool_id });
    res.json({
      success: true, token,
      parent: { id: matched.id, name: matched.name, phone: matched.phone, swimming_pool_id: matched.swimming_pool_id, login_id: matched.login_id, pool_name: poolDisplayName },
    });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 내 정보 조회 ──────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user) return err(res, 404, "사용자를 찾을 수 없습니다.");
    const { password_hash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 내 정보 수정 (이름/전화번호) ────────────────────────────────────
router.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  const { name, phone } = req.body;
  if (!name?.trim() && !phone?.trim()) return err(res, 400, "수정할 항목이 없습니다.");
  try {
    await superAdminDb.execute(sql`
      UPDATE users SET
        name  = COALESCE(NULLIF(${name?.trim() || ''}, ''), name),
        phone = COALESCE(NULLIF(${phone?.trim() || ''}, ''), phone),
        updated_at = now()
      WHERE id = ${req.user!.userId}
    `);
    const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user) return err(res, 404, "사용자를 찾을 수 없습니다.");
    const { password_hash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 승인된 수영장 목록 (학부모 가입용) ───────────────────────────────
router.get("/pools", async (req, res) => {
  try {
    const search = (req.query.search as string || "").trim();
    const pools = await superAdminDb.select({
      id: swimmingPoolsTable.id, name: swimmingPoolsTable.name,
      address: swimmingPoolsTable.address, phone: swimmingPoolsTable.phone,
    }).from(swimmingPoolsTable).where(eq(swimmingPoolsTable.approval_status, "approved"));
    const filtered = search ? pools.filter(p => p.name.toLowerCase().includes(search.toLowerCase())) : pools;
    res.json(filtered);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 학부모 가입 ───────────────────────────────────────────────────────
router.post("/parent-register", async (req, res) => {
  const { name, phone, pin, loginId, password, swimming_pool_id, child_names, memo } = req.body;
  const pw = (password || pin || "").trim();
  const lid = loginId?.trim() || null;
  if (!name || !phone || !pw || !swimming_pool_id) return err(res, 400, "이름, 전화번호, 비밀번호, 수영장은 필수입니다.");
  if (pw.length < 4) return err(res, 400, "비밀번호는 4자리 이상이어야 합니다.");
  if (lid && lid.length < 3) return err(res, 400, "아이디는 3자 이상이어야 합니다.");
  const names: string[] = Array.isArray(child_names)
    ? child_names.map((n: string) => n.trim()).filter(Boolean) : [];
  if (names.length === 0) return err(res, 400, "자녀 이름을 1명 이상 입력해주세요.");
  try {
    const [pool] = await superAdminDb.select().from(swimmingPoolsTable)
      .where(and(eq(swimmingPoolsTable.id, swimming_pool_id), eq(swimmingPoolsTable.approval_status, "approved"))).limit(1);
    if (!pool) return err(res, 400, "유효하지 않은 수영장입니다.");

    if (lid) {
      const dupId = await db.execute(sql`SELECT id FROM parent_accounts WHERE login_id = ${lid} LIMIT 1`);
      if ((dupId.rows as any[]).length > 0) return err(res, 409, "이미 사용 중인 아이디입니다.");
    }

    const existing = await db.select().from(parentAccountsTable)
      .where(and(eq(parentAccountsTable.phone, phone), eq(parentAccountsTable.swimming_pool_id, swimming_pool_id)));
    if (existing.length > 0) return err(res, 400, "이미 해당 수영장에 등록된 전화번호입니다.");

    const pin_hash = await hashPassword(pw);
    const parentId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, login_id, created_at, updated_at)
      VALUES (${parentId}, ${swimming_pool_id}, ${phone}, ${pin_hash}, ${name}, ${lid}, now(), now())
    `);
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, parentId)).limit(1);

    const reqId = `srr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await superAdminDb.insert(studentRegistrationRequestsTable).values({
      id: reqId, swimming_pool_id, parent_id: parentId,
      child_names: names, memo: memo || null, status: "pending",
    });

    const token = signToken({ userId: pa.id, role: "parent_account", poolId: pa.swimming_pool_id });
    res.status(201).json({
      success: true, token,
      parent: { id: pa.id, name: pa.name, phone: pa.phone, login_id: pa.login_id, swimming_pool_id: pa.swimming_pool_id, pool_name: pool.name },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("unique")) return err(res, 400, "이미 등록된 전화번호입니다.");
    console.error(e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── 수영장 내 학생 검색 (학부모 가입 흐름용 — 공개 API) ───────────────────
// GET /auth/pool-student-search?pool_id=xxx&name=yyy
// 이름이 포함된 학생 목록 반환 (id, name, birth_year 만 — 개인정보 최소화)
router.get("/pool-student-search", async (req, res) => {
  const pool_id = (req.query.pool_id as string || "").trim();
  const name    = (req.query.name    as string || "").trim();
  if (!pool_id) return res.status(400).json({ error: "pool_id 필수" });
  if (!name || name.length < 1) return res.json([]);
  try {
    const rows = await db.execute(sql`
      SELECT id, name, birth_year
      FROM students
      WHERE swimming_pool_id = ${pool_id}
        AND name ILIKE ${"%" + name + "%"}
        AND status NOT IN ('withdrawn', 'archived', 'deleted')
      ORDER BY name
      LIMIT 20
    `);
    res.json(rows.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 학부모 간편 가입 (수영장/자녀 없이 계정만 생성) ──────────────────────
router.post("/simple-parent-register", async (req, res) => {
  // child_names: string[] — 자녀 이름 배열 (선택한 수영장 내에서 이름 매칭에 사용)
  // child_ids: string[]   — 직접 선택한 학생 ID 배열 (검색 후 확인한 경우 우선 사용)
  // pool_id: string       — 학부모가 선택한 수영장 ID
  const { parent_name, phone, loginId, password, child_names, child_ids, pool_id } = req.body;
  const name      = (parent_name || "").trim();
  const ph        = (phone || "").trim().replace(/[^0-9]/g, "");
  const lid       = (loginId || "").trim() || null;
  const pw        = (password || "").trim();
  let requestedPoolId: string | null = (pool_id || "").trim() || null;
  const childNamesArr: string[] = Array.isArray(child_names)
    ? child_names.map((s: string) => s.trim()).filter(Boolean)
    : [];
  const childIdsArr: string[] = Array.isArray(child_ids)
    ? child_ids.map((s: string) => s.trim()).filter(Boolean)
    : [];

  const phoneMask = ph.length > 6 ? ph.slice(0,3)+"****"+ph.slice(-4) : "****";
  console.log(`[simple-parent-register] 입력: name=${name} phone=${phoneMask} pool_id=${requestedPoolId ?? "미지정"} child_names=[${childNamesArr.join(",")}]`);

  if (!name || !ph || !pw) return err(res, 400, "학부모 이름, 전화번호, 비밀번호는 필수입니다.");
  if (pw.length < 4) return err(res, 400, "비밀번호는 4자리 이상이어야 합니다.");
  if (lid && lid.length < 3) return err(res, 400, "아이디는 3자 이상이어야 합니다.");

  // pool_id 미제공 시 전화번호로 수영장 자동 해결 (없으면 null로 진행 — 홈에서 온보딩)
  if (!requestedPoolId && ph) {
    const autoPool = await db.execute(sql`
      SELECT swimming_pool_id FROM students
      WHERE REGEXP_REPLACE(COALESCE(parent_phone,''),'[^0-9]','','g') = ${ph}
        AND status NOT IN ('withdrawn','archived','deleted')
        AND swimming_pool_id IS NOT NULL
      LIMIT 1
    `);
    if ((autoPool.rows as any[]).length > 0) {
      requestedPoolId = (autoPool.rows[0] as any).swimming_pool_id;
    }
  }
  // pool_id 없어도 가입 허용 — 홈 온보딩에서 수영장 선택

  try {
    let matched: any[] = [];
    let resolvedPoolId: string | null = requestedPoolId;

    // ════════════════════════════════════════════════════════════════════
    // 학생 매칭: 모든 단계를 병렬/누적으로 실행 (exclusive가 아닌 accumulate)
    // 중복 제거 헬퍼
    const addUnique = (arr: any[], items: any[]) => {
      for (const it of items) {
        if (!arr.some((m: any) => m.id === it.id)) arr.push(it);
      }
    };

    // matchedByName: child_names 중 이미 DB 학생과 매칭된 이름 (placeholder 중복 방지)
    const matchedByName = new Set<string>();
    // 매칭 후 matched 학생 이름이 childNamesArr에 있으면 matchedByName에 추가
    const markMatchedNames = (rows: any[]) => {
      for (const r of rows) {
        if (r.name && childNamesArr.includes(r.name)) matchedByName.add(r.name);
      }
    };

    // ── STEP 1: 학부모가 직접 선택한 학생 ID (최우선) ─────────────────────
    if (childIdsArr.length > 0 && resolvedPoolId) {
      for (const cId of childIdsArr) {
        const r = await db.execute(sql`
          SELECT id, swimming_pool_id, name FROM students
          WHERE id = ${cId}
            AND swimming_pool_id = ${resolvedPoolId}
            AND status NOT IN ('withdrawn', 'archived', 'deleted')
          LIMIT 1
        `);
        addUnique(matched, r.rows as any[]);
        markMatchedNames(r.rows as any[]);
      }
    }

    // ── STEP 2: 전화번호로 학생 매칭 ─────────────────────────────────────
    // pool 없으면 전체 DB에서 매칭 (실시간 연결), pool 있으면 해당 pool만
    if (ph) {
      const r = resolvedPoolId
        ? await db.execute(sql`
            SELECT id, swimming_pool_id, name FROM students
            WHERE REGEXP_REPLACE(COALESCE(parent_phone, ''), '[^0-9]', '', 'g') = ${ph}
              AND swimming_pool_id = ${resolvedPoolId}
              AND status NOT IN ('withdrawn', 'archived', 'deleted')
            LIMIT 20
          `)
        : await db.execute(sql`
            SELECT id, swimming_pool_id, name FROM students
            WHERE REGEXP_REPLACE(COALESCE(parent_phone, ''), '[^0-9]', '', 'g') = ${ph}
              AND status NOT IN ('withdrawn', 'archived', 'deleted')
            LIMIT 20
          `);
      addUnique(matched, r.rows as any[]);
      markMatchedNames(r.rows as any[]);
      // pool 미선택 시 첫 번째 매칭 학생의 pool을 resolvedPoolId로 사용
      if (!resolvedPoolId && (r.rows as any[]).length > 0) {
        resolvedPoolId = (r.rows[0] as any).swimming_pool_id;
      }
    }

    // ── STEP 3: 자녀 이름으로 매칭 (pool 있을 때만) ─────────────────────
    if (childNamesArr.length > 0 && resolvedPoolId) {
      for (const cName of childNamesArr) {
        const r = await db.execute(sql`
          SELECT id, swimming_pool_id, name FROM students
          WHERE name = ${cName}
            AND swimming_pool_id = ${resolvedPoolId}
            AND status NOT IN ('withdrawn', 'archived', 'deleted')
          LIMIT 5
        `);
        if ((r.rows as any[]).length > 0) {
          matchedByName.add(cName);
          addUnique(matched, r.rows as any[]);
        }
      }
    }

    // ── STEP 3B: 학부모 이름으로 추가 매칭 ──────────────────────────────
    if (name && resolvedPoolId) {
      const normName = name.replace(/\s+/g, "").toLowerCase();
      const r = await db.execute(sql`
        SELECT id, swimming_pool_id, name FROM students
        WHERE REPLACE(LOWER(COALESCE(parent_name, '')), ' ', '') = ${normName}
          AND swimming_pool_id = ${resolvedPoolId}
          AND status NOT IN ('withdrawn', 'archived', 'deleted')
        LIMIT 20
      `);
      addUnique(matched, r.rows as any[]);
      markMatchedNames(r.rows as any[]);
    }
    // ════════════════════════════════════════════════════════════════════

    // 수영장이 있는 경우에만 존재 확인
    let poolName: string | null = null;
    if (resolvedPoolId) {
      const poolRows = await db.execute(sql`SELECT id, name FROM swimming_pools WHERE id = ${resolvedPoolId} LIMIT 1`);
      if ((poolRows.rows as any[]).length === 0) return err(res, 404, "수영장을 찾을 수 없습니다.");
      poolName = (poolRows.rows as any[])[0].name;
    }

    // 아이디 중복 확인
    if (lid) {
      const dupId = await db.execute(sql`SELECT id FROM parent_accounts WHERE login_id = ${lid} LIMIT 1`);
      if ((dupId.rows as any[]).length > 0) return err(res, 409, "이미 사용 중인 아이디입니다.");
    }
    // 전화번호 중복 확인 (수영장 있을 때만 같은 수영장 체크, 없을 때는 전체 체크)
    if (resolvedPoolId) {
      const dupPhone = await db.execute(sql`SELECT id FROM parent_accounts WHERE phone = ${ph} AND swimming_pool_id = ${resolvedPoolId} LIMIT 1`);
      if ((dupPhone.rows as any[]).length > 0) return err(res, 409, "이미 가입된 전화번호입니다. 로그인 화면에서 로그인해주세요.");
    } else {
      const dupPhone = await db.execute(sql`SELECT id FROM parent_accounts WHERE phone = ${ph} AND swimming_pool_id IS NULL LIMIT 1`);
      if ((dupPhone.rows as any[]).length > 0) return err(res, 409, "이미 가입된 전화번호입니다. 로그인 화면에서 로그인해주세요.");
    }

    const pin_hash = await hashPassword(pw);
    const parentId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.execute(sql`
      INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, login_id, is_active, created_at, updated_at)
      VALUES (${parentId}, ${resolvedPoolId}, ${ph}, ${pin_hash}, ${name}, ${lid}, true, now(), now())
    `);

    // ── 매칭된 학생 전체 연결 (DELETE+INSERT로 항상 approved 보장) ─────────
    console.log(`[simple-parent-register] 연결 시작: parentId=${parentId} matched=${matched.length}명`);
    for (const student of matched) {
      try {
        const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.execute(sql`DELETE FROM parent_students WHERE parent_id=${parentId} AND student_id=${student.id}`);
        await db.execute(sql`
          INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at, created_at)
          VALUES (${psId}, ${parentId}, ${student.id}, ${student.swimming_pool_id}, 'approved', NOW(), NOW())
        `);
        await db.execute(sql`
          UPDATE students
          SET parent_user_id = ${parentId},
              parent_name    = COALESCE(NULLIF(parent_name, ''), ${name}),
              parent_phone   = COALESCE(NULLIF(parent_phone, ''), ${ph}),
              status         = CASE
                                 WHEN status IN ('unregistered', 'pending_approval') THEN 'active'
                                 ELSE status
                               END,
              updated_at = NOW()
          WHERE id = ${student.id}
        `);
        console.log(`[simple-parent-register] ✓ linked student=${student.id} pool=${student.swimming_pool_id}`);
      } catch (linkErr: any) {
        console.error(`[simple-parent-register] ✗ student=${student.id} error:`, linkErr?.message);
      }
    }

    // ── 자녀 이름을 제공했지만 이름 매칭이 안 된 경우 → placeholder 생성 ──
    // (매칭 여부와 무관하게, 이름 미매칭 자녀는 placeholder로 관리자에게 노출)
    const unmatchedNames = childNamesArr.filter(n => !matchedByName.has(n));
    // 전체 매칭이 0명이어도 자녀 이름이 없으면 placeholder를 만들지 않음
    if (unmatchedNames.length > 0 && resolvedPoolId) {
      for (const cName of unmatchedNames) {
        const sId = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.execute(sql`
          INSERT INTO students (id, swimming_pool_id, name, parent_name, parent_phone, parent_user_id,
            status, registration_path, weekly_count, assigned_class_ids, created_at, updated_at)
          VALUES (${sId}, ${resolvedPoolId}, ${cName}, ${name}, ${ph}, ${parentId},
            'unregistered', 'parent_signup', 1, '[]'::jsonb, NOW(), NOW())
          ON CONFLICT DO NOTHING
        `);
        const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.execute(sql`
          INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at)
          VALUES (${psId}, ${parentId}, ${sId}, ${resolvedPoolId}, 'approved', NOW())
          ON CONFLICT DO NOTHING
        `);
        matched.push({ id: sId, swimming_pool_id: resolvedPoolId });
      }
      console.log(`[simple-parent-register] placeholder ${unmatchedNames.length}명 생성: ${unmatchedNames.join(", ")}`);
    }

    console.log(`[simple-parent-register] 학부모 가입: poolId=${resolvedPoolId} matched=${matched.length}명`);

    const token = signToken({ userId: parentId, role: "parent_account", poolId: resolvedPoolId });
    return res.status(201).json({
      success: true, token,
      matched_count: matched.length,
      parent: { id: parentId, name, phone: ph, swimming_pool_id: resolvedPoolId, pool_name: poolName },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) return err(res, 409, "이미 사용 중인 정보입니다.");
    console.error(e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── 아이디 존재 여부 확인 ───────────────────────────────────────────────
router.post("/check-id", async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.json({ exists: false, type: null });
  const id = identifier.trim();
  try {
    const [user] = await superAdminDb.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.email, id.toLowerCase())).limit(1);
    if (user) return res.json({ exists: true, type: "admin" });

    const [parent] = await db.select({ id: parentAccountsTable.id })
      .from(parentAccountsTable).where(eq(parentAccountsTable.phone, id)).limit(1);
    if (parent) return res.json({ exists: true, type: "parent" });

    return res.json({ exists: false, type: null });
  } catch (e) {
    return res.json({ exists: false, type: null });
  }
});

// ── 통합 로그인 v2 — available_accounts 배열 반환 ──────────────────────
router.post("/unified-login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return err(res, 400, "아이디와 비밀번호를 입력해주세요.");
  const id = identifier.trim();
  console.log("[LOGIN_ROUTE] unified-login 요청 수신", { identifier: id });

  // ── Apple 심사용 데모 계정 특별 처리 ────────────────────────────────
  // DB 조회 없이 고정 자격증명으로 실제 pool_admin 계정 토큰 발급
  const DEMO_ID = "demo@swimnote.app";
  const DEMO_PW = "Demo2024!";
  if (id === DEMO_ID && password === DEMO_PW) {
    try {
      // 승인된 수영장 중 첫 번째 pool_admin 계정 조회
      const demoUser = await superAdminDb.execute(sql`
        SELECT u.id, u.email, u.name, u.role, u.swimming_pool_id, u.roles
        FROM users u
        JOIN swimming_pools p ON p.id = u.swimming_pool_id
        WHERE u.role = 'pool_admin'
          AND p.approval_status = 'approved'
        ORDER BY u.created_at ASC
        LIMIT 1
      `);
      if ((demoUser.rows as any[]).length > 0) {
        const user = demoUser.rows[0] as any;
        const token = signToken({ userId: user.id, role: "pool_admin", poolId: user.swimming_pool_id });
        const roles: string[] = user.roles ?? ["pool_admin"];
        return res.json({
          success: true,
          available_accounts: [{ kind: "admin", token, user: { ...user, roles } }],
          token, kind: "admin",
          user: { ...user, roles },
        });
      }
    } catch (e) {
      console.error("[demo-login]", e);
    }
    return err(res, 503, "데모 계정을 사용할 수 있는 수영장이 없습니다. 잠시 후 다시 시도해주세요.");
  }
  // ─────────────────────────────────────────────────────────────────────

  try {
    const available_accounts: any[] = [];
    let wrongPwCount = 0;

    // ── 1) users 테이블 (이메일 매칭) ────────────────────────────────
    const [user] = await superAdminDb.select().from(usersTable)
      .where(eq(usersTable.email, id.toLowerCase())).limit(1);

    if (user) {
      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        wrongPwCount++;
      } else {
        // teacher 활성화 체크
        if (user.role === "teacher") {
          const rawRows = await superAdminDb.execute(sql`SELECT is_activated FROM users WHERE id = ${user.id} LIMIT 1`);
          const isActivated = (rawRows.rows[0] as any)?.is_activated ?? true;
          if (!isActivated) {
            const pendingInvite = await superAdminDb.execute(sql`
              SELECT id FROM teacher_invites
              WHERE user_id = ${user.id} AND invite_status = 'joinedPendingApproval' LIMIT 1
            `);
            if (pendingInvite.rows.length > 0) {
              res.status(403).json({ success: false, error: "관리자 승인 대기 중입니다.", error_code: "pending_teacher_approval" }); return;
            }
            res.status(403).json({ success: false, error: "계정이 아직 활성화되지 않았습니다.", error_code: "needs_activation", needs_activation: true, teacher_id: user.id }); return;
          }
        }
        // TOTP 2단계 인증 체크 (App Store 리뷰 데모 계정은 우회)
        const isDemoAccount = user.email === "demo@swimnote.app";
        if (!isDemoAccount) {
          const totpRow = await superAdminDb.execute(sql`SELECT totp_enabled FROM users WHERE id = ${user.id} LIMIT 1`);
          const totpEnabled = (totpRow.rows[0] as any)?.totp_enabled ?? false;
          if (totpEnabled) {
            const totpSession = signTotpSession(user.id);
            res.json({ success: true, totp_required: true, totp_session: totpSession }); return;
          }
        }
        const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
        const { password_hash: _, ...safeUser } = user;
        const rolesRow = await superAdminDb.execute(sql`SELECT roles FROM users WHERE id = ${user.id} LIMIT 1`);
        const roles: string[] = (rolesRow.rows[0] as any)?.roles ?? [user.role];
        available_accounts.push({ kind: "admin", token, user: { ...safeUser, roles } });
      }
    }

    // ── 2) parent_accounts 테이블 (login_id → phone) ──────────────
    const parentByLoginId = await superAdminDb.execute(sql`SELECT * FROM parent_accounts WHERE login_id = ${id} LIMIT 1`);
    let parentRow: any = parentByLoginId.rows[0] ?? null;
    if (!parentRow) {
      const byPhoneRaw = await superAdminDb.execute(sql`SELECT * FROM parent_accounts WHERE phone = ${id} LIMIT 1`);
      parentRow = byPhoneRaw.rows[0] ?? null;
    }

    if (parentRow) {
      const valid = await comparePassword(password, parentRow.pin_hash);
      if (!valid) {
        wrongPwCount++;
      } else {
        let poolName: string | null = null;
        try {
          const [pool] = await superAdminDb.select({ name: swimmingPoolsTable.name })
            .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, parentRow.swimming_pool_id)).limit(1);
          poolName = pool?.name ?? null;
        } catch {}
        const token = signToken({ userId: parentRow.id, role: "parent_account", poolId: parentRow.swimming_pool_id });
        available_accounts.push({
          kind: "parent",
          token,
          join_status: "approved",
          join_request_id: null,
          parent: { id: parentRow.id, name: parentRow.name, nickname: parentRow.nickname || null, phone: parentRow.phone, login_id: parentRow.login_id, swimming_pool_id: parentRow.swimming_pool_id, pool_name: poolName },
        });
      }
    }

    // ── 3) 결과 처리 ─────────────────────────────────────────────────
    if (available_accounts.length === 0) {
      if (wrongPwCount > 0) {
        res.status(401).json({ success: false, error: "비밀번호가 일치하지 않습니다.", error_code: "wrong_password" }); return;
      }
      res.status(401).json({ success: false, error: "가입된 계정이 없습니다.", error_code: "user_not_found" }); return;
    }

    // 단일 계정 → 기존 호환성 유지 (kind + token + user/parent)
    const first = available_accounts[0];
    res.json({
      success: true,
      available_accounts,
      // 하위 호환 필드
      token: first.token,
      kind: first.kind,
      user: first.kind === "admin" ? first.user : undefined,
      parent: first.kind === "parent" ? first.parent : undefined,
    });
  } catch (e: any) {
    console.error("[LOGIN_ROUTE_ERROR]", { path: "/unified-login", body: { identifier: req.body?.identifier }, reason: e?.message, stack: e?.stack });
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── 역할 권한 유효성 확인 ─────────────────────────────────────────────
router.post("/check-role-permission", requireAuth, async (req: AuthRequest, res) => {
  const { role } = req.body;
  if (!role) return err(res, 400, "role을 지정해주세요.");
  try {
    const userId = req.user!.userId;
    // super 계열: DB 조회 없이 항상 유효
    if (["super_admin", "platform_admin", "super_manager"].includes(role)) {
      res.json({ valid: true }); return;
    }
    // DB에서 사용자 roles 조회 (모든 역할 공통)
    const userRow = await superAdminDb.execute(sql`
      SELECT is_activated, roles, role AS primary_role FROM users WHERE id = ${userId} LIMIT 1
    `);
    const u = userRow.rows[0] as any;
    if (!u) { res.json({ valid: false }); return; }
    const userRoles: string[] = u.roles?.length ? u.roles : [u.primary_role];

    // 1단계: DB roles에 해당 role 존재 여부 검증 (클라이언트 조작 방지)
    if (!userRoles.includes(role)) {
      return res.status(403).json({ valid: false, error: "invalid_role" });
    }

    // 2단계: teacher 역할은 활성화 상태 추가 검증
    if (role === "teacher") {
      // pool_admin 연결 계정은 항상 유효
      if (userRoles.includes("pool_admin") || u.primary_role === "pool_admin") {
        res.json({ valid: true }); return;
      }
      // 일반 teacher: teacher_invites 승인 상태 확인
      const rows = await superAdminDb.execute(sql`
        SELECT invite_status FROM teacher_invites WHERE user_id = ${userId} LIMIT 1
      `);
      const row = rows.rows[0] as any;
      if (!row) {
        res.json({ valid: u.is_activated === true }); return;
      }
      res.json({ valid: row.invite_status === "approved" }); return;
    }

    // pool_admin 등 기타 역할: DB roles 포함 = 유효
    res.json({ valid: true });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── JWT 역할 DB 검증 ─────────────────────────────────────────────────
// 클라이언트가 현재 JWT 역할이 DB에서 여전히 유효한지 확인 (조작 방지)
router.get("/verify-role", requireAuth, async (req: AuthRequest, res) => {
  const { userId, role } = req.user!;
  // super 계열은 DB 검증 없이 항상 유효
  if (["super_admin", "platform_admin", "super_manager"].includes(role)) {
    return res.json({ valid: true, role });
  }
  try {
    const rolesRow = await superAdminDb.execute(sql`
      SELECT roles, role AS primary_role, swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
    `);
    const row = rolesRow.rows[0] as any;
    if (!row) return res.status(403).json({ valid: false, error: "계정 없음" });
    const dbRoles: string[] = row.roles?.length ? row.roles : [row.primary_role];
    if (!dbRoles.includes(role)) {
      return res.status(403).json({ valid: false, error: "invalid_role", db_roles: dbRoles });
    }
    return res.json({ valid: true, role, db_roles: dbRoles, pool_id: row.swimming_pool_id });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 역할 전환 ─────────────────────────────────────────────────────────
// requireDbRoleCheck: 현재 JWT 역할이 DB에 유효한지 먼저 검증
router.post("/switch-role", requireAuth, requireDbRoleCheck, async (req: AuthRequest, res) => {
  const { role } = req.body;
  if (!role) return err(res, 400, "전환할 역할을 지정해주세요.");
  try {
    const rolesRow = await superAdminDb.execute(sql`SELECT roles, swimming_pool_id, role AS primary_role FROM users WHERE id = ${req.user!.userId} LIMIT 1`);
    const row = rolesRow.rows[0] as any;
    if (!row) return err(res, 404, "계정을 찾을 수 없습니다.");
    let userRoles: string[] = row.roles ?? [];

    // pool_admin 계정이 "teacher"로 전환 요청 시 자동으로 teacher 역할 추가 (최초 1회)
    const isPoolAdmin = userRoles.includes("pool_admin") || row.primary_role === "pool_admin";
    if (!userRoles.includes(role) && role === "teacher" && isPoolAdmin) {
      userRoles = [...userRoles, "teacher"];
      const rolesLiteral = `{${userRoles.map((r: string) => `"${r}"`).join(",")}}`;
      await superAdminDb.execute(sql.raw(`UPDATE users SET roles = '${rolesLiteral}'::TEXT[] WHERE id = '${req.user!.userId}'`));
    }

    // pool_admin이 teacher로 전환 시 teacher_invites 승인 레코드 자동 생성 (없는 경우)
    if (role === "teacher" && isPoolAdmin) {
      try {
        const userId = req.user!.userId;
        const existingInvite = await superAdminDb.execute(sql`
          SELECT id FROM teacher_invites WHERE user_id = ${userId} LIMIT 1
        `);
        if (!existingInvite.rows.length) {
          const userInfo = await superAdminDb.execute(sql`
            SELECT name, phone FROM users WHERE id = ${userId} LIMIT 1
          `);
          const info = userInfo.rows[0] as any;
          const inviteId = `ti_admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await superAdminDb.execute(sql`
            INSERT INTO teacher_invites
              (id, swimming_pool_id, name, phone, invite_status, invited_by, user_id, requested_at, approved_at, created_at)
            VALUES
              (${inviteId}, ${row.swimming_pool_id}, ${info?.name ?? ""}, ${info?.phone ?? ""},
               'approved', ${userId}, ${userId}, now(), now(), now())
          `).catch(() => {});
        }
      } catch { /* teacher_invites 미존재 시 무시 */ }
    }

    if (!userRoles.includes(role)) return err(res, 403, "해당 역할에 대한 권한이 없습니다.");
    const newToken = signToken({ userId: req.user!.userId, role, poolId: row.swimming_pool_id });
    res.json({ success: true, token: newToken, role, roles: userRoles });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 비밀번호 재설정 (MVP: 이메일 확인 → 바로 변경) ────────────────────
router.post("/reset-password", async (req, res) => {
  const { identifier, new_password } = req.body;
  if (!identifier || !new_password) return err(res, 400, "아이디와 새 비밀번호를 입력해주세요.");
  if (new_password.length < 4) return err(res, 400, "비밀번호는 4자 이상이어야 합니다.");
  try {
    const [user] = await superAdminDb.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, identifier.trim().toLowerCase())).limit(1);
    if (user) {
      const hash = await hashPassword(new_password);
      await superAdminDb.execute(sql`UPDATE users SET password_hash = ${hash}, updated_at = now() WHERE id = ${user.id}`);
      res.json({ success: true, message: "비밀번호가 변경되었습니다." }); return;
    }
    const [parent] = await db.select({ id: parentAccountsTable.id }).from(parentAccountsTable)
      .where(eq(parentAccountsTable.phone, identifier.trim())).limit(1);
    if (parent) {
      const hash = await hashPassword(new_password);
      await db.execute(sql`UPDATE parent_accounts SET pin_hash = ${hash}, updated_at = now() WHERE id = ${parent.id}`);
      res.json({ success: true, message: "비밀번호가 변경되었습니다." }); return;
    }
    return err(res, 404, "해당 아이디로 등록된 계정이 없습니다.");
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 비밀번호 변경 (인증된 사용자 — 현재 비밀번호 확인 후 변경) ──────────
router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return err(res, 400, "현재 비밀번호와 새 비밀번호를 입력해주세요.");
  if (new_password.length < 4) return err(res, 400, "새 비밀번호는 4자 이상이어야 합니다.");
  try {
    const [user] = await superAdminDb.select({ id: usersTable.id, password_hash: usersTable.password_hash })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user) return err(res, 404, "사용자를 찾을 수 없습니다.");
    const valid = await comparePassword(current_password, user.password_hash);
    if (!valid) return err(res, 400, "현재 비밀번호가 올바르지 않습니다.");
    const hash = await hashPassword(new_password);
    await superAdminDb.execute(sql`UPDATE users SET password_hash = ${hash}, updated_at = now() WHERE id = ${user.id}`);
    res.json({ success: true, message: "비밀번호가 변경되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 선생님 자체 회원가입 (풀 검색 후 등록, PENDING 상태) ───────────────
router.post("/teacher-self-signup", async (req, res) => {
  const { name, email, loginId, password, phone, pool_id } = req.body;
  // loginId = 실제 로그인 식별자 (email 컬럼에 저장), email = 연락용 (현재 저장 안 함)
  const identifier = (loginId?.trim() || email?.trim() || "").toLowerCase();
  if (!name?.trim() || !identifier || !password || !pool_id) {
    return err(res, 400, "이름, 아이디, 비밀번호, 수영장은 필수입니다.");
  }
  if (password.length < 4) return err(res, 400, "비밀번호는 4자 이상이어야 합니다.");
  if (identifier.length < 4) return err(res, 400, "아이디는 4자 이상이어야 합니다.");
  try {
    // 아이디 중복 확인
    const [exist] = await superAdminDb.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, identifier)).limit(1);
    if (exist) return err(res, 409, "이미 사용 중인 아이디입니다.");

    // 수영장 확인
    const [pool] = await superAdminDb.select({ id: swimmingPoolsTable.id, name: swimmingPoolsTable.name })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, pool_id)).limit(1);
    if (!pool) return err(res, 404, "수영장을 찾을 수 없습니다.");

    const hash = await hashPassword(password);
    const userId = `u_teacher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 관리자가 사전에 등록한 teacher_invite 레코드에서 전화번호 일치 여부 확인
    const cleanedPhone = phone?.trim() || "";
    let autoApproved = false;
    let matchedInviteId: string | null = null;

    if (cleanedPhone) {
      const inviteMatch = await superAdminDb.execute(sql`
        SELECT id FROM teacher_invites
        WHERE swimming_pool_id = ${pool_id}
          AND phone = ${cleanedPhone}
          AND invite_status IN ('invited', 'active', 'pending')
        LIMIT 1
      `);
      if ((inviteMatch.rows as any[]).length > 0) {
        autoApproved = true;
        matchedInviteId = (inviteMatch.rows[0] as any).id;
      }
    }

    // 유저 생성 (자동승인이면 is_activated=true)
    await superAdminDb.execute(sql`
      INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated, created_at, updated_at)
      VALUES (${userId}, ${identifier}, ${hash}, ${name.trim()}, ${cleanedPhone || null},
              'teacher', ${pool_id}, ${autoApproved}, now(), now())
    `);

    if (autoApproved && matchedInviteId) {
      // 기존 invite 레코드 → 승인 완료 처리
      await superAdminDb.execute(sql`
        UPDATE teacher_invites
        SET invite_status = 'approved', user_id = ${userId}, approved_at = now(), approved_by = ${userId}
        WHERE id = ${matchedInviteId}
      `);
    } else {
      // 새 승인 대기 레코드 생성
      const inviteId = `ti_self_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await superAdminDb.execute(sql`
        INSERT INTO teacher_invites (id, swimming_pool_id, name, phone, invite_status, invited_by, user_id, requested_at, created_at)
        VALUES (${inviteId}, ${pool_id}, ${name.trim()}, ${cleanedPhone},
                'joinedPendingApproval', ${userId}, ${userId}, now(), now())
      `);
    }

    // 승인 여부에 관계없이 토큰 발급 (미승인 선생님도 제한 모드로 앱 진입 허용)
    const token = signToken({ userId, role: "teacher", poolId: pool_id });
    if (autoApproved) {
      res.status(201).json({
        success: true,
        message: "가입이 완료되었습니다.",
        pool_name: pool.name,
        status: "approved",
        auto_approved: true,
        token,
        user: { id: userId, email: identifier, name: name.trim(), phone: cleanedPhone, role: "teacher", swimming_pool_id: pool_id, is_activated: true },
      });
    } else {
      res.status(201).json({
        success: true,
        message: "가입 신청이 완료되었습니다. 관리자 승인 후 수영장 정보가 연결됩니다.",
        pool_name: pool.name,
        status: "pending_approval",
        auto_approved: false,
        token,
        user: { id: userId, email: identifier, name: name.trim(), phone: cleanedPhone, role: "teacher", swimming_pool_id: pool_id, is_activated: false },
      });
    }
  } catch (e: any) {
    console.error("[teacher-self-signup]", e);
    return err(res, 500, e.message || "서버 오류가 발생했습니다.");
  }
});

// ── 선생님 단독 대표 가입 (개인 워크스페이스 생성) ───────────────────────
router.post("/solo-teacher-signup", async (req, res) => {
  const { name, loginId, password, phone, workspace_name } = req.body;
  const identifier = (loginId?.trim() || "").toLowerCase();
  if (!name?.trim() || !identifier || !password || !workspace_name?.trim()) {
    return err(res, 400, "이름, 아이디, 비밀번호, 워크스페이스 이름은 필수입니다.");
  }
  if (password.length < 4) return err(res, 400, "비밀번호는 4자 이상이어야 합니다.");
  if (identifier.length < 4) return err(res, 400, "아이디는 4자 이상이어야 합니다.");
  try {
    const [exist] = await superAdminDb.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, identifier)).limit(1);
    if (exist) return err(res, 409, "이미 사용 중인 아이디입니다.");

    const cleanPhone = phone?.replace(/[-\s]/g, "") || null;
    const poolId = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const userId = `u_solo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const wsName = workspace_name.trim();
    const nameEn = wsName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").substring(0, 30) || `pool_${Date.now()}`;

    await superAdminDb.execute(sql`
      INSERT INTO swimming_pools
        (id, name, name_en, address, phone, owner_name, owner_email,
         admin_name, admin_email, admin_phone, approval_status, subscription_status, trial_end_at)
      VALUES
        (${poolId}, ${wsName}, ${nameEn}, ${"개인 워크스페이스"}, ${cleanPhone || ""},
         ${name.trim()}, ${identifier},
         ${name.trim()}, ${identifier}, ${cleanPhone},
         ${"approved"}, ${"trial"}, NOW() + INTERVAL '30 days')
    `);

    const hash = await hashPassword(password);
    await superAdminDb.execute(sql`
      INSERT INTO users
        (id, email, password_hash, name, phone, role,
         swimming_pool_id, is_activated, is_admin_self_teacher,
         phone_verified, roles, created_at, updated_at)
      VALUES
        (${userId}, ${identifier}, ${hash}, ${name.trim()},
         ${cleanPhone}, ${"pool_admin"}::user_role,
         ${poolId}, ${true}, ${true},
         ${true}, ${"{\"pool_admin\",\"teacher\"}"}::TEXT[], now(), now())
    `);

    const inviteId = `tinv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO teacher_invites
        (id, swimming_pool_id, name, phone, position,
         invite_token, invite_status, invited_by, user_id,
         approved_at, approved_by, approved_role, created_at, requested_at)
      VALUES
        (${inviteId}, ${poolId}, ${"대표선생님"}, ${cleanPhone}, ${"대표"},
         ${inviteId}, ${"approved"}, ${userId}, ${userId},
         now(), ${userId}, ${"teacher"}, now(), now())
    `);

    const token = signToken({ userId, role: "pool_admin", poolId });
    res.status(201).json({
      success: true,
      token,
      roles: ["pool_admin", "teacher"],
      user: {
        id: userId, email: identifier, name: name.trim(),
        phone: cleanPhone, role: "pool_admin", swimming_pool_id: poolId,
        is_activated: true, is_admin_self_teacher: true,
        roles: ["pool_admin", "teacher"],
      },
    });
  } catch (e: any) {
    console.error("[solo-teacher-signup]", e);
    return err(res, 500, e.message || "서버 오류가 발생했습니다.");
  }
});

// ══════════════════════════════════════════════════════
// ── TOTP (Google Authenticator) 라우트 ───────────────
// ══════════════════════════════════════════════════════

// TOTP 로그인 2단계 검증 (비밀번호 인증 후 OTP 코드 확인)
router.post("/totp/verify-login", async (req, res) => {
  const { totp_session, otp_code } = req.body;
  if (!totp_session || !otp_code) return err(res, 400, "totp_session과 otp_code를 입력해주세요.");
  try {
    let payload: { userId: string };
    try {
      payload = verifyTotpSession(totp_session);
    } catch {
      return err(res, 401, "OTP 세션이 만료되었습니다. 다시 로그인해주세요.");
    }

    const userRow = await superAdminDb.execute(sql`
      SELECT * FROM users WHERE id = ${payload.userId} LIMIT 1
    `);
    const user = userRow.rows[0] as any;
    if (!user) return err(res, 404, "사용자를 찾을 수 없습니다.");
    if (!user.totp_enabled || !user.totp_secret) return err(res, 400, "TOTP가 설정되지 않은 계정입니다.");

    const cleanCode = otp_code.replace(/\D/g, "").trim();
    console.log(`[totp/verify-login] userId=***${payload.userId.slice(-4)} code_len=${cleanCode.length} totp_enabled=${user.totp_enabled} secret_len=${user.totp_secret?.length ?? 0}`);
    const isValid = totpVerifySync({ token: cleanCode, secret: user.totp_secret, strategy: "totp" } as any);
    console.log(`[totp/verify-login] code_match=${isValid?.valid}`);
    if (!isValid?.valid) return err(res, 401, "OTP 코드가 올바르지 않거나 만료되었습니다.");

    const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
    const { password_hash: _pw, totp_secret: _secret, ...safeUser } = user;
    const roles: string[] = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role];
    const account = { kind: "admin", token, user: { ...safeUser, roles } };

    res.json({
      success: true,
      available_accounts: [account],
      token,
      kind: "admin",
      user: account.user,
    });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// TOTP 민감 작업 인증 — OTP 게이트용 (로그인과 별개, 일반 JWT 토큰 사용)
router.post("/totp/verify-action", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { otp_code } = req.body;
    if (!otp_code || String(otp_code).trim().length !== 6) {
      return err(res, 400, "6자리 OTP 코드를 입력해주세요.");
    }
    const row = await superAdminDb.execute(sql`
      SELECT totp_secret, totp_enabled FROM users WHERE id = ${req.user!.userId} LIMIT 1
    `);
    const user = row.rows[0] as any;
    if (!user?.totp_enabled || !user?.totp_secret) {
      return err(res, 403, "OTP가 등록되지 않았습니다. 보안 설정에서 먼저 OTP를 등록해주세요.");
    }
    const valid = totpVerifySync({ secret: user.totp_secret, token: String(otp_code), strategy: "totp" } as any);
    if (!valid?.valid) return err(res, 401, "OTP 코드가 올바르지 않습니다. 앱의 코드를 다시 확인해주세요.");
    res.json({ success: true });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// TOTP 상태 조회
router.get("/totp/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const row = await superAdminDb.execute(sql`SELECT totp_enabled FROM users WHERE id = ${req.user!.userId} LIMIT 1`);
    const totpEnabled = (row.rows[0] as any)?.totp_enabled ?? false;
    res.json({ success: true, totp_enabled: totpEnabled });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// TOTP 설정 시작 — 시크릿 + QR 코드 생성 (아직 활성화 안함)
router.post("/totp/setup", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userRow = await superAdminDb.execute(sql`SELECT email, name, totp_enabled FROM users WHERE id = ${req.user!.userId} LIMIT 1`);
    const user = userRow.rows[0] as any;
    if (!user) return err(res, 404, "사용자를 찾을 수 없습니다.");

    const secret = totpGenerateSecret();
    const otpauth = totpGenerateURI({ issuer: "Swim Platform", label: user.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 240, margin: 2 });

    await superAdminDb.execute(sql`UPDATE users SET totp_secret = ${secret}, updated_at = NOW() WHERE id = ${req.user!.userId}`);

    res.json({ success: true, secret, qr_code: qrDataUrl, otpauth_url: otpauth });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// TOTP 활성화 — 첫 OTP 코드 검증 후 활성화
router.post("/totp/enable", requireAuth, async (req: AuthRequest, res) => {
  const { otp_code } = req.body;
  if (!otp_code) return err(res, 400, "OTP 코드를 입력해주세요.");
  try {
    const userRow = await superAdminDb.execute(sql`SELECT totp_secret FROM users WHERE id = ${req.user!.userId} LIMIT 1`);
    const user = userRow.rows[0] as any;
    if (!user?.totp_secret) return err(res, 400, "먼저 TOTP 설정을 시작해주세요.");

    const isValid = totpVerifySync({ token: otp_code.replace(/\s/g, ""), secret: user.totp_secret, strategy: "totp" });
    if (!isValid?.valid) return err(res, 401, "OTP 코드가 올바르지 않습니다. Google Authenticator 앱의 코드를 확인해주세요.");

    await superAdminDb.execute(sql`UPDATE users SET totp_enabled = TRUE, updated_at = NOW() WHERE id = ${req.user!.userId}`);
    res.json({ success: true, message: "Google OTP가 활성화되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// TOTP 비활성화 — OTP 코드 검증 후 비활성화
router.post("/totp/disable", requireAuth, async (req: AuthRequest, res) => {
  const { otp_code } = req.body;
  if (!otp_code) return err(res, 400, "OTP 코드를 입력해주세요.");
  try {
    const userRow = await superAdminDb.execute(sql`SELECT totp_secret, totp_enabled FROM users WHERE id = ${req.user!.userId} LIMIT 1`);
    const user = userRow.rows[0] as any;
    if (!user?.totp_enabled) return err(res, 400, "TOTP가 활성화되어 있지 않습니다.");
    if (!user?.totp_secret) return err(res, 400, "TOTP 설정 정보를 찾을 수 없습니다.");

    const isValid = totpVerifySync({ token: otp_code.replace(/\s/g, ""), secret: user.totp_secret, strategy: "totp" });
    if (!isValid?.valid) return err(res, 401, "OTP 코드가 올바르지 않습니다.");

    await superAdminDb.execute(sql`UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, updated_at = NOW() WHERE id = ${req.user!.userId}`);
    res.json({ success: true, message: "Google OTP가 비활성화되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ════════════════════════════════════════════════════════════════
// SMS 인증 — 발송
// POST /auth/send-sms-code
// body: { phone, purpose }
// purpose: pool_admin_signup | parent_signup | password_reset
//
// provider 분기:
//   SMS_PROVIDER=dev  → 개발용 우회 (로그 출력, dev_code 응답 포함)
//   NAVER_SENS_* 설정  → 실제 SENS SMS 발송
//   기타               → coolsms / aligo
//
// 보안:
//   - dev provider는 NODE_ENV=production 에서 절대 차단
//   - 고정 코드 금지 — 매번 랜덤 6자리 생성
//   - phone_verifications 저장/검증 구조는 provider 무관 동일
// ════════════════════════════════════════════════════════════════
router.post("/send-sms-code", async (req, res) => {
  const { phone, purpose } = req.body;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";

  const validPurposes = ["pool_admin_signup", "parent_signup", "password_reset", "reset_password", "signup"];
  if (!validPurposes.includes(purpose)) {
    return err(res, 400, "invalid_purpose");
  }

  const cleaned = (phone || "").replace(/[-\s]/g, "");
  if (!/^01[016789]\d{7,8}$/.test(cleaned)) {
    return res.status(400).json({ success: false, error: "invalid_phone", message: "올바른 휴대폰 번호를 입력해주세요. (010-0000-0000 형식)" });
  }

  // ── Apple 심사용 데모 번호 우회 (01000000000 → 고정 코드 000000) ──
  const DEMO_PHONE = "01000000000";
  if (cleaned === DEMO_PHONE) {
    try {
      const demoCode = "000000";
      const id = randomUUID();
      const hash = createHash("sha256").update(demoCode + id).digest("hex");
      const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3시간
      await superAdminDb.execute(sql`
        INSERT INTO phone_verifications (id, phone, code, code_hash, purpose, expires_at, attempt_count, request_ip)
        VALUES (${id}, ${cleaned}, '', ${hash}, ${purpose}, ${expiresAt.toISOString()}, 0, ${ip})
      `);
      return res.json({ success: true, message: "인증번호가 발송되었습니다." });
    } catch (e) {
      console.error("[send-sms-code demo]", e);
      return err(res, 500, "서버 오류가 발생했습니다.");
    }
  }

  // ── provider 확인 ─────────────────────────────────────────────
  const provider = getActiveProvider();

  // 운영 환경에서 dev provider 차단 (이중 안전장치)
  if (provider === null && (process.env.SMS_PROVIDER ?? "").toLowerCase() === "dev") {
    return res.status(503).json({
      success: false,
      error: "dev_provider_blocked",
      message: "운영 환경에서는 개발용 SMS provider를 사용할 수 없습니다.",
    });
  }

  if (!isSmsConfigured()) {
    const configErr = getSmsConfigError();
    return res.status(503).json({ success: false, error: "provider_not_configured", message: configErr || "SMS 서비스가 설정되지 않았습니다." });
  }

  try {
    // ── IP 기반 전역 요청 제한 (1분 5회) ─────────────────────
    const IP_WINDOW_MS  = 60_000;
    const IP_MAX_REQ    = 5;
    const windowStart   = new Date(Date.now() - IP_WINDOW_MS).toISOString();
    const ipCount = await superAdminDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM phone_verifications
      WHERE request_ip = ${ip} AND created_at > ${windowStart}
    `);
    if (Number((ipCount.rows[0] as any).cnt) >= IP_MAX_REQ) {
      console.warn(`[SMS] IP 제한 초과: ${ip} (1분 내 ${IP_MAX_REQ}회 이상)`);
      return res.status(429).json({
        success: false,
        error:   "too_many_requests",
        message: "잠시 후 다시 시도해주세요.",
      });
    }

    // ── 재발송 쿨다운 (60초) ──────────────────────────────────
    const recent = await superAdminDb.execute(sql`
      SELECT created_at FROM phone_verifications
      WHERE phone = ${cleaned} AND purpose = ${purpose}
      ORDER BY created_at DESC LIMIT 1
    `);
    if (recent.rows.length > 0) {
      const lastAt = new Date((recent.rows[0] as any).created_at).getTime();
      if (Date.now() - lastAt < 60_000) {
        return res.status(429).json({ success: false, error: "cooldown_active", message: "60초 후 다시 시도해주세요." });
      }
    }

    // ── 인증번호 생성 (랜덤 6자리, 고정 코드 금지) ──────────
    const digits    = String(Math.floor(100_000 + Math.random() * 900_000));
    const id        = randomUUID();
    const hash      = createHash("sha256").update(digits + id).digest("hex");
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    // ── phone_verifications 저장 (provider 무관 동일 구조) ───
    await superAdminDb.execute(sql`
      INSERT INTO phone_verifications (id, phone, code, code_hash, purpose, expires_at, attempt_count, request_ip)
      VALUES (${id}, ${cleaned}, '', ${hash}, ${purpose}, ${expiresAt.toISOString()}, 0, ${ip})
    `);

    // ── provider 분기 발송 ────────────────────────────────────
    if (provider === "dev") {
      // 개발용: 실제 발송 없이 로그 출력 + dev_code 반환
      const devCode = sendDevVerification({ phone: cleaned, code: digits, purpose });

      const isProduction = process.env.NODE_ENV === "production";
      const exposeCode   = !isProduction && process.env.SMS_DEV_EXPOSE_CODE !== "false";
      return res.json({
        success:    true,
        expires_in: 180,
        ...(exposeCode && { dev_code: devCode }),
      });
    }

    // 실제 SMS 발송 (sens / coolsms / aligo)
    try {
      await sendSms({
        phone:   cleaned,
        message: `[수영노트] 인증번호는 ${digits}입니다. 3분 내 입력해주세요.`,
      });
    } catch (smsErr: any) {
      await superAdminDb.execute(sql`DELETE FROM phone_verifications WHERE id = ${id}`);
      console.error("[SMS] 발송 실패:", smsErr.message);
      return res.status(500).json({ success: false, error: "sms_send_failed", message: "SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요." });
    }

    return res.json({ success: true, expires_in: 180 });
  } catch (e) {
    console.error("[send-sms-code]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ════════════════════════════════════════════════════════════════
// SMS 인증 — 검증
// POST /auth/verify-sms-code
// body: { phone, code, purpose }
// ════════════════════════════════════════════════════════════════
router.post("/verify-sms-code", async (req, res) => {
  const { phone, code, purpose } = req.body;
  if (!phone || !code || !purpose) {
    return res.status(400).json({ success: false, error: "missing_fields", message: "필수 항목이 누락되었습니다." });
  }

  const cleaned = (phone as string).replace(/[-\s]/g, "");
  const trimmed = (code as string).trim();

  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT id, code_hash, expires_at, is_used, attempt_count
      FROM phone_verifications
      WHERE phone = ${cleaned}
        AND purpose = ${purpose}
        AND code_hash IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `)).rows as any[];

    if (!rows.length) {
      return res.status(400).json({ success: false, error: "code_not_found", message: "인증번호를 먼저 요청해주세요." });
    }

    const rec = rows[0];

    if (rec.is_used) {
      return res.status(400).json({ success: false, error: "already_used", message: "이미 사용된 인증번호입니다." });
    }

    if (new Date(rec.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: "code_expired", message: "인증시간이 만료되었습니다. 다시 요청해주세요." });
    }

    if (rec.attempt_count >= 5) {
      await superAdminDb.execute(sql`
        UPDATE phone_verifications SET is_used = true WHERE id = ${rec.id}
      `);
      return res.status(400).json({ success: false, error: "too_many_attempts", message: "인증 시도 횟수를 초과했습니다. 다시 요청해주세요." });
    }

    const inputHash = createHash("sha256").update(trimmed + rec.id).digest("hex");
    if (inputHash !== rec.code_hash) {
      await superAdminDb.execute(sql`
        UPDATE phone_verifications SET attempt_count = attempt_count + 1 WHERE id = ${rec.id}
      `);
      const remaining = 4 - rec.attempt_count;
      return res.status(400).json({ success: false, error: "invalid_code", message: `인증번호가 올바르지 않습니다. (남은 시도: ${remaining}회)` });
    }

    await superAdminDb.execute(sql`
      UPDATE phone_verifications
      SET is_used = true, verified_at = now()
      WHERE id = ${rec.id}
    `);

    return res.json({ success: true, verified: true, message: "휴대폰 인증이 완료되었습니다." });
  } catch (e) {
    console.error("[verify-sms-code]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// POST /auth/find-identifier-by-phone — 전화번호로 등록된 모든 계정 조회 (비밀번호 찾기용)
router.post("/find-identifier-by-phone", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return err(res, 400, "전화번호를 입력해주세요.");
  const cleaned = (phone as string).replace(/[-\s]/g, "");
  try {
    // users 테이블 (superAdminDb) — 관리자·선생님 계정
    const userRows = (await superAdminDb.execute(sql`
      SELECT u.email AS identifier, u.name, u.role, u.is_activated,
             sp.name AS pool_name
      FROM users u
      LEFT JOIN swimming_pools sp ON sp.id = u.swimming_pool_id
      WHERE u.phone = ${cleaned}
        AND u.role != 'super_admin'
      ORDER BY u.created_at ASC
    `)).rows as any[];

    // parent_accounts 테이블 (db — pool별 DB)
    const parentRows = (await db.execute(sql`
      SELECT pa.phone AS identifier, pa.name, pa.swimming_pool_id
      FROM parent_accounts pa
      WHERE pa.phone = ${cleaned}
      ORDER BY pa.created_at ASC
    `)).rows as any[];

    // 학부모 계정 pool_name: pool_id 목록을 쉼표 구분 IN 절로 조회
    const poolMap: Record<string, string> = {};
    const parentPoolIds = [...new Set(parentRows.map((r: any) => r.swimming_pool_id).filter(Boolean))];
    for (const pid of parentPoolIds) {
      const poolRows = (await superAdminDb.execute(
        sql`SELECT id, name FROM swimming_pools WHERE id = ${pid} LIMIT 1`
      )).rows as any[];
      if (poolRows.length > 0) poolMap[pid] = poolRows[0].name;
    }

    const accounts = [
      ...userRows.map((r: any) => ({
        type: "admin",
        identifier: r.identifier,
        name: r.name,
        role: r.role,
        pool_name: r.pool_name || null,
        is_activated: r.is_activated,
      })),
      ...parentRows.map((r: any) => ({
        type: "parent",
        identifier: r.identifier,
        name: r.name,
        pool_name: poolMap[r.swimming_pool_id] || null,
      })),
    ];

    return res.json({ success: true, accounts });
  } catch (e) {
    console.error("[find-identifier-by-phone]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── 카카오 소셜 로그인 ────────────────────────────────────────────────
router.post("/kakao-social-login", async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) return err(res, 400, "카카오 액세스 토큰이 필요합니다.");

  try {
    // 카카오 사용자 정보 조회
    const kakaoRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
    });
    if (!kakaoRes.ok) {
      return err(res, 401, "카카오 토큰이 유효하지 않습니다.");
    }
    const kakaoUser: any = await kakaoRes.json();
    const kakaoId = String(kakaoUser.id);
    const kakaoNickname = kakaoUser.kakao_account?.profile?.nickname || null;
    const kakaoProfileImage = kakaoUser.kakao_account?.profile?.profile_image_url || null;
    const kakaoPhone = kakaoUser.kakao_account?.phone_number
      ? kakaoUser.kakao_account.phone_number.replace(/^\+82\s*/, "0").replace(/[^0-9]/g, "")
      : null;

    // 1) kakao_id로 기존 계정 조회
    const byKakaoId = await db.execute(sql`
      SELECT * FROM parent_accounts WHERE kakao_id = ${kakaoId} LIMIT 1
    `);

    if ((byKakaoId.rows as any[]).length > 0) {
      const account = byKakaoId.rows[0] as any;
      const token = signToken({ userId: account.id, role: "parent_account", poolId: account.swimming_pool_id });
      return res.json({
        success: true,
        token,
        parent: {
          id: account.id,
          name: account.name,
          nickname: account.nickname || null,
          phone: account.phone,
          login_id: account.login_id || null,
          swimming_pool_id: account.swimming_pool_id,
          kakao_profile_image: account.kakao_profile_image || null,
        },
      });
    }

    // 2) 전화번호로 기존 계정 매칭 후 kakao_id 연결
    if (kakaoPhone) {
      const byPhone = await db.execute(sql`
        SELECT * FROM parent_accounts WHERE phone = ${kakaoPhone} LIMIT 1
      `);
      if ((byPhone.rows as any[]).length > 0) {
        const account = byPhone.rows[0] as any;
        await db.execute(sql`
          UPDATE parent_accounts 
          SET kakao_id = ${kakaoId}, kakao_profile_image = ${kakaoProfileImage}, updated_at = NOW()
          WHERE id = ${account.id}
        `);
        const token = signToken({ userId: account.id, role: "parent_account", poolId: account.swimming_pool_id });
        return res.json({
          success: true,
          token,
          parent: {
            id: account.id,
            name: account.name,
            nickname: account.nickname || null,
            phone: account.phone,
            login_id: account.login_id || null,
            swimming_pool_id: account.swimming_pool_id,
            kakao_profile_image: kakaoProfileImage,
          },
        });
      }
    }

    // 3) 계정 없음 → 신규 가입 유도 (kakao_id + 정보 반환)
    return res.status(404).json({
      success: false,
      error_code: "kakao_no_account",
      message: "연결된 수영장 계정이 없습니다. 수영장에서 등록된 전화번호로 계정을 연결해주세요.",
      kakao_info: {
        kakao_id: kakaoId,
        name: kakaoNickname,
        phone: kakaoPhone,
        profile_image: kakaoProfileImage,
      },
    });
  } catch (e) {
    console.error("[kakao-social-login]", e);
    return err(res, 500, "카카오 로그인 처리 중 오류가 발생했습니다.");
  }
});

// ── Apple Sign In ──────────────────────────────────────────────────────
router.post("/apple-social-login", async (req, res) => {
  const { identityToken, fullName } = req.body;
  if (!identityToken) return err(res, 400, "Apple identity token이 필요합니다.");

  try {
    // Apple JWT 검증: apple-auth 라이브러리 없이 직접 페이로드 파싱 (신뢰된 환경)
    // identityToken은 Apple이 서명한 JWT. sub 클레임이 고유 사용자 ID(apple_id)
    const parts = identityToken.split(".");
    if (parts.length !== 3) return err(res, 400, "유효하지 않은 Apple identity token 형식입니다.");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const appleId = payload.sub as string;
    const appleEmail = payload.email as string | null;
    if (!appleId) return err(res, 400, "Apple 사용자 ID를 확인할 수 없습니다.");

    // 1) apple_id로 기존 계정 조회
    const byAppleId = await db.execute(sql`
      SELECT * FROM parent_accounts WHERE apple_id = ${appleId} LIMIT 1
    `);
    if ((byAppleId.rows as any[]).length > 0) {
      const account = byAppleId.rows[0] as any;
      const token = signToken({ userId: account.id, role: "parent_account", poolId: account.swimming_pool_id });
      return res.json({
        success: true,
        token,
        parent: {
          id: account.id,
          name: account.name,
          nickname: account.nickname || null,
          phone: account.phone,
          login_id: account.login_id || null,
          swimming_pool_id: account.swimming_pool_id,
          kakao_profile_image: null,
        },
      });
    }

    // 2) 이메일로 기존 계정 매칭 후 apple_id 연결
    if (appleEmail) {
      const byEmail = await db.execute(sql`
        SELECT * FROM parent_accounts WHERE login_id = ${appleEmail} LIMIT 1
      `);
      if ((byEmail.rows as any[]).length > 0) {
        const account = byEmail.rows[0] as any;
        await db.execute(sql`
          UPDATE parent_accounts SET apple_id = ${appleId}, updated_at = NOW()
          WHERE id = ${account.id}
        `);
        const token = signToken({ userId: account.id, role: "parent_account", poolId: account.swimming_pool_id });
        return res.json({
          success: true,
          token,
          parent: {
            id: account.id,
            name: account.name,
            nickname: account.nickname || null,
            phone: account.phone,
            login_id: account.login_id || null,
            swimming_pool_id: account.swimming_pool_id,
            kakao_profile_image: null,
          },
        });
      }
    }

    // 3) 계정 없음 → Apple ID로 신규 학부모 계정 자동 생성 (수영장 연결 대기)
    const newParentId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const displayName = fullName || (appleEmail ? appleEmail.split("@")[0] : "Apple 사용자");
    const randomPinHash = await hashPassword(randomUUID()); // Apple로만 로그인하므로 실제 사용 안 됨
    await db.execute(sql`
      INSERT INTO parent_accounts
        (id, swimming_pool_id, phone, pin_hash, name, login_id, apple_id, created_at, updated_at)
      VALUES
        (${newParentId}, NULL, NULL, ${randomPinHash}, ${displayName}, ${appleEmail || null}, ${appleId}, now(), now())
    `);
    const token = signToken({ userId: newParentId, role: "parent_account", poolId: null });
    return res.json({
      success: true,
      token,
      parent: {
        id: newParentId,
        name: displayName,
        nickname: null,
        phone: null,
        login_id: appleEmail || null,
        swimming_pool_id: null,
        kakao_profile_image: null,
      },
    });
  } catch (e) {
    console.error("[apple-social-login]", e);
    return err(res, 500, "Apple 로그인 처리 중 오류가 발생했습니다.");
  }
});

// ── 카카오 계정 연결 (전화번호로 본인 확인 후 kakao_id 연결) ─────────
router.post("/kakao-link-account", async (req, res) => {
  const { kakaoId, phone, kakaoProfileImage } = req.body;
  if (!kakaoId || !phone) return err(res, 400, "kakaoId와 전화번호가 필요합니다.");

  try {
    const byPhone = await db.execute(sql`
      SELECT * FROM parent_accounts WHERE phone = ${phone} LIMIT 1
    `);
    if ((byPhone.rows as any[]).length === 0) {
      return err(res, 404, "입력하신 전화번호로 등록된 계정이 없습니다. 수영장 관리자에게 문의하세요.");
    }
    const account = byPhone.rows[0] as any;

    // kakao_id가 이미 다른 계정에 연결되어 있는지 확인
    const existing = await db.execute(sql`
      SELECT id FROM parent_accounts WHERE kakao_id = ${kakaoId} AND id != ${account.id} LIMIT 1
    `);
    if ((existing.rows as any[]).length > 0) {
      return err(res, 409, "이미 다른 계정에 연결된 카카오 계정입니다.");
    }

    await db.execute(sql`
      UPDATE parent_accounts 
      SET kakao_id = ${kakaoId}, kakao_profile_image = ${kakaoProfileImage || null}, updated_at = NOW()
      WHERE id = ${account.id}
    `);

    const token = signToken({ userId: account.id, role: "parent_account", poolId: account.swimming_pool_id });
    return res.json({
      success: true,
      token,
      parent: {
        id: account.id,
        name: account.name,
        nickname: account.nickname || null,
        phone: account.phone,
        login_id: account.login_id || null,
        swimming_pool_id: account.swimming_pool_id,
        kakao_profile_image: kakaoProfileImage || null,
      },
    });
  } catch (e) {
    console.error("[kakao-link-account]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── Apple 계정 연결 (전화번호로 본인 확인 후 apple_id 연결) ───────────
router.post("/apple-link-account", async (req, res) => {
  const { appleId, phone } = req.body;
  if (!appleId || !phone) return err(res, 400, "appleId와 전화번호가 필요합니다.");

  const cleanPhone = String(phone).replace(/[^0-9]/g, "");
  try {
    const byPhone = await db.execute(sql`
      SELECT * FROM parent_accounts WHERE phone = ${cleanPhone} LIMIT 1
    `);
    if ((byPhone.rows as any[]).length === 0) {
      return err(res, 404, "입력하신 전화번호로 등록된 계정이 없습니다. 수영장 관리자에게 문의하세요.");
    }
    const account = byPhone.rows[0] as any;

    const existingApple = await db.execute(sql`
      SELECT id FROM parent_accounts WHERE apple_id = ${appleId} AND id != ${account.id} LIMIT 1
    `);
    if ((existingApple.rows as any[]).length > 0) {
      return err(res, 409, "이미 다른 계정에 연결된 Apple 계정입니다.");
    }

    await db.execute(sql`
      UPDATE parent_accounts SET apple_id = ${appleId}, updated_at = NOW()
      WHERE id = ${account.id}
    `);

    const token = signToken({ userId: account.id, role: "parent_account", poolId: account.swimming_pool_id });
    return res.json({
      success: true,
      token,
      parent: {
        id: account.id,
        name: account.name,
        nickname: account.nickname || null,
        phone: account.phone,
        login_id: account.login_id || null,
        swimming_pool_id: account.swimming_pool_id,
        kakao_profile_image: null,
      },
    });
  } catch (e) {
    console.error("[apple-link-account]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ════════════════════════════════════════════════════════════════
// DELETE /auth/account — 계정 영구 탈퇴 (Apple 5.1.1(v) 필수 요건)
// ════════════════════════════════════════════════════════════════
router.delete("/account", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const role   = req.user!.role;

  try {
    if (role === "parent_account" || role === "parent") {
      // 학부모 계정 영구 삭제
      const rows = (await db.execute(sql`
        SELECT id, login_id FROM parent_accounts WHERE id = ${userId} LIMIT 1
      `)).rows as any[];

      if (!rows.length) return err(res, 404, "계정을 찾을 수 없습니다.");

      // 데모 계정 보호 (로그인 ID: demo_parent)
      if (rows[0].login_id === "demo_parent") {
        return err(res, 403, "데모 계정은 삭제할 수 없습니다.");
      }

      await db.execute(sql`DELETE FROM parent_accounts WHERE id = ${userId}`);
      return res.json({ success: true, message: "계정이 삭제되었습니다." });

    } else {
      // 관리자/선생님 계정 익명화 처리 (데이터 영구 삭제)
      const rows = (await superAdminDb.execute(sql`
        SELECT id, email, role FROM users WHERE id = ${userId} LIMIT 1
      `)).rows as any[];

      if (!rows.length) return err(res, 404, "계정을 찾을 수 없습니다.");

      // 데모 계정 보호
      if (rows[0].email === "demo@swimnote.app") {
        return err(res, 403, "데모 계정은 삭제할 수 없습니다.");
      }

      // super_admin은 삭제 불가
      if (rows[0].role === "super_admin") {
        return err(res, 403, "슈퍼관리자 계정은 앱에서 삭제할 수 없습니다.");
      }

      const deletedId = randomUUID();
      await superAdminDb.execute(sql`
        UPDATE users SET
          email        = ${`deleted_${deletedId}@deleted.local`},
          name         = '탈퇴한 사용자',
          phone        = NULL,
          password_hash = '',
          is_activated = false,
          totp_secret  = NULL,
          totp_enabled = false,
          updated_at   = NOW()
        WHERE id = ${userId}
      `);

      return res.json({ success: true, message: "계정이 삭제되었습니다." });
    }
  } catch (e) {
    console.error("[DELETE /auth/account]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ══════════════════════════════════════════════════════════════════════
// V2 학부모 회원가입
// POST /auth/v2/parent-register
// ══════════════════════════════════════════════════════════════════════
router.post("/v2/parent-register", async (req, res) => {
  const { parent_name, phone, password, pool_id, child_name, loginId } = req.body;

  const name     = (parent_name || "").trim();
  const ph       = normPhoneV2(phone || "");
  const pw       = (password || "").trim();
  const poolId   = (pool_id || "").trim();
  const childRaw = (child_name || "").trim();
  const lid      = (loginId || "").trim() || null;

  const phoneMaskLog = ph.length > 6 ? ph.slice(0, 3) + "****" + ph.slice(-4) : "****";
  console.log(`[v2-register] 입력: name="${name}" phone=${phoneMaskLog} pool_id=${poolId} child_name="${childRaw}" loginId=${lid ?? "없음"}`);

  // 필수값 검증
  if (!name)    return err(res, 400, "학부모 이름을 입력해주세요.");
  if (!ph)      return err(res, 400, "전화번호를 입력해주세요.");
  if (!pw)      return err(res, 400, "비밀번호를 입력해주세요.");
  if (pw.length < 4) return err(res, 400, "비밀번호는 4자 이상이어야 합니다.");
  if (!poolId)  return err(res, 400, "수영장을 선택해주세요.");
  if (!childRaw) return err(res, 400, "우리 아이 이름을 입력해주세요.");

  const childNorm = normNameV2(childRaw);

  try {
    // 중복 전화번호 확인
    const [existingPhone] = (await db.execute(sql`
      SELECT id FROM parent_accounts
      WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = ${ph} LIMIT 1
    `)).rows as any[];
    if (existingPhone) return err(res, 409, "이미 가입된 전화번호입니다.");

    // 중복 아이디 확인
    if (lid) {
      const [existingLid] = (await db.execute(sql`
        SELECT id FROM parent_accounts WHERE login_id = ${lid} LIMIT 1
      `)).rows as any[];
      if (existingLid) return err(res, 409, "이미 사용 중인 아이디입니다.");
    }

    // 수영장 존재 확인
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id, name FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) return err(res, 404, "수영장을 찾을 수 없습니다.");

    // 계정 생성
    const parentId = `pa_v2_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const pin_hash = await hashPassword(pw);

    await db.execute(sql`
      INSERT INTO parent_accounts
        (id, swimming_pool_id, phone, pin_hash, name, login_id, is_active, created_at, updated_at)
      VALUES
        (${parentId}, ${poolId}, ${ph}, ${pin_hash}, ${name}, ${lid}, true, NOW(), NOW())
    `);
    console.log(`[v2-register] 계정 생성 완료: parentId=${parentId}`);

    // V2 매칭 시도 (3개 조건: pool_id + phone + child_name)
    const { matched, studentId, studentName } = await tryMatchStudentV2(parentId, poolId, ph, childNorm);

    let status: "linked" | "waiting" = "waiting";

    if (matched && studentId) {
      const { success } = await linkParentToStudentV2(parentId, studentId, poolId);
      if (success) {
        status = "linked";
        console.log(`[v2-register] ✓ 즉시 연결 성공: student="${studentName}"`);
      }
    }

    if (status === "waiting") {
      // 연결 실패 → pending 저장
      await upsertParentV2Pending(parentId, poolId, childRaw, childNorm, ph);
      console.log(`[v2-register] 대기 상태로 저장: child="${childRaw}" pool=${poolId}`);
    }

    const token = signToken({ userId: parentId, role: "parent_account", poolId });
    console.log(`[v2-register] 완료: status=${status} parentId=${parentId}`);

    return res.status(201).json({
      token,
      status,
      pool_name: pool.name,
      matched_student: matched ? { id: studentId, name: studentName } : null,
      parent: { id: parentId, name, phone: ph, swimming_pool_id: poolId },
    });
  } catch (e: any) {
    console.error("[v2-register] 오류:", e?.message, e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

export default router;
