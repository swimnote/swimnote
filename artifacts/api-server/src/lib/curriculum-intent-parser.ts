/**
 * curriculum-intent-parser.ts — WP-A Intent Parser
 *
 * 학부모 자연어 질문을 GPT 없이 deterministic하게 의도 분류.
 *
 * 원칙:
 *   - GPT 사용 금지 (WP-A 기본 경로)
 *   - 한국어 구어체 variation 처리
 *   - HUMAN_ONLY는 최우선 판정 (서버가 답변 불가능한 경우)
 *   - 우선순위: HUMAN_ONLY > STROKE_PROGRESS > SKILL_STATUS > NEXT_STEP
 *               > RECENT_LESSONS > LEVEL_PROGRESS > PROGRESS_CHANGE
 *               > WHY_CURRENT_STEP > CURRICULUM_INFO > CURRENT_PROGRESS > UNKNOWN
 */

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export type CurriculumIntent =
  | "CURRENT_PROGRESS"   // 전반적 진행 상황 ("어디까지 했어요?")
  | "STROKE_PROGRESS"    // 특정 영법 진행 ("자유형 어디까지 했어요?")
  | "SKILL_STATUS"       // 특정 기술 여부 ("평영킥 했어요?")
  | "NEXT_STEP"          // 다음 배울 내용 ("다음에 뭐 배워요?")
  | "RECENT_LESSONS"     // 최근 수업 내용 ("요즘 뭐 배워요?")
  | "LEVEL_PROGRESS"     // 레벨/급 진행 ("몇 급이에요?")
  | "PROGRESS_CHANGE"    // 변화/발전 ("최근에 나아진 게 있나요?")
  | "WHY_CURRENT_STEP"   // 현재 단계 이유 ("왜 이걸 배워요?")
  | "CURRICULUM_INFO"    // 커리큘럼 정보 ("수업 내용이 뭐예요?")
  | "CURRICULUM_GENERAL" // 수영장 커리큘럼 일반 검색 — 개인 진도 불필요 ("접영 언제 배워?", "발차기 과정")
  | "HUMAN_ONLY"         // 서버 답변 불가 ("왜 진급 안 시켜줘요?")
  | "UNKNOWN";           // 분류 불가

export interface ParsedIntent {
  intent: CurriculumIntent;
  /** 감지된 영법 이름 (STROKE_PROGRESS 또는 SKILL_STATUS 시) */
  stroke?: string;
  /** 감지된 기술명 (SKILL_STATUS 시) */
  skill?: string;
  /** HIGH = 패턴 명확, LOW = 약한 매칭 */
  confidence: "HIGH" | "LOW";
}

// ── 내부 상수 ─────────────────────────────────────────────────────────────────

const STROKES: readonly string[] = [
  "자유형", "프리스타일",
  "배영", "백스트로크",
  "평영", "브레스트",
  "접영", "버터플라이",
  "개인혼영", "혼영",
  "킥", "발차기",
];

// STROKE_PROGRESS 트리거: 영법 + 진도 질문
const PROGRESS_TRIGGERS = [
  "어디까지", "어디쯤", "얼마나", "어느 단계", "어느단계",
  "어느 수준", "어느수준", "몇 단계", "진도",
  "어디서", "어디 까지",
];

// SKILL_STATUS 트리거: 특정 기술/동작 여부 질문
const SKILL_STATUS_TRIGGERS = [
  "했어요", "했나요", "했어", "했나",
  "배웠어요", "배웠나요", "배웠어", "배웠나",
  "할 수 있어요", "할수있어요", "할 수 있나요", "할수있나요",
  "가르쳐줬어요", "가르쳐줬나요",
  "연습했어요", "연습했나요",
  "익혔어요", "익혔나요",
  "됐어요", "됐나요",
];

// NEXT_STEP 트리거
const NEXT_STEP_TRIGGERS = [
  "다음에", "다음은", "다음 단계", "다음단계",
  "이후에", "이후는", "그 다음", "그다음",
  "앞으로", "앞으로는",
  "뭐 배울", "뭐 가르칠", "뭐를 배울",
];

// RECENT_LESSONS 트리거
const RECENT_TRIGGERS = [
  "요즘", "최근", "이번에", "요번에", "이번 수업",
  "지금은", "지금 뭐", "지금 배우는", "지금 배우고",
  "요즘 뭐", "요번", "이번",
];

// HUMAN_ONLY 트리거 (최우선 판정)
const HUMAN_ONLY_TRIGGERS = [
  "왜 진급 안",  "진급 안 시켜", "진급 안시켜",
  "언제 진급",   "진급 언제",
  "다음주",      "내일",        "이번 주",      "이번주",
  "정확히 언제", "진급 가능",   "진급 가능성",
  "언제 올라", "올라갈 수 있어", "올라갈수있어",
  "몇 주", "몇주 안에", "언제쯤 될",
  "언제쯤 진급",
];

// LEVEL_PROGRESS 트리거
const LEVEL_TRIGGERS = [
  "레벨", "급수", "몇 급", "몇급", "level",
  "진급", "승급", "올라간", "올라갔",
  "어떤 레벨", "어떤레벨",
];

// PROGRESS_CHANGE 트리거
const CHANGE_TRIGGERS = [
  "나아진", "나아졌", "발전", "향상",
  "달라진", "달라졌", "변화", "좋아진",
  "좋아졌", "늘었어", "늘었나",
];

// WHY_CURRENT_STEP 트리거
const WHY_TRIGGERS = [
  "왜 지금", "왜 이걸", "왜 이것", "왜 배워요", "왜 배워",
  "왜 이 단계", "왜이걸", "이유가 뭐",
  "왜 아직", "왜 이 기술",
];

// CURRICULUM_INFO 트리거
const CURRICULUM_INFO_TRIGGERS = [
  "커리큘럼", "교육 과정", "교육과정",
  "수업 내용", "수업내용", "수업 순서", "어떻게 구성",
  "어떤 걸 배워", "어떤걸 배워", "뭘 배워요", "뭘 가르쳐",
];

// CURRICULUM_GENERAL 트리거 — 수영장 커리큘럼 구조/시점 질문 (개인 진도 불필요)
// 예: "접영 언제 배워?", "자유형킥은 언제 해?", "발차기 과정", "평영 다음에 뭐 해?"
const CURRICULUM_GENERAL_TRIGGERS = [
  "언제 배워", "언제배워",
  "언제 해요", "언제해요", "언제 하나요", "언제하나요",
  "언제 시작", "언제시작", "언제 가르쳐", "언제가르쳐",
  "어떻게 배우는", "어떻게배우는",
  "배우는 과정", "배우는과정",
  "과정 알려", "과정알려",
  "과정이 뭐", "과정이뭐",
  "어떤 과정", "어떤과정",
  "뭐부터 배워", "뭐부터배워",
  "어떤 순서", "어떤순서",
  "순서가 뭐", "순서가뭐",
  "몇 단계부터", "몇단계부터",
  "언제 배우나요", "언제배우나요",
  "언제 나와요", "언제나와요",
];

// 개인 진도 질문 마커 — 이 마커가 있으면 CURRICULUM_GENERAL 분류 제외
const PERSONAL_MARKERS = [
  "우리 아이", "우리아이",
  "제 아이", "제아이",
  "아이가 ", "아이는 ",
  "아이 지금", "아이지금",
];

// CURRENT_PROGRESS 트리거 (범용)
const CURRENT_PROGRESS_TRIGGERS = [
  "어디까지", "어디쯤", "어느 단계", "어느단계",
  "어디 왔어", "어느 수준", "지금 어디",
  "현재", "얼마나 됐", "얼마나 했",
];

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function detectStroke(text: string): string | undefined {
  for (const stroke of STROKES) {
    if (text.includes(stroke)) return stroke;
  }
  return undefined;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 학부모 질문을 분석하여 ParsedIntent를 반환.
 *
 * GPT 사용 없음 — 완전 deterministic.
 */
export function parseIntent(query: string): ParsedIntent {
  const text = normalize(query);

  // 0. 개인 진도 마커 여부 (CURRICULUM_GENERAL 분류 제외 기준)
  const hasPersonalMarker = containsAny(text, PERSONAL_MARKERS);

  // 1. HUMAN_ONLY 최우선 (서버가 답변 불가능한 질문)
  if (containsAny(text, HUMAN_ONLY_TRIGGERS)) {
    return { intent: "HUMAN_ONLY", confidence: "HIGH" };
  }

  // 1b. CURRICULUM_GENERAL — 수영장 커리큘럼 구조/시점 질문
  //     개인 진도 마커가 없고, 커리큘럼 일반 트리거가 있을 때.
  //     예: "접영 언제 배워?", "발차기 과정 알려줘", "자유형킥은 언제 해?"
  //     HUMAN_ONLY 다음으로 검사 — 개인 마커가 있어도 진도 트리거가 없으면
  //     CURRICULUM_GENERAL로 분류한다(예: "우리 아이 접영 언제 배워?" →
  //     개인 진도 기록이 없더라도 수영장 커리큘럼 검색으로 답변 가능).
  if (containsAny(text, CURRICULUM_GENERAL_TRIGGERS)) {
    const stroke = detectStroke(text);
    return {
      intent: "CURRICULUM_GENERAL",
      ...(stroke ? { stroke } : {}),
      confidence: "HIGH",
    };
  }

  // 2. STROKE_PROGRESS — 영법 + 진도 질문
  const stroke = detectStroke(text);
  if (stroke && containsAny(text, PROGRESS_TRIGGERS)) {
    return { intent: "STROKE_PROGRESS", stroke, confidence: "HIGH" };
  }

  // 3. SKILL_STATUS — 영법 or 기술 + 완료 여부 질문
  //    단, 진도 트리거("어디까지" 등)가 함께 있으면 CURRENT/STROKE_PROGRESS 우선 → SKIP
  if (stroke && containsAny(text, SKILL_STATUS_TRIGGERS) && !containsAny(text, PROGRESS_TRIGGERS) && !containsAny(text, CURRENT_PROGRESS_TRIGGERS)) {
    return { intent: "SKILL_STATUS", stroke, confidence: "HIGH" };
  }
  // stroke 없이 기술 여부 질문 (예: "그 동작 배웠어요?")
  //    진도 트리거("어디까지 했어요?")와 중복 시 SKILL_STATUS 제외
  if (!stroke && containsAny(text, SKILL_STATUS_TRIGGERS) && !containsAny(text, PROGRESS_TRIGGERS) && !containsAny(text, CURRENT_PROGRESS_TRIGGERS)) {
    return { intent: "SKILL_STATUS", confidence: "HIGH" };
  }

  // 4. NEXT_STEP — 다음 배울 내용
  if (containsAny(text, NEXT_STEP_TRIGGERS)) {
    return { intent: "NEXT_STEP", confidence: "HIGH" };
  }

  // 5. RECENT_LESSONS — 최근 수업 내용
  if (containsAny(text, RECENT_TRIGGERS)) {
    return { intent: "RECENT_LESSONS", confidence: "HIGH" };
  }

  // 6. LEVEL_PROGRESS — 레벨/급 진행 (HUMAN_ONLY가 아닌 단순 확인)
  if (containsAny(text, LEVEL_TRIGGERS)) {
    return { intent: "LEVEL_PROGRESS", confidence: "HIGH" };
  }

  // 7. PROGRESS_CHANGE — 발전/변화
  if (containsAny(text, CHANGE_TRIGGERS)) {
    return { intent: "PROGRESS_CHANGE", confidence: "HIGH" };
  }

  // 8. WHY_CURRENT_STEP — 현재 단계 이유 (단, HUMAN_ONLY 아님)
  if (containsAny(text, WHY_TRIGGERS)) {
    return { intent: "WHY_CURRENT_STEP", confidence: "HIGH" };
  }

  // 9. CURRICULUM_INFO — 커리큘럼 일반 정보
  if (containsAny(text, CURRICULUM_INFO_TRIGGERS)) {
    return { intent: "CURRICULUM_INFO", confidence: "HIGH" };
  }

  // 10. CURRENT_PROGRESS — 범용 진도 질문
  if (containsAny(text, CURRENT_PROGRESS_TRIGGERS)) {
    return { intent: "CURRENT_PROGRESS", confidence: "HIGH" };
  }

  // 11. stroke만 있고 진도/기술 트리거 없음
  //     개인 마커 없음 → 수영장 커리큘럼 일반 검색 (예: "자유형킥", "발차기")
  //     개인 마커 있음 → 개인 진도 질문 (예: "우리 아이 접영") → STROKE_PROGRESS LOW
  if (stroke) {
    if (!hasPersonalMarker) {
      return { intent: "CURRICULUM_GENERAL", stroke, confidence: "LOW" };
    }
    return { intent: "STROKE_PROGRESS", stroke, confidence: "LOW" };
  }

  return { intent: "UNKNOWN", confidence: "LOW" };
}
