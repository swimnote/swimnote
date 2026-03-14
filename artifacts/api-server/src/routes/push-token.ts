/**
 * push-token.ts — Expo 푸시 토큰 등록/삭제 API
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// POST /push-token — 푸시 토큰 등록
router.post("/push-token", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { token, parent_account_id } = req.body;
    if (!token?.trim()) return res.status(400).json({ error: "토큰이 필요합니다." });

    const { userId } = req.user!;
    const id = `pt_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await db.execute(sql`
      INSERT INTO push_tokens (id, user_id, parent_account_id, token, updated_at)
      VALUES (${id}, ${userId || null}, ${parent_account_id || null}, ${token.trim()}, now())
      ON CONFLICT (token)
        DO UPDATE SET updated_at = now(), user_id = EXCLUDED.user_id, parent_account_id = EXCLUDED.parent_account_id
    `);

    return res.json({ success: true });
  } catch (e) {
    console.error("push-token 등록 오류:", e);
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// DELETE /push-token — 로그아웃 시 토큰 삭제
router.delete("/push-token", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "토큰이 필요합니다." });
    const { userId } = req.user!;
    await db.execute(sql`DELETE FROM push_tokens WHERE user_id = ${userId} AND token = ${token}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
