/**
 * terminology.ts — Terminology Gateway Routes
 *
 * Additive routes, backward-compatible.
 * Accessible by any authenticated user (parent, teacher, pool_admin, etc.)
 * No pool_id required — global knowledge.
 *
 * GET /terminology/search?q=...&limit=30
 * GET /terminology/terms/:termId
 */

import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import {
  searchTerminology,
  getTermDetail,
  TerminologyEngineError,
  isTerminologyMockMode,
} from "../lib/terminology-engine-client.js";

const router = Router();

// ─── GET /terminology/search ───────────────────────────────────────────────────

router.get(
  "/terminology/search",
  requireAuth as any,
  async (req: AuthRequest, res) => {
    const q = (req.query["q"] as string | undefined)?.trim() ?? "";
    if (!q) {
      return res.json({ results: [], terminology_version: null, total: 0 });
    }

    const limitRaw = parseInt((req.query["limit"] as string) ?? "30", 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;

    try {
      const result = await searchTerminology(q, limit);
      return res.json(result);
    } catch (err) {
      if (err instanceof TerminologyEngineError) {
        return res
          .status(err.statusCode >= 500 ? 503 : err.statusCode)
          .json({ error: err.errorCode, message: "검색 서비스를 일시적으로 사용할 수 없습니다." });
      }
      console.error("[terminology/search] unexpected error:", err);
      return res.status(503).json({ error: "ENGINE_UNAVAILABLE" });
    }
  },
);

// ─── GET /terminology/terms/:termId ───────────────────────────────────────────

router.get(
  "/terminology/terms/:termId",
  requireAuth as any,
  async (req: AuthRequest, res) => {
    const { termId } = req.params;
    if (!termId) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "termId가 필요합니다." });
    }

    try {
      const detail = await getTermDetail(termId);
      if (!detail) {
        return res.status(404).json({ error: "TERM_NOT_FOUND", message: "용어를 찾을 수 없습니다." });
      }
      return res.json(detail);
    } catch (err) {
      if (err instanceof TerminologyEngineError) {
        return res
          .status(err.statusCode >= 500 ? 503 : err.statusCode)
          .json({ error: err.errorCode, message: "용어 서비스를 일시적으로 사용할 수 없습니다." });
      }
      console.error("[terminology/terms] unexpected error:", err);
      return res.status(503).json({ error: "ENGINE_UNAVAILABLE" });
    }
  },
);

// ─── GET /terminology/status (health / mock indicator) ───────────────────────

router.get(
  "/terminology/status",
  requireAuth as any,
  (_req: AuthRequest, res) => {
    return res.json({
      ok: true,
      mock_mode: isTerminologyMockMode(),
      message: isTerminologyMockMode()
        ? "MOCK MODE — ENGINE 연결 전"
        : "LIVE MODE — ENGINE 연결됨",
    });
  },
);

export default router;
