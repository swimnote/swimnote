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
// 방식:
//   1차: query stemmed token 중 상위 3개로 ILIKE keyword prefilter → 최대 300건
//   2차: keyword 후보 < 30건이면 weight 상위 100건을 추가 보충
//   JS: 양방향 token overlap 점수 계산. 최고 점수 후보 반환.
//
// 이 전략은 utterance 수가 LIMIT 수를 초과해도 관련 utterance가 반드시
// 후보 집합에 포함되도록 보장한다. (기존 blind full-scan 대체)
//
// 조건: 최소 DIRECT_FUZZY_MIN_CONFIDENCE 이상만 반환 (false-positive 방지).
// AMBIGUOUS_DIRECT_MATCH = 0 보장:
//   - 복수 후보가 동점이면 null 반환 (명확한 단일 매치만 허용).

/** Max candidates from keyword-prefiltered query */
const FUZZY_KEYWORD_LIMIT = 300;
/** Supplement with top-weight rows when keyword candidates are sparse */
const FUZZY_FALLBACK_LIMIT = 100;
/** Threshold below which we supplement with fallback */
const FUZZY_SUPPLEMENT_THRESHOLD = 30;

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
  // 단일 meaningful stem 쿼리(예: "결제", "사진")는 너무 모호 → false-positive 방지
  if (meaningfulStems.length < 2) return null;

  // ── 1차: keyword prefilter (server-side, indexed ILIKE on normalized_utterance)
  // 상위 3개 스템으로 ILIKE 조건 구성 → 관련 utterance가 총 수 무관하게 검색됨
  const topStems = meaningfulStems.slice(0, 3);
  // SQL injection 방지: 스템은 이미 lowercase alphanumeric+한글만 포함
  // (stemKorean은 한글 어간, tokenize는 공백 분할 → 특수문자 없음)
  const likeClause = topStems
    .map(s => `u.normalized_utterance ILIKE '%${s.replace(/'/g, "''")}%'`)
    .join(" OR ");

  const keywordRows = (await superAdminDb.execute(sql.raw(`
    SELECT u.id AS utterance_id, u.intent_id, u.knowledge_id,
           u.utterance, u.normalized_utterance, u.weight
    FROM support_intent_utterances u
    WHERE u.status = 'active'
      AND (${likeClause})
    ORDER BY u.weight DESC
    LIMIT ${FUZZY_KEYWORD_LIMIT}
  `))) as any;

  const candidates: UtteranceRow[] = keywordRows.rows ?? [];

  // ── 2차: weight 기반 보충 (keyword 후보 부족 시)
  // 키워드와 무관한 짧은 utterance(일반 오류/FAQ)도 커버
  if (candidates.length < FUZZY_SUPPLEMENT_THRESHOLD) {
    const fallbackRows = (await superAdminDb.execute(sql`
      SELECT u.id AS utterance_id, u.intent_id, u.knowledge_id,
             u.utterance, u.normalized_utterance, u.weight
      FROM support_intent_utterances u
      WHERE u.status = 'active'
      ORDER BY u.weight DESC, u.created_at ASC
      LIMIT ${FUZZY_FALLBACK_LIMIT}
    `)) as any;
    const seenIds = new Set(candidates.map((c: UtteranceRow) => c.utterance_id));
    for (const row of (fallbackRows.rows ?? []) as UtteranceRow[]) {
      if (!seenIds.has(row.utterance_id)) {
        candidates.push(row);
        seenIds.add(row.utterance_id);
      }
    }
  }

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

      // GROUNDED_GPT or null answer_mode → fall to existing chain.
      // null = legacy KI not yet migrated to explicit DIRECT_DB → must not bypass GPT chain.
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
