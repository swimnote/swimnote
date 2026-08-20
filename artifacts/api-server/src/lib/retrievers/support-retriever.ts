/**
 * support-retriever.ts — RT2 SupportRetriever (Semantic Slot Correction 반영)
 *
 * 계층 순서:
 *   L0. 기존 exact utterance matcher (matchDirectAnswer) — 결과 최우선
 *   L1-L5. concept → ILIKE candidate → semantic-slot-aware scoring → policy
 *
 * Scoring 우선순위 (§6):
 *   1. concept match
 *   2. object match / mismatch
 *   3. action match / opposite-action penalty
 *   4. intent match / mismatch
 *   5. title/question lexical overlap
 *   6. content overlap
 *   7. usage_count (tiebreak only, +2 max)
 *
 * 원칙:
 *   - active KI only / pool-scope / 전체 KI 무조건 로드 금지
 *   - utterance miss → INSUFFICIENT_EVIDENCE 처리 금지
 *   - 동점 시 null 금지 (confidence 낮춤 + re-sort)
 *   - opposite action (ENABLE↔DISABLE 등) → DB_DIRECT 금지, 강한 penalty
 *   - object mismatch (MATERIAL_SUBMISSION ≠ APP_INSTALL 등) → penalty
 *   - generic-settings query에 ERROR_TROUBLESHOOT KI → penalty
 *   - semantic slot mismatch KI → grounded_evidence 제외
 *   - usage_count는 tiebreak 보조만
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

const CONCEPT_CANDIDATE_LIMIT    = 80;
const FALLBACK_CANDIDATE_LIMIT   = 50;
const MIN_SCORE_THRESHOLD        = 25;
const HIGH_SCORE                 = 80;   // DB_DIRECT 기준
const MEDIUM_SCORE               = 50;   // GROUNDED_AI 기준
const MAX_GROUNDED_EVIDENCE      = 5;
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

export type QueryIntent =
  | "DESCRIPTION" | "HOW_TO" | "DISABLE" | "ERROR_TROUBLESHOOT"
  | "LIMIT_USAGE" | "REQUIREMENT" | "NONE";

const INTENT_PATTERNS: { intent: QueryIntent; patterns: string[] }[] = [
  { intent: "DESCRIPTION",        patterns: ["뭐야","뭔지","뭐예요","뭔가요","어떤기능","어떤 기능","설명","소개","무엇","이란","란 무엇","가 뭐","은 뭐","이 뭐"] },
  { intent: "HOW_TO",             patterns: ["어떻게","어디서","방법","하는법","하는 법","하려면","하면되나요","하면 되나요","하면돼","사용법"] },
  { intent: "DISABLE",            patterns: ["끄기","끄는","끄고","끄려","해제","비활성","차단","끊기","중지","끄고싶"] },
  { intent: "ERROR_TROUBLESHOOT", patterns: ["안돼","안 돼","안됨","안 됨","오류","오류가","등록됐는데","등록 됐는데","작동안함","안되는","검색이안돼","검색 안돼","검색이 안돼","안보여","안 보여","문제","고장","안와요","안와","안 와","실패"] },
  { intent: "LIMIT_USAGE",        patterns: ["몇번","몇 번","횟수","한도","월 몇회","월 몇 회","사용횟수","사용 횟수","몇회","몇 회"] },
  { intent: "REQUIREMENT",        patterns: ["조건","필요한가요","필요해요","언제 가능","자격","기준은","되려면","되어야"] },
];

export function extractQueryIntents(qLower: string): QueryIntent[] {
  const intents: QueryIntent[] = [];
  const qNS = qLower.replace(/\s+/g, "");
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (qNS.includes(p.replace(/\s+/g, "")) || qLower.includes(p)) { intents.push(intent); break; }
    }
  }
  return intents.length > 0 ? intents : ["NONE"];
}

export function extractKIIntents(row: KiRow): QueryIntent[] {
  const combined = [row.title ?? "", row.question ?? "", (row.content ?? "").substring(0, 200)].join(" ").toLowerCase();
  const intents: QueryIntent[] = [];
  const combinedNS = combined.replace(/\s+/g, "");
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (combinedNS.includes(p.replace(/\s+/g, "")) || combined.includes(p)) { intents.push(intent); break; }
    }
  }
  return intents.length > 0 ? intents : ["NONE"];
}

// ── Semantic ACTION ───────────────────────────────────────────────────────────

export type SemanticAction =
  | "ENABLE" | "DISABLE" | "SUBMIT" | "VIEW" | "SEARCH" | "REGISTER"
  | "DELETE" | "CREATE" | "LOGIN" | "PAY" | "DOWNLOAD" | "UPLOAD"
  | "EDIT" | "UNKNOWN";

const ACTION_PATTERNS: { action: SemanticAction; patterns: string[] }[] = [
  // ENABLE / DISABLE 먼저 (DISABLE → ENABLE 혼동 방지)
  { action: "DISABLE",  patterns: ["끄기","끄는","끄고","끄려","끄면","끄고싶","해제하","비활성","차단","중지","알림끄"] },
  { action: "ENABLE",   patterns: ["켜기","켜는","켜고","켜려","켜면","다시 켜","활성화","허용","켜져","켜달라","켜주세요","권한 켜"] },
  { action: "SUBMIT",   patterns: ["제출","업로드하","올리기","신청하기","제출하기","자료 제출","서류 제출","자료를 제출","제출 방법"] },
  { action: "DELETE",   patterns: ["삭제","제거","탈퇴","지우기","삭제하"] },
  { action: "CREATE",   patterns: ["생성","만들기","작성","새로 만","등록하기","추가하기"] },
  { action: "VIEW",     patterns: ["보려면","보고싶","조회","확인하려면","볼수있","보는방법","보고 싶"] },
  { action: "SEARCH",   patterns: ["검색","찾기","찾으려","검색하"] },
  { action: "REGISTER", patterns: ["등록","가입","추가","등록하면","등록됐","등록되어있는데"] },
  { action: "LOGIN",    patterns: ["로그인","로그아웃"] },
  { action: "PAY",      patterns: ["결제","구매","구독하"] },
  { action: "DOWNLOAD", patterns: ["다운로드","내려받기"] },
  { action: "UPLOAD",   patterns: ["업로드","올리기"] },
  { action: "EDIT",     patterns: ["수정","변경","바꾸기","편집"] },
];

function extractAction(text: string): SemanticAction {
  const ns = text.replace(/\s+/g, "").toLowerCase();
  const lo = text.toLowerCase();
  for (const { action, patterns } of ACTION_PATTERNS) {
    for (const p of patterns) {
      if (ns.includes(p.replace(/\s+/g, "")) || lo.includes(p)) return action;
    }
  }
  return "UNKNOWN";
}

// ── Semantic OBJECT ───────────────────────────────────────────────────────────

export type SemanticObject =
  | "NOTIFICATION" | "CURRICULUM_SEARCH" | "GROWTH_REPORT" | "X_MODE"
  | "MATERIAL_SUBMISSION" | "APP_INSTALL" | "LOGIN" | "PHOTO" | "DIARY"
  | "SCHEDULE" | "SUBSCRIPTION" | "STUDENT" | "POOL" | "UNKNOWN";

const OBJECT_PATTERNS: { object: SemanticObject; patterns: string[] }[] = [
  // MATERIAL_SUBMISSION 우선 (앱 설치와 혼동 방지)
  { object: "MATERIAL_SUBMISSION", patterns: ["자료 제출","서류 제출","자료 업로드","제출 자료","신청 자료","자료제출","서류제출","자료업로드","제출자료","신청자료"] },
  { object: "APP_INSTALL",         patterns: ["앱 설치","다른 앱","앱을 설치","설치해야","앱설치","다른앱"] },
  { object: "NOTIFICATION",        patterns: ["알림","푸시"] },
  { object: "CURRICULUM_SEARCH",   patterns: ["커리큘럼 검색","커리큘럼검색","커리큘럼","진도"] },
  { object: "GROWTH_REPORT",       patterns: ["성장리포트","학부모리포트","리포트","성장 리포트","학부모 리포트"] },
  { object: "X_MODE",              patterns: ["x모드","x mode","xmode","스윔노트x"] },
  { object: "LOGIN",               patterns: ["로그인","계정","비밀번호"] },
  { object: "PHOTO",               patterns: ["사진","앨범","포토"] },
  { object: "DIARY",               patterns: ["일지","수업일지","다이어리"] },
  { object: "SCHEDULE",            patterns: ["시간표","스케줄","수업일정"] },
  { object: "SUBSCRIPTION",        patterns: ["구독","플랜","subscription"] },
  { object: "STUDENT",             patterns: ["학생","수강생"] },
  { object: "POOL",                patterns: ["수영장"] },
];

function extractObject(text: string): SemanticObject {
  const ns = text.replace(/\s+/g, "").toLowerCase();
  const lo = text.toLowerCase();
  for (const { object, patterns } of OBJECT_PATTERNS) {
    for (const p of patterns) {
      if (ns.includes(p.replace(/\s+/g, "")) || lo.includes(p)) return object;
    }
  }
  return "UNKNOWN";
}

export interface SemanticSlots {
  action: SemanticAction;
  object: SemanticObject;
}

export function extractSlots(text: string): SemanticSlots {
  return { action: extractAction(text), object: extractObject(text) };
}

// ── Opposite action pairs ─────────────────────────────────────────────────────

const OPPOSITE_ACTION_PAIRS: [SemanticAction, SemanticAction][] = [
  ["ENABLE",   "DISABLE"],
  ["CREATE",   "DELETE"],
  ["REGISTER", "DELETE"],
  ["SUBMIT",   "DOWNLOAD"],
];

function isOppositeAction(a: SemanticAction, b: SemanticAction): boolean {
  if (a === "UNKNOWN" || b === "UNKNOWN") return false;
  return OPPOSITE_ACTION_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  );
}

// ── Platform Detection ─────────────────────────────────────────────────────────

const PLATFORM_QUERY_HINTS = ["android","안드로이드","iphone","아이폰","ios","갤럭시","galaxy"];
const PLATFORM_KI_MARKERS  = ["android","iphone","ios","안드로이드","아이폰"];

function queryHasPlatformHint(qLower: string): boolean {
  const ns = qLower.replace(/\s+/g, "");
  return PLATFORM_QUERY_HINTS.some(h => ns.includes(h.replace(/\s+/g, "")) || qLower.includes(h));
}

function kiIsPlatformSpecific(row: KiRow): boolean {
  const text = ((row.title ?? "") + " " + (row.question ?? "")).toLowerCase();
  return PLATFORM_KI_MARKERS.some(m => text.startsWith(m) || text.includes(` ${m}`) || text.includes(`${m} `));
}

// ── Generic-settings detection ─────────────────────────────────────────────────

/** query에 오류/에러 신호가 없는지 확인 (generic settings query) */
const ERROR_SIGNAL_PATTERNS = ["안돼","안됨","안 됨","오류","고장","실패","안보여","문제","안와","안 와","작동안함","먹통"];

function queryHasErrorSignal(qLower: string): boolean {
  const ns = qLower.replace(/\s+/g, "");
  return ERROR_SIGNAL_PATTERNS.some(p => ns.includes(p.replace(/\s+/g, "")) || qLower.includes(p));
}

/** KI가 ERROR_TROUBLESHOOT 성격인지 확인 (title/question에 오류 신호 포함) */
function kiIsErrorTroubleshoot(row: KiRow): boolean {
  const text = ((row.title ?? "") + " " + (row.question ?? "")).toLowerCase();
  return ERROR_SIGNAL_PATTERNS.some(p => text.includes(p)) || text.includes("해결") || text.includes("오지 않는");
}

// ── Intent scoring ────────────────────────────────────────────────────────────

const INTENT_CONFLICT_PAIRS: [QueryIntent, QueryIntent][] = [
  ["DESCRIPTION",        "REQUIREMENT"],
  ["DESCRIPTION",        "LIMIT_USAGE"],
  ["ERROR_TROUBLESHOOT", "LIMIT_USAGE"],
  ["ERROR_TROUBLESHOOT", "REQUIREMENT"],
  ["DESCRIPTION",        "ERROR_TROUBLESHOOT"],
  ["DISABLE",            "LIMIT_USAGE"],
  ["DISABLE",            "REQUIREMENT"],
];

function intentScore(
  qIntents: QueryIntent[],
  kiIntents: QueryIntent[],
): { delta: number; tag: string } {
  if (qIntents[0] === "NONE" || kiIntents[0] === "NONE") return { delta: 0, tag: "" };
  const shared = qIntents.filter(qi => kiIntents.includes(qi));
  if (shared.length > 0) return { delta: 20, tag: `INTENT_MATCH(${shared.join(",")})` };
  for (const [qi, ki] of INTENT_CONFLICT_PAIRS) {
    if (
      (qIntents.includes(qi) && kiIntents.includes(ki)) ||
      (qIntents.includes(ki) && kiIntents.includes(qi))
    ) {
      return { delta: -25, tag: `INTENT_MISMATCH(${qi}↔${ki})` };
    }
  }
  return { delta: 0, tag: "" };
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
  querySlots:   SemanticSlots;
  kiSlots:      SemanticSlots;
}

/**
 * KI row와 query의 종합 유사도 점수 계산.
 *
 * 점수 구성 (우선순위 순):
 *   concept keyword match (title/cat/feature)   = +50
 *   concept keyword match (question)             = +45
 *   object MATCH                                 = +25
 *   object MISMATCH (different known objects)    = -25
 *   action OPPOSITE (ENABLE↔DISABLE 등)          = -35
 *   action MATCH                                 = +15
 *   intent MATCH                                 = +20
 *   intent MISMATCH (conflicting pair)           = -25
 *   generic-settings, KI=ERROR_TROUBLESHOOT      = -20
 *   title exact match                            = +30
 *   question exact match                         = +35
 *   title token overlap ≥80%                     = +25
 *   title token overlap ≥50%                     = +15
 *   content token overlap ≥50%                   = +10
 *   platform-specific KI, query has no hint      = -20
 *   usage_count log bonus (tiebreak)             = 0~2
 */
function scoreKI(
  row: KiRow,
  qLower: string,
  tokens: string[],
  searchKeywords: string[],
  queryIntents: QueryIntent[],
  querySlots: SemanticSlots,
  hasPlatformHint: boolean,
  queryHasError: boolean,
): ScoredKI {
  let score = 0;
  const methods: string[] = [];

  const nTitle    = normalizeQuery(row.title);
  const nQuestion = row.question ? normalizeQuery(row.question) : null;
  const nCategory = row.category ? normalizeQuery(row.category) : null;
  const nFeature  = row.feature  ? normalizeQuery(row.feature)  : null;

  // ── 1. Concept keyword match ───────────────────────────────────────────────
  for (const keyword of searchKeywords) {
    const nk = normalizeQuery(keyword);
    if (nTitle.includes(nk) || nCategory?.includes(nk) || nFeature?.includes(nk)) {
      score += 50; methods.push("CONCEPT_KW"); break;
    }
    if (nQuestion?.includes(nk)) {
      score += 45; methods.push("CONCEPT_QKW"); break;
    }
  }

  // ── 2. Semantic OBJECT match / mismatch ────────────────────────────────────
  const kiFullText = [row.title ?? "", row.question ?? "", row.content ?? ""].join(" ");
  const kiSlots = extractSlots(kiFullText);

  if (querySlots.object !== "UNKNOWN" && kiSlots.object !== "UNKNOWN") {
    if (querySlots.object === kiSlots.object) {
      score += 25; methods.push(`OBJ_MATCH(${querySlots.object})`);
    } else {
      score -= 25; methods.push(`OBJ_MISMATCH(${querySlots.object}≠${kiSlots.object})`);
    }
  }

  // ── 3. Semantic ACTION: opposite penalty / match boost ─────────────────────
  if (querySlots.action !== "UNKNOWN" && kiSlots.action !== "UNKNOWN") {
    if (isOppositeAction(querySlots.action, kiSlots.action)) {
      score -= 35; methods.push(`OPP_ACTION(${querySlots.action}↔${kiSlots.action})`);
    } else if (querySlots.action === kiSlots.action) {
      score += 15; methods.push(`ACT_MATCH(${querySlots.action})`);
    }
  }

  // ── 4. Generic-settings: no error signal in query, KI is error-only ────────
  if (!queryHasError && kiIsErrorTroubleshoot(row) && !queryIntents.includes("ERROR_TROUBLESHOOT")) {
    score -= 20; methods.push("GENERIC_SETTINGS_ERR_PENALTY");
  }

  // ── 5. Intent match / mismatch ─────────────────────────────────────────────
  const kiIntents = extractKIIntents(row);
  const { delta: intentDelta, tag: intentTag } = intentScore(queryIntents, kiIntents);
  score += intentDelta;
  if (intentTag) methods.push(intentTag);

  // ── 6. Exact matches ───────────────────────────────────────────────────────
  if (nQuestion && (nQuestion === qLower || nQuestion.includes(qLower))) {
    score += 35; methods.push("Q_EXACT");
  }
  if (nTitle === qLower || nTitle.includes(qLower)) {
    score += 30; methods.push("T_EXACT");
  }

  // ── 7. Token overlap ───────────────────────────────────────────────────────
  const qStems = tokens.map(stemKorean);
  const tStems = tokenize(row.title).map(stemKorean);
  const cStems = tokenize((row.content ?? "") + " " + (row.question ?? "")).map(stemKorean);

  if (qStems.length > 0) {
    const titleOverlap = qStems.filter(s => tStems.includes(s)).length;
    const bodyOverlap  = qStems.filter(s => cStems.includes(s) && !tStems.includes(s)).length;
    const tRatio   = titleOverlap / qStems.length;
    const allRatio = (titleOverlap + bodyOverlap) / qStems.length;

    if (tRatio >= 0.8)      { score += 25; methods.push("T_TOKEN_HIGH"); }
    else if (tRatio >= 0.5) { score += 15; methods.push("T_TOKEN_MED"); }
    else if (allRatio >= 0.5){ score += 10; methods.push("C_TOKEN"); }
  }

  // ── 8. Platform-specific penalty ──────────────────────────────────────────
  if (!hasPlatformHint && kiIsPlatformSpecific(row)) {
    score -= 20; methods.push("PLATFORM_PENALTY");
  }

  // ── 9. Usage bonus (tiebreak only) ────────────────────────────────────────
  score += Math.min(2, Math.floor(Math.log2((row.usage_count ?? 0) + 1)));

  return {
    row, score: Math.min(100, score), methods,
    queryIntents, kiIntents, querySlots, kiSlots,
  };
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
 *   score ≥ HIGH_SCORE
 *   AND no INTENT_MISMATCH
 *   AND no PLATFORM_PENALTY
 *   AND no OPP_ACTION
 *   AND no OBJ_MISMATCH
 */
function mapAnswerPolicy(scored: ScoredKI[]): AnswerPolicyDecision {
  if (scored.length === 0) return "INSUFFICIENT_EVIDENCE";

  const top = scored[0];
  const answerMode = top.row.answer_mode ?? "DIRECT_DB";

  if (answerMode === "HUMAN_ONLY") return "HUMAN_REQUIRED";
  if (answerMode === "GROUNDED_GPT") return "GROUNDED_AI";

  const hasConflict = top.methods.some(m =>
    m.startsWith("INTENT_MISMATCH") ||
    m.includes("PLATFORM_PENALTY") ||
    m.startsWith("OPP_ACTION") ||
    m.startsWith("OBJ_MISMATCH"),
  );

  if (top.score >= HIGH_SCORE && !hasConflict) return "DB_DIRECT";
  if (scored.length > 1 || top.score >= MEDIUM_SCORE) return "GROUNDED_AI";
  return "INSUFFICIENT_EVIDENCE";
}

// ── Semantic mismatch guard for grounded evidence ─────────────────────────────

/**
 * semantic slot mismatch KI를 grounded_evidence에서 제외.
 *
 * 제외 규칙:
 *   - OPP_ACTION (반대 행동): 항상 제외 — 내용이 오해를 일으킴
 *   - OBJ_MISMATCH + no ACT_MATCH: 제외 — 완전히 다른 대상
 *   - OBJ_MISMATCH + ACT_MATCH: 허용 — 행동이 맞으면 객체 카테고리 차이는 보조 근거로 허용
 *     (예: query object=X_MODE, KI object=MATERIAL_SUBMISSION 이지만 ACT_MATCH(SUBMIT) 있음)
 */
function isEvidenceEligible(s: ScoredKI): boolean {
  const hasOppAction  = s.methods.some(m => m.startsWith("OPP_ACTION"));
  const hasObjMismatch = s.methods.some(m => m.startsWith("OBJ_MISMATCH"));
  const hasActMatch   = s.methods.some(m => m.startsWith("ACT_MATCH"));

  if (hasOppAction) return false;                   // 반대 행동 → 항상 제외
  if (hasObjMismatch && !hasActMatch) return false; // object mismatch + action miss → 제외
  return true;                                       // object mismatch + action match → 허용
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
  retrieval:                RetrievalResult;
  answer_mode:              string | null;
  best_answer:              string | null;
  best_title:               string | null;
  best_deep_link:           string | null;
  policy:                   AnswerPolicyDecision;
  /** top-N evidence KIs (score ≥ threshold AND no semantic mismatch) */
  grounded_evidence:        KiRow[];
  excluded_by_status_count: number;
  concepts:                 SupportConcept[];
  query_intents:            QueryIntent[];
  query_slots:              SemanticSlots;
}

// ── Main retriever ────────────────────────────────────────────────────────────

export async function retrieveCanonicalKI(
  ctx: RouterContext,
): Promise<SupportRetrievalResult> {
  const qLower  = ctx.qLower;
  const tokens  = tokenizeKorean(qLower);
  const poolId  = ctx.poolId;
  const role    = ctx.role;
  const mode    = ctx.mode;

  // Feature extraction
  const concepts        = detectConcepts(qLower);
  const searchKeywords  = buildSearchKeywordsFromConcepts(concepts);
  const queryIntents    = extractQueryIntents(qLower);
  const querySlots      = extractSlots(qLower);
  const hasPlatformHint = queryHasPlatformHint(qLower);
  const queryHasError   = queryHasErrorSignal(qLower);

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

  // Score & rank
  const scored = eligible
    .map(r => scoreKI(r, qLower, tokens, searchKeywords, queryIntents, querySlots, hasPlatformHint, queryHasError))
    .filter(s => s.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.row.usage_count - a.row.usage_count);

  // Tie handling + re-sort
  if (
    scored.length >= 2 &&
    scored[0].score === scored[1].score &&
    scored[0].row.id !== scored[1].row.id
  ) {
    scored[0] = { ...scored[0], score: Math.max(scored[0].score - 10, MIN_SCORE_THRESHOLD) };
    scored.sort((a, b) => b.score - a.score || b.row.usage_count - a.row.usage_count);
  }

  const policy = mapAnswerPolicy(scored);

  // grounded_evidence: score ≥ threshold AND no semantic mismatch
  const groundedEvidence = scored
    .filter(s => s.score >= GROUNDED_EVIDENCE_MIN_SCORE && isEvidenceEligible(s))
    .slice(0, MAX_GROUNDED_EVIDENCE)
    .map(s => s.row);

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
    query_slots:              querySlots,
  };
}
