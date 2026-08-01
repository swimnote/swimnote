/**
 * diary-template-search.ts — Template Search + Ranking (V2 Normalized Scoring)
 *
 * diary_templates DB에서 교사 입력의 의미 추출 결과를 기반으로
 * 후보 템플릿을 검색하고, Ranking 상위 템플릿만 반환합니다.
 *
 * 설계 원칙:
 *   - 후보 기준: conceptOverlap >= CANDIDATE_MIN_CONCEPT_OVERLAP (0.30)
 *   - 최종 사용 기준: score >= USAGE_MIN_SCORE (1.40) AND top TOP_K_USAGE (1)
 *   - 중복 방지: strokeMatch / focusMatch 는 0|1 (여러 신호 중복 합산 금지)
 *   - Template DB는 diary_templates (global scope) 단일 소스 사용
 *   - 새로운 Template DB를 생성하지 않음
 *
 * Scoring 알고리즘 (최대 3.0점):
 *   strokeMatch      (0|1)    — level_name 영법 신호 매칭 여부 (중복 없음)
 *   focusMatch       (0|1)    — level_name 기술 신호 매칭 여부 (중복 없음)
 *   conceptOverlap   (0~1.0)  — 입력 allKeywords 중 template_text 포함 비율
 *   observationMatch (0|1)    — 입력 issues 중 template_text 매칭 여부
 *   score = strokeMatch + focusMatch + conceptOverlap + observationMatch
 *
 * 기존 문제 (V1):
 *   - LEVEL_NAME_STROKE_SIGNALS 여러 항목이 동일 영법을 중복 +3 → "자유형" 입력으로 score=10+
 *   - CANDIDATE_MIN_SCORE=1 (너무 낮음) / MAX_TEMPLATES_USED=5 (너무 많음)
 *   - grounding 검증 없이 과도한 template 적용
 */

import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import type { ExtractedMeaning, Stroke } from './diary-parser.js';

// ── 파라미터 ──────────────────────────────────────────────────────────────────

/**
 * 후보 포함 최소 conceptOverlap 임계값.
 * 입력 키워드의 30% 이상이 template_text에 포함되어야 후보.
 * 키워드가 없는 입력(confidence=0.2)은 이 필터를 적용하지 않음.
 */
export const CANDIDATE_MIN_CONCEPT_OVERLAP = 0.30;

/**
 * 실제 사용 최소 점수 (strokeMatch+focusMatch+conceptOverlap+observationMatch).
 * 1.40 이상이어야 프롬프트에 포함.
 * 영법 단독(strokeMatch=1, conceptOverlap=0) = 1.0 → 미달 → INPUT_ONLY
 */
export const USAGE_MIN_SCORE = 1.40;

/** 프롬프트에 실제 사용할 최대 템플릿 수 */
export const TOP_K_USAGE = 1;

/** 한 번에 로드할 템플릿 최대 수 (pool 전체 로드, 인메모리 scoring) */
const TEMPLATE_LOAD_LIMIT = 500;

// ── level_name → Stroke 매핑 ─────────────────────────────────────────────────

/**
 * level_name에 포함된 키워드를 통해 관련 영법을 추론합니다.
 * strokeMatch 계산 시 여러 신호가 동일 영법을 중복 매칭해도 strokeMatch=1 (최대 1회).
 */
const LEVEL_NAME_STROKE_SIGNALS: [string, Stroke[]][] = [
  ['자유형',    ['자유형']],
  ['배영',      ['배영']],
  ['평영',      ['평영']],
  ['접영',      ['접영']],
  // 특수 레벨 — 영법 유추 (strokeMatch는 아래 신호 포함 여부와 무관하게 최대 1)
  ['풀·글라이드',    ['자유형']],
  ['글라이드',       ['자유형']],
  ['롤링·스트림라인', ['자유형', '배영']],
  ['롤링',           ['자유형', '배영']],
  ['스트림라인',     ['자유형', '배영']],
];

/** level_name → 관련 기술 신호 (focusMatch 계산 시 중복 방지) */
const LEVEL_NAME_SKILL_SIGNALS: [string, string[]][] = [
  ['킥',         ['발차기', '킥']],
  ['스트로크',   ['스트로크']],
  ['호흡',       ['호흡']],
  ['글라이드',   ['글라이드']],
  ['롤링',       ['롤링']],
  ['스트림라인', ['스트림라인']],
  ['출발',       ['출발']],
  ['턴',         ['턴']],
  ['스프린트',   ['스프린트']],
];

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

/** 점수 구성 — 메타 보고 및 디버깅용 */
export interface ScoringBreakdown {
  /** level_name 영법 신호 매칭 여부 (0|1, 여러 신호 중복 합산 금지) */
  strokeMatch:      number;
  /** level_name 기술 신호 매칭 여부 (0|1, 여러 신호 중복 합산 금지) */
  focusMatch:       number;
  /** 입력 allKeywords 중 template_text에 포함된 비율 (0.0~1.0) */
  conceptOverlap:   number;
  /** 입력 issues 중 template_text에 하나 이상 매칭 여부 (0|1) */
  observationMatch: number;
  /** strokeMatch + focusMatch + conceptOverlap + observationMatch */
  score:            number;
}

export interface ScoredTemplate {
  id:            string;
  level_id:      string;
  level_name:    string;
  template_text: string;
  score:         number;
  breakdown:     ScoringBreakdown;
}

export interface TemplateSearchResult {
  /** Ranking + USAGE_MIN_SCORE 통과 템플릿 (프롬프트에 실제 사용) */
  usedTemplates:    ScoredTemplate[];
  /** 후보 총 수 (candidate_count 메타데이터용) */
  candidateCount:   number;
  /** 프롬프트에 사용된 수 */
  usedCount:        number;
  /** 상위 점수 */
  topScore:         number;
  /** pool에 템플릿이 존재하지 않아 전역 fallback 사용 여부 */
  usedFallbackPool: boolean;
  /** 후보 템플릿 실제 DB ID 목록 (meta candidate_ids 용) */
  candidateIds:     string[];
  /** 상위 템플릿 점수 구성 (meta 보고용, 없으면 null) */
  topBreakdown:     ScoringBreakdown | null;
}

// ── 내부 타입 ─────────────────────────────────────────────────────────────────

interface RawTemplate {
  id:            string;
  level_id:      string;
  level_name:    string | null;
  template_text: string;
}

// ── 스코어링 ──────────────────────────────────────────────────────────────────

/**
 * 단일 템플릿에 대해 정규화된 점수 구성을 계산합니다.
 *
 * 핵심 원칙:
 *   - strokeMatch / focusMatch 는 최대 1 (여러 신호가 같은 영법/기술을 중복 가산하지 않음)
 *   - 영법 단독(strokeMatch=1, 나머지=0) = 1.0 → USAGE_MIN_SCORE=1.40 미달 → 미사용
 *   - conceptOverlap은 template_text 기반 (level_name 제외) — 실제 내용 관련성 측정
 */
function scoreTemplate(
  tpl:     RawTemplate,
  meaning: ExtractedMeaning,
): ScoringBreakdown {
  const levelName = tpl.level_name ?? '';
  const text      = tpl.template_text;

  // ── 1. strokeMatch (0|1) ─────────────────────────────────────────────────
  // level_name 신호를 순회, 하나라도 입력 영법과 매칭되면 1 (이후 중단)
  let strokeMatch = 0;
  strokeLoop: for (const [signal, strokes] of LEVEL_NAME_STROKE_SIGNALS) {
    if (levelName.includes(signal)) {
      for (const stroke of strokes) {
        if (meaning.strokes.includes(stroke)) {
          strokeMatch = 1;
          break strokeLoop;
        }
      }
    }
  }

  // ── 2. focusMatch (0|1) ──────────────────────────────────────────────────
  // level_name 기술 신호를 순회, 하나라도 입력 기술과 매칭되면 1 (이후 중단)
  let focusMatch = 0;
  focusLoop: for (const [signal, skills] of LEVEL_NAME_SKILL_SIGNALS) {
    if (levelName.includes(signal)) {
      for (const skill of skills) {
        if (meaning.skills.includes(skill)) {
          focusMatch = 1;
          break focusLoop;
        }
      }
    }
  }

  // ── 3. conceptOverlap (0.0~1.0) ─────────────────────────────────────────
  // 입력 allKeywords 중 template_text에 포함된 비율
  // (level_name 제외 — template_text의 실제 내용 관련성 측정)
  const inputKws = meaning.allKeywords;
  const conceptOverlap = inputKws.length === 0
    ? 0
    : inputKws.filter(kw => text.includes(kw)).length / inputKws.length;

  // ── 4. observationMatch (0|1) ────────────────────────────────────────────
  // 입력 이슈 키워드(신체 부위·오류) 중 template_text에 하나라도 포함
  const observationMatch =
    meaning.issues.length > 0 && meaning.issues.some(iss => text.includes(iss)) ? 1 : 0;

  const score = strokeMatch + focusMatch + conceptOverlap + observationMatch;

  return { strokeMatch, focusMatch, conceptOverlap, observationMatch, score };
}

// ── 메인 검색 함수 ────────────────────────────────────────────────────────────

/**
 * 교사 입력 의미에 기반하여 템플릿을 검색하고 Ranking합니다.
 *
 * 후보 생성 기준 (CANDIDATE_MIN_CONCEPT_OVERLAP):
 *   - 입력 키워드가 있는 경우: conceptOverlap >= 0.30 이상인 것만 후보
 *   - 후보가 0개이면: strokeMatch > 0 인 것을 최대 3개 fallback 후보로 추가
 *   - 입력 키워드가 없는 경우: 전체 후보 (sort_order 기반 fallback)
 *
 * 최종 사용 기준:
 *   - score >= USAGE_MIN_SCORE (1.40) AND top TOP_K_USAGE (1) 개
 */
export async function searchTemplates(
  poolId:  string,
  meaning: ExtractedMeaning,
): Promise<TemplateSearchResult> {

  // ── 1. Pool 전용 템플릿 로드 ────────────────────────────────────────────
  let rows = await loadTemplates(poolId);
  let usedFallbackPool = false;

  if (rows.length === 0) {
    rows = await loadTemplatesAnyPool();
    usedFallbackPool = true;
  }

  if (rows.length === 0) {
    return {
      usedTemplates:    [],
      candidateCount:   0,
      usedCount:        0,
      topScore:         0,
      usedFallbackPool: false,
      candidateIds:     [],
      topBreakdown:     null,
    };
  }

  // ── 2. Scoring (정규화) ────────────────────────────────────────────────
  const scored: ScoredTemplate[] = rows.map(tpl => {
    const breakdown = scoreTemplate(tpl, meaning);
    return {
      id:            tpl.id,
      level_id:      tpl.level_id,
      level_name:    tpl.level_name ?? '',
      template_text: tpl.template_text,
      score:         breakdown.score,
      breakdown,
    };
  });

  // ── 3. 후보 필터링 ─────────────────────────────────────────────────────
  const hasAnySignal = meaning.allKeywords.length > 0;

  let candidates: ScoredTemplate[];
  if (hasAnySignal) {
    // 입력 키워드 있음: conceptOverlap >= CANDIDATE_MIN_CONCEPT_OVERLAP
    candidates = scored.filter(t => t.breakdown.conceptOverlap >= CANDIDATE_MIN_CONCEPT_OVERLAP);

    // 후보가 0개이면: strokeMatch > 0 인 것을 최대 3개 fallback 추가
    // (conceptOverlap 기준 미달이지만 영법 level_name 매칭 있음)
    if (candidates.length === 0) {
      candidates = scored
        .filter(t => t.breakdown.strokeMatch > 0 || t.breakdown.focusMatch > 0)
        .slice(0, 3);
    }
  } else {
    // 입력 키워드 없음 — 모든 템플릿이 후보 (sort_order 순)
    candidates = scored;
  }

  // ── 4. Ranking (score desc, 동점 시 DB 순서 유지) ─────────────────────
  candidates.sort((a, b) => b.score - a.score);

  // ── 5. 최종 사용 (score >= USAGE_MIN_SCORE AND top TOP_K_USAGE 개) ─────
  const usedTemplates = candidates
    .filter(t => t.score >= USAGE_MIN_SCORE)
    .slice(0, TOP_K_USAGE);

  const topScore     = usedTemplates[0]?.score ?? 0;
  const topBreakdown = usedTemplates[0]?.breakdown ?? null;

  return {
    usedTemplates,
    candidateCount:   candidates.length,
    usedCount:        usedTemplates.length,
    topScore,
    usedFallbackPool,
    candidateIds:     candidates.map(t => t.id),
    topBreakdown,
  };
}

// ── DB 쿼리 헬퍼 ─────────────────────────────────────────────────────────────

async function loadTemplates(poolId: string): Promise<RawTemplate[]> {
  const result = await db.execute(sql`
    SELECT
      dt.id,
      dt.level_id,
      dtl.level_name,
      dt.template_text
    FROM diary_templates dt
    LEFT JOIN diary_template_levels dtl ON dtl.id = dt.level_id
    WHERE dt.swimming_pool_id = ${poolId}
      AND dt.scope     = 'global'
      AND dt.is_active = true
    ORDER BY dt.sort_order ASC
    LIMIT ${TEMPLATE_LOAD_LIMIT}
  `);
  return result.rows as unknown as RawTemplate[];
}

async function loadTemplatesAnyPool(): Promise<RawTemplate[]> {
  const result = await db.execute(sql`
    SELECT
      dt.id,
      dt.level_id,
      dtl.level_name,
      dt.template_text
    FROM diary_templates dt
    LEFT JOIN diary_template_levels dtl ON dtl.id = dt.level_id
    WHERE dt.scope     = 'global'
      AND dt.is_active = true
    ORDER BY dt.sort_order ASC
    LIMIT ${TEMPLATE_LOAD_LIMIT}
  `);
  return result.rows as unknown as RawTemplate[];
}
