/**
 * support-resolver.ts — WP-CS-07R/08R 공유 Resolution Chain
 *
 * runResolutionChain(ctx) — 7-layer 우선순위 체인:
 *   1. RULE        — support_knowledge_items item_type=RULE (active only)
 *   2. DB_STATE    — 실시간 DB (구독/X/리포트 상태) — read-only
 *   3. SOLUTION    — support_knowledge_items item_type=SOLUTION (active only)
 *   4. FRONTEND_MAP — 정적 레지스트리 (role/mode 필터)
 *   5. FAQ/KNOWLEDGE — support_knowledge_items item_type IN (FAQ,KNOWLEDGE)
 *   6. KNOWN_ISSUE — super_incidents(OPEN/INVESTIGATING/MITIGATED) 연결 ki만
 *   7. NO_MATCH    → llm_required=true
 *
 * 보안:
 *   - Auth context 기반 pool isolation (클라이언트 pool_id 무시)
 *   - raw query 저장 금지
 *   - OpenAI 호출 없음 (deterministic only)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  FRONTEND_MAP_REGISTRY,
  SCREEN_BY_ID,
  type FrontendScreen,
  type ScreenRole,
  type ScreenMode,
} from "../config/support/frontend-map.v1.js";

// ── Threshold ─────────────────────────────────────────────────────────────────

export const HIGH_CONFIDENCE = 60;

// ── Explanation intent markers ────────────────────────────────────────────────
// §4 Routing quality rule (P0-CS08-ANSWER-SOURCE-QUALITY):
// Queries containing these words seek product/feature explanation, not screen navigation.
// FAQ/Knowledge items should take priority over Frontend Map purpose metadata.
// Navigation queries ("어디야", "어디에서", "화면 찾기") are NOT listed here.
const EXPLANATION_INTENT_MARKERS = ["알려줘", "뭐야", "뭔지", "설명", "소개", "대해"];

export function hasExplanationIntent(qLower: string): boolean {
  return EXPLANATION_INTENT_MARKERS.some((m) => qLower.includes(m));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KnowledgeRow {
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

export interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  service: string | null;
  description: string | null;
  started_at: string | null;
}

export interface ResolutionResult {
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

export interface RouterContext {
  query: string;
  role: string;
  mode: string;
  poolId: string | null;
  screenId: string | null;
  appVersion: string | null;
  qLower: string;
  tokens: string[];
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * 검색 전용 정규화 — 원본 query/content는 절대 수정하지 않음.
 * scoreText 및 RouterContext 구축에만 사용.
 *
 * 적용 규칙:
 *  1. lowercase
 *  2. 한글 ↔ ASCII 경계 공백 삽입  ("스윔노트x" → "스윔노트 x", "x에" → "x 에")
 *  3. 조사 변형 정규화  ("에대해서" / "에대해" → "에 대해 ")
 *  4. 뭐야 / 뭔지 변형  ("이뭐야" / "가뭐야" → "가 뭐야 ")
 *  5. 다중 공백 정리
 */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    // 1. 한글 → ASCII
    .replace(/([\uAC00-\uD7A3])([A-Za-z0-9])/g, "$1 $2")
    // 2. ASCII → 한글
    .replace(/([A-Za-z0-9])([\uAC00-\uD7A3])/g, "$1 $2")
    // 3. 조사 변형 (에대해서 먼저)
    .replace(/에\s*대해서/g, "에 대해 ")
    .replace(/에\s*대해/g, "에 대해 ")
    // 4. 뭐야 / 뭔지 변형
    .replace(/[이가]\s*뭐야/g, "가 뭐야 ")
    .replace(/[이가]\s*뭔지/g, "가 뭔지 ")
    // 5. 다중 공백 정리
    .replace(/\s+/g, " ")
    .trim();
}

export function roleMatches(row: KnowledgeRow, role: string): boolean {
  if (row.affected_roles?.length) return row.affected_roles.includes(role);
  if (!row.affected_role || row.affected_role === "all") return true;
  return row.affected_role === role;
}

export function modeMatches(row: KnowledgeRow, mode: string): boolean {
  if (row.affected_modes?.length) return row.affected_modes.includes(mode);
  if (!row.affected_mode || row.affected_mode === "all") return true;
  return row.affected_mode === mode;
}

/**
 * Knowledge row와 query의 유사도를 점수로 반환.
 * qLower / tokens는 반드시 normalizeQuery 처리 후 전달.
 * row 필드도 동일 정규화 후 비교하여 "에대해서" 등 변형 커버.
 */
export function scoreText(
  row: KnowledgeRow,
  qLower: string,
  tokens: string[]
): number {
  // 정확한 정규화 비교 (양쪽 모두 normalizeQuery 적용)
  const nQuestion = row.question ? normalizeQuery(row.question) : null;
  const nTitle    = normalizeQuery(row.title);

  if (nQuestion !== null && nQuestion === qLower) return 90;
  if (nTitle === qLower) return 85;
  if (nQuestion !== null && nQuestion.includes(qLower)) return 78;
  if (nTitle.includes(qLower)) return 72;
  if (qLower.length > 2 && normalizeQuery(row.content).includes(qLower)) return 65;

  const titleTokens   = tokenize(row.title);
  const contentTokens = tokenize(row.content + " " + (row.question ?? ""));
  const overlap = tokens.filter(
    (t) => titleTokens.includes(t) || contentTokens.includes(t)
  ).length;
  if (tokens.length > 0 && overlap / tokens.length >= 0.5) return 55;
  return 0;
}

// ── Event logger ──────────────────────────────────────────────────────────────

export type ResolverEventType =
  | "RULE_HIT"
  | "DB_STATE_HIT"
  | "SOLUTION_HIT"
  | "FRONTEND_MAP_HIT"
  | "FAQ_HIT"
  | "KNOWLEDGE_HIT"
  | "KNOWN_ISSUE_HIT"
  | "NO_KNOWLEDGE_MATCH";

export async function logResolverEvent(
  eventType: ResolverEventType,
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

// ── Knowledge DB query helper ─────────────────────────────────────────────────

async function queryKnowledge(
  itemType: string | string[],
  ctx: RouterContext
): Promise<KnowledgeRow[]> {
  const isArray = Array.isArray(itemType);
  const rows = (await superAdminDb.execute(
    isArray
      ? sql`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, solution_steps, conditions, incident_id,
               status, usage_count
        FROM support_knowledge_items
        WHERE status = 'active'
          AND item_type IN ('FAQ', 'KNOWLEDGE')
          AND (scope = 'global' OR (scope = 'pool' AND pool_id = ${ctx.poolId}))
        ORDER BY usage_count DESC
        LIMIT 200
      `
      : itemType === "RULE"
      ? sql`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, solution_steps, conditions, incident_id,
               status, usage_count
        FROM support_knowledge_items
        WHERE status = 'active'
          AND item_type = 'RULE'
          AND (scope = 'global' OR (scope = 'pool' AND pool_id = ${ctx.poolId}))
        ORDER BY usage_count DESC
        LIMIT 100
      `
      : itemType === "SOLUTION"
      ? sql`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, solution_steps, conditions, incident_id,
               status, usage_count
        FROM support_knowledge_items
        WHERE status = 'active'
          AND item_type = 'SOLUTION'
          AND (scope = 'global' OR (scope = 'pool' AND pool_id = ${ctx.poolId}))
        ORDER BY usage_count DESC
        LIMIT 100
      `
      : sql`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, solution_steps, conditions, incident_id,
               status, usage_count
        FROM support_knowledge_items
        WHERE status = 'active'
          AND item_type = 'KNOWN_ISSUE'
          AND incident_id IS NOT NULL
          AND (scope = 'global' OR (scope = 'pool' AND pool_id = ${ctx.poolId}))
        ORDER BY usage_count DESC
        LIMIT 50
      `
  )) as any;
  return rows.rows ?? [];
}

// ── Layer 1: RULE ─────────────────────────────────────────────────────────────

async function tryRule(ctx: RouterContext): Promise<ResolutionResult | null> {
  const candidates = await queryKnowledge("RULE", ctx);
  const eligible   = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  for (const row of eligible) {
    const score = scoreText(row, ctx.qLower, ctx.tokens);
    if (score >= HIGH_CONFIDENCE) {
      await logResolverEvent("RULE_HIT", {
        source_id: row.id, role: ctx.role, mode: ctx.mode,
        pool_id: ctx.poolId, category: row.category, feature: row.feature,
      });
      return {
        resolution_status: "RESOLVED",
        source_type:  "RULE",
        source_id:    row.id,
        confidence:   score,
        title:        row.title,
        answer:       row.answer ?? row.content,
        solution_steps: row.solution_steps ?? null,
        screen_id:    row.frontend_screen_id ?? null,
        deep_link:    row.deep_link ?? null,
        requires_human: false,
        llm_required: false,
      };
    }
  }
  return null;
}

// ── Layer 2: DB_STATE ─────────────────────────────────────────────────────────

const SUBSCRIPTION_KW = ["구독", "subscription", "결제", "payment", "plan", "플랜", "만료", "expire", "cancel", "취소"];
const X_KW = ["x모드", "x mode", "xmode", "x 활성", "x 기능", "x 커리큘럼", "x curriculum", "x_mode", "x-mode"];
const REPORT_KW = ["리포트", "report", "성장 리포트", "growth report", "생성 중", "pending report"];

function hasKw(text: string, kws: string[]): boolean {
  const l = text.toLowerCase();
  return kws.some((k) => l.includes(k));
}

async function tryDbState(ctx: RouterContext): Promise<ResolutionResult | null> {
  if (!ctx.poolId) return null;

  if (hasKw(ctx.qLower, SUBSCRIPTION_KW)) {
    try {
      const r = (await superAdminDb.execute(sql`
        SELECT id, x_status, subscription_status, billing_state, display_name
        FROM swimming_pools WHERE id = ${ctx.poolId} LIMIT 1
      `)) as any;
      const pool = r.rows?.[0];
      if (pool) {
        const state   = pool.billing_state ?? pool.subscription_status ?? pool.x_status ?? null;
        if (state) {
          const isActive = ["ACTIVE", "active", "paid"].includes(String(state).toLowerCase());
          const answer   = isActive
            ? `현재 구독이 활성 상태입니다. (상태: ${state})`
            : `현재 구독이 비활성 상태입니다. (상태: ${state}) 결제 및 구독 관리 화면에서 확인하세요.`;
          await logResolverEvent("DB_STATE_HIT", {
            source_id: pool.id, role: ctx.role, mode: ctx.mode,
            pool_id: ctx.poolId, category: "billing", feature: "subscription",
          });
          return { resolution_status: "RESOLVED", source_type: "DB_STATE", source_id: pool.id,
            confidence: 95, title: "구독 상태", answer, requires_human: !isActive, llm_required: false };
        }
      }
    } catch { /* fall through */ }
  }

  if (hasKw(ctx.qLower, X_KW)) {
    try {
      const r = (await superAdminDb.execute(sql`
        SELECT id, x_status, x_enabled, display_name
        FROM swimming_pools WHERE id = ${ctx.poolId} LIMIT 1
      `)) as any;
      const pool = r.rows?.[0];
      if (pool) {
        const enabled = pool.x_enabled === true || pool.x_enabled === 1;
        const status  = pool.x_status ?? (enabled ? "ACTIVE" : "INACTIVE");
        const answer  = enabled
          ? `X 모드가 활성화되어 있습니다. (상태: ${status})`
          : `X 모드가 아직 활성화되지 않았습니다. (상태: ${status}) X 설정 화면에서 신청하세요.`;
        await logResolverEvent("DB_STATE_HIT", {
          source_id: pool.id, role: ctx.role, mode: ctx.mode,
          pool_id: ctx.poolId, category: "x_mode", feature: "x_activation",
        });
        return { resolution_status: "RESOLVED", source_type: "DB_STATE", source_id: pool.id,
          confidence: 95, title: "X 모드 활성화 상태", answer, requires_human: false, llm_required: false };
      }
    } catch { /* fall through */ }
  }

  if (hasKw(ctx.qLower, REPORT_KW)) {
    try {
      const r = (await superAdminDb.execute(sql`
        SELECT id, student_id, status, created_at
        FROM growth_reports
        WHERE pool_id = ${ctx.poolId} AND status = 'PENDING'
        ORDER BY created_at DESC LIMIT 1
      `)) as any;
      const pending = r.rows?.[0];
      if (pending) {
        await logResolverEvent("DB_STATE_HIT", {
          source_id: pending.id, role: ctx.role, mode: ctx.mode,
          pool_id: ctx.poolId, category: "growth", feature: "report_generation",
        });
        return { resolution_status: "RESOLVED", source_type: "DB_STATE", source_id: pending.id,
          confidence: 90, title: "리포트 생성 중",
          answer: "현재 성장 리포트가 생성 중입니다. 잠시 후 앱을 새로고침하면 확인하실 수 있습니다.",
          requires_human: false, llm_required: false };
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ── Layer 3: SOLUTION ─────────────────────────────────────────────────────────

async function trySolution(ctx: RouterContext): Promise<ResolutionResult | null> {
  const candidates = await queryKnowledge("SOLUTION", ctx);
  const eligible   = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  let bestRow: KnowledgeRow | null = null;
  let bestScore = 0;
  for (const row of eligible) {
    const s = scoreText(row, ctx.qLower, ctx.tokens);
    if (s > bestScore) { bestScore = s; bestRow = row; }
  }
  if (!bestRow || bestScore < HIGH_CONFIDENCE) return null;

  const conditions = bestRow.conditions as any;
  const needsDiag  = conditions?.needs_diagnostic === true;
  await logResolverEvent("SOLUTION_HIT", {
    source_id: bestRow.id, role: ctx.role, mode: ctx.mode,
    pool_id: ctx.poolId, category: bestRow.category, feature: bestRow.feature,
  });

  if (needsDiag) {
    const checks: string[] = Array.isArray(conditions?.diagnostic_checks)
      ? conditions.diagnostic_checks
      : ["증상을 자세히 확인하세요.", "앱을 재시작해 보세요."];
    return { resolution_status: "NEEDS_DIAGNOSTIC", source_type: "SOLUTION", source_id: bestRow.id,
      confidence: bestScore, title: bestRow.title, answer: bestRow.answer ?? bestRow.content,
      solution_steps: bestRow.solution_steps ?? null, screen_id: bestRow.frontend_screen_id ?? null,
      deep_link: bestRow.deep_link ?? null, requires_human: false, llm_required: false, diagnostic_checks: checks };
  }
  return { resolution_status: "RESOLVED", source_type: "SOLUTION", source_id: bestRow.id,
    confidence: bestScore, title: bestRow.title, answer: bestRow.answer ?? bestRow.content,
    solution_steps: bestRow.solution_steps ?? null, screen_id: bestRow.frontend_screen_id ?? null,
    deep_link: bestRow.deep_link ?? null, requires_human: false, llm_required: false };
}

// ── Layer 4: FRONTEND_MAP ─────────────────────────────────────────────────────

function fmPassesFilter(screen: FrontendScreen, role: string, mode: string): boolean {
  if (role && !screen.available_roles.includes(role as ScreenRole)) return false;
  if (mode && !screen.available_modes.includes(mode as ScreenMode)) return false;
  return true;
}

function fmScore(screen: FrontendScreen, qLower: string, tokens: string[]): number {
  if (screen.screen_name.toLowerCase().includes(qLower)) return 90;
  if (screen.support_keywords.some((k) => k.toLowerCase() === qLower)) return 85;
  if (screen.support_keywords.some((k) => k.toLowerCase().includes(qLower) || qLower.includes(k.toLowerCase()))) return 75;
  if (screen.related_features.some((f) => f.toLowerCase().includes(qLower) || qLower.includes(f.toLowerCase()))) return 65;
  const pt = tokenize(screen.purpose + " " + screen.screen_name);
  const ov = tokens.filter((t) => pt.includes(t)).length;
  if (tokens.length > 0 && ov / tokens.length >= 0.4) return 55;
  return 0;
}

function buildFmResult(screen: FrontendScreen, confidence: number): ResolutionResult {
  return {
    resolution_status: "RESOLVED", source_type: "FRONTEND_MAP",
    source_id: screen.screen_id, confidence,
    title: screen.screen_name, answer: screen.purpose,
    screen_id: screen.screen_id, deep_link: screen.deep_link ?? null,
    requires_human: false, llm_required: false,
  };
}

async function tryFrontendMap(ctx: RouterContext): Promise<ResolutionResult | null> {
  if (ctx.screenId) {
    const screen = SCREEN_BY_ID.get(ctx.screenId.toUpperCase());
    if (screen && fmPassesFilter(screen, ctx.role, ctx.mode)) {
      await logResolverEvent("FRONTEND_MAP_HIT", {
        source_id: screen.screen_id, role: ctx.role, mode: ctx.mode,
        pool_id: ctx.poolId, screen_id: screen.screen_id,
      });
      return buildFmResult(screen, 100);
    }
  }
  if (!ctx.qLower) return null;

  let best: FrontendScreen | null = null;
  let bestS = 0;
  for (const screen of FRONTEND_MAP_REGISTRY) {
    if (!fmPassesFilter(screen, ctx.role, ctx.mode)) continue;
    const s = fmScore(screen, ctx.qLower, ctx.tokens);
    if (s > bestS) { bestS = s; best = screen; }
  }
  if (best && bestS >= HIGH_CONFIDENCE) {
    // §4 routing quality rule: explanation-intent queries (알려줘/뭐야/설명/소개/대해)
    // must be answered by verified FAQ/Knowledge items, not by internal Frontend Map
    // purpose metadata. Screen-name-level exact matches (score ≥ 85) are safe to bypass.
    if (hasExplanationIntent(ctx.qLower) && bestS < 85) return null;

    await logResolverEvent("FRONTEND_MAP_HIT", {
      source_id: best.screen_id, role: ctx.role, mode: ctx.mode,
      pool_id: ctx.poolId, screen_id: best.screen_id,
    });
    return buildFmResult(best, bestS);
  }
  return null;
}

// ── Layer 5: FAQ / KNOWLEDGE ──────────────────────────────────────────────────

async function tryFaqKnowledge(ctx: RouterContext): Promise<ResolutionResult | null> {
  const candidates = await queryKnowledge(["FAQ", "KNOWLEDGE"], ctx);
  const eligible   = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
  );

  let best: KnowledgeRow | null = null;
  let bestS = 0;
  for (const row of eligible) {
    const s = scoreText(row, ctx.qLower, ctx.tokens);
    if (s > bestS) { bestS = s; best = row; }
  }
  if (!best || bestS < HIGH_CONFIDENCE) return null;

  const isFaq = best.item_type === "FAQ";
  await logResolverEvent(isFaq ? "FAQ_HIT" : "KNOWLEDGE_HIT", {
    source_id: best.id, role: ctx.role, mode: ctx.mode,
    pool_id: ctx.poolId, category: best.category, feature: best.feature,
    screen_id: best.frontend_screen_id,
  });
  return {
    resolution_status: "RESOLVED", source_type: isFaq ? "FAQ" : "KNOWLEDGE",
    source_id: best.id, confidence: bestS, title: best.title,
    answer: best.answer ?? best.content,
    screen_id: best.frontend_screen_id ?? null, deep_link: best.deep_link ?? null,
    requires_human: false, llm_required: false,
  };
}

// ── Layer 6: KNOWN_ISSUE ──────────────────────────────────────────────────────

async function tryKnownIssue(ctx: RouterContext): Promise<ResolutionResult | null> {
  const candidates = await queryKnowledge("KNOWN_ISSUE", ctx);
  const eligible   = candidates.filter(
    (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode) && r.incident_id
  );
  if (!eligible.length) return null;

  const incidentIds = [...new Set(eligible.map((r) => r.incident_id!))];
  const incRows = (await superAdminDb.execute(sql`
    SELECT id, title, severity, status, service, description, started_at::text
    FROM super_incidents
    WHERE status IN ('OPEN', 'INVESTIGATING', 'MITIGATED')
      AND id = ANY(${JSON.stringify(incidentIds)}::text[])
    ORDER BY started_at DESC LIMIT 10
  `)) as any;

  const activeInc: IncidentRow[] = incRows.rows ?? [];
  if (!activeInc.length) return null;

  const activeIds = new Set(activeInc.map((i) => i.id));
  const verified  = eligible.filter((r) => activeIds.has(r.incident_id!));
  if (!verified.length) return null;

  let best: KnowledgeRow | null = null;
  let bestS = 0;
  for (const row of verified) {
    const s = scoreText(row, ctx.qLower, ctx.tokens);
    const eff = s > 0 ? s : 45;
    if (eff > bestS) { bestS = eff; best = row; }
  }
  if (!best) return null;

  const inc = activeInc.find((i) => i.id === best!.incident_id);
  await logResolverEvent("KNOWN_ISSUE_HIT", {
    source_id: best.id, role: ctx.role, mode: ctx.mode,
    pool_id: ctx.poolId, category: best.category, feature: best.feature,
  });
  return {
    resolution_status: "RESOLVED", source_type: "KNOWN_ISSUE",
    source_id: best.id, confidence: Math.max(bestS, 45),
    title: inc ? `[알려진 문제] ${inc.title} (${inc.severity})` : best.title,
    answer: best.answer ?? best.content ?? (inc ? `${inc.description ?? ""} 복구 작업 중입니다.` : null),
    requires_human: false, llm_required: false,
  };
}

// ── Layer 7: NO_MATCH ─────────────────────────────────────────────────────────

async function buildNoMatch(ctx: RouterContext): Promise<ResolutionResult> {
  await logResolverEvent("NO_KNOWLEDGE_MATCH", {
    role: ctx.role, mode: ctx.mode, pool_id: ctx.poolId,
  });
  return {
    resolution_status: "NO_MATCH", source_type: "NONE", source_id: null,
    confidence: 0, title: null, answer: null,
    requires_human: true, llm_required: true,
  };
}

// ── Public: runResolutionChain ────────────────────────────────────────────────

export async function runResolutionChain(ctx: RouterContext): Promise<ResolutionResult> {
  return (
    (await tryRule(ctx)) ??
    (await tryDbState(ctx)) ??
    (await trySolution(ctx)) ??
    (await tryFrontendMap(ctx)) ??
    (await tryFaqKnowledge(ctx)) ??
    (await tryKnownIssue(ctx)) ??
    (await buildNoMatch(ctx))
  );
}

// ── Public: gatherEvidence (for LLM context) ─────────────────────────────────

/**
 * 쿼리와 관련된 상위 K개 knowledge 항목을 수집.
 * LLM 프롬프트 context 구성에 사용.
 * raw query 저장 금지 — evidence는 metadata만 포함.
 */
export async function gatherEvidence(
  ctx: RouterContext,
  maxItems = 5
): Promise<Array<{ id: string; item_type: string; title: string; answer: string; score: number }>> {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT id, item_type, title, content, question, answer,
             affected_role, affected_mode, affected_roles, affected_modes,
             scope, pool_id, status, usage_count,
             null::text AS deep_link, null::text AS frontend_screen_id,
             null::jsonb AS solution_steps, null::jsonb AS conditions,
             null::text AS incident_id,
             null::text AS category, null::text AS feature
      FROM support_knowledge_items
      WHERE status = 'active'
        AND item_type IN ('FAQ', 'KNOWLEDGE', 'RULE', 'SOLUTION')
        AND (scope = 'global' OR (scope = 'pool' AND pool_id = ${ctx.poolId}))
      ORDER BY usage_count DESC
      LIMIT 100
    `)) as any;

    const candidates: KnowledgeRow[] = rows.rows ?? [];
    const eligible = candidates.filter(
      (r) => roleMatches(r, ctx.role) && modeMatches(r, ctx.mode)
    );

    const scored = eligible
      .map((r) => ({ r, score: scoreText(r, ctx.qLower, ctx.tokens) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);

    const knowledgeEvidence = scored.map(({ r, score }) => ({
      id:        r.id,
      item_type: r.item_type,
      title:     r.title,
      answer:    r.answer ?? r.content,
      score,
    }));

    // ── Frontend Map static registry (독립 evidence source) ──────────────────
    // support_knowledge_items ACTIVE = 0 이어도 FM 레지스트리에서 evidence 수집.
    // role / mode 필터 필수 — parent에게 admin 화면 노출 금지.
    const fmEvidence: Array<{ id: string; item_type: string; title: string; answer: string; score: number }> = [];
    if (ctx.qLower) {
      for (const screen of FRONTEND_MAP_REGISTRY) {
        if (!fmPassesFilter(screen, ctx.role, ctx.mode)) continue;
        const score = fmScore(screen, ctx.qLower, ctx.tokens);
        if (score > 0) {
          fmEvidence.push({
            id:        `fm_${screen.screen_id}`,
            item_type: "FRONTEND_MAP",
            title:     screen.screen_name,
            answer:    screen.purpose +
              (screen.deep_link ? ` (화면 경로: ${screen.deep_link})` : ""),
            score,
          });
        }
      }
    }

    // Merge knowledge + FM evidence, sort by score descending, cap at maxItems
    return [...knowledgeEvidence, ...fmEvidence]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  } catch {
    return [];
  }
}
