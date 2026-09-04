/**
 * support-retriever.ts — RT2 SupportRetriever (Round 5: Facet Precision)
 *
 * 계층 순서:
 *   L0. 기존 exact utterance matcher (matchDirectAnswer) — 결과 최우선
 *   L1-L5. concept → ILIKE candidate → slot-aware scoring → policy
 *
 * Scoring 우선순위:
 *   1. concept keyword match
 *   2. goal match / mismatch        (Round 4)
 *   3. facet match / mismatch       (Round 5 — concept-specific sub-topic)
 *   4. object match / mismatch
 *   5. action match / opposite-action penalty
 *   6. KI action = UNKNOWN penalty  (Round 4)
 *   7. intent match / mismatch
 *   8. generic-settings error penalty
 *   9. title/question lexical overlap
 *  10. content overlap
 *  11. platform penalty
 *  12. usage_count (tiebreak, +2 max)
 *
 * 원칙:
 *   - active KI only / pool-scope 필터 / 전체 KI 무조건 로드 금지
 *   - opposite action → DB_DIRECT 금지, 강한 penalty
 *   - goal mismatch → DB_DIRECT 금지, evidence 제외, strong penalty
 *   - facet mismatch → DB_DIRECT 금지, evidence 제외 (Round 5)
 *   - object mismatch (non-ACT_MATCH) → evidence 제외
 *   - no forced wrong answer: top-1 GOAL_MISMATCH / FACET_MISMATCH → GROUNDED_AI/INSUFFICIENT_EVIDENCE
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

const CONCEPT_CANDIDATE_LIMIT     = 80;
const FALLBACK_CANDIDATE_LIMIT    = 50;
const MIN_SCORE_THRESHOLD         = 20;  // Round 4: 낮춤 (goal mismatch 후 남은 KI 수용)
const HIGH_SCORE                  = 80;  // DB_DIRECT 기준
const MEDIUM_SCORE                = 45;  // GROUNDED_AI 기준 (Round 4: 낮춤)
const MAX_GROUNDED_EVIDENCE       = 5;
const GROUNDED_EVIDENCE_MIN_SCORE = 35;  // Round 4: 낮춤

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

// ── Semantic GOAL (Round 4) ────────────────────────────────────────────────────

/**
 * User's high-level goal for asking the question.
 *
 * SETTINGS_MANAGE      : wants to change/configure/toggle a setting
 * BEHAVIOR_CONDITION   : wants to know when/why something happens (descriptive condition)
 * TROUBLESHOOT         : something is broken, wants fix
 * FEATURE_DESCRIPTION  : wants to know what a feature is
 * USAGE_LIMIT          : wants to know usage quotas/limits
 * REQUIREMENT          : wants to know eligibility/requirements
 * MATERIAL_SUBMISSION  : wants to submit materials/documents
 * OTHER                : unclear or catch-all
 */
export type SemanticGoal =
  | "SETTINGS_MANAGE" | "BEHAVIOR_CONDITION" | "TROUBLESHOOT"
  | "FEATURE_DESCRIPTION" | "USAGE_LIMIT" | "REQUIREMENT"
  | "MATERIAL_SUBMISSION" | "OTHER";

// Goal patterns listed in priority order (first match wins for most specific goals)
const GOAL_PATTERNS: { goal: SemanticGoal; patterns: string[] }[] = [
  // 1. MATERIAL_SUBMISSION — most specific
  { goal: "MATERIAL_SUBMISSION",  patterns: ["제출","자료제출","서류제출","자료 제출","서류 제출"] },
  // 2. TROUBLESHOOT — error signal
  { goal: "TROUBLESHOOT",         patterns: ["안돼","안됨","안 됨","오류","고장","실패","안보여","안 보여","문제","안와요","안와","안 와","작동안함","먹통","등록됐는데","등록 됐는데","검색이안돼","검색 안돼"] },
  // 3. SETTINGS_MANAGE — action + navigation, or standalone setting
  { goal: "SETTINGS_MANAGE",      patterns: ["어디서해","어디서 해","끄기","끄는","끄고","끄려","켜기","켜는","켜려","해제","비활성","활성화","설정","변경","바꾸기","수정","어디서","어떻게 끄","어떻게 켜","어디서 끄","어디서 켜"] },
  // 4. USAGE_LIMIT
  { goal: "USAGE_LIMIT",          patterns: ["몇번","몇 번","횟수","한도","월 몇회","몇회","사용횟수","사용 횟수"] },
  // 5. REQUIREMENT
  { goal: "REQUIREMENT",          patterns: ["조건","필요한가요","필요해요","자격","되려면","되어야","기준은"] },
  // 6. FEATURE_DESCRIPTION
  { goal: "FEATURE_DESCRIPTION",  patterns: ["뭐야","뭔지","뭐예요","뭔가요","무엇","이란","어떤기능","어떤 기능","소개","뭔데"] },
  // 7. BEHAVIOR_CONDITION — when/why something happens (descriptive, passive)
  { goal: "BEHAVIOR_CONDITION",   patterns: ["어떤경우에","어떤 경우에","언제오나요","언제 오나요","어떤때","어떤 때","언제","경우에","오나요","알림이오나요","알림이 오나요"] },
];

/**
 * extractGoal: query or KI text에서 user goal을 추출.
 * 패턴 우선순위 순으로 첫 번째 매치 반환.
 */
export function extractGoal(text: string): SemanticGoal {
  const ns  = text.replace(/\s+/g, "").toLowerCase();
  const lo  = text.toLowerCase();
  for (const { goal, patterns } of GOAL_PATTERNS) {
    for (const p of patterns) {
      if (ns.includes(p.replace(/\s+/g, "")) || lo.includes(p)) return goal;
    }
  }
  return "OTHER";
}

/** Goal이 명확히 다른 pair — 동일 object라도 goal이 이 쌍에 속하면 mismatch */
const GOAL_CONFLICT_PAIRS: [SemanticGoal, SemanticGoal][] = [
  ["SETTINGS_MANAGE",    "BEHAVIOR_CONDITION"],
  ["SETTINGS_MANAGE",    "FEATURE_DESCRIPTION"],
  ["SETTINGS_MANAGE",    "USAGE_LIMIT"],
  ["SETTINGS_MANAGE",    "REQUIREMENT"],
  ["TROUBLESHOOT",       "BEHAVIOR_CONDITION"],
  ["TROUBLESHOOT",       "FEATURE_DESCRIPTION"],
  ["TROUBLESHOOT",       "USAGE_LIMIT"],
  ["TROUBLESHOOT",       "REQUIREMENT"],
  ["FEATURE_DESCRIPTION","BEHAVIOR_CONDITION"],
  ["FEATURE_DESCRIPTION","TROUBLESHOOT"],
  ["FEATURE_DESCRIPTION","USAGE_LIMIT"],
  ["MATERIAL_SUBMISSION","BEHAVIOR_CONDITION"],
  ["MATERIAL_SUBMISSION","FEATURE_DESCRIPTION"],
  ["USAGE_LIMIT",        "BEHAVIOR_CONDITION"],
];

function goalMismatch(a: SemanticGoal, b: SemanticGoal): boolean {
  if (a === "OTHER" || b === "OTHER") return false;
  if (a === b) return false;
  return GOAL_CONFLICT_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  );
}

/** goal scoring delta + tag */
function goalScore(
  queryGoal: SemanticGoal,
  kiGoal: SemanticGoal,
): { delta: number; tag: string } {
  if (queryGoal === "OTHER") return { delta: 0, tag: "" };

  if (kiGoal === queryGoal) {
    return { delta: 30, tag: `GOAL_MATCH(${queryGoal})` };
  }
  if (goalMismatch(queryGoal, kiGoal)) {
    return { delta: -30, tag: `GOAL_MISMATCH(${queryGoal}≠${kiGoal})` };
  }
  if (kiGoal === "OTHER") {
    return { delta: -10, tag: "GOAL_KI_OTHER" };
  }
  // different but not in conflict pair — mild penalty
  return { delta: -5, tag: `GOAL_DIFF(${queryGoal}≠${kiGoal})` };
}

// ── Semantic ACTION ───────────────────────────────────────────────────────────

export type SemanticAction =
  | "ENABLE" | "DISABLE" | "SUBMIT" | "VIEW" | "SEARCH" | "REGISTER"
  | "DELETE" | "CREATE" | "LOGIN" | "PAY" | "DOWNLOAD" | "UPLOAD"
  | "EDIT" | "UNKNOWN";

const ACTION_PATTERNS: { action: SemanticAction; patterns: string[] }[] = [
  { action: "DISABLE",  patterns: ["끄기","끄는","끄고","끄려","끄면","해제하","비활성","차단","중지","알림끄"] },
  { action: "ENABLE",   patterns: ["켜기","켜는","켜고","켜려","다시 켜","활성화","허용","켜져","권한 켜"] },
  { action: "SUBMIT",   patterns: ["제출","업로드하","신청하기","제출하기","자료 제출","서류 제출","자료를 제출","제출 방법"] },
  { action: "DELETE",   patterns: ["삭제","제거","탈퇴","지우기"] },
  { action: "CREATE",   patterns: ["생성","만들기","작성","새로 만","추가하기"] },
  { action: "VIEW",     patterns: ["보려면","보고싶","조회","확인하려면","보는방법"] },
  { action: "SEARCH",   patterns: ["검색","찾기","찾으려"] },
  { action: "REGISTER", patterns: ["등록","가입","추가","등록됐","등록되어있는데"] },
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
  { object: "SUBSCRIPTION",        patterns: ["구독","플랜"] },
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

// ── Semantic FACET (Round 5) ───────────────────────────────────────────────────

/**
 * 개념 내 세부 주제(facet).
 * 현재 NOTIFICATION object에만 비-OTHER 값 부여.
 * 다른 object는 항상 OTHER 반환.
 *
 * PREFERENCE          : 알림 켜기/끄기/설정/수신 여부 (user preference control)
 * PERMISSION          : OS 권한, 허용/거부 (system-level permission)
 * EVENT_TRIGGER       : 어떤 이벤트 시 알림이 오는지 (when/why notification fires)
 * DELIVERY_TROUBLESHOOT: 알림이 안 오거나 지연되는 문제 (delivery failure/delay)
 * SUBMISSION_PROCESS  : 자료 제출 절차
 * FEATURE_OVERVIEW    : 기능 설명/소개
 * ELIGIBILITY         : 자격 요건
 * USAGE_POLICY        : 사용 정책/한도
 * OTHER               : 분류 불가
 */
export type SemanticFacet =
  | "PREFERENCE" | "PERMISSION" | "EVENT_TRIGGER" | "DELIVERY_TROUBLESHOOT"
  | "SUBMISSION_PROCESS" | "FEATURE_OVERVIEW" | "ELIGIBILITY" | "USAGE_POLICY"
  | "OTHER";

// NOTIFICATION-specific facet patterns (priority order — first match wins)
const NOTIFICATION_FACET_PATTERNS: { facet: SemanticFacet; patterns: string[] }[] = [
  // 1. DELIVERY_TROUBLESHOOT — error/missing delivery
  { facet: "DELIVERY_TROUBLESHOOT", patterns: [
      "안와요","안와","안 와","오지않","오지 않","수신안됨","수신 안됨","누락","안오면","늦게","두 번","두번","이중","중복",
      "안왔","못받","못 받",
  ]},
  // 2. PERMISSION — OS-level permission flow
  { facet: "PERMISSION", patterns: [
      "권한","허용","거부","os설정","os 설정","알림권한","설정앱","아이폰 설정","안드로이드 설정",
      "system","시스템설정","시스템 설정",
  ]},
  // 3. EVENT_TRIGGER — when/why notification fires
  { facet: "EVENT_TRIGGER", patterns: [
      "어떤경우에","어떤 경우에","언제오나요","언제 오나요","어떤때","어떤 때","어떤경우","어떤 경우",
      "처리되면","등록되면","바뀌면","생기면","변경되면","추가되면","오나요","알림이오나요","알림이 오나요",
      "알림오나요","알림 오나요","언제알림","언제 알림",
  ]},
  // 4. PREFERENCE — user preference control (on/off/setting)
  { facet: "PREFERENCE", patterns: [
      "끄기","끄는","끄고","끄려","끄면","켜기","켜는","켜고","켜려","켜면",
      "설정","수신","알림설정","알림 설정","푸시설정","푸시 설정","수신설정","수신 설정",
      "알림끄","알림켜",
  ]},
];

/**
 * extractFacet: text에서 semantic facet 추출.
 * object가 NOTIFICATION일 때만 비-OTHER 값 가능.
 * 다른 object는 OTHER 반환.
 */
export function extractFacet(text: string, object: SemanticObject): SemanticFacet {
  if (object !== "NOTIFICATION") return "OTHER";

  const ns = text.replace(/\s+/g, "").toLowerCase();
  const lo = text.toLowerCase();
  for (const { facet, patterns } of NOTIFICATION_FACET_PATTERNS) {
    for (const p of patterns) {
      if (ns.includes(p.replace(/\s+/g, "")) || lo.includes(p)) return facet;
    }
  }
  return "OTHER";
}

/** facet scoring delta + tag */
function facetScore(
  queryFacet: SemanticFacet,
  kiFacet: SemanticFacet,
): { delta: number; tag: string } {
  if (queryFacet === "OTHER") return { delta: 0, tag: "" };

  if (kiFacet === queryFacet) {
    return { delta: 30, tag: `FACET_MATCH(${queryFacet})` };
  }
  if (kiFacet === "OTHER") {
    return { delta: -10, tag: "FACET_KI_OTHER" };
  }
  // different known facets → strong penalty
  return { delta: -35, tag: `FACET_MISMATCH(${queryFacet}≠${kiFacet})` };
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

const ERROR_SIGNAL_PATTERNS = ["안돼","안됨","안 됨","오류","고장","실패","안보여","문제","안와","안 와","작동안함","먹통"];

function queryHasErrorSignal(qLower: string): boolean {
  const ns = qLower.replace(/\s+/g, "");
  return ERROR_SIGNAL_PATTERNS.some(p => ns.includes(p.replace(/\s+/g, "")) || qLower.includes(p));
}

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
  raw_score:    number;         // Round 6: uncapped, used for ranking
  score:        number;         // 0–100 normalized for display/output
  methods:      string[];
  queryIntents: QueryIntent[];
  kiIntents:    QueryIntent[];
  querySlots:   SemanticSlots;
  kiSlots:      SemanticSlots;
  queryGoal:    SemanticGoal;
  kiGoal:       SemanticGoal;
  queryFacet:   SemanticFacet;
  kiFacet:      SemanticFacet;
}

/**
 * KI row와 query의 종합 유사도 점수 계산.
 *
 * 점수 구성:
 *   concept keyword match (title/cat/feature)   = +50
 *   concept keyword match (question)             = +45
 *   goal MATCH                                   = +30
 *   goal MISMATCH (conflict pair)                = -30
 *   goal KI=OTHER (query goal is specific)       = -10
 *   goal different but not conflict              = -5
 *   facet MATCH (same sub-topic)                 = +30   (Round 5)
 *   facet MISMATCH (different known facets)      = -35   (Round 5)
 *   facet KI=OTHER (query facet is specific)     = -10   (Round 5)
 *   object MATCH                                 = +25
 *   object MISMATCH (different known objects)    = -25
 *   action OPPOSITE                              = -35
 *   action MATCH                                 = +15
 *   KI action UNKNOWN (query action != UNKNOWN)  = -10
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
  queryGoal: SemanticGoal,
  queryFacet: SemanticFacet,
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

  // ── 2. Semantic GOAL match / mismatch ─────────────────────────────────────
  //   kiQueryText = title+question only: 슬롯/팩셋의 "질문 주제" 판별에 사용
  //   kiFullText  = title+question+content: 목적(goal) 판별에는 전체 맥락 사용
  //   Round 6: KI content에 "수업" 등 배경어가 포함될 경우 object=SCHEDULE 오감지 방지
  const kiQueryText = [row.title ?? "", row.question ?? ""].join(" ");
  const kiFullText  = [row.title ?? "", row.question ?? "", row.content ?? ""].join(" ");
  const kiGoal  = extractGoal(kiFullText);
  const kiSlots = extractSlots(kiQueryText);   // Round 6: title+question only

  const { delta: goalDelta, tag: goalTag } = goalScore(queryGoal, kiGoal);
  score += goalDelta;
  if (goalTag) methods.push(goalTag);

  // ── 3. Semantic FACET match / mismatch ────────────────────────────────────
  const kiFacet = extractFacet(kiQueryText, kiSlots.object);  // Round 6: title+question only
  const { delta: facetDelta, tag: facetTag } = facetScore(queryFacet, kiFacet);
  score += facetDelta;
  if (facetTag) methods.push(facetTag);

  // ── 4. Semantic OBJECT match / mismatch ────────────────────────────────────
  if (querySlots.object !== "UNKNOWN" && kiSlots.object !== "UNKNOWN") {
    if (querySlots.object === kiSlots.object) {
      score += 25; methods.push(`OBJ_MATCH(${querySlots.object})`);
    } else {
      score -= 25; methods.push(`OBJ_MISMATCH(${querySlots.object}≠${kiSlots.object})`);
    }
  }

  // ── 5. Semantic ACTION: opposite penalty / match boost / unknown penalty ───
  if (querySlots.action !== "UNKNOWN") {
    if (kiSlots.action !== "UNKNOWN") {
      if (isOppositeAction(querySlots.action, kiSlots.action)) {
        score -= 35; methods.push(`OPP_ACTION(${querySlots.action}↔${kiSlots.action})`);
      } else if (querySlots.action === kiSlots.action) {
        score += 15; methods.push(`ACT_MATCH(${querySlots.action})`);
      }
    } else {
      score -= 10; methods.push("ACT_KI_UNKNOWN");
    }
  }

  // ── 6. Generic-settings: no error signal in query, KI is error-only ────────
  if (!queryHasError && kiIsErrorTroubleshoot(row) && !queryIntents.includes("ERROR_TROUBLESHOOT")) {
    score -= 20; methods.push("GENERIC_SETTINGS_ERR_PENALTY");
  }

  // ── 7. Intent match / mismatch ─────────────────────────────────────────────
  const kiIntents = extractKIIntents(row);
  const { delta: intentDelta, tag: intentTag } = intentScore(queryIntents, kiIntents);
  score += intentDelta;
  if (intentTag) methods.push(intentTag);

  // ── 8. Exact matches ───────────────────────────────────────────────────────
  if (nQuestion && (nQuestion === qLower || nQuestion.includes(qLower))) {
    score += 35; methods.push("Q_EXACT");
  }
  if (nTitle === qLower || nTitle.includes(qLower)) {
    score += 30; methods.push("T_EXACT");
  }

  // ── 9. Token overlap ───────────────────────────────────────────────────────
  const qStems = tokens.map(stemKorean);
  const tStems = tokenize(row.title).map(stemKorean);
  const cStems = tokenize((row.content ?? "") + " " + (row.question ?? "")).map(stemKorean);

  if (qStems.length > 0) {
    const titleOverlap = qStems.filter(s => tStems.includes(s)).length;
    const bodyOverlap  = qStems.filter(s => cStems.includes(s) && !tStems.includes(s)).length;
    const tRatio   = titleOverlap / qStems.length;
    const allRatio = (titleOverlap + bodyOverlap) / qStems.length;

    if (tRatio >= 0.8)       { score += 25; methods.push("T_TOKEN_HIGH"); }
    else if (tRatio >= 0.5)  { score += 15; methods.push("T_TOKEN_MED"); }
    else if (allRatio >= 0.5){ score += 10; methods.push("C_TOKEN"); }
  }

  // ── 10. Platform-specific penalty ─────────────────────────────────────────
  if (!hasPlatformHint && kiIsPlatformSpecific(row)) {
    score -= 20; methods.push("PLATFORM_PENALTY");
  }

  // ── 11. Usage bonus (tiebreak only) ────────────────────────────────────────
  score += Math.min(2, Math.floor(Math.log2((row.usage_count ?? 0) + 1)));

  // Round 6: raw_score for ranking (uncapped), score for display (0~100)
  return {
    row,
    raw_score: score,
    score:     Math.min(100, Math.max(0, score)),
    methods,
    queryIntents, kiIntents, querySlots, kiSlots, queryGoal, kiGoal,
    queryFacet, kiFacet,
  };
}

// ── Role / mode filter ─────────────────────────────────────────────────────────

function kiRoleMatches(row: KiRow, role: string): boolean {
  return roleMatches(row as unknown as KnowledgeRow, role);
}
function kiModeMatches(row: KiRow, mode: string): boolean {
  return modeMatches(row as unknown as KnowledgeRow, mode);
}

// ── Policy mapping (Round 4: no-forced-wrong-answer) ─────────────────────────

/**
 * DB_DIRECT 조건:
 *   raw_score ≥ HIGH_SCORE
 *   AND no INTENT_MISMATCH / PLATFORM_PENALTY / OPP_ACTION / OBJ_MISMATCH
 *   AND no GOAL_MISMATCH / FACET_MISMATCH
 *
 * No-forced-wrong-answer (extended):
 *   top-1이 GOAL_MISMATCH → GROUNDED_AI(≥3)/INSUFFICIENT_EVIDENCE
 *   top-1이 FACET_MISMATCH → INSUFFICIENT_EVIDENCE
 *     (GROUNDED_AI 금지: FACET_MISMATCH top-1 상황에서 GPT가 창작 위험)
 *     예외: eligible evidence 중 FACET_MATCH가 존재하면 GROUNDED_AI 허용
 *
 * missingReasonHint: KNOWLEDGE_GAP / RANKING_MISS / undefined
 *   → caller에서 retrieval.missing_reason에 반영
 */
export type PolicyWithHint = {
  policy: AnswerPolicyDecision;
  missingReasonHint?: "KNOWLEDGE_GAP" | "RANKING_MISS";
};

function mapAnswerPolicyWithHint(
  scored: ScoredKI[],
  eligibleEvidence: ScoredKI[],
  queryFacet: SemanticFacet,
): PolicyWithHint {
  if (scored.length === 0) return { policy: "INSUFFICIENT_EVIDENCE" };

  const top = scored[0];
  const answerMode = top.row.answer_mode ?? "DIRECT_DB";

  if (answerMode === "HUMAN_ONLY") return { policy: "HUMAN_REQUIRED" };
  if (answerMode === "GROUNDED_GPT") return { policy: "GROUNDED_AI" };

  // Round 6 — Facet gate: queryFacet이 specific(≠OTHER)이고 eligible evidence에
  // FACET_MATCH KI가 하나도 없으면 → KNOWLEDGE_GAP (DB에 해당 sub-topic KI 부재)
  // 케이스:
  //   a. top-1 FACET_MISMATCH (wrong sub-topic KI가 올라온 경우)
  //   b. top-1 FACET_MATCH이지만 OPP_ACTION으로 eligible 제외 (→ no FACET_MATCH evidence)
  // 둘 다 eligible evidence에 FACET_MATCH 없음 → KNOWLEDGE_GAP으로 통일
  if (queryFacet !== "OTHER") {
    const hasFacetMatchEvidence = eligibleEvidence.some(s =>
      s.methods.some(m => m.startsWith("FACET_MATCH")),
    );
    if (!hasFacetMatchEvidence) {
      return {
        policy: "INSUFFICIENT_EVIDENCE",
        missingReasonHint: "KNOWLEDGE_GAP",
      };
    }
  }

  const topHasGoalMismatch  = top.methods.some(m => m.startsWith("GOAL_MISMATCH"));
  const topHasFacetMismatch = top.methods.some(m => m.startsWith("FACET_MISMATCH"));

  // No-forced-wrong-answer: top-1 GOAL_MISMATCH
  if (topHasGoalMismatch) {
    return { policy: scored.length >= 3 ? "GROUNDED_AI" : "INSUFFICIENT_EVIDENCE" };
  }

  // top-1 FACET_MISMATCH (하지만 queryFacet=OTHER이어서 gate를 통과한 경우)
  if (topHasFacetMismatch) {
    return { policy: scored.length >= 3 ? "GROUNDED_AI" : "INSUFFICIENT_EVIDENCE" };
  }

  const hasConflict = top.methods.some(m =>
    m.startsWith("INTENT_MISMATCH") ||
    m.includes("PLATFORM_PENALTY") ||
    m.startsWith("OPP_ACTION") ||
    m.startsWith("OBJ_MISMATCH") ||
    m.startsWith("GOAL_MISMATCH") ||
    m.startsWith("FACET_MISMATCH"),
  );

  if (top.raw_score >= HIGH_SCORE && !hasConflict) return { policy: "DB_DIRECT" };
  if (scored.length > 1 || top.raw_score >= MEDIUM_SCORE) return { policy: "GROUNDED_AI" };
  return { policy: "INSUFFICIENT_EVIDENCE" };
}

// backward-compat wrapper used by legacy call sites in this file
function mapAnswerPolicy(scored: ScoredKI[]): AnswerPolicyDecision {
  const eligible = scored.filter(isEvidenceEligible);
  const top = scored[0];
  const qFacet = top?.queryFacet ?? "OTHER";
  return mapAnswerPolicyWithHint(scored, eligible, qFacet).policy;
}

// ── Semantic mismatch guard for grounded evidence ─────────────────────────────

/**
 * evidence 제외 규칙:
 *   OPP_ACTION               → 항상 제외
 *   OBJ_MISMATCH + no ACT_MATCH → 제외
 *   GOAL_MISMATCH            → 제외 (잘못된 방향의 GPT 근거)
 *   FACET_MISMATCH           → 제외 (Round 5: 세부 주제 다른 KI는 misleading)
 */
function isEvidenceEligible(s: ScoredKI): boolean {
  const hasOppAction    = s.methods.some(m => m.startsWith("OPP_ACTION"));
  const hasObjMismatch  = s.methods.some(m => m.startsWith("OBJ_MISMATCH"));
  const hasActMatch     = s.methods.some(m => m.startsWith("ACT_MATCH"));
  const hasGoalMismatch = s.methods.some(m => m.startsWith("GOAL_MISMATCH"));
  const hasFacetMismatch = s.methods.some(m => m.startsWith("FACET_MISMATCH"));  // Round 5

  if (hasOppAction)               return false;
  if (hasGoalMismatch)            return false;
  if (hasFacetMismatch)           return false;  // Round 5
  if (hasObjMismatch && !hasActMatch) return false;
  return true;
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
  grounded_evidence:        KiRow[];
  excluded_by_status_count: number;
  concepts:                 SupportConcept[];
  query_intents:            QueryIntent[];
  query_slots:              SemanticSlots;
  query_goal:               SemanticGoal;
  query_facet:              SemanticFacet;  // Round 5
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
  const queryGoal       = extractGoal(qLower);
  const queryFacet      = extractFacet(qLower, querySlots.object);  // Round 5
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

  // Score & rank — Round 6: sort by raw_score (uncapped) for accurate ordering
  const scored = eligible
    .map(r => scoreKI(r, qLower, tokens, searchKeywords, queryIntents, querySlots, queryGoal, queryFacet, hasPlatformHint, queryHasError))
    .filter(s => s.raw_score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.raw_score - a.raw_score || b.row.usage_count - a.row.usage_count);

  // Tie handling + re-sort (raw_score based)
  if (
    scored.length >= 2 &&
    scored[0].raw_score === scored[1].raw_score &&
    scored[0].row.id !== scored[1].row.id
  ) {
    scored[0] = {
      ...scored[0],
      raw_score: Math.max(scored[0].raw_score - 10, MIN_SCORE_THRESHOLD),
      score:     Math.min(100, Math.max(0, scored[0].raw_score - 10)),
    };
    scored.sort((a, b) => b.raw_score - a.raw_score || b.row.usage_count - a.row.usage_count);
  }

  // grounded_evidence: eligible KIs above display-score threshold, no mismatch flags
  const eligibleEvidence = scored.filter(
    s => s.score >= GROUNDED_EVIDENCE_MIN_SCORE && isEvidenceEligible(s),
  );
  const groundedEvidence = eligibleEvidence.slice(0, MAX_GROUNDED_EVIDENCE).map(s => s.row);

  // Policy with KNOWLEDGE_GAP hint
  const { policy, missingReasonHint } = mapAnswerPolicyWithHint(scored, eligibleEvidence, queryFacet);

  // Detect RANKING_MISS: correct KI in DB but suppressed by mismatch penalty
  const hasRankingMiss = scored.length > 0 &&
    scored.some(s => !s.methods.some(m =>
      m.startsWith("GOAL_MISMATCH") || m.startsWith("FACET_MISMATCH") || m.startsWith("OBJ_MISMATCH"),
    )) &&
    scored[0].methods.some(m =>
      m.startsWith("GOAL_MISMATCH") || m.startsWith("FACET_MISMATCH"),
    );

  const missing_reason =
    scored.length === 0          ? "NO_MATCH"
    : missingReasonHint === "KNOWLEDGE_GAP" ? "KNOWLEDGE_GAP"
    : hasRankingMiss             ? "RANKING_MISS"
    : undefined;

  const matches   = buildMatches(scored, poolId);
  const retrieval = buildRetrievalResult({
    domain:         "SUPPORT",
    tenant_id:      poolId ?? "global",
    query:          qLower,
    matches,
    excluded_count: excluded_by_status_count,
    missing_reason,
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
    query_goal:               queryGoal,
    query_facet:              queryFacet,  // Round 5
  };
}
