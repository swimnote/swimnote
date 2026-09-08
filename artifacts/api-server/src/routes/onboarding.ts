/**
 * onboarding.ts — Core Onboarding State API
 *
 * GET  /onboarding/state          자신의 onboarding state 목록 조회
 * POST /onboarding/complete        특정 key 완료 기록 (idempotent upsert)
 *
 * 권한: 자기 state만 읽고 쓰기.
 * user_kind: 'user' (admin/teacher) | 'parent' (parent_account)
 *
 * version rollback 방지:
 *   completed_version은 높은 값으로만 업데이트.
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { superAdminDb } from "@workspace/db";

const router = Router();

// ── helpers ─────────────────────────────────────────────────────────────────

function getUserKind(role: string): "user" | "parent" {
  return role === "parent_account" ? "parent" : "user";
}

// ── GET /onboarding/state ────────────────────────────────────────────────────
router.get("/onboarding/state", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const userKind = getUserKind(req.user!.role);

    const result = await superAdminDb.execute(sql`
      SELECT onboarding_key, completed_version, completed_at
      FROM user_onboarding_state
      WHERE user_id   = ${userId}
        AND user_kind = ${userKind}
      ORDER BY onboarding_key
    `);

    const state: Record<string, { completed_version: number; completed_at: string }> = {};
    for (const row of (result as any).rows ?? []) {
      state[row.onboarding_key] = {
        completed_version: Number(row.completed_version),
        completed_at: row.completed_at,
      };
    }

    res.json({ ok: true, user_kind: userKind, state });
  } catch (err) {
    console.error("[onboarding/state GET]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /onboarding/complete ────────────────────────────────────────────────
router.post("/onboarding/complete", requireAuth, async (req: AuthRequest, res) => {
  const { onboarding_key, completed_version } = req.body ?? {};

  if (!onboarding_key || typeof onboarding_key !== "string") {
    res.status(400).json({ error: "onboarding_key가 필요합니다." });
    return;
  }
  const version = Number(completed_version ?? 1);
  if (!Number.isFinite(version) || version < 1) {
    res.status(400).json({ error: "completed_version은 1 이상이어야 합니다." });
    return;
  }

  try {
    const userId = req.user!.userId;
    const userKind = getUserKind(req.user!.role);

    // Upsert — version rollback 방지 (높은 값 유지)
    await superAdminDb.execute(sql`
      INSERT INTO user_onboarding_state
        (user_id, user_kind, onboarding_key, completed_version, completed_at, updated_at)
      VALUES
        (${userId}, ${userKind}, ${onboarding_key}, ${version}, NOW(), NOW())
      ON CONFLICT (user_id, user_kind, onboarding_key) DO UPDATE
        SET completed_version = GREATEST(user_onboarding_state.completed_version, EXCLUDED.completed_version),
            completed_at      = CASE
              WHEN EXCLUDED.completed_version > user_onboarding_state.completed_version
              THEN NOW()
              ELSE user_onboarding_state.completed_at
            END,
            updated_at        = NOW()
    `);

    res.json({ ok: true, onboarding_key, completed_version: version, user_kind: userKind });
  } catch (err) {
    console.error("[onboarding/complete POST]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
