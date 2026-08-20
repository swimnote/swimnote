/**
 * support-retriever.ts — RT2 SupportRetriever (Relevance Correction 반영)
 *
 * RT1 Runtime 기반 위에서 동작.
 * canonical support_knowledge_items를 자연어로 검색.
 *
 * 계층 순서:
 *   L0. 기존 exact utterance matcher (matchDirectAnswer) — 결과 최우선
 *   L1. Normalized keyword / token matching (개선된 stemming)
 *   L2. Product concept lexicon expansion
 *   L3. Canonical KI title/question ILIKE + JS ranking
 *   L4. Multi-factor scoring (concept + intent match + platform + token overlap)
 *   L5. AnswerPolicy (answer_mode + intent consistency)
 *
 * 원칙:
 *   - active KI only (pending/archived/candidate 제외)
 *   - pool-scope 적용 (global OR pool match)
 *   - 전체 active KI 무조건 로드 금지
 *   - utterance miss 자체로 INSUFFICIENT_EVIDENCE 처리 금지
 *   - 동점 시 무조건 null 금지 (confidence 낮춤 + GROUNDED_AI 가능)
 *   - cross-pool KI 누출 금지
 *   - query intent ↔ KI intent 불일치 시 penalty
 *   - 플랫폼 미지정 query에 platform-specific KI top-1 금지
 *   - usage_count는 동점 보조만 (핵심 점수 아님)
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
/** HIGH confidence 기준 (DB_DIRECT 가능). intent match 필요. */
const HIGH_SCORE = 80;
/** MEDIUM confidence 기준 (GROUNDED_AI 가능) */
const MEDIUM_SCORE = 50;
/** GROUNDED_AI에 전달할 max evidence KI 수 */
const MAX_GROUNDED_EVIDENCE = 5;
/** GROUNDED_AI evidence 최소 score 기준 */
const GROUNDED_EVIDENCE_MIN_SCORE = 40;

// ── KI DB row ─────────────────────────────────────────────────────────────────

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

// ── Query Intent Features ─────────────────────────────────────────────────────

/**
 * 질문의 세부 의도.
 * 복수 intent 동시 가능 (예: HOW_TO + DISABLE).
 */
export type QueryIntent =
  | "DESCRIPTION"       // 기능/개념 설명 요청
  | "HOW_TO"            // 방법/위치 요청
  | "DISABLE"           // 끄기/해제 요청
  | "ERROR_TROUBLESHOOT"// 오류/안됨 트러블슈팅
  | "LIMIT_USAGE"       // 사용 횟수/한도 문의
  | "REQUIREMENT"       // 이용 조건/자격 문의
  | "NONE";             // 감지 불가

const INTENT_PATTERNS: { intent: QueryIntent; patterns: string[] }[] = [
  {
    intent: "DESCRIPTION",
    patterns: ["뭐야", "뭔지", "뭐예요", "뭔가요", "어떤기능", "어떤 기능", "설명", "소개", "무엇", "이란", "란 무엇", "가 뭐", "은 뭐", "이 뭐"],
  },
  {
    intent: "HOW_TO",
    patterns: ["어떻게", "어디서", "방법", "하는법", "하는 법", "하려면", "하면되나요", "하면 되나요", "하면돼", "사용법"],
  },
  {
    intent: "DISABLE",
    patterns: ["끄기", "끄는", "끄고", "끄려", "해제", "비활성", "차단", "끊기", "중지", "끄고싶"],
  },
  {
    intent: "ERROR_TROUBLESHOOT",
    patterns: ["안돼", "안 돼", "안됨", "안 됨", "오류", "오류가", "등록됐는데", "등록 됐는데", "작동안함", "안되는", "검색이안돼", "검색 안돼", "검색이 안돼", "안보여", "안 보여", "문제", "고장"],
  },
  {
    intent: "LIMIT_USAGE",
    patterns: ["몇번", "몇 번", "횟수", "한도", "월 몇회", "월 몇 회", "사용횟수", "사용 횟수", "몇회", "몇 회"],
  },
  {
    intent: "REQUIREMENT",
    patterns: ["조건", "필요한가요", "필요해요", "언제 가능", "자격", "기준은", "되려면", "되어야"],
  },
];

/**
 * 쿼리 텍스트에서 intent feature 집합 추출.
 * @param qLower - normalizeQuery() 처리 후 소문자 텍스트
 */
export function extractQueryIntents(qLower: string): QueryIntent[] {
  const intents: QueryIntent[] = [];
  const qNS = qLower.replace(/\s+/g, ""); // 공백 제거 버전도 병행

  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (qNS.includes(p.replace(/\s+/g, "")) || qLower.includes(p)) {
        intents.push(intent);
        break;
      }
    }
  }

  return intents.length > 0 ? intents : ["NONE"];
}

/**
 * KI 텍스트(title + question + content)에서 intent feature 집합 추출.
 */
export function extractKIIntents(row: KiRow): QueryIntent[] {
  const combined = [
    row.title ?? "",
    row.question ?? "",
    (row.content ?? "").substring(0, 200), // content는 앞부분만
  ].join(" ").toLowerCase();

  const intents: QueryIntent[] = [];
  const combinedNS = combined.replace(/\s+/g, "");

  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (combinedNS.includes(p.replace(/\s+/g, "")) || combined.includes(p)) {
        intents.push(intent);
        break;
      }
    }
  }

  return intents.length > 0 ? intents : ["NONE"];
}

// ── Platform Detection ─────────────────────────────────────────────────────────

const PLATFORM_QUERY_HINTS = ["android", "안드로이드", "iphone", "아이폰", "ios", "갤럭시", "galaxy"];
const PLATFORM_KI_MARKERS  = ["android", "iphone", "ios", "안드로이드", "아이폰"];

/**
 * query에 플랫폼 힌트가 있는지 확인.
 */
function queryHasPlatformHint(qLower: string): boolean {
  const qNS = qLower.replace(/\s+/g, "");
  return PLATFORM_QUERY_HINTS.some(h => qNS.includes(h.replace(/\s+/g, "")) || qLower.includes(h));
}

/**
 * KI가 platform-specific한지 확인 (title/question 기준).
 * e.g. "Android 알림 권한 설정" → true
 */
function kiIsPlatformSpecific(row: KiRow): boolean {
  const text = ((row.title ?? "") + " " + (row.question ?? "")).toLowerCase();
  return PLATFORM_KI_MARKERS.some(m => text.startsWith(m) || text.includes(` ${m}`) || text.includes(`${m} `));
}

// ── Intent Scoring ────────────────────────────────────────────────────────────

/**
 * query intent ↔ KI intent 비교 후 boost/penalty 반환.
 *
 * 규칙:
 *   - query=DESCRIPTION, KI=DESCRIPTION  → +20 (DESCRIPTION_MATCH)
 *   - query=DESCRIPTION, KI=REQUIREMENT  → -25 (INTENT_MISMATCH)
 *   - query=DESCRIPTION, KI=LIMIT_USAGE  → -25 (INTENT_MISMATCH)
 *   - query=ERROR_TROUBLESHOOT, KI=LIMIT_USAGE → -25 (INTENT_MISMATCH)
 *   - query=ERROR_TROUBLESHOOT, KI=ERROR_TROUBLESHOOT → +20
 *   - query=HOW_TO|DISABLE, KI=HOW_TO|DISABLE → +15
 *   - query=LIMIT_USAGE, KI=LIMIT_USAGE → +20
 *   - query=REQUIREMENT, KI=REQUIREMENT → +20
 *   - 교차 mismatch (DESCRIPTION ↔ LIMIT_USAGE, ERROR ↔ LIMIT_USAGE 등) → -25
 */
const CONFLICTING_PAIRS: [QueryIntent, QueryIntent][] = [
  ["DESCRIPTION",        "REQUIREMENT"],
  ["DESCRIPTION",        "LIMIT_USAGE"],
  ["ERROR_TROUBLESHOOT", "LIMIT_USAGE"],
  ["ERROR_TROUBLESHOOT", "REQUIREMENT"],
  ["DESCRIPTION",        "ERROR_TROUBLESHOOT"], // 기능 설명 ≠ 트러블슈팅
  ["DISABLE",            "LIMIT_USAGE"],
  ["DISABLE",            "REQUIREMENT"],
];

function intentScore(queryIntents: QueryIntent[], kiIntents: QueryIntent[]): { delta: number; tags: string[] } {
  const tags: string[] = [];
  let delta = 0;

  // NONE-on-either → neutral
  if (queryIntents[0] === "NONE" || kiIntents[0] === "NONE") return { delta: 0, tags };

  // Match boost: any shared intent
  const shared = queryIntents.filter(qi => kiIntents.includes(qi));
  if (shared.length > 0) {
    delta += 20;
    tags.push(`INTENT_MATCH(${shared.join(",")})`);
    return { delta, tags }; // match found — no conflict check
  }

  // Conflict penalty: any conflicting pair
  for (const [qi, ki] of CONFLICTING_PAIRS) {
    if (
      (queryIntents.includes(qi) && kiIntents.includes(ki)) ||
      (queryIntents.includes(ki) && kiIntents.includes(qi))
    ) {
      delta -= 25;
      tags.push(`INTENT_MISMATCH(${qi}↔${ki})`);
      break; // one penalty per KI
    }
  }

  return { delta, tags };
}

// ── Fetch candidates ──────────────────────────────────────────────────────────

async function fetchByConceptKeywords(
  keywords: string[],
  poolId: string | null,
): Promise<{ rows: KiRow[]; excluded_count: number }> {
  if (keywords.length === 0) return { rows: [], excluded_count: 0 };

  const ilikeConditions = keywords
    .slice(0, 5)
    .map(k => {
      const e = k.replace(/'/g, "''");
      return `(title ILIKE '%${e}%' OR question ILIKE '%${e}%' OR category ILIKE '%${e}%' OR feature ILIKE '%${e}%')`;
    })
    .join(" OR ");

  const poolClause = poolId
    ? `AND (scope = 'global' OR (scope = 'pool' AND pool_id = '${poolId.replace(/'/g, "''")}'))`
    : `AND scope = 'global'`;

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

interface ScoredKI {
  row:          KiRow;
  score:        number;
  methods:      string[];
  queryIntents: QueryIntent[];
  kiIntents:    QueryIntent[];
}

/**
 * KI row와 query의 종합 유사도 점수 계산.
 *
 * 점수 구성:
 *   concept keyword title/category/feature match  = +50
 *   concept keyword question match                = +45
 *   title exact match                             = +30
 *   question exact match                          = +35
 *   title token overlap ≥80%                      = +25
 *   title token overlap ≥50%                      = +15
 *   content token overlap ≥50%                    = +10
 *   intent MATCH                                  = +20
 *   intent MISMATCH (conflicting pair)             = -25
 *   platform-specific KI, query no platform hint  = -20
 *   usage_count log bonus (동점 보조)              = 0~2 (상한 낮춤)
 */
function scoreKI(
  row: KiRow,
  qLower: string,
  tokens: string[],
  searchKeywords: string[],
  queryIntents: QueryIntent[],
  hasPlatformHint: boolean,
): ScoredKI {
  let score = 0;
  const methods: string[] = [];

  const nTitle    = normalizeQuery(row.title);
  const nQuestion = row.question ? normalizeQuery(row.question) : null;
  const nCategory = row.category ? normalizeQuery(row.category) : null;
  const nFeature  = row.feature  ? normalizeQuery(row.feature)  : null;

  // ── Concept keyword match ─────────────────────────────────────────────────
  for (const keyword of searchKeywords) {
    const nk = normalizeQuery(keyword);
    if (nTitle.includes(nk) || nCategory?.includes(nk) || nFeature?.includes(nk)) {
      score += 50; methods.push("CONCEPT_KW"); break;
    }
    if (nQuestion?.includes(nk)) {
      score += 45; methods.push("CONCEPT_QKW"); break;
    }
  }

  // ── Exact matches ──────────────────────────────────────────────────────────
  if (nQuestion && (nQuestion === qLower || nQuestion.includes(qLower))) {
    score += 35; methods.push("Q_EXACT");
  }
  if (nTitle === qLower || nTitle.includes(qLower)) {
    score += 30; methods.push("T_EXACT");
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
    const tRatio   = titleOverlap / qStems.length;
    const allRatio = (titleOverlap + bodyOverlap) / qStems.length;

    if (tRatio >= 0.8) {
      score += 25; methods.push("T_TOKEN_HIGH");
    } else if (tRatio >= 0.5) {
      score += 15; methods.push("T_TOKEN_MED");
    } else if (allRatio >= 0.5) {
      score += 10; methods.push("C_TOKEN");
    }
  }

  // ── Intent match / mismatch ───────────────────────────────────────────────
  const kiIntents = extractKIIntents(row);
  const { delta: intentDelta, tags: intentTags } = intentScore(queryIntents, kiIntents);
  score += intentDelta;
  methods.push(...intentTags);

  // ── Platform-specific penalty ─────────────────────────────────────────────
  // query에 플랫폼 힌트가 없으면 platform-specific KI를 generic KI보다 우선 금지.
  if (!hasPlatformHint && kiIsPlatformSpecific(row)) {
    score -= 20;
    methods.push("PLATFORM_PENALTY");
  }

  // ── Usage bonus (동점 보조만) ───────────────────────────────────────────────
  // 상한 2점으로 낮춤 — relevance 핵심 점수 아님
  const usageBonus = Math.min(2, Math.floor(Math.log2((row.usage_count ?? 0) + 1)));
  score += usageBonus;

  // ── Cap ────────────────────────────────────────────────────────────────────
  score = Math.min(100, score);

  return { row, score, methods, queryIntents, kiIntents };
}

// ── Role / mode filter ─────────────────────────────────────────────────────────

function kiRoleMatches(row: KiRow, role: string): boolean {
  return roleMatches(row as unknown as KnowledgeRow, role);
}

function kiModeMatches(row: KiRow, mode: string): boolean {
  return modeMatches(row as unknown as KnowledgeRow, mode);
}

// ── Policy mapping ─────────────────────────────────────────────────────────────

/**
 * DB_DIRECT 조건:
 *   - score ≥ HIGH_SCORE
 *   - AND: intent conflict 없음 (methods에 INTENT_MISMATCH 없어야 함)
 *   - AND: platform penalty 없음 (methods에 PLATFORM_PENALTY 없어야 함)
 *
 * GROUNDED_AI: score ≥ MEDIUM_SCORE 또는 복수 KI
 * HUMAN_REQUIRED: answer_mode = HUMAN_ONLY
 * INSUFFICIENT_EVIDENCE: 후보 없음
 */
function mapAnswerPolicy(scored: ScoredKI[]): AnswerPolicyDecision {
  if (scored.length === 0) return "INSUFFICIENT_EVIDENCE";

  const top = scored[0];
  const answerMode = top.row.answer_mode ?? "DIRECT_DB";

  if (answerMode === "HUMAN_ONLY") return "HUMAN_REQUIRED";
  if (answerMode === "GROUNDED_GPT") return "GROUNDED_AI";

  // DB_DIRECT: 높은 점수 + intent 일관성 + 플랫폼 호환
  const hasConflict   = top.methods.some(m => m.startsWith("INTENT_MISMATCH"));
  const hasPlatformPenalty = top.methods.includes("PLATFORM_PENALTY");

  if (top.score >= HIGH_SCORE && !hasConflict && !hasPlatformPenalty) {
    return "DB_DIRECT";
  }

  // GROUNDED_AI: medium confidence 이상 또는 복수 KI
  if (scored.length > 1 || top.score >= MEDIUM_SCORE) return "GROUNDED_AI";

  return "INSUFFICIENT_EVIDENCE";
}

// ── Build RetrievalMatches ────────────────────────────────────────────────────

function buildMatches(scored: ScoredKI[], poolId: string | null): RetrievalMatch[] {
  return scored.slice(0, MAX_GROUNDED_EVIDENCE).map((s, idx): RetrievalMatch => ({
    source_id:    s.row.id,
    source_type:  "KNOWLEDGE_ITEM",
    text:         s.row.answer ?? s.row.content ?? "",
    score:        s.score,
    rank:         idx + 1,
    match_method: "KEYWORD",
    tenant_id:    s.row.scope === "global" ? "global" : (s.row.pool_id ?? poolId ?? "global"),
  }));
}

// ── Result type ────────────────────────────────────────────────────────────────

export interface SupportRetrievalResult {
  retrieval:               RetrievalResult;
  answer_mode:             string | null;
  best_answer:             string | null;
  best_title:              string | null;
  best_deep_link:          string | null;
  policy:                  AnswerPolicyDecision;
  /** top-N relevant KI rows (score ≥ GROUNDED_EVIDENCE_MIN_SCORE) for GROUNDED_AI */
  grounded_evidence:       KiRow[];
  excluded_by_status_count: number;
  concepts:                SupportConcept[];
  query_intents:           QueryIntent[];
}

// ── Main retriever ────────────────────────────────────────────────────────────

/**
 * retrieveCanonicalKI()
 *
 * RouterContext를 받아 RT1 RetrievalResult + policy decision 반환.
 * L0 (exact utterance)는 기존 matchDirectAnswer가 처리.
 * L1-L5: concept → ILIKE candidate → intent-aware scoring → policy.
 */
export async function retrieveCanonicalKI(
  ctx: RouterContext,
): Promise<SupportRetrievalResult> {
  const qLower  = ctx.qLower;
  const tokens  = tokenizeKorean(qLower);
  const poolId  = ctx.poolId;
  const role    = ctx.role;
  const mode    = ctx.mode;

  // L2: Concept + intent detection
  const concepts       = detectConcepts(qLower);
  const searchKeywords = buildSearchKeywordsFromConcepts(concepts);
  const queryIntents   = extractQueryIntents(qLower);
  const hasPlatformHint = queryHasPlatformHint(qLower);

  let rows: KiRow[];
  let excluded_by_status_count = 0;

  if (searchKeywords.length > 0) {
    const fetched = await fetchByConceptKeywords(searchKeywords, poolId);
    rows = fetched.rows;
    excluded_by_status_count = fetched.excluded_count;
  } else {
    rows = await fetchFallbackKI(poolId);
  }

  // Role/mode filter
  const eligible = rows.filter(r => kiRoleMatches(r, role) && kiModeMatches(r, mode));

  // L4: Score & rank (intent-aware, platform-aware)
  const scored = eligible
    .map(r => scoreKI(r, qLower, tokens, searchKeywords, queryIntents, hasPlatformHint))
    .filter(s => s.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.row.usage_count - a.row.usage_count);

  // Tie handling: 동점 + 다른 KI → confidence 낮춤 (GROUNDED_AI eligible), re-sort
  if (
    scored.length >= 2 &&
    scored[0].score === scored[1].score &&
    scored[0].row.id !== scored[1].row.id
  ) {
    scored[0] = { ...scored[0], score: Math.max(scored[0].score - 10, MIN_SCORE_THRESHOLD) };
    // re-sort after tie adjustment
    scored.sort((a, b) => b.score - a.score || b.row.usage_count - a.row.usage_count);
  }

  // L5: Policy
  const policy = mapAnswerPolicy(scored);

  // GROUNDED_AI evidence: top-N above threshold (multi-evidence)
  const groundedEvidence = scored
    .filter(s => s.score >= GROUNDED_EVIDENCE_MIN_SCORE)
    .slice(0, MAX_GROUNDED_EVIDENCE)
    .map(s => s.row);

  // Build RT1 RetrievalResult
  const matches   = buildMatches(scored, poolId);
  const retrieval = buildRetrievalResult({
    domain:         "SUPPORT",
    tenant_id:      poolId ?? "global",
    query:          qLower,
    matches,
    excluded_count: excluded_by_status_count,
    missing_reason: scored.length === 0 ? "NO_MATCH" : undefined,
  });

  const top = scored[0] ?? null;

  return {
    retrieval,
    answer_mode:              top?.row.answer_mode ?? null,
    best_answer:              top ? (top.row.answer ?? top.row.content ?? null) : null,
    best_title:               top?.row.title ?? null,
    best_deep_link:           top?.row.deep_link ?? null,
    policy,
    grounded_evidence:        groundedEvidence,
    excluded_by_status_count,
    concepts,
    query_intents:            queryIntents,
  };
}
