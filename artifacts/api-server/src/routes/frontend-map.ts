/**
 * Frontend Map Search API
 *
 * GET /support/frontend-map/search
 *   ?q=<keyword>
 *   &role=pool_admin|sub_admin|teacher|parent|super_admin
 *   &mode=normal|x|x_pending
 *   &route=/some-route
 *   &screen_id=ADMIN_DASHBOARD
 *   &version=1.6.3
 *
 * 검색 우선순위:
 *   1. exact screen_id
 *   2. exact route (role/mode 필터 적용)
 *   3. screen_name 포함 (label 매치)
 *   4. support_keywords 포함
 *   5. related_features 포함
 *   6. purpose 토큰 매치
 *
 * OpenAI 호출 없음 — deterministic search only.
 * 매칭 없으면 NO_MATCH 반환.
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  FRONTEND_MAP_REGISTRY,
  SCREEN_BY_ID,
  SCREENS_BY_ROUTE,
  FRONTEND_MAP_VERSION,
  type FrontendScreen,
  type ScreenRole,
  type ScreenMode,
} from "../config/support/frontend-map.v1.js";

const router = Router();

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** 쿼리 문자열을 정규화된 토큰 배열로 변환 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** 화면이 role/mode 필터를 통과하는지 */
function passesFilter(
  screen: FrontendScreen,
  role?: string,
  mode?: string
): boolean {
  if (role && !screen.available_roles.includes(role as ScreenRole)) return false;
  if (mode && !screen.available_modes.includes(mode as ScreenMode)) return false;
  return true;
}

/** 결과 형태로 변환 (내부 상세 제외, support-safe 필드만) */
function toResult(screen: FrontendScreen, score: number, source: string) {
  return {
    screen_id:    screen.screen_id,
    screen_name:  screen.screen_name,
    route:        screen.route,
    purpose:      screen.purpose,
    available_roles: screen.available_roles,
    available_modes: screen.available_modes,
    actions:      screen.buttons.map((b) => ({
      id:          b.id,
      label:       b.label,
      action_type: b.action_type,
      target_route: b.target_route ?? null,
    })),
    deep_link:    screen.deep_link ?? null,
    related_features: screen.related_features,
    support_keywords: screen.support_keywords,
    version:      screen.frontend_map_version,
    score,
    source,
  };
}

// ─── GET /support/frontend-map/search ────────────────────────────────────────

router.get(
  "/support/frontend-map/search",
  requireAuth,
  (req, res) => {
    const {
      q        = "",
      role     = "",
      mode     = "",
      route    = "",
      screen_id: sid = "",
      version  = "",
    } = req.query as Record<string, string>;

    // version check — warn but do not block (supports future map versions)
    const versionMismatch =
      version && version !== FRONTEND_MAP_VERSION ? true : false;

    // ── 1. Exact screen_id ───────────────────────────────────────────────────
    if (sid) {
      const screen = SCREEN_BY_ID.get(sid.toUpperCase());
      if (screen && passesFilter(screen, role, mode)) {
        return res.json({
          match: true,
          results: [toResult(screen, 100, "exact_screen_id")],
          total: 1,
          map_version: FRONTEND_MAP_VERSION,
          version_mismatch: versionMismatch,
        });
      }
      // screen_id 지정했으나 없음
      return res.json({
        match: false,
        results: [],
        total: 0,
        reason: "NO_MATCH",
        map_version: FRONTEND_MAP_VERSION,
        version_mismatch: versionMismatch,
      });
    }

    // ── 2. Exact route ───────────────────────────────────────────────────────
    if (route) {
      const normalized = route.startsWith("/") ? route : `/${route}`;
      const screens = (SCREENS_BY_ROUTE.get(normalized) ?? []).filter((s) =>
        passesFilter(s, role, mode)
      );
      if (screens.length > 0) {
        return res.json({
          match: true,
          results: screens.map((s) => toResult(s, 95, "exact_route")),
          total: screens.length,
          map_version: FRONTEND_MAP_VERSION,
          version_mismatch: versionMismatch,
        });
      }
    }

    // ── 3-6. Keyword / feature / purpose search ──────────────────────────────
    const query = q.trim();
    if (!query) {
      // No q, no sid, no route — return role/mode filtered full list
      const all = FRONTEND_MAP_REGISTRY.filter((s) => passesFilter(s, role, mode));
      if (all.length === 0) {
        return res.json({
          match: false,
          results: [],
          total: 0,
          reason: "NO_MATCH",
          map_version: FRONTEND_MAP_VERSION,
          version_mismatch: versionMismatch,
        });
      }
      return res.json({
        match: true,
        results: all.map((s) => toResult(s, 0, "role_mode_filter")),
        total: all.length,
        map_version: FRONTEND_MAP_VERSION,
        version_mismatch: versionMismatch,
      });
    }

    const queryLower   = query.toLowerCase();
    const queryTokens  = tokenize(query);

    interface ScoredResult {
      screen: FrontendScreen;
      score: number;
      source: string;
    }
    const scored: ScoredResult[] = [];

    for (const screen of FRONTEND_MAP_REGISTRY) {
      if (!passesFilter(screen, role, mode)) continue;

      let score  = 0;
      let source = "";

      // screen_name 완전 포함 (label match)
      if (screen.screen_name.includes(query) || screen.screen_name.toLowerCase().includes(queryLower)) {
        score  = 90;
        source = "label_match";
      }

      // support_keywords 완전 일치
      if (score < 85) {
        const kwExact = screen.support_keywords.some(
          (kw) => kw.toLowerCase() === queryLower
        );
        if (kwExact) { score = 85; source = "keyword_exact"; }
      }

      // support_keywords 포함
      if (score < 75) {
        const kwPartial = screen.support_keywords.some((kw) =>
          kw.toLowerCase().includes(queryLower) || queryLower.includes(kw.toLowerCase())
        );
        if (kwPartial) { score = 75; source = "keyword_partial"; }
      }

      // related_features 포함
      if (score < 65) {
        const featMatch = screen.related_features.some((f) =>
          f.toLowerCase().includes(queryLower) || queryLower.includes(f.toLowerCase())
        );
        if (featMatch) { score = 65; source = "feature_match"; }
      }

      // purpose 토큰 매치 — 토큰 중 하나라도 purpose에 포함
      if (score < 50) {
        const purposeLower = screen.purpose.toLowerCase();
        const tokenHit     = queryTokens.some((t) => t.length >= 2 && purposeLower.includes(t));
        if (tokenHit) { score = 50; source = "purpose_token"; }
      }

      // screen_id 토큰 매치 (예: "TEACHER" → teacher 화면들)
      if (score < 40) {
        const idLower = screen.screen_id.toLowerCase();
        const idHit   = queryTokens.some((t) => t.length >= 3 && idLower.includes(t));
        if (idHit) { score = 40; source = "screen_id_token"; }
      }

      if (score > 0) {
        scored.push({ screen, score, source });
      }
    }

    if (scored.length === 0) {
      return res.json({
        match: false,
        results: [],
        total: 0,
        reason: "NO_MATCH",
        map_version: FRONTEND_MAP_VERSION,
        version_mismatch: versionMismatch,
      });
    }

    // 점수 내림차순, 동점 시 screen_id 알파벳 순
    scored.sort((a, b) => b.score - a.score || a.screen.screen_id.localeCompare(b.screen.screen_id));

    // 최대 10개
    const top = scored.slice(0, 10);

    return res.json({
      match: true,
      results: top.map(({ screen, score, source }) => toResult(screen, score, source)),
      total: scored.length,
      map_version: FRONTEND_MAP_VERSION,
      version_mismatch: versionMismatch,
    });
  }
);

// ─── GET /support/frontend-map/screens/:screen_id ────────────────────────────

router.get(
  "/support/frontend-map/screens/:screen_id",
  requireAuth,
  (req, res) => {
    const { screen_id } = req.params;
    const screen = SCREEN_BY_ID.get(screen_id.toUpperCase());
    if (!screen) {
      return res.status(404).json({
        match: false,
        reason: "NO_MATCH",
        map_version: FRONTEND_MAP_VERSION,
      });
    }
    return res.json({
      match: true,
      screen,
      map_version: FRONTEND_MAP_VERSION,
    });
  }
);

// ─── GET /support/frontend-map/meta ──────────────────────────────────────────

router.get("/support/frontend-map/meta", requireAuth, (_req, res) => {
  const roleCount = new Map<string, number>();
  const modeCount = new Map<string, number>();

  for (const s of FRONTEND_MAP_REGISTRY) {
    for (const r of s.available_roles) roleCount.set(r, (roleCount.get(r) ?? 0) + 1);
    for (const m of s.available_modes) modeCount.set(m, (modeCount.get(m) ?? 0) + 1);
  }

  res.json({
    map_version: FRONTEND_MAP_VERSION,
    total_screens: FRONTEND_MAP_REGISTRY.length,
    by_role: Object.fromEntries(roleCount),
    by_mode: Object.fromEntries(modeCount),
  });
});

export default router;
