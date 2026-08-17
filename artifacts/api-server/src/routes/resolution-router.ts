/**
 * WP-CS-07R — Support Resolution Router
 *
 * POST /support/resolve
 *
 * Resolution order (priority fixed; first HIGH-confidence match wins):
 *   1. RULE        — support_knowledge_items item_type=RULE (active only)
 *   2. DB_STATE    — Real-time DB checks (subscription, X, feature flags) — read-only
 *   3. SOLUTION    — support_knowledge_items item_type=SOLUTION (active only)
 *   4. FRONTEND_MAP — Static registry (role/mode/version filtered)
 *   5. FAQ/KNOWLEDGE — support_knowledge_items item_type IN (FAQ,KNOWLEDGE) (active only)
 *   6. KNOWN_ISSUE — super_incidents (active: OPEN/INVESTIGATING/MITIGATED only)
 *   7. NO_MATCH
 *
 * Security:
 *   - Auth context (JWT) overrides client-supplied role/pool_id
 *   - Pool isolation enforced at every DB layer
 *   - No raw query stored in analytics
 *   - No OpenAI calls — deterministic only
 *
 * Event log (category=SUPPORT):
 *   RULE_HIT | DB_STATE_HIT | SOLUTION_HIT | FRONTEND_MAP_HIT |
 *   FAQ_HIT  | KNOWLEDGE_HIT | KNOWN_ISSUE_HIT | NO_KNOWLEDGE_MATCH
 */

import { Router, type Request, type Response } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import {
  FRONTEND_MAP_REGISTRY,
  SCREEN_BY_ID,
  type FrontendScreen,
  type ScreenRole,
  type ScreenMode,
} from "../config/support/frontend-map.v1.js";

const router = Router();

// ── Threshold ─────────────────────────────────────────────────────────────────

/** Score at or above this value is treated as HIGH-confidence — stops the chain. */
const HIGH_CONFIDENCE = 60;

// ── Shared Types ──────────────────────────────────────────────────────────────

interface KnowledgeRow {
  id: string;
  item_type: string;
  scope: string;
  pool_id: string | null;
  category: string | null;
  feature: string | null;
  affected_role: string | null;
  affected_mode: string | null;
  affected_roles: string[] | null;
  affected_modes: string[] | null;
  title: string;
  content: string;
  question: string | null;
  answer: string | null;
  deep_link: string | null;
  frontend_screen_id: string | null;
  solution_steps: any[] | null;
  conditions: Record<string, unknown> | null;
  incident_id: string | null;
  status: string;
  usage_count: number;
}

interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  service: string | null;
  description: string | null;
  started_at: string | null;
}

interface ResolutionResult {
  resolution_status: "RESOLVED" | "NEEDS_DIAGNOSTIC" | "NO_MATCH";
  source_type:
    | "RULE"
    | "DB_STATE"
    | "SOLUTION"
    | "FRONTEND_MAP"
    | "FAQ"
    | "KNOWLEDGE"
    | "KNOWN_ISSUE"
    | "NONE";
  source_id: string | null;
  confidence: number;
  title: string | null;
  answer: string | null;
  solution_steps?: any[] | null;
  screen_id?: string | null;
  deep_link?: string | null;
  requires_human: boolean;
  llm_required: boolean;
  diagnostic_checks?: string[] | null;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function roleMatches(row: KnowledgeRow, role: string): boolean {
  if (row.affected_roles?.length) return row.affected_roles.includes(role);
  if (!row.affected_role || row.affected_role === "all") return true;
  return row.affected_role === role;
}

function modeMatches(row: KnowledgeRow, mode: string): boolean {
  if (row.affected_modes?.length) return row.affected_modes.includes(mode);
  if (!row.affected_mode || row.affected_mode === "all") return true;
  return row.affected_mode === mode;
}

/**
 * Deterministic text score: returns [0..100].
 * Checks question exact, title exact, partial question, partial title, token overlap.
 */
function scoreText(row: KnowledgeRow, qLower: string, tokens: string[]): number {
  if (row.question && row.question.toLowerCase() === qLower) return 90;
  if (row.title.toLowerCase() === qLower) return 85;
  if (row.question && row.question.toLowerCase().includes(qLower)) return 78;
  if (row.title.toLowerCase().includes(qLower)) return 72;
  if (qLower.length > 2 && row.content.toLowerCase().includes(qLower)) return 65;

  // token overlap
  const titleTokens = tokenize(row.title);
  const contentTokens = tokenize(row.content + " " + (row.question ?? ""));
  const overlap = tokens.filter(
    (t) => titleTokens.includes(t) || contentTokens.includes(t)
  ).length;
  if (tokens.length > 0 && overlap / tokens.length >= 0.5) return 55;
  return 0;
}

// ── Event logger ──────────────────────────────────────────────────────────────

async function logEvent(
  eventType:
    | "RULE_HIT"
    | "DB_STATE_HIT"
    | "SOLUTION_HIT"
    | "FRONTEND_MAP_HIT"
    | "FAQ_HIT"
    | "KNOWLEDGE_HIT"
    | "KNOWN_ISSUE_HIT"
    | "NO_KNOWLEDGE_MATCH",
  meta: {
    source_id?: string | null;
    role?: string;
    mode?: string;
    pool_id?: string | null;
    screen_id?: string | null;
    category?: string | null;
    feature?: string | null;
  }
): Promise<void> {
  try {
    const id = `ev_rr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await superAdminDb.execute(sql`
      INSERT INTO event_logs (id, category, action, metadata, created_at)
      VALUES (
        ${id},
        'SUPPORT',
        ${eventType},
        ${JSON.stringify({
          source_id: meta.source_id ?? null,
          role:      meta.role      ?? null,
          mode:      meta.mode      ?? null,
          pool_id:   meta.pool_id   ?? null,
          screen_id: meta.screen_id ?? null,
          category:  meta.category  ?? null,
          feature:   meta.feature   ?? null,
        })}::jsonb,
        NOW()
      )
    `);
  } catch { /* best-effort */ }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface RouterContext {
  query: string;
  role: string;
  mode: string;
  poolId: string | null;
  screenId: string | null;
  appVersion: string | null;
  qLower: string;
  tokens: string[];
}

// ── Layer 1: RULE ─────────────────────────────────────────────────────────────

async function tryRule(ctx: RouterContext): Promise<ResolutionResult | null> {
  const rows = (await superAdminDb.execute(sql`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, deep_link,
           frontend_screen_id, solution_steps, conditions, incident_id,
           status, usage_count
    FROM support_knowledge_items
    WHERE status = 'active'
      AND item_type = 'RULE'
      AND (
        scope = 'global'
        OR (scope = 'pool' AND pool_id = ${ctx.poolId})
      )
    ORDER BY usage_count DESC
    LIMIT 100
  `)) as any;

  const candidates: KnowledgeRow[] = rows.rows ?? [];

  // role / mode filter
  const eligible = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  // score against query text
  for (const row of eligible) {
    const score = scoreText(row, ctx.qLower, ctx.tokens);
    if (score >= HIGH_CONFIDENCE) {
      await logEvent("RULE_HIT", {
        source_id: row.id, role: ctx.role, mode: ctx.mode,
        pool_id: ctx.poolId, category: row.category, feature: row.feature,
      });
      return {
        resolution_status: "RESOLVED",
        source_type: "RULE",
        source_id: row.id,
        confidence: score,
        title: row.title,
        answer: row.answer ?? row.content,
        solution_steps: row.solution_steps ?? null,
        screen_id: row.frontend_screen_id ?? null,
        deep_link: row.deep_link ?? null,
        requires_human: false,
        llm_required: false,
      };
    }
  }
  return null;
}

// ── Layer 2: DB_STATE ─────────────────────────────────────────────────────────
//
// Keyword-based dispatcher. Queries real-time DB for definitive state answers.
// Read-only — no mutations ever.

const SUBSCRIPTION_KEYWORDS = ["구독", "subscription", "결제", "payment", "plan", "플랜", "만료", "expire", "cancel", "취소"];
const X_KEYWORDS = ["x모드", "x mode", "xmode", "x 활성", "x 기능", "x 커리큘럼", "x curriculum", "x_mode", "x-mode"];
const REPORT_KEYWORDS = ["리포트", "report", "성장 리포트", "growth report", "생성", "생성 중", "pending report"];
const FEATURE_KEYWORDS = ["기능 활성", "feature", "활성화", "enabled", "disabled", "기능 꺼짐"];

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

async function tryDbState(ctx: RouterContext): Promise<ResolutionResult | null> {
  const fullText = ctx.qLower;

  // — Subscription state ———————————————————————————————————————————————————————
  if (hasAnyKeyword(fullText, SUBSCRIPTION_KEYWORDS) && ctx.poolId) {
    try {
      const result = (await superAdminDb.execute(sql`
        SELECT id, x_status, subscription_status, billing_state, read_only_mode,
               display_name
        FROM swimming_pools
        WHERE id = ${ctx.poolId}
        LIMIT 1
      `)) as any;

      const pool = result.rows?.[0];
      if (pool) {
        const state = pool.billing_state ?? pool.subscription_status ?? pool.x_status ?? null;
        if (state) {
          const isActive = ["ACTIVE", "active", "paid"].includes(String(state).toLowerCase());
          const answer = isActive
            ? `현재 구독이 활성 상태입니다. (상태: ${state})`
            : `현재 구독이 비활성 상태입니다. (상태: ${state}) 결제 및 구독 관리 화면에서 확인하세요.`;
          await logEvent("DB_STATE_HIT", {
            source_id: pool.id, role: ctx.role, mode: ctx.mode, pool_id: ctx.poolId,
            category: "billing", feature: "subscription",
          });
          return {
            resolution_status: "RESOLVED",
            source_type: "DB_STATE",
            source_id: pool.id,
            confidence: 95,
            title: "구독 상태",
            answer,
            requires_human: !isActive,
            llm_required: false,
          };
        }
      }
    } catch { /* fall through */ }
  }

  // — X activation state ———————————————————————————————————————————————————————
  if (hasAnyKeyword(fullText, X_KEYWORDS) && ctx.poolId) {
    try {
      const result = (await superAdminDb.execute(sql`
        SELECT id, x_status, x_enabled, x_configured_at, display_name
        FROM swimming_pools
        WHERE id = ${ctx.poolId}
        LIMIT 1
      `)) as any;

      const pool = result.rows?.[0];
      if (pool) {
        const enabled = pool.x_enabled === true || pool.x_enabled === 1;
        const status = pool.x_status ?? (enabled ? "ACTIVE" : "INACTIVE");
        const answer = enabled
          ? `X 모드가 활성화되어 있습니다. (상태: ${status})`
          : `X 모드가 아직 활성화되지 않았습니다. (상태: ${status}) X 설정 화면에서 신청하세요.`;
        await logEvent("DB_STATE_HIT", {
          source_id: pool.id, role: ctx.role, mode: ctx.mode, pool_id: ctx.poolId,
          category: "x_mode", feature: "x_activation",
        });
        return {
          resolution_status: "RESOLVED",
          source_type: "DB_STATE",
          source_id: pool.id,
          confidence: 95,
          title: "X 모드 활성화 상태",
          answer,
          requires_human: false,
          llm_required: false,
        };
      }
    } catch { /* fall through */ }
  }

  // — Report generation state ——————————————————————————————————————————————————
  if (hasAnyKeyword(fullText, REPORT_KEYWORDS) && ctx.poolId) {
    try {
      const result = (await superAdminDb.execute(sql`
        SELECT id, student_id, status, created_at
        FROM growth_reports
        WHERE pool_id = ${ctx.poolId}
          AND status = 'PENDING'
        ORDER BY created_at DESC
        LIMIT 1
      `)) as any;

      const pending = result.rows?.[0];
      if (pending) {
        await logEvent("DB_STATE_HIT", {
          source_id: pending.id, role: ctx.role, mode: ctx.mode, pool_id: ctx.poolId,
          category: "growth", feature: "report_generation",
        });
        return {
          resolution_status: "RESOLVED",
          source_type: "DB_STATE",
          source_id: pending.id,
          confidence: 90,
          title: "리포트 생성 중",
          answer:
            "현재 성장 리포트가 생성 중입니다. 잠시 후 앱을 새로고침하면 확인하실 수 있습니다.",
          requires_human: false,
          llm_required: false,
        };
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ── Layer 3: SOLUTION ─────────────────────────────────────────────────────────

async function trySolution(ctx: RouterContext): Promise<ResolutionResult | null> {
  const rows = (await superAdminDb.execute(sql`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, deep_link,
           frontend_screen_id, solution_steps, conditions, incident_id,
           status, usage_count
    FROM support_knowledge_items
    WHERE status = 'active'
      AND item_type = 'SOLUTION'
      AND (
        scope = 'global'
        OR (scope = 'pool' AND pool_id = ${ctx.poolId})
      )
    ORDER BY usage_count DESC
    LIMIT 100
  `)) as any;

  const candidates: KnowledgeRow[] = rows.rows ?? [];
  const eligible = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  let bestRow: KnowledgeRow | null = null;
  let bestScore = 0;

  for (const row of eligible) {
    const score = scoreText(row, ctx.qLower, ctx.tokens);
    if (score > bestScore) { bestScore = score; bestRow = row; }
  }

  if (bestRow && bestScore >= HIGH_CONFIDENCE) {
    // Check if solution requires diagnostic steps
    const conditions = bestRow.conditions as any;
    const needsDiag = conditions?.needs_diagnostic === true;

    await logEvent("SOLUTION_HIT", {
      source_id: bestRow.id, role: ctx.role, mode: ctx.mode,
      pool_id: ctx.poolId, category: bestRow.category, feature: bestRow.feature,
    });

    if (needsDiag) {
      const checks: string[] = Array.isArray(conditions?.diagnostic_checks)
        ? conditions.diagnostic_checks
        : ["증상을 자세히 확인하세요.", "앱을 재시작해 보세요."];
      return {
        resolution_status: "NEEDS_DIAGNOSTIC",
        source_type: "SOLUTION",
        source_id: bestRow.id,
        confidence: bestScore,
        title: bestRow.title,
        answer: bestRow.answer ?? bestRow.content,
        solution_steps: bestRow.solution_steps ?? null,
        screen_id: bestRow.frontend_screen_id ?? null,
        deep_link: bestRow.deep_link ?? null,
        requires_human: false,
        llm_required: false,
        diagnostic_checks: checks,
      };
    }

    return {
      resolution_status: "RESOLVED",
      source_type: "SOLUTION",
      source_id: bestRow.id,
      confidence: bestScore,
      title: bestRow.title,
      answer: bestRow.answer ?? bestRow.content,
      solution_steps: bestRow.solution_steps ?? null,
      screen_id: bestRow.frontend_screen_id ?? null,
      deep_link: bestRow.deep_link ?? null,
      requires_human: false,
      llm_required: false,
    };
  }
  return null;
}

// ── Layer 4: FRONTEND_MAP ─────────────────────────────────────────────────────

function frontendMapPassesFilter(
  screen: FrontendScreen,
  role: string,
  mode: string
): boolean {
  if (role && !screen.available_roles.includes(role as ScreenRole)) return false;
  if (mode && !screen.available_modes.includes(mode as ScreenMode)) return false;
  return true;
}

function scoreFrontendMap(screen: FrontendScreen, qLower: string, tokens: string[]): number {
  if (screen.screen_name.toLowerCase().includes(qLower)) return 90;
  if (screen.support_keywords.some((k) => k.toLowerCase() === qLower)) return 85;
  if (screen.support_keywords.some((k) => k.toLowerCase().includes(qLower) || qLower.includes(k.toLowerCase()))) return 75;
  if (screen.related_features.some((f) => f.toLowerCase().includes(qLower) || qLower.includes(f.toLowerCase()))) return 65;
  const purposeTokens = tokenize(screen.purpose + " " + screen.screen_name);
  const overlap = tokens.filter((t) => purposeTokens.includes(t)).length;
  if (tokens.length > 0 && overlap / tokens.length >= 0.4) return 55;
  return 0;
}

async function tryFrontendMap(ctx: RouterContext): Promise<ResolutionResult | null> {
  // exact screen_id
  if (ctx.screenId) {
    const screen = SCREEN_BY_ID.get(ctx.screenId.toUpperCase());
    if (screen && frontendMapPassesFilter(screen, ctx.role, ctx.mode)) {
      await logEvent("FRONTEND_MAP_HIT", {
        source_id: screen.screen_id, role: ctx.role, mode: ctx.mode,
        pool_id: ctx.poolId, screen_id: screen.screen_id,
      });
      return buildFrontendMapResult(screen, 100);
    }
  }

  if (!ctx.qLower) return null;

  // keyword scoring
  let bestScreen: FrontendScreen | null = null;
  let bestScore = 0;
  for (const screen of FRONTEND_MAP_REGISTRY) {
    if (!frontendMapPassesFilter(screen, ctx.role, ctx.mode)) continue;
    const score = scoreFrontendMap(screen, ctx.qLower, ctx.tokens);
    if (score > bestScore) { bestScore = score; bestScreen = screen; }
  }

  if (bestScreen && bestScore >= HIGH_CONFIDENCE) {
    await logEvent("FRONTEND_MAP_HIT", {
      source_id: bestScreen.screen_id, role: ctx.role, mode: ctx.mode,
      pool_id: ctx.poolId, screen_id: bestScreen.screen_id,
    });
    return buildFrontendMapResult(bestScreen, bestScore);
  }
  return null;
}

function buildFrontendMapResult(screen: FrontendScreen, confidence: number): ResolutionResult {
  return {
    resolution_status: "RESOLVED",
    source_type: "FRONTEND_MAP",
    source_id: screen.screen_id,
    confidence,
    title: screen.screen_name,
    answer: screen.purpose,
    screen_id: screen.screen_id,
    deep_link: screen.deep_link ?? null,
    requires_human: false,
    llm_required: false,
  };
}

// ── Layer 5: FAQ / KNOWLEDGE ──────────────────────────────────────────────────

async function tryFaqKnowledge(ctx: RouterContext): Promise<ResolutionResult | null> {
  const rows = (await superAdminDb.execute(sql`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, deep_link,
           frontend_screen_id, solution_steps, conditions, incident_id,
           status, usage_count
    FROM support_knowledge_items
    WHERE status = 'active'
      AND item_type IN ('FAQ', 'KNOWLEDGE')
      AND (
        scope = 'global'
        OR (scope = 'pool' AND pool_id = ${ctx.poolId})
      )
    ORDER BY usage_count DESC
    LIMIT 200
  `)) as any;

  const candidates: KnowledgeRow[] = rows.rows ?? [];
  const eligible = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  let bestRow: KnowledgeRow | null = null;
  let bestScore = 0;
  for (const row of eligible) {
    const score = scoreText(row, ctx.qLower, ctx.tokens);
    if (score > bestScore) { bestScore = score; bestRow = row; }
  }

  if (bestRow && bestScore >= HIGH_CONFIDENCE) {
    const isFaq = bestRow.item_type === "FAQ";
    await logEvent(isFaq ? "FAQ_HIT" : "KNOWLEDGE_HIT", {
      source_id: bestRow.id, role: ctx.role, mode: ctx.mode,
      pool_id: ctx.poolId, category: bestRow.category, feature: bestRow.feature,
      screen_id: bestRow.frontend_screen_id,
    });
    return {
      resolution_status: "RESOLVED",
      source_type: isFaq ? "FAQ" : "KNOWLEDGE",
      source_id: bestRow.id,
      confidence: bestScore,
      title: bestRow.title,
      answer: bestRow.answer ?? bestRow.content,
      screen_id: bestRow.frontend_screen_id ?? null,
      deep_link: bestRow.deep_link ?? null,
      requires_human: false,
      llm_required: false,
    };
  }
  return null;
}

// ── Layer 6: KNOWN_ISSUE ──────────────────────────────────────────────────────

const ACTIVE_INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "MITIGATED"];

async function tryKnownIssue(ctx: RouterContext): Promise<ResolutionResult | null> {
  // Load active KNOWN_ISSUE knowledge items (linked to super_incidents)
  const kiRows = (await superAdminDb.execute(sql`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, deep_link,
           frontend_screen_id, solution_steps, conditions, incident_id,
           status, usage_count
    FROM support_knowledge_items
    WHERE status = 'active'
      AND item_type = 'KNOWN_ISSUE'
      AND incident_id IS NOT NULL
      AND (
        scope = 'global'
        OR (scope = 'pool' AND pool_id = ${ctx.poolId})
      )
    ORDER BY usage_count DESC
    LIMIT 50
  `)) as any;

  const kiCandidates: KnowledgeRow[] = kiRows.rows ?? [];
  const eligible = kiCandidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  if (eligible.length === 0) return null;

  // Verify the linked incidents are still active (not RESOLVED)
  const incidentIds = [...new Set(eligible.map((r) => r.incident_id!))];

  // Query active incidents matching our candidates
  const incRows = (await superAdminDb.execute(sql`
    SELECT id, title, severity, status, service, description, started_at::text
    FROM super_incidents
    WHERE status IN ('OPEN', 'INVESTIGATING', 'MITIGATED')
      AND id = ANY(${JSON.stringify(incidentIds)}::text[])
    ORDER BY started_at DESC
    LIMIT 10
  `)) as any;

  const activeIncidents: IncidentRow[] = incRows.rows ?? [];
  if (activeIncidents.length === 0) return null;

  const activeIds = new Set(activeIncidents.map((i) => i.id));

  // Only keep ki rows linked to an active incident
  const verified = eligible.filter((r) => activeIds.has(r.incident_id!));
  if (verified.length === 0) return null;

  // Score against query
  let bestRow: KnowledgeRow | null = null;
  let bestScore = 0;
  for (const row of verified) {
    const score = scoreText(row, ctx.qLower, ctx.tokens);
    // KNOWN_ISSUE: lower threshold — incident presence is strong signal even with partial match
    const effective = score > 0 ? score : 45;
    if (effective > bestScore) { bestScore = effective; bestRow = row; }
  }

  if (!bestRow) return null;

  const incident = activeIncidents.find((i) => i.id === bestRow!.incident_id);

  await logEvent("KNOWN_ISSUE_HIT", {
    source_id: bestRow.id, role: ctx.role, mode: ctx.mode,
    pool_id: ctx.poolId, category: bestRow.category, feature: bestRow.feature,
  });

  return {
    resolution_status: "RESOLVED",
    source_type: "KNOWN_ISSUE",
    source_id: bestRow.id,
    confidence: Math.max(bestScore, 45),
    title: incident
      ? `[알려진 문제] ${incident.title} (${incident.severity})`
      : bestRow.title,
    answer:
      bestRow.answer ??
      bestRow.content ??
      (incident ? `${incident.description ?? ""} 복구 작업 중입니다.` : null),
    requires_human: false,
    llm_required: false,
  };
}

// ── Layer 7: NO_MATCH ─────────────────────────────────────────────────────────

async function buildNoMatch(ctx: RouterContext): Promise<ResolutionResult> {
  await logEvent("NO_KNOWLEDGE_MATCH", {
    role: ctx.role, mode: ctx.mode, pool_id: ctx.poolId,
  });
  return {
    resolution_status: "NO_MATCH",
    source_type: "NONE",
    source_id: null,
    confidence: 0,
    title: null,
    answer: null,
    requires_human: true,
    llm_required: true,
  };
}

// ── POST /support/resolve ─────────────────────────────────────────────────────

router.post("/support/resolve", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;

  // Auth context overrides client-supplied role/pool_id
  const role   = (user?.role    as string) ?? "unknown";
  const poolId = (user?.poolId  as string) ?? null;

  const body       = req.body as any;
  const rawQuery   = (body.query   as string) ?? "";
  const mode       = ((body.mode   as string) || "normal").toLowerCase();
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
    // Ordered resolution chain — first HIGH-confidence match wins
    const result =
      (await tryRule(ctx)) ??
      (await tryDbState(ctx)) ??
      (await trySolution(ctx)) ??
      (await tryFrontendMap(ctx)) ??
      (await tryFaqKnowledge(ctx)) ??
      (await tryKnownIssue(ctx)) ??
      (await buildNoMatch(ctx));

    return res.json(result);
  } catch (err) {
    console.error("[POST /support/resolve]", err);
    return res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
