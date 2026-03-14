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

    const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
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

// ── 통합 로그인 (MVP 테스트용) ─────────────────────────────────────────
router.post("/unified-login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return err(res, 400, "아이디와 비밀번호를 입력해주세요.");
  try {
    // 1) users 테이블 (super_admin / pool_admin / teacher) 먼저 조회
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.email, identifier.trim().toLowerCase())).limit(1);

    if (user) {
      const valid = await comparePassword(password, user.password_hash);
      if (!valid) return err(res, 401, "아이디 또는 비밀번호가 올바르지 않습니다.");

      if (user.role === "teacher") {
        const rawRows = await db.execute(sql`SELECT is_activated FROM users WHERE id = ${user.id} LIMIT 1`);
        const isActivated = (rawRows.rows[0] as any)?.is_activated ?? true;
        if (!isActivated) {
          res.status(403).json({
            success: false,
            message: "계정이 아직 활성화되지 않았습니다.",
            error: "계정이 아직 활성화되지 않았습니다.",
            needs_activation: true,
            teacher_id: user.id,
          });
          return;
        }
      }

      const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
      const { password_hash: _, ...safeUser } = user;
      res.json({ success: true, token, kind: "admin", user: safeUser });
      return;
    }

    // 2) parent_accounts 테이블
    const [parent] = await db.select().from(parentAccountsTable)
      .where(eq(parentAccountsTable.phone, identifier.trim())).limit(1);

    if (parent) {
      const valid = await comparePassword(password, parent.pin_hash);
      if (!valid) return err(res, 401, "아이디 또는 비밀번호가 올바르지 않습니다.");

      let poolName: string | null = null;
      try {
        const [pool] = await db.select({ name: swimmingPoolsTable.name })
          .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, parent.swimming_pool_id)).limit(1);
        poolName = pool?.name ?? null;
      } catch {}

      const token = signToken({ userId: parent.id, role: "parent_account", poolId: parent.swimming_pool_id });
      res.json({
        success: true,
        token,
        kind: "parent",
        parent: { id: parent.id, name: parent.name, phone: parent.phone, swimming_pool_id: parent.swimming_pool_id, pool_name: poolName },
      });
      return;
    }

    return err(res, 401, "아이디 또는 비밀번호가 올바르지 않습니다.");
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
