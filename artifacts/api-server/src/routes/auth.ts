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
      // 자체 가입 신청(대기중)인지 확인
      const pendingInvite = await db.execute(sql`
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
      const pending = await db.execute(sql`
        SELECT id, parent_name FROM parent_pool_requests
        WHERE (login_id = ${id} OR phone = ${id})
          AND request_status = 'pending'
        LIMIT 1
      `);
      if ((pending.rows as any[]).length > 0) {
        return res.status(403).json({
          success: false,
          error: "가입 요청이 승인 대기 중입니다. 수영장 관리자 승인 후 로그인 가능합니다.",
          error_code: "pending_pool_request",
        });
      }
      return err(res, 401, "등록되지 않은 아이디 또는 전화번호입니다.");
    }
    let matched: any = null;
    for (const acc of accounts) {
      const valid = await comparePassword(pw, acc.pin_hash);
      if (valid) { matched = acc; break; }
    }
    if (!matched) return err(res, 401, "비밀번호가 올바르지 않습니다.");
    if (matched.is_active === false) {
      return err(res, 403, "비활성화된 계정입니다. 수영장 관리자에게 문의하세요.");
    }
    const token = signToken({ userId: matched.id, role: "parent_account", poolId: matched.swimming_pool_id });
    res.json({
      success: true, token,
      parent: { id: matched.id, name: matched.name, phone: matched.phone, swimming_pool_id: matched.swimming_pool_id, login_id: matched.login_id },
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
    const [pool] = await db.select().from(swimmingPoolsTable)
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
    await db.insert(studentRegistrationRequestsTable).values({
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

// ── 통합 로그인 v2 — available_accounts 배열 반환 ──────────────────────
router.post("/unified-login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return err(res, 400, "아이디와 비밀번호를 입력해주세요.");
  const id = identifier.trim();
  try {
    const available_accounts: any[] = [];
    let wrongPwCount = 0;

    // ── 1) users 테이블 (이메일 매칭) ────────────────────────────────
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.email, id.toLowerCase())).limit(1);

    if (user) {
      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        wrongPwCount++;
      } else {
        // teacher 활성화 체크
        if (user.role === "teacher") {
          const rawRows = await db.execute(sql`SELECT is_activated FROM users WHERE id = ${user.id} LIMIT 1`);
          const isActivated = (rawRows.rows[0] as any)?.is_activated ?? true;
          if (!isActivated) {
            const pendingInvite = await db.execute(sql`
              SELECT id FROM teacher_invites
              WHERE user_id = ${user.id} AND invite_status = 'joinedPendingApproval' LIMIT 1
            `);
            if (pendingInvite.rows.length > 0) {
              res.status(403).json({ success: false, error: "관리자 승인 대기 중입니다.", error_code: "pending_teacher_approval" }); return;
            }
            res.status(403).json({ success: false, error: "계정이 아직 활성화되지 않았습니다.", error_code: "needs_activation", needs_activation: true, teacher_id: user.id }); return;
          }
        }
        const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
        const { password_hash: _, ...safeUser } = user;
        const rolesRow = await db.execute(sql`SELECT roles FROM users WHERE id = ${user.id} LIMIT 1`);
        const roles: string[] = (rolesRow.rows[0] as any)?.roles ?? [user.role];
        available_accounts.push({ kind: "admin", token, user: { ...safeUser, roles } });
      }
    }

    // ── 2) parent_accounts 테이블 (login_id → phone) ──────────────
    const parentByLoginId = await db.execute(sql`SELECT * FROM parent_accounts WHERE login_id = ${id} LIMIT 1`);
    let parentRow: any = parentByLoginId.rows[0] ?? null;
    if (!parentRow) {
      const [byPhone] = await db.select().from(parentAccountsTable)
        .where(eq(parentAccountsTable.phone, id)).limit(1);
      parentRow = byPhone ?? null;
    }

    if (parentRow) {
      const valid = await comparePassword(password, parentRow.pin_hash);
      if (!valid) {
        wrongPwCount++;
      } else {
        let poolName: string | null = null;
        try {
          const [pool] = await db.select({ name: swimmingPoolsTable.name })
            .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, parentRow.swimming_pool_id)).limit(1);
          poolName = pool?.name ?? null;
        } catch {}
        const token = signToken({ userId: parentRow.id, role: "parent_account", poolId: parentRow.swimming_pool_id });
        available_accounts.push({
          kind: "parent",
          token,
          parent: { id: parentRow.id, name: parentRow.name, nickname: parentRow.nickname || null, phone: parentRow.phone, login_id: parentRow.login_id, swimming_pool_id: parentRow.swimming_pool_id, pool_name: poolName },
        });
      }
    }

    // ── 3) 결과 처리 ─────────────────────────────────────────────────
    if (available_accounts.length === 0) {
      if (wrongPwCount > 0) {
        res.status(401).json({ success: false, error: "비밀번호가 일치하지 않습니다.", error_code: "wrong_password" }); return;
      }
      // pending 요청 확인
      const pendingReq = await db.execute(sql`
        SELECT id FROM parent_pool_requests
        WHERE (login_id = ${id} OR phone = ${id}) AND request_status = 'pending' LIMIT 1
      `);
      if ((pendingReq.rows as any[]).length > 0) {
        res.status(403).json({ success: false, error: "가입 요청이 승인 대기 중입니다.", error_code: "pending_pool_request" }); return;
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
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 역할 권한 유효성 확인 ─────────────────────────────────────────────
router.post("/check-role-permission", requireAuth, async (req: AuthRequest, res) => {
  const { role } = req.body;
  if (!role) return err(res, 400, "role을 지정해주세요.");
  try {
    const userId = req.user!.userId;
    if (role === "teacher") {
      // teacher_invites에서 approved 상태 확인
      const rows = await db.execute(sql`
        SELECT invite_status FROM teacher_invites WHERE user_id = ${userId} LIMIT 1
      `);
      const row = rows.rows[0] as any;
      if (!row) {
        // teacher_invites에 없으면 users.is_activated 확인
        const userRow = await db.execute(sql`SELECT is_activated FROM users WHERE id = ${userId} LIMIT 1`);
        const activated = (userRow.rows[0] as any)?.is_activated ?? false;
        res.json({ valid: activated }); return;
      }
      res.json({ valid: row.invite_status === "approved" }); return;
    }
    // 기타 역할은 계정 존재 = 유효
    res.json({ valid: true });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── 역할 전환 ─────────────────────────────────────────────────────────
router.post("/switch-role", requireAuth, async (req: AuthRequest, res) => {
  const { role } = req.body;
  if (!role) return err(res, 400, "전환할 역할을 지정해주세요.");
  try {
    const rolesRow = await db.execute(sql`SELECT roles, swimming_pool_id, role AS primary_role FROM users WHERE id = ${req.user!.userId} LIMIT 1`);
    const row = rolesRow.rows[0] as any;
    if (!row) return err(res, 404, "계정을 찾을 수 없습니다.");
    let userRoles: string[] = row.roles ?? [];

    // pool_admin 계정이 "teacher"로 전환 요청 시 자동으로 teacher 역할 추가 (최초 1회)
    if (!userRoles.includes(role) && role === "teacher" &&
        (userRoles.includes("pool_admin") || row.primary_role === "pool_admin")) {
      userRoles = [...userRoles, "teacher"];
      const rolesLiteral = `{${userRoles.map((r: string) => `"${r}"`).join(",")}}`;
      await db.execute(sql.raw(`UPDATE users SET roles = '${rolesLiteral}'::TEXT[] WHERE id = '${req.user!.userId}'`));
    }

    if (!userRoles.includes(role)) return err(res, 403, "해당 역할에 대한 권한이 없습니다.");
    const newToken = signToken({ userId: req.user!.userId, role, poolId: row.swimming_pool_id });
    res.json({ success: true, token: newToken, role });
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
  const { name, email, loginId, password, phone, pool_id } = req.body;
  // loginId = 실제 로그인 식별자 (email 컬럼에 저장), email = 연락용 (현재 저장 안 함)
  const identifier = (loginId?.trim() || email?.trim() || "").toLowerCase();
  if (!name?.trim() || !identifier || !password || !pool_id) {
    return err(res, 400, "이름, 아이디, 비밀번호, 수영장은 필수입니다.");
  }
  if (password.length < 6) return err(res, 400, "비밀번호는 6자 이상이어야 합니다.");
  try {
    // 아이디 중복 확인
    const [exist] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, identifier)).limit(1);
    if (exist) return err(res, 409, "이미 사용 중인 아이디입니다.");

    // 수영장 확인
    const [pool] = await db.select({ id: swimmingPoolsTable.id, name: swimmingPoolsTable.name })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, pool_id)).limit(1);
    if (!pool) return err(res, 404, "수영장을 찾을 수 없습니다.");

    const hash = await hashPassword(password);
    const userId = `u_teacher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 유저 생성 (is_activated = false → 관리자 승인 전 로그인 불가)
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated, created_at, updated_at)
      VALUES (${userId}, ${identifier}, ${hash}, ${name.trim()}, ${phone?.trim() || null},
              'teacher', ${pool_id}, false, now(), now())
    `);

    // teacher_invites에 승인 대기 레코드 생성 (관리자 승인 화면에서 처리 가능하도록)
    const inviteId = `ti_self_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO teacher_invites (id, swimming_pool_id, name, phone, invite_status, invited_by, user_id, requested_at, created_at)
      VALUES (${inviteId}, ${pool_id}, ${name.trim()}, ${phone?.trim() || ''},
              'joinedPendingApproval', ${userId}, ${userId}, now(), now())
    `);

    res.status(201).json({
      success: true,
      message: "가입 신청이 완료되었습니다. 수영장 관리자 승인 후 로그인 가능합니다.",
      pool_name: pool.name,
      status: "pending_approval",
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
  const { code, pin, loginId, password } = req.body;
  const pw = (password || pin || "").trim();
  const lid = loginId?.trim() || null;
  if (!code || !pw) return err(res, 400, "코드와 비밀번호가 필요합니다.");
  if (pw.length < 4) return err(res, 400, "비밀번호는 4자리 이상이어야 합니다.");
  if (lid && lid.length < 3) return err(res, 400, "아이디는 3자 이상이어야 합니다.");
  try {
    const rows = await db.execute(sql`SELECT * FROM parent_invite_codes WHERE code = ${code.trim().toUpperCase()} LIMIT 1`);
    const invite = rows.rows[0] as any;
    if (!invite) return err(res, 404, "유효하지 않은 코드입니다.");
    if (invite.is_used) return res.status(410).json({ success: false, error: "이미 사용된 코드입니다.", error_code: "code_used" });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: "만료된 코드입니다.", error_code: "code_expired" });
    }

    if (lid) {
      const dupId = await db.execute(sql`SELECT id FROM parent_accounts WHERE login_id = ${lid} LIMIT 1`);
      if ((dupId.rows as any[]).length > 0) return err(res, 409, "이미 사용 중인 아이디입니다.");
    }

    // parent_account 생성
    const existing = await db.execute(sql`SELECT id FROM parent_accounts WHERE phone = ${invite.phone} AND swimming_pool_id = ${invite.swimming_pool_id} LIMIT 1`);
    if ((existing.rows as any[]).length > 0) return err(res, 409, "이미 이 수영장에 가입된 계정이 있습니다.");

    const pinHash = await hashPassword(pw);
    const parentId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, login_id, created_at, updated_at)
      VALUES (${parentId}, ${invite.swimming_pool_id}, ${invite.phone}, ${pinHash}, ${invite.parent_name}, ${lid}, now(), now())
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
