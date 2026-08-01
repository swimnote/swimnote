/**
 * diary-grounding.ts — GPT 출력 Grounding 검증기
 *
 * parser_confidence와 완전히 분리된 독립 검증 모듈.
 *
 * 역할:
 *   - GPT 최종 생성 결과가 강사 입력(inputText)의 범위를 벗어났는지 검사
 *   - 각 위반 유형별 카운트 반환
 *   - 위반 건수 기반으로 PASS / WARNING / FAIL 판정
 *
 * 비역할:
 *   - parser_confidence 참조 금지 (완전 분리)
 *   - GPT/LLM 재호출 없음 — 순수 키워드 기반 분석
 *   - DB 접근 없음
 *
 * 판정 기준:
 *   - unsupported_claim_count = 0        → PASS  (score=1.0)
 *   - unsupported_claim_count = 1~2      → WARNING (score=0.7)
 *   - unsupported_claim_count >= 3       → FAIL  (score=0.3)
 */

// ── 검출 키워드 목록 ──────────────────────────────────────────────────────────

/**
 * 미언급 기술 키워드.
 * 강사 메모에 없는데 생성 결과에 등장하면 invented_technique 카운트.
 */
const TECHNIQUE_KEYWORDS = [
  '발차기', '발 차기', '킥',
  '호흡', '브리딩',
  '자세', '체형',
  '스트로크', '팔동작', '팔 동작',
  '턴', '플립턴', '터치턴',
  '출발', '다이브', '스타트',
  '글라이드', '활공',
  '롤링',
  '스트림라인', '유선형',
  '풀', '캐치', '엔트리',
  '다리동작', '다리 동작',
  '킥판',
];

/**
 * 태도·평가 키워드.
 * 강사 메모에 없는데 생성 결과에 등장하면 invented_student_evaluation 카운트.
 */
const EVALUATION_KEYWORDS = [
  '향상', '발전', '성장', '개선',
  '기대', '기대됩니다', '기대돼',
  '잘하', '잘 하', '훌륭',
  '좋아지', '나아지', '늘었',
  '실력', '능력',
  '태도', '집중', '노력',
  '의욕', '적극',
];

/**
 * 다음 계획·미래 키워드.
 * 강사 메모에 없는데 생성 결과에 등장하면 invented_next_plan 카운트.
 */
const NEXT_PLAN_KEYWORDS = [
  '다음 수업', '다음 시간', '다음 시',
  '앞으로', '앞으론',
  '목표', '계획',
  '연습할', '익히도록', '익혀',
  '해보겠', '해 보겠',
  '이어서', '이어 나',
  '계속해서', '꾸준히',
];

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface DiaryGroundingResult {
  /** 전체 종합 상태 */
  status: 'PASS' | 'WARNING' | 'FAIL';
  /**
   * 종합 점수 (0.0~1.0).
   * 위반 0건=1.0, 1~2건=0.7, 3건+=0.3
   */
  score:                            number;
  /** 전체 위반 건수 합계 */
  unsupported_claim_count:          number;
  /** common 필드에 특정 학생 이름이 노출된 건수 */
  student_to_common_leak_count:     number;
  /** 입력에 없는 태도/평가 표현 생성 건수 */
  invented_student_evaluation_count: number;
  /** 입력에 없는 미래 계획/목표 생성 건수 */
  invented_next_plan_count:         number;
  /** 입력에 없는 수영 기술 키워드 생성 건수 */
  invented_technique_count:         number;
}

// ── 강제 정제 함수 ────────────────────────────────────────────────────────────

/**
 * common 텍스트에서 학생 이름이 포함된 문장을 코드에서 강제 제거합니다.
 *
 * GPT 판단에 의존하지 않으며, 학생 이름 변형(전체 이름·성 제외 이름) 중
 * 하나라도 포함된 문장은 무조건 삭제합니다.
 *
 * 이름 변형 규칙:
 *   - 3자 이름(서태웅) → ['서태웅', '태웅']
 *   - 4자 이름(남궁민준) → ['남궁민준', '궁민준']
 *   - 2자 이름(민준) → ['민준']
 *
 * @param common       GPT가 생성한 공통 일지 원문
 * @param studentNames 수업 학생 이름 목록 (DB 등록 이름 기준)
 * @returns            { purged: 정제된 텍스트, removedSentenceCount: 제거된 문장 수 }
 */
export function purgeStudentLeaksFromCommon(
  common: string,
  studentNames: string[],
): { purged: string; removedSentenceCount: number } {
  if (!common || studentNames.length === 0) {
    return { purged: common, removedSentenceCount: 0 };
  }

  // ── 1. 이름 변형 목록 빌드 ─────────────────────────────────────────────
  const variants = new Set<string>();
  for (const name of studentNames) {
    const n = name.trim();
    if (!n) continue;
    variants.add(n);                        // 전체 이름: '서태웅'
    if (n.length >= 3) variants.add(n.slice(1)); // 성 제외: '태웅'
    if (n.length >= 4) variants.add(n.slice(2)); // 긴 이름: '민준' (남궁민준)
  }
  const nameList = [...variants].filter(v => v.length > 0);

  // ── 2. 문장 분리 ────────────────────────────────────────────────────────
  // 마침표/!/?/~ 뒤 공백 기준으로 분리 (한국어 문장 끝 패턴)
  const sentences = common
    .split(/(?<=[.!?~])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // ── 3. 학생 이름 포함 문장 제거 ─────────────────────────────────────────
  let removedSentenceCount = 0;
  const kept = sentences.filter(sentence => {
    const hasLeak = nameList.some(v => sentence.includes(v));
    if (hasLeak) {
      removedSentenceCount++;
      return false;
    }
    return true;
  });

  return {
    purged: kept.join(' ').trim(),
    removedSentenceCount,
  };
}

// ── 검증 함수 ─────────────────────────────────────────────────────────────────

/**
 * GPT 생성 결과가 강사 입력 범위를 벗어났는지 검증합니다.
 *
 * @param result      GPT가 반환한 { common, students }
 * @param inputText   강사가 입력한 원문 메모
 * @param studentNames 수업에 참여한 학생 이름 목록 (common leak 검사용)
 */
export function validateGrounding(
  result: {
    common:   string;
    students: { student_ref: string; content: string }[];
  },
  inputText:    string,
  studentNames: string[],
): DiaryGroundingResult {
  const allOutputText = [
    result.common,
    ...result.students.map(s => s.content),
  ].join('\n');

  // ── 1. student_to_common_leak ───────────────────────────────────────────
  // common 필드에 학생 이름이 노출된 건수
  const studentToCommonLeaks = studentNames.filter(name =>
    name.trim().length > 0 && result.common.includes(name.trim()),
  );
  const student_to_common_leak_count = studentToCommonLeaks.length;

  // ── 2. invented_technique ───────────────────────────────────────────────
  // 입력에 없는 기술 키워드가 출력에 등장한 건수
  const inventedTechniques = TECHNIQUE_KEYWORDS.filter(kw =>
    allOutputText.includes(kw) && !inputText.includes(kw),
  );
  const invented_technique_count = inventedTechniques.length;

  // ── 3. invented_student_evaluation ─────────────────────────────────────
  // 입력에 없는 태도/평가 표현이 출력에 등장한 건수
  const inventedEvaluations = EVALUATION_KEYWORDS.filter(kw =>
    allOutputText.includes(kw) && !inputText.includes(kw),
  );
  const invented_student_evaluation_count = inventedEvaluations.length;

  // ── 4. invented_next_plan ───────────────────────────────────────────────
  // 입력에 없는 미래 계획/목표 표현이 출력에 등장한 건수
  const inventedNextPlans = NEXT_PLAN_KEYWORDS.filter(kw =>
    allOutputText.includes(kw) && !inputText.includes(kw),
  );
  const invented_next_plan_count = inventedNextPlans.length;

  // ── 종합 ────────────────────────────────────────────────────────────────
  const unsupported_claim_count =
    student_to_common_leak_count +
    invented_technique_count +
    invented_student_evaluation_count +
    invented_next_plan_count;

  const score =
    unsupported_claim_count === 0 ? 1.0 :
    unsupported_claim_count <= 2  ? 0.7 :
    0.3;

  const status: 'PASS' | 'WARNING' | 'FAIL' =
    unsupported_claim_count === 0 ? 'PASS' :
    unsupported_claim_count <= 2  ? 'WARNING' :
    'FAIL';

  return {
    status,
    score,
    unsupported_claim_count,
    student_to_common_leak_count,
    invented_student_evaluation_count,
    invented_next_plan_count,
    invented_technique_count,
  };
}
