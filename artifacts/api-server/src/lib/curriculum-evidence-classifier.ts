/**
 * curriculum-evidence-classifier.ts
 *
 * STEP-GAUGE-03: Teacher Diary / growth_event evidence를
 * 진도 게이지 관찰로 사용할 수 있는지 fail-closed 방식으로 분류.
 *
 * 설계 원칙:
 *   - fail-open 금지: 의심스러우면 UNVERIFIED → isGaugeEligible=false
 *   - NULL evidence + teacher_ai → UNVERIFIED
 *   - teacher_manual → ACTUAL_TAUGHT (교사가 item 직접 선택 = explicit selection)
 *   - AI/Professional/GPT 의존성 없음: 순수 rule-based
 *
 * Priority order (teacher_ai + evidenceText):
 *   1. FUTURE_PLAN   — 미래 문맥 먼저 (교정 keyword라도 미래면 FUTURE_PLAN)
 *   2. PAST_REFERENCE — 과거 문맥 (단, 오늘 수행 표현이 함께 있으면 REVIEW/CORRECTION 우선)
 *   3. CORRECTION    — 오늘 교정 수행
 *   4. REVIEW        — 오늘 복습 수행
 *   5. ACTUAL_TAUGHT — 위 모두 해당 없고 현재 수업으로 해석 가능
 *
 * DB CHECK 일치:
 *   chk_cpo_eligible_type_consistency:
 *     ACTUAL_TAUGHT/REVIEW/CORRECTION → isGaugeEligible=true
 *     FUTURE_PLAN/PAST_REFERENCE/UNVERIFIED → isGaugeEligible=false
 */

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

export type ObservationType =
  | "ACTUAL_TAUGHT"
  | "REVIEW"
  | "CORRECTION"
  | "FUTURE_PLAN"
  | "PAST_REFERENCE"
  | "UNVERIFIED";

export interface ClassifyObservationInput {
  /** growth_event 또는 diary 일지에서 추출한 텍스트 (nullable) */
  evidenceText: string | null | undefined;
  /** growth_events.source 값: 'teacher_ai' | 'teacher_manual' | 기타 */
  evidenceSource: string | null | undefined;
}

export interface ClassifyObservationResult {
  observationType: ObservationType;
  isGaugeEligible: boolean;
  /** 내부 diagnostic — 어떤 규칙/패턴이 매치됐는지 (테스트·로깅용) */
  matchedRule: string;
}

// ── Eligible type 집합 (DB CHECK와 일치) ──────────────────────────────────────

const ELIGIBLE_TYPES = new Set<ObservationType>([
  "ACTUAL_TAUGHT",
  "REVIEW",
  "CORRECTION",
]);

// ── Pattern 정의 ──────────────────────────────────────────────────────────────

/**
 * FUTURE_PLAN 패턴.
 * 미래 의도·계획·예정을 나타내는 표현.
 * Priority 1 — 다른 keyword가 함께 있어도 미래 문맥이 우선.
 */
const FUTURE_PLAN_PATTERNS: RegExp[] = [
  /다음\s*(시간|수업|번|에)/,
  /배울\s*예정/,
  /할\s*예정/,
  /해볼\s*예정/,
  /진행할\s*예정/,
  /연습할\s*예정/,
  /할\s*거예요/,
  /할\s*거야/,
  /배우게\s*될/,
  /이후에/,
  /다음\s*단계는/,
  // 영어
  /next\s+time/i,
  /will\s+learn/i,
  /plan\s+to/i,
  /going\s+to\s+practice/i,
];

/**
 * PAST_REFERENCE 패턴 (단독 지표).
 * 오늘 수행 표현이 없을 때 PAST_REFERENCE로 분류.
 */
const PAST_REFERENCE_PATTERNS: RegExp[] = [
  /지난\s*(번|시간|수업)/,
  /저번에/,
  /예전에/,
  /이전에/,
  /전에\s*배웠던/,
  /이전\s*시간에/,
  // 영어
  /last\s+time/i,
  /previously/i,
  /before/i,
];

/**
 * 오늘 수행 표현 패턴.
 * PAST_REFERENCE 문맥이 있어도 오늘 수행이 확인되면 REVIEW/CORRECTION 분류 가능.
 */
const TODAY_PERFORMANCE_PATTERNS: RegExp[] = [
  /오늘/,
  /금일/,
  /이번\s*시간/,
  /진행했/,
  /수행했/,
  /연습했/,
  /복습했/,
  /교정했/,
  /다시\s*(잡|해|교정)/,
  /했습니다/,
  /했어요/,
  /했다/,
  /했음/,
];

/**
 * CORRECTION 패턴.
 * 오늘 수행이 확인될 때 eligible.
 */
const CORRECTION_PATTERNS: RegExp[] = [
  /교정/,
  /자세를\s*고침/,
  /자세\s*수정/,
  /수정/,
  /고쳐/,
  /다시\s*잡음/,
  /다시\s*잡아/,
  /자세를\s*다시/,
  /동작을\s*바로잡/,
  /교정\s*연습/,
];

/**
 * REVIEW 패턴.
 * 오늘 수행이 확인될 때 eligible.
 */
const REVIEW_PATTERNS: RegExp[] = [
  /복습/,
  /다시\s*연습/,
  /다시\s*해봄/,
  /다시\s*수행/,
  /반복\s*연습/,
  /재확인/,
  /확인\s*연습/,
];

/**
 * ACTUAL_TAUGHT 긍정 지표.
 * 현재 수업을 나타내는 표현 — fallback용.
 */
const ACTUAL_TAUGHT_PATTERNS: RegExp[] = [
  /연습했/,
  /진행했/,
  /배웠/,
  /익혔/,
  /수행했/,
  /했습니다/,
  /했어요/,
  /했다/,
  /했음/,
  /완료/,
  /실시/,
  /practiced/i,
  /completed/i,
  /taught/i,
  /worked\s+on/i,
];

// ── Helper ────────────────────────────────────────────────────────────────────

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * evidenceText와 evidenceSource를 받아 observation type을 반환한다.
 *
 * fail-closed 보장:
 *   - NULL/빈 text + teacher_ai → UNVERIFIED
 *   - 알 수 없는 source → UNVERIFIED
 *   - 분류 불가능 → UNVERIFIED
 */
export function classifyObservationType(
  input: ClassifyObservationInput
): ClassifyObservationResult {
  const { evidenceText, evidenceSource } = input;

  // ── 1. source 검증 ─────────────────────────────────────────────────────────

  const source = (evidenceSource ?? "").trim();

  if (!source || (source !== "teacher_ai" && source !== "teacher_manual")) {
    return {
      observationType: "UNVERIFIED",
      isGaugeEligible: false,
      matchedRule: "UNKNOWN_SOURCE",
    };
  }

  // ── 2. teacher_manual: 교사 explicit selection → ACTUAL_TAUGHT ────────────

  if (source === "teacher_manual") {
    return {
      observationType: "ACTUAL_TAUGHT",
      isGaugeEligible: true,
      matchedRule: "TEACHER_MANUAL_EXPLICIT_SELECTION",
    };
  }

  // ── 3. teacher_ai: evidenceText 필수 ──────────────────────────────────────

  const rawText = evidenceText ?? "";
  const text = rawText.trim();

  if (!text) {
    return {
      observationType: "UNVERIFIED",
      isGaugeEligible: false,
      matchedRule: "TEACHER_AI_NULL_TEXT",
    };
  }

  // ── 4. Priority 1: FUTURE_PLAN ────────────────────────────────────────────
  // 미래 문맥은 다른 모든 keyword보다 우선.
  // "다음 시간에 자유형 교정 예정" → FUTURE_PLAN (교정 keyword 무시)

  if (matches(text, FUTURE_PLAN_PATTERNS)) {
    return {
      observationType: "FUTURE_PLAN",
      isGaugeEligible: false,
      matchedRule: "FUTURE_PLAN_PATTERN",
    };
  }

  // ── 5. Priority 2: PAST_REFERENCE (단독) ─────────────────────────────────
  // 과거 keyword가 있으면서 오늘 수행 표현이 없으면 PAST_REFERENCE.
  // "지난번에 평영을 배웠습니다." → PAST_REFERENCE
  //
  // 오늘 수행 표현이 함께 있으면 CORRECTION/REVIEW로 분류할 기회를 준다.
  // "지난번에 배운 자유형을 오늘 복습했습니다." → todayPerf=true → continue to REVIEW

  const hasPastRef = matches(text, PAST_REFERENCE_PATTERNS);
  const hasTodayPerf = matches(text, TODAY_PERFORMANCE_PATTERNS);

  if (hasPastRef && !hasTodayPerf) {
    return {
      observationType: "PAST_REFERENCE",
      isGaugeEligible: false,
      matchedRule: "PAST_REFERENCE_ONLY",
    };
  }

  // ── 6. Priority 3: CORRECTION ─────────────────────────────────────────────
  // 오늘 수행 확인 필수.
  // 과거 문맥이 있어도 오늘 수행이 있으면 eligible.
  // "지난번 자세가 무너져 오늘 다시 교정했습니다." → CORRECTION true

  if (matches(text, CORRECTION_PATTERNS) && hasTodayPerf) {
    return {
      observationType: "CORRECTION",
      isGaugeEligible: true,
      matchedRule: "CORRECTION_WITH_TODAY_PERF",
    };
  }

  // ── 7. Priority 4: REVIEW ─────────────────────────────────────────────────
  // 오늘 수행 확인 필수.
  // "지난번에 배운 자유형을 오늘 복습했습니다." → REVIEW true

  if (matches(text, REVIEW_PATTERNS) && hasTodayPerf) {
    return {
      observationType: "REVIEW",
      isGaugeEligible: true,
      matchedRule: "REVIEW_WITH_TODAY_PERF",
    };
  }

  // ── 8. Priority 5: ACTUAL_TAUGHT ─────────────────────────────────────────
  // FUTURE/PAST/CORRECTION/REVIEW 아님 + 현재 수업으로 해석 가능.

  if (matches(text, ACTUAL_TAUGHT_PATTERNS)) {
    return {
      observationType: "ACTUAL_TAUGHT",
      isGaugeEligible: true,
      matchedRule: "ACTUAL_TAUGHT_PATTERN",
    };
  }

  // ── 9. Fallback: UNVERIFIED ───────────────────────────────────────────────
  // 어떤 패턴에도 매치되지 않으면 fail-closed.

  return {
    observationType: "UNVERIFIED",
    isGaugeEligible: false,
    matchedRule: "NO_PATTERN_MATCH",
  };
}

// ── Utility exports ──────────────────────────────────────────────────────────

/** GAUGE-01 DB CHECK와 일치하는 eligible type 집합 확인용 */
export function isGaugeEligibleType(type: ObservationType): boolean {
  return ELIGIBLE_TYPES.has(type);
}

/** 허용 evidenceSource 목록 (DB CHECK와 일치) */
export const VALID_EVIDENCE_SOURCES = ["teacher_ai", "teacher_manual"] as const;
export type ValidEvidenceSource = (typeof VALID_EVIDENCE_SOURCES)[number];
