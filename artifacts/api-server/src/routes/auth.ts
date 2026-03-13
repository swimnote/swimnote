import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, parentAccountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, comparePassword, signToken } from "../lib/auth.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요." });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
      return;
    }
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
      return;
    }
    const token = signToken({ userId: user.id, role: user.role, poolId: user.swimming_pool_id });
    const { password_hash: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/register", async (req, res) => {
  const { email, password, name, phone, role } = req.body;
  if (!email || !password || !name) {
    res.status(400).json({ error: "필수 정보를 입력해주세요." });
    return;
  }
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      res.status(400).json({ error: "이미 사용 중인 이메일입니다." });
      return;
    }
    const password_hash = await hashPassword(password);
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [user] = await db.insert(usersTable).values({
      id,
      email,
      password_hash,
      name,
      phone: phone || null,
      role: role === "pool_admin" ? "pool_admin" : "parent",
    }).returning();
    const token = signToken({ userId: user.id, role: user.role, poolId: null });
    const { password_hash: _, ...safeUser } = user;
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/parent-login", async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) {
    res.status(400).json({ error: "전화번호와 PIN을 입력해주세요." }); return;
  }
  try {
    const accounts = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.phone, phone));
    if (accounts.length === 0) {
      res.status(401).json({ error: "등록되지 않은 전화번호입니다." }); return;
    }
    let matched = null;
    for (const acc of accounts) {
      const valid = await comparePassword(pin, acc.pin_hash);
      if (valid) { matched = acc; break; }
    }
    if (!matched) {
      res.status(401).json({ error: "PIN이 올바르지 않습니다." }); return;
    }
    const token = signToken({ userId: matched.id, role: "parent_account", poolId: matched.swimming_pool_id });
    res.json({
      token,
      parent: { id: matched.id, name: matched.name, phone: matched.phone, swimming_pool_id: matched.swimming_pool_id },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
      return;
    }
    const { password_hash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
