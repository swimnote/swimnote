import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, parentAccountsTable, swimmingPoolsTable, studentRegistrationRequestsTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, comparePassword, signToken } from "../lib/auth.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

// ── 관리자/선생님 로그인 ──────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return err(res, 400, "이메일과 비밀번호를 입력해주세요.");
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    if (!user) return err(res, 401, "이메일 또는 비밀번호가 올바르지 않습니다.");

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return err(res, 401, "이메일 또는 비밀번호가 올바르지 않습니다.");

    // pool_admin 역할은 수영장 승인 상태 확인
    if (user.role === "pool_admin" && user.swimming_pool_id) {
      const [pool] = await db.select({ approval_status: swimmingPoolsTable.approval_status })
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
      res.status(403).json({
        success: false,
        message: "계정이 아직 활성화되지 않았습니다.",
        error: "계정이 아직 활성화되지 않았습니다.",
        needs_activation: true,
        teacher_id: user.id,
        hint: "관리자로부터 받은 인증코드로 계정을 활성화해주세요.",
      });
      return;
    }

    // platform_admin: permissions를 JWT에 포함
    let permissions;
    if (user.role === "platform_admin") {
      permissions = (user as any).permissions || { canViewPools: true, canEditPools: false, canApprovePools: false, canManageSubscriptions: false, canManagePlatformAdmins: false };
    }

    const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id, permissions });
    const { password_hash: _, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 관리자 계정 가입 ──────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { email, password, name, phone, role } = req.body;
  if (!email || !password || !name) return err(res, 400, "필수 정보를 입력해주세요.");
  if (password.length < 6) return err(res, 400, "비밀번호는 6자 이상이어야 합니다.");
  try {
    const [existing] = await db.select().from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    if (existing) return err(res, 400, "이미 사용 중인 이메일입니다.");

    const password_hash = await hashPassword(password);
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [user] = await db.insert(usersTable).values({
      id, email: email.trim().toLowerCase(), password_hash, name,
      phone: phone || null, role: role === "pool_admin" ? "pool_admin" : "parent",
    }).returning();
    const token = signToken({ userId: user.id, role: user.role, poolId: null });
    const { password_hash: _, ...safeUser } = user;
    res.status(201).json({ success: true, token, user: safeUser });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 선생님 계정 OTP 활성화 ────────────────────────────────────────────
router.post("/activate-teacher", async (req, res) => {
  const { teacher_id, otp } = req.body;
  if (!teacher_id || !otp) return err(res, 400, "teacher_id와 인증코드를 입력해주세요.");
  try {
    const [teacher] = await db.select().from(usersTable)
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

    await db.execute(sql`UPDATE users SET is_activated = true, phone_verified = true, updated_at = now() WHERE id = ${teacher_id}`);
    await db.execute(sql`UPDATE phone_verifications SET is_used = true WHERE id = ${(verif.rows[0] as any).id}`);

    const token = signToken({ userId: teacher.id, role: teacher.role, poolId: teacher.swimming_pool_id });
    const { password_hash: _, ...safeUser } = teacher;
    res.json({ success: true, token, user: { ...safeUser, is_activated: true }, message: "계정이 활성화되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 학부모 로그인 ─────────────────────────────────────────────────────
router.post("/parent-login", async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return err(res, 400, "전화번호와 PIN을 입력해주세요.");
  try {
    const accounts = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.phone, phone));
    if (accounts.length === 0) return err(res, 401, "등록되지 않은 전화번호입니다.");
    let matched = null;
    for (const acc of accounts) {
      const valid = await comparePassword(pin, acc.pin_hash);
      if (valid) { matched = acc; break; }
    }
    if (!matched) return err(res, 401, "PIN이 올바르지 않습니다.");
    const token = signToken({ userId: matched.id, role: "parent_account", poolId: matched.swimming_pool_id });
    res.json({
      success: true,
      token,
      parent: { id: matched.id, name: matched.name, phone: matched.phone, swimming_pool_id: matched.swimming_pool_id },
    });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 내 정보 조회 ──────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user) return err(res, 404, "사용자를 찾을 수 없습니다.");
    const { password_hash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 승인된 수영장 목록 (학부모 가입용) ───────────────────────────────
router.get("/pools", async (req, res) => {
  try {
    const search = (req.query.search as string || "").trim();
    const pools = await db.select({
      id: swimmingPoolsTable.id, name: swimmingPoolsTable.name,
      address: swimmingPoolsTable.address, phone: swimmingPoolsTable.phone,
    }).from(swimmingPoolsTable).where(eq(swimmingPoolsTable.approval_status, "approved"));
    const filtered = search ? pools.filter(p => p.name.toLowerCase().includes(search.toLowerCase())) : pools;
    res.json(filtered);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 학부모 가입 ───────────────────────────────────────────────────────
router.post("/parent-register", async (req, res) => {
  const { name, phone, pin, swimming_pool_id, child_names, memo } = req.body;
  if (!name || !phone || !pin || !swimming_pool_id) return err(res, 400, "이름, 전화번호, PIN, 수영장은 필수입니다.");
  if (pin.length < 4) return err(res, 400, "PIN은 4자리 이상이어야 합니다.");
  const names: string[] = Array.isArray(child_names)
    ? child_names.map((n: string) => n.trim()).filter(Boolean) : [];
  if (names.length === 0) return err(res, 400, "자녀 이름을 1명 이상 입력해주세요.");
  try {
    const [pool] = await db.select().from(swimmingPoolsTable)
      .where(and(eq(swimmingPoolsTable.id, swimming_pool_id), eq(swimmingPoolsTable.approval_status, "approved"))).limit(1);
    if (!pool) return err(res, 400, "유효하지 않은 수영장입니다.");

    const existing = await db.select().from(parentAccountsTable)
      .where(and(eq(parentAccountsTable.phone, phone), eq(parentAccountsTable.swimming_pool_id, swimming_pool_id)));
    if (existing.length > 0) return err(res, 400, "이미 해당 수영장에 등록된 전화번호입니다.");

    const pin_hash = await hashPassword(pin);
    const parentId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [pa] = await db.insert(parentAccountsTable)
      .values({ id: parentId, swimming_pool_id, phone, pin_hash, name }).returning();

    const reqId = `srr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.insert(studentRegistrationRequestsTable).values({
      id: reqId, swimming_pool_id, parent_id: parentId,
      child_names: names, memo: memo || null, status: "pending",
    });

    const token = signToken({ userId: pa.id, role: "parent_account", poolId: pa.swimming_pool_id });
    res.status(201).json({
      success: true,
      token,
      parent: { id: pa.id, name: pa.name, phone: pa.phone, swimming_pool_id: pa.swimming_pool_id, pool_name: pool.name },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("unique")) return err(res, 400, "이미 등록된 전화번호입니다.");
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
    const [user] = await db.select({ id: usersTable.id })
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

// ── 통합 로그인 (error_code 포함) ──────────────────────────────────────
router.post("/unified-login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return err(res, 400, "아이디와 비밀번호를 입력해주세요.");
  try {
    // 1) users 테이블
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.email, identifier.trim().toLowerCase())).limit(1);

    if (user) {
      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ success: false, error: "비밀번호가 일치하지 않습니다.", error_code: "wrong_password" }); return;
      }
      if (user.role === "teacher") {
        const rawRows = await db.execute(sql`SELECT is_activated FROM users WHERE id = ${user.id} LIMIT 1`);
        const isActivated = (rawRows.rows[0] as any)?.is_activated ?? true;
        if (!isActivated) {
          res.status(403).json({ success: false, error: "계정이 아직 활성화되지 않았습니다.", error_code: "needs_activation", needs_activation: true, teacher_id: user.id }); return;
        }
      }
      const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
      const { password_hash: _, ...safeUser } = user;
      res.json({ success: true, token, kind: "admin", user: safeUser }); return;
    }

    // 2) parent_accounts 테이블
    const [parent] = await db.select().from(parentAccountsTable)
      .where(eq(parentAccountsTable.phone, identifier.trim())).limit(1);

    if (parent) {
      const valid = await comparePassword(password, parent.pin_hash);
      if (!valid) {
        res.status(401).json({ success: false, error: "비밀번호가 일치하지 않습니다.", error_code: "wrong_password" }); return;
      }
      let poolName: string | null = null;
      try {
        const [pool] = await db.select({ name: swimmingPoolsTable.name })
          .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, parent.swimming_pool_id)).limit(1);
        poolName = pool?.name ?? null;
      } catch {}
      const token = signToken({ userId: parent.id, role: "parent_account", poolId: parent.swimming_pool_id });
      res.json({ success: true, token, kind: "parent", parent: { id: parent.id, name: parent.name, phone: parent.phone, swimming_pool_id: parent.swimming_pool_id, pool_name: poolName } }); return;
    }

    // 계정 없음
    res.status(401).json({ success: false, error: "가입된 계정이 없습니다.", error_code: "user_not_found" });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 비밀번호 재설정 (MVP: 이메일 확인 → 바로 변경) ────────────────────
router.post("/reset-password", async (req, res) => {
  const { identifier, new_password } = req.body;
  if (!identifier || !new_password) return err(res, 400, "아이디와 새 비밀번호를 입력해주세요.");
  if (new_password.length < 6) return err(res, 400, "비밀번호는 6자 이상이어야 합니다.");
  try {
    const [user] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, identifier.trim().toLowerCase())).limit(1);
    if (user) {
      const hash = await hashPassword(new_password);
      await db.execute(sql`UPDATE users SET password_hash = ${hash}, updated_at = now() WHERE id = ${user.id}`);
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

// ── 선생님 자체 회원가입 (풀 검색 후 등록, PENDING 상태) ───────────────
router.post("/teacher-self-signup", async (req, res) => {
  const { name, email, password, phone, pool_id } = req.body;
  if (!name?.trim() || !email?.trim() || !password || !pool_id) {
    return err(res, 400, "이름, 이메일, 비밀번호, 수영장은 필수입니다.");
  }
  if (password.length < 6) return err(res, 400, "비밀번호는 6자 이상이어야 합니다.");
  try {
    // 이메일 중복 확인
    const [exist] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    if (exist) return err(res, 409, "이미 사용 중인 이메일입니다.");

    // 수영장 확인
    const [pool] = await db.select({ id: swimmingPoolsTable.id, name: swimmingPoolsTable.name })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, pool_id)).limit(1);
    if (!pool) return err(res, 404, "수영장을 찾을 수 없습니다.");

    const hash = await hashPassword(password);
    const id = `u_teacher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated, created_at, updated_at)
      VALUES (${id}, ${email.trim().toLowerCase()}, ${hash}, ${name.trim()}, ${phone?.trim() || null},
              'teacher', ${pool_id}, false, now(), now())
    `);

    res.status(201).json({
      success: true,
      message: "가입 승인 요청이 전송되었습니다. 수영장 관리자 승인 후 로그인 가능합니다.",
      pool_name: pool.name,
      status: "pending",
    });
  } catch (e: any) {
    console.error("[teacher-self-signup]", e);
    return err(res, 500, e.message || "서버 오류가 발생했습니다.");
  }
});

// ── 학부모 초대코드 검증 ───────────────────────────────────────────────
router.get("/parent-invite/verify", async (req, res) => {
  const { code } = req.query as { code: string };
  if (!code) return err(res, 400, "코드를 입력해주세요.");
  try {
    const rows = await db.execute(sql`
      SELECT pic.*, sp.name AS pool_name
      FROM parent_invite_codes pic
      LEFT JOIN swimming_pools sp ON sp.id = pic.swimming_pool_id
      WHERE pic.code = ${code.trim().toUpperCase()}
      LIMIT 1
    `);
    const invite = rows.rows[0] as any;
    if (!invite) return err(res, 404, "유효하지 않은 코드입니다.");
    if (invite.is_used) return res.status(410).json({ success: false, error: "이미 사용된 코드입니다.", error_code: "code_used" });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: "만료된 코드입니다. 새 코드를 요청해주세요.", error_code: "code_expired" });
    }
    res.json({ success: true, invite: {
      id: invite.id, code: invite.code, pool_name: invite.pool_name,
      parent_name: invite.parent_name, phone: invite.phone,
      child_name: invite.child_name, child_birth_year: invite.child_birth_year,
      swimming_pool_id: invite.swimming_pool_id,
    }});
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 학부모 초대코드로 가입 (즉시 ACTIVE) ────────────────────────────────
router.post("/parent-invite/join", async (req, res) => {
  const { code, pin } = req.body;
  if (!code || !pin) return err(res, 400, "코드와 PIN이 필요합니다.");
  if (pin.length < 4) return err(res, 400, "PIN은 4자리 이상이어야 합니다.");
  try {
    const rows = await db.execute(sql`SELECT * FROM parent_invite_codes WHERE code = ${code.trim().toUpperCase()} LIMIT 1`);
    const invite = rows.rows[0] as any;
    if (!invite) return err(res, 404, "유효하지 않은 코드입니다.");
    if (invite.is_used) return res.status(410).json({ success: false, error: "이미 사용된 코드입니다.", error_code: "code_used" });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: "만료된 코드입니다.", error_code: "code_expired" });
    }

    // parent_account 생성
    const existing = await db.execute(sql`SELECT id FROM parent_accounts WHERE phone = ${invite.phone} AND swimming_pool_id = ${invite.swimming_pool_id} LIMIT 1`);
    if ((existing.rows as any[]).length > 0) return err(res, 409, "이미 이 수영장에 가입된 계정이 있습니다.");

    const pinHash = await hashPassword(pin);
    const parentId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, created_at, updated_at)
      VALUES (${parentId}, ${invite.swimming_pool_id}, ${invite.phone}, ${pinHash}, ${invite.parent_name}, now(), now())
    `);

    // 코드 사용 처리
    await db.execute(sql`UPDATE parent_invite_codes SET is_used = true, used_at = now() WHERE id = ${invite.id}`);

    // 학생 연결 (child_name 있는 경우, 기존 학생 찾거나 요청 상태 저장)
    if (invite.child_name) {
      const studentRows = await db.execute(sql`
        SELECT id FROM students WHERE swimming_pool_id = ${invite.swimming_pool_id} AND name = ${invite.child_name} LIMIT 1
      `);
      if ((studentRows.rows as any[]).length > 0) {
        const studentId = (studentRows.rows[0] as any).id;
        await db.execute(sql`
          INSERT INTO parent_students (id, parent_id, student_id, created_at)
          VALUES (gen_random_uuid()::text, ${parentId}, ${studentId}, now())
          ON CONFLICT DO NOTHING
        `);
        await db.execute(sql`UPDATE students SET parent_user_id = ${parentId} WHERE id = ${studentId}`);
      }
    }

    // 로그인 토큰 발급
    const [poolRow] = await db.select({ name: swimmingPoolsTable.name }).from(swimmingPoolsTable)
      .where(eq(swimmingPoolsTable.id, invite.swimming_pool_id)).limit(1);
    const token = signToken({ userId: parentId, role: "parent_account", poolId: invite.swimming_pool_id });

    res.status(201).json({
      success: true,
      token,
      kind: "parent",
      parent: { id: parentId, name: invite.parent_name, phone: invite.phone, swimming_pool_id: invite.swimming_pool_id, pool_name: poolRow?.name || null },
    });
  } catch (e: any) { console.error(e); return err(res, 500, e.message || "서버 오류가 발생했습니다."); }
});

export default router;
