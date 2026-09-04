/**
 * WP-CS-07R — Support Resolution Router
 *
 * POST /support/resolve
 *
 * 핵심 resolution 로직은 lib/support-resolver.ts에서 공유.
 * 이 파일은 Express route wrapping만 담당.
 *
 * Resolution order (우선순위 고정):
 *   1. RULE → 2. DB_STATE → 3. SOLUTION → 4. FRONTEND_MAP
 *   5. FAQ/KNOWLEDGE → 6. KNOWN_ISSUE → 7. NO_MATCH
 *
 * 보안:
 *   - Auth context (JWT) 기반 pool isolation
 *   - raw query 저장 금지
 *   - OpenAI 호출 없음 — deterministic only
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  runResolutionChain,
  tokenize,
  type RouterContext,
} from "../lib/support-resolver.js";

const router = Router();

// ── POST /support/resolve ─────────────────────────────────────────────────────

router.post("/support/resolve", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;

  // Auth context overrides client-supplied role/pool_id
  const role   = (user?.role    as string) ?? "unknown";
  const poolId = (user?.poolId  as string) ?? null;

  const body       = req.body as any;
  const rawQuery   = (body.query      as string) ?? "";
  const mode       = ((body.mode      as string) || "normal").toLowerCase();
  const screenId   = (body.screen_id   as string) ?? null;
  const appVersion = (body.app_version as string) ?? null;

  if (!rawQuery.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const qLower = rawQuery.toLowerCase().trim();
  const tokens = tokenize(rawQuery);

  const ctx: RouterContext = {
    query: rawQuery,
    role,
    mode,
    poolId,
    screenId,
    appVersion,
    qLower,
    tokens,
  };

  try {
    const result = await runResolutionChain(ctx);
    return res.json(result);
  } catch (err) {
    console.error("[POST /support/resolve]", err);
    return res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
