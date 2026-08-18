/**
 * support-direct-answer.ts — WP-CS23A Direct DB Answer Engine
 *
 * matchDirectAnswer(ctx) — Layer 0 for runResolutionChain
 *
 * Flow:
 *   1. Exact normalized match → support_intent_utterances
 *   2. Token-overlap fuzzy match (pg_trgm 미지원 → JS-side LIKE+scoring)
 *   3. confidence < DIRECT_MIN_CONFIDENCE → null (fall to existing chain)
 *
 * Security:
 *   - roleMatches / modeMatches 반드시 통과 후 답변
 *   - pool scope 적용 (global or pool 일치)
 *   - client role/mode/pool 신뢰 금지 (RouterContext는 server-authoritative)
 *
 * HUMAN_ONLY:
 *   - Direct Match 성공해도 GPT 없이 CTA 안내 반환 (requires_human=true, llm_required=false)
 *   - "고객지원으로 문의해 주세요" 같은 자기 참조 fallback 금지
 *
 * GROUNDED_GPT / null answer_mode:
 *   - Direct Matcher에서 최종 답변 반환 금지 → null 반환 → 기존 chain으로 낙하
 *
 * pg_trgm: Production에서 미지원 → exact + LIKE-token fallback 사용
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  HIGH_CONFIDENCE,
  roleMatches,
  modeMatches,
  normalizeQuery,
  tokenize,
  stemKorean,
  type RouterContext,
  type ResolutionResult,
  type KnowledgeRow,
} from "./support-resolver.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Exact utterance match confidence */
export const DIRECT_EXACT_CONFIDENCE = 90;

/** Fuzzy match minimum confidence (must be ≥ HIGH_CONFIDENCE=60 to avoid false positives) */
export const DIRECT_FUZZY_MIN_CONFIDENCE = 65;

/** HUMAN_ONLY answer: shown to user as CTA */
const HUMAN_ONLY_ANSWER = "이 문의는 담당자 확인이 필요합니다.\n\n아래 [직접 문의하기] 버튼을 통해 담당자에게 문의해 주세요.";

// ── Utterance row from DB ─────────────────────────────────────────────────────

interface UtteranceRow {
  utterance_id: string;
  intent_id: string | null;
  knowledge_id: string;
  utterance: string;
  normalized_utterance: string;
  weight: number;
}

// ── Step 1: Exact normalized match ───────────────────────────────────────────

async function findExact(
  normalizedQuery: string,
  poolId: string | null
): Promise<UtteranceRow | null> {
  const rows = (await superAdminDb.execute(sql`
    SELECT u.id AS utterance_id, u.intent_id, u.knowledge_id,
           u.utterance, u.normalized_utterance, u.weight
    FROM support_intent_utterances u
    WHERE u.normalized_utterance = ${normalizedQuery}
      AND u.status = 'active'
    ORDER BY u.weight DESC, u.created_at ASC
    LIMIT 5
  `)) as any;
  return (rows.rows ?? [])[0] ?? null;
}

// ── Step 2: Token-overlap fuzzy match (pg_trgm 대체) ─────────────────────────
//
// 방식: query의 stemmed token을 모두 포함하는 utterance 후보를 ILIKE로 1차 필터 후
//       JS에서 token overlap 점수 계산. 최고 점수 후보를 반환.
//
// 조건: 최소 DIRECT_FUZZY_MIN_CONFIDENCE 이상만 반환 (false-positive 방지).
// AMBIGUOUS_DIRECT_MATCH = 0 보장:
//   - 복수 후보가 동점이면 null 반환 (명확한 단일 매치만 허용).

async function findFuzzy(
  qLower: string,
  tokens: string[],
  poolId: string | null
): Promise<{ row: UtteranceRow; confidence: number } | null> {
  if (tokens.length === 0) return null;

  const qStems = tokens.map(stemKorean);
  // 최소 토큰 길이 2자 이상만 쿼리에 사용 (단자 토큰은 false-positive 유발)
  const meaningfulStems = qStems.filter(s => s.length >= 2);
  if (meaningfulStems.length === 0) return null;

  // ILIKE로 의미있는 스템 중 하나라도 포함하는 utterance 후보 수집
  // 성능: active utterance는 수천 건 이하 → full-scan 허용
  const rows = (await superAdminDb.execute(sql`
    SELECT u.id AS utterance_id, u.intent_id, u.knowledge_id,
           u.utterance, u.normalized_utterance, u.weight
    FROM support_intent_utterances u
    WHERE u.status = 'active'
    LIMIT 500
  `)) as any;

  const candidates: UtteranceRow[] = rows.rows ?? [];
  if (!candidates.length) return null;

  // JS scoring: stemmed token overlap ratio
  interface Scored { row: UtteranceRow; score: number }
  const scored: Scored[] = [];

  for (const c of candidates) {
    const cNorm      = normalizeQuery(c.normalized_utterance);
    const cTokens    = tokenize(cNorm);
    const cStems     = cTokens.map(stemKorean);

    // Overlap: how many of qStems are in cStems (and vice versa for symmetry)
    const qInC = qStems.filter(s => cStems.includes(s)).length;
    const cInQ = cStems.filter(s => qStems.includes(s)).length;

    // Bi-directional overlap: prevents short utterances from over-matching long queries
    const qRatio = qStems.length > 0 ? qInC / qStems.length : 0;
    const cRatio = cStems.length > 0 ? cInQ / cStems.length : 0;
    const overlap = Math.min(qRatio, cRatio); // conservative: both directions must match

    if (overlap < 0.7) continue; // strict threshold — prevents "사진" matching everything

    // Score: 60 base × overlap + weight bonus
    const score = Math.round(60 * overlap + 5 * (overlap >= 1 ? 1 : 0));
    if (score >= DIRECT_FUZZY_MIN_CONFIDENCE) {
      scored.push({ row: c, score });
    }
  }

  if (!scored.length) return null;

  // Sort by score DESC, then weight DESC
  scored.sort((a, b) => b.score - a.score || b.row.weight - a.row.weight);

  // AMBIGUOUS check: top two different knowledge_ids with same score → reject
  if (
    scored.length >= 2 &&
    scored[0].score === scored[1].score &&
    scored[0].row.knowledge_id !== scored[1].row.knowledge_id
  ) {
    return null; // ambiguous — do not pick arbitrarily
  }

  return { row: scored[0].row, confidence: scored[0].score };
}

// ── Knowledge item fetch + security enforcement ───────────────────────────────

async function fetchKnowledge(
  knowledgeId: string,
  ctx: RouterContext
): Promise<KnowledgeRow | null> {
  const rows = (await superAdminDb.execute(sql`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, deep_link,
           frontend_screen_id, solution_steps, conditions, incident_id,
           status, usage_count, intent_id, answer_mode
    FROM support_knowledge_items
    WHERE id = ${knowledgeId}
      AND status = 'active'
      AND (scope = 'global' OR (scope = 'pool' AND pool_id = ${ctx.poolId}))
    LIMIT 1
  `)) as any;

  const row = (rows.rows ?? [])[0];
  if (!row) return null;

  // Server-authoritative role/mode enforcement
  if (!roleMatches(row as KnowledgeRow, ctx.role)) return null;
  if (!modeMatches(row as KnowledgeRow, ctx.mode)) return null;

  return row as KnowledgeRow;
}

// ── Build ResolutionResult ────────────────────────────────────────────────────

function buildDirectResult(
  row: KnowledgeRow,
  utterance: UtteranceRow,
  confidence: number,
  matchMethod: "EXACT" | "FUZZY"
): ResolutionResult {
  const answerMode: string = (row as any).answer_mode ?? "DIRECT_DB";
  const intentId:   string = (row as any).intent_id  ?? utterance.intent_id ?? "UNKNOWN";

  // HUMAN_ONLY: return CTA without leaking policy/price creativity
  if (answerMode === "HUMAN_ONLY") {
    return {
      resolution_status: "RESOLVED",
      source_type:       "DIRECT_DB",
      source_id:         row.id,
      confidence,
      title:             row.title,
      answer:            HUMAN_ONLY_ANSWER,
      solution_steps:    null,
      screen_id:         null,
      deep_link:         null,
      requires_human:    true,
      llm_required:      false,
      feature:           row.feature ?? null,
      category:          row.category ?? null,
      entity_key:        (row as any).intent_id ?? row.id,
      // CS23A trace metadata (stored in resolution_context, not on HTTP response directly)
      ...(({ intent_id: intentId, match_method: matchMethod, match_confidence: confidence }) as any),
    };
  }

  // GROUNDED_GPT / null → should not reach here (filtered in matchDirectAnswer)
  // DIRECT_DB → canonical answer
  return {
    resolution_status: "RESOLVED",
    source_type:       "DIRECT_DB",
    source_id:         row.id,
    confidence,
    title:             row.title,
    answer:            row.answer ?? row.content,
    solution_steps:    row.solution_steps ?? null,
    screen_id:         row.frontend_screen_id ?? null,
    deep_link:         row.deep_link ?? null,
    requires_human:    false,
    llm_required:      false,
    feature:           row.feature ?? null,
    category:          row.category ?? null,
    entity_key:        (row as any).intent_id ?? row.id,
  };
}

// ── Public: matchDirectAnswer ─────────────────────────────────────────────────

/**
 * Layer 0: Direct DB Answer Matcher
 *
 * @returns ResolutionResult if high-confidence match found, null to fall through.
 */
export async function matchDirectAnswer(
  ctx: RouterContext
): Promise<ResolutionResult | null> {
  try {
    const normalizedQuery = ctx.qLower; // already normalizeQuery'd in support-respond

    // ── Step 1: Exact match ──────────────────────────────────────────────────
    const exactRow = await findExact(normalizedQuery, ctx.poolId);
    if (exactRow) {
      const knowledge = await fetchKnowledge(exactRow.knowledge_id, ctx);
      if (!knowledge) return null; // role/mode/pool mismatch

      // GROUNDED_GPT or null answer_mode → fall to existing chain
      const answerMode: string | null = (knowledge as any).answer_mode ?? null;
      if (answerMode === "GROUNDED_GPT" || answerMode === null) return null;

      return buildDirectResult(knowledge, exactRow, DIRECT_EXACT_CONFIDENCE, "EXACT");
    }

    // ── Step 2: Fuzzy token-overlap match ────────────────────────────────────
    const fuzzyResult = await findFuzzy(normalizedQuery, ctx.tokens, ctx.poolId);
    if (!fuzzyResult) return null;

    const knowledge = await fetchKnowledge(fuzzyResult.row.knowledge_id, ctx);
    if (!knowledge) return null;

    const answerMode: string | null = (knowledge as any).answer_mode ?? null;
    if (answerMode === "GROUNDED_GPT" || answerMode === null) return null;

    return buildDirectResult(knowledge, fuzzyResult.row, fuzzyResult.confidence, "FUZZY");
  } catch (err) {
    // Non-fatal: any error → fall to existing chain
    console.error("[support-direct-answer] matchDirectAnswer error:", (err as Error).message);
    return null;
  }
}
