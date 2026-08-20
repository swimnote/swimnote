/**
 * support-retriever.ts — RT2 SupportRetriever
 *
 * RT1 Runtime 기반 위에서 동작.
 * canonical support_knowledge_items를 자연어로 검색.
 *
 * 계층 순서:
 *   L0. 기존 exact utterance matcher (matchDirectAnswer) — 결과 최우선
 *   L1. Normalized keyword / token matching (개선된 stemming)
 *   L2. Product concept lexicon expansion
 *   L3. Canonical KI title/question ILIKE + JS ranking
 *   L4. Multi-factor scoring & ranking
 *   L5. AnswerPolicy (answer_mode 기반)
 *
 * 원칙:
 *   - active KI only (pending/archived/candidate 제외)
 *   - pool-scope 적용 (global OR pool match)
 *   - 전체 active KI 무조건 로드 금지
 *   - utterance miss 자체로 INSUFFICIENT_EVIDENCE 처리 금지
 *   - 동점 시 무조건 null 금지 (confidence 낮춤 + GROUNDED_AI 가능)
 *   - cross-pool KI 누출 금지
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

import type { RouterContext, KnowledgeRow } from "../support-resolver.js";
import {
  normalizeQuery,
  tokenize,
  stemKorean,
  roleMatches,
  modeMatches,
} from "../support-resolver.js";

import {
  detectConcepts,
  buildSearchKeywordsFromConcepts,
  tokenizeKorean,
  stripJosa,
  type SupportConcept,
} from "../runtime/support-lexicon.js";

import type { RetrievalMatch, RetrievalResult } from "../runtime/retrieval-result.js";
import { buildRetrievalResult } from "../runtime/retrieval-result.js";
import type { AnswerPolicyDecision } from "../runtime/answer-policy.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** DB 후보 최대 수 (ILIKE concept 검색) */
const CONCEPT_CANDIDATE_LIMIT = 80;
/** concept miss 시 fallback: 상위 usage_count rows */
const FALLBACK_CANDIDATE_LIMIT = 50;
/** JS ranking: 이 점수 이상만 최종 후보 */
const MIN_SCORE_THRESHOLD = 25;
/** HIGH confidence 기준 (DB_DIRECT 가능) */
const HIGH_SCORE = 80;
/** MEDIUM confidence 기준 (GROUNDED_AI 가능) */
const MEDIUM_SCORE = 55;

// ── KI DB row (retriever용) ────────────────────────────────────────────────────

interface KiRow {
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
  answer_mode: string | null;
  status: string;
  usage_count: number;
  deep_link: string | null;
}

// ── Result type ────────────────────────────────────────────────────────────────

export interface SupportRetrievalResult {
  retrieval: RetrievalResult;
  /** best match answer_mode (DIRECT_DB / GROUNDED_GPT / HUMAN_ONLY) */
  answer_mode: string | null;
  /** best match answer text (for DB_DIRECT path) */
  best_answer: string | null;
  /** best match title */
  best_title: string | null;
  /** best match deep_link */
  best_deep_link: string | null;
  /** policy decision */
  policy: AnswerPolicyDecision;
  /** KI rows for GROUNDED_AI (evidence pack input) */
  grounded_evidence: KiRow[];
  /** how many candidates were excluded due to status */
  excluded_by_status_count: number;
  /** matched concepts */
  concepts: SupportConcept[];
}

// ── Fetch candidates via ILIKE ────────────────────────────────────────────────

async function fetchByConceptKeywords(
  keywords: string[],
  poolId: string | null,
): Promise<{ rows: KiRow[]; excluded_count: number }> {
  if (keywords.length === 0) return { rows: [], excluded_count: 0 };

  // Build ILIKE conditions: title OR question matches any keyword
  // We fetch active only (status filter)
  // Use LIMIT to avoid full-scan
  const ilikeConditions = keywords
    .slice(0, 5) // top 5 keywords max
    .map(k => {
      const escaped = k.replace(/'/g, "''");
      return `(title ILIKE '%${escaped}%' OR question ILIKE '%${escaped}%' OR category ILIKE '%${escaped}%' OR feature ILIKE '%${escaped}%')`;
    })
    .join(" OR ");

  const poolClause = poolId
    ? `AND (scope = 'global' OR (scope = 'pool' AND pool_id = '${poolId.replace(/'/g, "''")}'))`
    : `AND scope = 'global'`;

  // active only
  const activeRows = (await superAdminDb.execute(sql.raw(`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, answer_mode,
           status, usage_count, deep_link
    FROM support_knowledge_items
    WHERE status = 'active'
      ${poolClause}
      AND (${ilikeConditions})
    ORDER BY usage_count DESC
    LIMIT ${CONCEPT_CANDIDATE_LIMIT}
  `))) as any;

  // Count excluded (non-active rows with same criteria, for diagnostics)
  const excludedRows = (await superAdminDb.execute(sql.raw(`
    SELECT COUNT(*) AS cnt
    FROM support_knowledge_items
    WHERE status != 'active'
      ${poolClause}
      AND (${ilikeConditions})
  `))) as any;
  const excluded_count = Number((excludedRows.rows ?? [])[0]?.cnt ?? 0);

  return { rows: (activeRows.rows ?? []) as KiRow[], excluded_count };
}

async function fetchFallbackKI(poolId: string | null): Promise<KiRow[]> {
  const poolClause = poolId
    ? `AND (scope = 'global' OR (scope = 'pool' AND pool_id = '${poolId.replace(/'/g, "''")}'))`
    : `AND scope = 'global'`;

  const rows = (await superAdminDb.execute(sql.raw(`
    SELECT id, item_type, scope, pool_id, category, feature,
           affected_role, affected_mode, affected_roles, affected_modes,
           title, content, question, answer, answer_mode,
           status, usage_count, deep_link
    FROM support_knowledge_items
    WHERE status = 'active'
      ${poolClause}
    ORDER BY usage_count DESC
    LIMIT ${FALLBACK_CANDIDATE_LIMIT}
  `))) as any;

  return (rows.rows ?? []) as KiRow[];
}

// ── Scoring ────────────────────────────────────────────────────────────────────

/**
 * KI row에 대해 query와의 유사도 점수를 계산.
 *
 * 가중치:
 *   exact concept match       = +40
 *   concept alias match       = +30
 *   title exact match         = +35
 *   question exact match      = +30
 *   title token overlap ≥80%  = +25
 *   title token overlap ≥50%  = +15
 *   content token overlap     = +10
 *   usage_count bonus (log)   = 0-5
 */
interface ScoredKI {
  row:     KiRow;
  score:   number;
  methods: string[];
}

function scoreKI(
  row: KiRow,
  qLower: string,
  tokens: string[],
  concepts: SupportConcept[],
  searchKeywords: string[],
): ScoredKI {
  let score = 0;
  const methods: string[] = [];

  const nTitle    = normalizeQuery(row.title);
  const nQuestion = row.question ? normalizeQuery(row.question) : null;
  const nContent  = normalizeQuery(row.content ?? "");
  const nCategory = row.category ? normalizeQuery(row.category) : null;
  const nFeature  = row.feature  ? normalizeQuery(row.feature)  : null;

  // ── Exact matches ──────────────────────────────────────────────────────────
  if (nQuestion && (nQuestion === qLower || nQuestion.includes(qLower))) {
    score += 35; methods.push("QUESTION_EXACT");
  }
  if (nTitle === qLower || nTitle.includes(qLower)) {
    score += 30; methods.push("TITLE_EXACT");
  }

  // ── Concept match ──────────────────────────────────────────────────────────
  // concept keyword가 title/category/feature에 있으면 MEDIUM confidence 기준(50) 충족 보장.
  // question에 있으면 MEDIUM 경계.
  for (const keyword of searchKeywords) {
    const nk = normalizeQuery(keyword);
    if (nTitle.includes(nk) || nCategory?.includes(nk) || nFeature?.includes(nk)) {
      score += 50; methods.push("CONCEPT_KEYWORD"); break;
    }
    if (nQuestion?.includes(nk)) {
      score += 45; methods.push("CONCEPT_QUESTION_KEYWORD"); break;
    }
  }

  // ── Token overlap ──────────────────────────────────────────────────────────
  const qStems = tokens.map(stemKorean);
  const titleTokens   = tokenize(row.title);
  const contentTokens = tokenize((row.content ?? "") + " " + (row.question ?? ""));
  const tStems = titleTokens.map(stemKorean);
  const cStems = contentTokens.map(stemKorean);

  if (qStems.length > 0) {
    const titleOverlap = qStems.filter(s => tStems.includes(s)).length;
    const bodyOverlap  = qStems.filter(s => cStems.includes(s) && !tStems.includes(s)).length;
    const tRatio = titleOverlap / qStems.length;
    const allRatio = (titleOverlap + bodyOverlap) / qStems.length;

    if (tRatio >= 0.8) {
      score += 25; methods.push("TITLE_TOKEN_HIGH");
    } else if (tRatio >= 0.5) {
      score += 15; methods.push("TITLE_TOKEN_MED");
    } else if (allRatio >= 0.5) {
      score += 10; methods.push("CONTENT_TOKEN");
    }
  }

  // ── Usage bonus ────────────────────────────────────────────────────────────
  const usageBonus = Math.min(5, Math.floor(Math.log2((row.usage_count ?? 0) + 1)));
  score += usageBonus;

  // ── Cap at 100 ────────────────────────────────────────────────────────────
  score = Math.min(100, score);

  return { row, score, methods };
}

// ── Role / mode filter ─────────────────────────────────────────────────────────

function kiRoleMatches(row: KiRow, role: string): boolean {
  const kr: KnowledgeRow = row as unknown as KnowledgeRow;
  return roleMatches(kr, role);
}

function kiModeMatches(row: KiRow, mode: string): boolean {
  const kr: KnowledgeRow = row as unknown as KnowledgeRow;
  return modeMatches(kr, mode);
}

// ── Policy mapping ─────────────────────────────────────────────────────────────

function mapAnswerPolicy(
  scored: ScoredKI[],
): AnswerPolicyDecision {
  if (scored.length === 0) return "INSUFFICIENT_EVIDENCE";

  const top = scored[0];
  const answerMode = top.row.answer_mode ?? "DIRECT_DB";

  if (answerMode === "HUMAN_ONLY") return "HUMAN_REQUIRED";
  if (answerMode === "GROUNDED_GPT") return "GROUNDED_AI";

  // DIRECT_DB
  if (top.score >= HIGH_SCORE) return "DB_DIRECT";

  // Multiple KIs or medium confidence → GROUNDED_AI
  if (scored.length > 1 || top.score >= MEDIUM_SCORE) return "GROUNDED_AI";

  return "INSUFFICIENT_EVIDENCE";
}

// ── Build RetrievalMatches from scored KIs ────────────────────────────────────

function buildMatches(
  scored: ScoredKI[],
  poolId: string | null,
): RetrievalMatch[] {
  return scored.slice(0, 5).map((s, idx): RetrievalMatch => ({
    source_id:    s.row.id,
    source_type:  "KNOWLEDGE_ITEM",
    text:         s.row.answer ?? s.row.content ?? "",
    score:        s.score,
    rank:         idx + 1,
    match_method: s.methods.includes("CONCEPT_KEYWORD") ? "KEYWORD" : "KEYWORD",
    tenant_id:    s.row.scope === "global" ? "global" : (s.row.pool_id ?? poolId ?? "global"),
  }));
}

// ── Main retriever ────────────────────────────────────────────────────────────

/**
 * SupportRetriever.retrieve()
 *
 * RouterContext를 받아 RT1 RetrievalResult + policy decision 반환.
 * L0 (exact utterance)는 기존 matchDirectAnswer가 처리하므로 여기서는 생략.
 * L1-L5 처리.
 */
export async function retrieveCanonicalKI(
  ctx: RouterContext,
): Promise<SupportRetrievalResult> {
  const qLower  = ctx.qLower;
  const tokens  = tokenizeKorean(qLower);  // 개선된 tokenizer
  const poolId  = ctx.poolId;
  const role    = ctx.role;
  const mode    = ctx.mode;

  // L2: Concept detection
  const concepts = detectConcepts(qLower);
  const searchKeywords = buildSearchKeywordsFromConcepts(concepts);

  let rows: KiRow[];
  let excluded_by_status_count = 0;

  if (searchKeywords.length > 0) {
    // L3: ILIKE concept-based candidate fetch
    const fetched = await fetchByConceptKeywords(searchKeywords, poolId);
    rows = fetched.rows;
    excluded_by_status_count = fetched.excluded_count;
  } else {
    // Concept miss → fallback: top-usage rows (LIMIT 50)
    rows = await fetchFallbackKI(poolId);
  }

  // Role/mode filter (server authoritative)
  const eligible = rows.filter(
    r => kiRoleMatches(r, role) && kiModeMatches(r, mode),
  );

  // L4: Score & rank
  const scored = eligible
    .map(r => scoreKI(r, qLower, tokens, concepts, searchKeywords))
    .filter(s => s.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.row.usage_count - a.row.usage_count);

  // Tie handling: if top 2 are same KI (shouldn't happen) or different KIs with equal score
  const top      = scored[0] ?? null;
  const second   = scored[1] ?? null;
  let finalScored = scored;

  if (
    top && second &&
    top.score === second.score &&
    top.row.id !== second.row.id
  ) {
    // 동점 + 다른 KI → score 낮춤 (GROUNDED_AI eligible)
    finalScored = scored.map((s, i) =>
      i === 0 ? { ...s, score: Math.max(s.score - 10, MIN_SCORE_THRESHOLD) } : s,
    );
  }

  // L5: Policy
  const policy = mapAnswerPolicy(finalScored);

  // Build RetrievalResult (RT1)
  const matches = buildMatches(finalScored, poolId);
  const retrieval = buildRetrievalResult({
    domain:         "SUPPORT",
    tenant_id:      poolId ?? "global",
    query:          qLower,
    matches,
    excluded_count: excluded_by_status_count,
    missing_reason: finalScored.length === 0 ? "NO_MATCH" : undefined,
  });

  return {
    retrieval,
    answer_mode:             top?.row.answer_mode ?? null,
    best_answer:             top ? (top.row.answer ?? top.row.content ?? null) : null,
    best_title:              top?.row.title ?? null,
    best_deep_link:          top?.row.deep_link ?? null,
    policy,
    grounded_evidence:       finalScored.slice(0, 5).map(s => s.row),
    excluded_by_status_count,
    concepts,
  };
}
