/**
 * diary-parser.ts — Teacher Diary 의미 추출기
 *
 * 교사의 메모/STT 원문 텍스트에서 수영 관련 의미 요소를 추출합니다.
 *
 * 역할:
 *   - 영법, 기술 키워드, 오류/이슈 키워드 감지
 *   - parser_confidence 계산
 *
 * 비역할:
 *   - GPT/LLM 호출 없음 — 순수 키워드 기반 파싱
 *   - DB 접근 없음 — 순수 함수
 *
 * 설계 원칙:
 *   - 완전한 문장 불필요 — 메모 수준 입력 허용
 *   - 일부 의미만 추출되어도 검색 후보 생성에 활용
 *   - Parser는 AI Engine의 단일 책임 (Single Source of Truth)
 */

// ── 영법 감지 ─────────────────────────────────────────────────────────────────

/** 영법 표준명 → 검색 시 level_name 매핑에 사용 */
export type Stroke =
  | '자유형'
  | '배영'
  | '평영'
  | '접영'
  | '혼영';

/** 텍스트에서 감지할 영법 키워드 → 표준명 매핑 */
const STROKE_KEYWORDS: [string, Stroke][] = [
  ['자유형',    '자유형'],
  ['프리스타일', '자유형'],
  ['배영',      '배영'],
  ['백스트로크', '배영'],
  ['평영',      '평영'],
  ['브레스트',  '평영'],
  ['접영',      '접영'],
  ['버터플라이', '접영'],
  ['혼영',      '혼영'],
];

// ── 기술 키워드 ───────────────────────────────────────────────────────────────

/** 기술/동작 관련 키워드 (부분 일치) */
const SKILL_KEYWORDS: string[] = [
  '발차기', '발 차기', '킥',
  '호흡', '브리딩',
  '스트로크', '스트록',
  '풀', '캐치', '엔트리', '피니시',
  '글라이드', '활공',
  '롤링', '롤',
  '스트림라인', '유선형',
  '턴', '플립턴', '터치턴',
  '출발', '다이브', '스타트',
  '타이밍', '리듬',
  '킥판', '부력',
  '팔동작', '팔 동작',
  '다리동작', '다리 동작',
];

// ── 오류/이슈 키워드 ──────────────────────────────────────────────────────────

/** 신체 부위 키워드 (오류/이슈 감지에 사용) */
const BODY_PART_KEYWORDS: string[] = [
  '무릎', '팔꿈치', '머리', '허리',
  '어깨', '손목', '발목', '엉덩이',
  '몸통', '코어', '엉덩이',
];

/** 오류/상태 수식어 (신체 부위와 함께 이슈 신호) */
const ISSUE_MODIFIER_KEYWORDS: string[] = [
  '굽힘', '굽어', '굽히', '굽는',
  '가라앉', '처짐', '처져',
  '들기', '들어', '들어올',
  '벌어짐', '벌어져', '벌림',
  '뻣뻣', '딱딱', '경직',
  '늦음', '늦어', '늦는',
  '짧음', '짧아', '짧은',
  '좁음', '좁아', '좁은',
  '흔들림', '흔들', '불안정',
  '힘듦', '힘들어', '부족',
  '과도', '너무', '많이',
];

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface ExtractedMeaning {
  /** 감지된 영법 목록 (중복 없음) */
  strokes: Stroke[];
  /** 감지된 기술 키워드 목록 */
  skills: string[];
  /** 감지된 오류/이슈 관련 키워드 목록 */
  issues: string[];
  /** 전체 감지 키워드 합집합 (검색 scoring에 사용) */
  allKeywords: string[];
  /**
   * 파서 확신도 (0.0 ~ 1.0)
   *   0.2 — 키워드 미감지 (메모가 너무 짧거나 비수영 텍스트)
   *   0.5 — 1개 감지
   *   0.7 — 2개 감지
   *   0.85 — 3개 감지
   *   0.95 — 4개 이상 감지
   */
  confidence: number;
}

// ── 의미 추출 ─────────────────────────────────────────────────────────────────

/**
 * 교사 입력 텍스트에서 수영 관련 의미를 추출합니다.
 *
 * - 완전한 문장이 아니어도 동작합니다.
 * - 키워드가 없어도 오류를 던지지 않고 confidence=0.2로 반환합니다.
 * - 이 함수의 결과가 template search의 scoring 입력이 됩니다.
 *
 * @example
 * extractMeaning("태웅 자유형 발차기 무릎 많이 굽힘")
 * // → { strokes: ['자유형'], skills: ['발차기'], issues: ['무릎', '굽힘'], confidence: 0.85 }
 */
export function extractMeaning(text: string): ExtractedMeaning {
  const strokes: Stroke[]  = [];
  const skills: string[]   = [];
  const issues: string[]   = [];

  // ── 영법 감지 ─────────────────────────────────────────────────────────────
  for (const [keyword, stroke] of STROKE_KEYWORDS) {
    if (text.includes(keyword) && !strokes.includes(stroke)) {
      strokes.push(stroke);
    }
  }

  // ── 기술 키워드 감지 ──────────────────────────────────────────────────────
  for (const kw of SKILL_KEYWORDS) {
    if (text.includes(kw) && !skills.includes(kw)) {
      skills.push(kw);
    }
  }

  // ── 오류/이슈 키워드 감지 ─────────────────────────────────────────────────
  // 신체 부위 + 오류 수식어 각각 개별 감지 (AND 조건 불필요 — relaxed)
  for (const kw of BODY_PART_KEYWORDS) {
    if (text.includes(kw) && !issues.includes(kw)) {
      issues.push(kw);
    }
  }
  for (const kw of ISSUE_MODIFIER_KEYWORDS) {
    if (text.includes(kw) && !issues.includes(kw)) {
      issues.push(kw);
    }
  }

  // ── 합집합 ────────────────────────────────────────────────────────────────
  const allKeywords: string[] = [...strokes, ...skills, ...issues];

  // ── 확신도 계산 ───────────────────────────────────────────────────────────
  let confidence = 0.2;
  if (allKeywords.length >= 1) confidence = 0.5;
  if (allKeywords.length >= 2) confidence = 0.7;
  if (allKeywords.length >= 3) confidence = 0.85;
  if (allKeywords.length >= 4) confidence = 0.95;

  return { strokes, skills, issues, allKeywords, confidence };
}
