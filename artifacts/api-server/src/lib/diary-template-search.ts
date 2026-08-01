/**
 * diary-template-search.ts — Template Search + Ranking
 *
 * diary_templates DB에서 교사 입력의 의미 추출 결과를 기반으로
 * 후보 템플릿을 폭넓게 검색하고, Ranking 상위 템플릿만 반환합니다.
 *
 * 설계 원칙:
 *   - 후보 생성 기준: 낮게 (score ≥ CANDIDATE_MIN_SCORE)
 *   - 최종 사용 기준: 높게 (top MAX_TEMPLATES_USED 개)
 *   - Template DB는 diary_templates (global scope) 단일 소스 사용
 *   - 새로운 Template DB를 생성하지 않음
 *
 * Scoring 알고리즘:
 *   1. level_name 기반 영법/기술 매칭 → 높은 가중치 (수업 주제 일치)
 *   2. template_text 키워드 매칭 → 낮은 가중치 (세부 내용 관련성)
 */

import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import type { ExtractedMeaning, Stroke } from './diary-parser.js';

// ── 파라미터 ──────────────────────────────────────────────────────────────────

/** 후보 포함 최소 점수 (relaxed) — 1개 이상 일치하면 후보 */
const CANDIDATE_MIN_SCORE = 1;

/** 프롬프트에 실제 사용할 최대 템플릿 수 (strict ranking) */
const MAX_TEMPLATES_USED = 5;

/** 한 번에 로드할 템플릿 최대 수 (pool 전체 로드, 인메모리 scoring) */
const TEMPLATE_LOAD_LIMIT = 500;

// ── level_name → Stroke 매핑 ─────────────────────────────────────────────────

/**
 * level_name에 포함된 키워드를 통해 관련 영법을 추론합니다.
 * 예: "흰색: 자유형" → ['자유형']
 *     "평영킥·파란레벨테스트" → ['평영']
 *     "풀·글라이드" → ['자유형'] (풀/글라이드는 자유형 주 동작)
 *     "롤링·스트림라인" → ['자유형'] (롤링은 자유형/배영 관련)
 */
const LEVEL_NAME_STROKE_SIGNALS: [string, Stroke[]][] = [
  ['자유형',    ['자유형']],
  ['배영',      ['배영']],
  ['평영',      ['평영']],
  ['접영',      ['접영']],
  // 특수 레벨 — 영법 유추
  ['풀·글라이드',    ['자유형']],
  ['글라이드',       ['자유형']],
  ['롤링·스트림라인', ['자유형', '배영']],
  ['롤링',           ['자유형', '배영']],
  ['스트림라인',     ['자유형', '배영']],
];

/** level_name → 관련 기술 신호 */
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

export interface ScoredTemplate {
  id:            string;
  level_id:      string;
  level_name:    string;
  template_text: string;
  score:         number;
}

export interface TemplateSearchResult {
  /** Ranking 상위 템플릿 (프롬프트에 실제 사용) */
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
}

// ── 내부 타입 ─────────────────────────────────────────────────────────────────

interface RawTemplate {
  id:            string;
  level_id:      string;
  level_name:    string | null;
  template_text: string;
}

// ── 스코어링 ──────────────────────────────────────────────────────────────────

/** 단일 템플릿에 대해 점수를 계산합니다. */
function scoreTemplate(
  tpl:     RawTemplate,
  meaning: ExtractedMeaning,
): number {
  let score = 0;
  const levelName = tpl.level_name ?? '';
  const text      = tpl.template_text;

  // ── 1. level_name 영법 일치 (가중치 3) ──────────────────────────────────
  for (const [signal, strokes] of LEVEL_NAME_STROKE_SIGNALS) {
    if (levelName.includes(signal)) {
      for (const stroke of strokes) {
        if (meaning.strokes.includes(stroke)) {
          score += 3;
          break;
        }
      }
    }
  }

  // ── 2. level_name 기술 일치 (가중치 2) ──────────────────────────────────
  for (const [signal, skills] of LEVEL_NAME_SKILL_SIGNALS) {
    if (levelName.includes(signal)) {
      for (const skill of skills) {
        if (meaning.skills.includes(skill)) {
          score += 2;
          break;
        }
      }
    }
  }

  // ── 3. template_text 키워드 일치 (가중치 1) ─────────────────────────────
  for (const kw of meaning.allKeywords) {
    if (text.includes(kw)) {
      score += 1;
    }
  }

  return score;
}

// ── 메인 검색 함수 ────────────────────────────────────────────────────────────

/**
 * 교사 입력 의미에 기반하여 템플릿을 검색하고 Ranking합니다.
 *
 * - 후보 생성 기준은 낮게 (relaxed): CANDIDATE_MIN_SCORE 이상
 * - 최종 사용 기준은 높게 (strict): Ranking 상위 MAX_TEMPLATES_USED 개
 * - 키워드를 전혀 추출하지 못한 경우에도 fallback 샘플 반환
 */
export async function searchTemplates(
  poolId:  string,
  meaning: ExtractedMeaning,
): Promise<TemplateSearchResult> {

  // ── 1. Pool 전용 템플릿 로드 ────────────────────────────────────────────
  let rows = await loadTemplates(poolId);
  let usedFallbackPool = false;

  // Pool에 템플릿이 없으면 임의 Pool로 fallback
  if (rows.length === 0) {
    rows = await loadTemplatesAnyPool();
    usedFallbackPool = true;
  }

  if (rows.length === 0) {
    // DB에 아무 템플릿도 없음 (비어있는 상태)
    return {
      usedTemplates:    [],
      candidateCount:   0,
      usedCount:        0,
      topScore:         0,
      usedFallbackPool: false,
      candidateIds:     [],
    };
  }

  // ── 2. Scoring ─────────────────────────────────────────────────────────
  const scored: ScoredTemplate[] = rows.map(tpl => ({
    id:            tpl.id,
    level_id:      tpl.level_id,
    level_name:    tpl.level_name ?? '',
    template_text: tpl.template_text,
    score:         scoreTemplate(tpl, meaning),
  }));

  // ── 3. 후보 필터링 (relaxed) ────────────────────────────────────────────
  // 키워드가 전혀 없는 경우(confidence 낮음): 모든 템플릿이 score=0
  // → 전체를 후보로 간주하여 sort_order 기반 fallback 처리
  const hasAnySignal = meaning.allKeywords.length > 0;

  let candidates: ScoredTemplate[];
  if (hasAnySignal) {
    candidates = scored.filter(t => t.score >= CANDIDATE_MIN_SCORE);
    // 후보가 너무 적으면 (3개 미만) score=0 템플릿도 일부 추가 (fallback)
    if (candidates.length < 3) {
      const extras = scored
        .filter(t => t.score < CANDIDATE_MIN_SCORE)
        .slice(0, 5 - candidates.length);
      candidates = [...candidates, ...extras];
    }
  } else {
    // 키워드 없음 — 모든 템플릿이 후보 (sort_order 순)
    candidates = scored;
  }

  // ── 4. Ranking (score desc, 동점 시 DB 순서 유지) ──────────────────────
  candidates.sort((a, b) => b.score - a.score);

  // ── 5. 최종 사용 (strict top N) ─────────────────────────────────────────
  const usedTemplates = candidates.slice(0, MAX_TEMPLATES_USED);
  const topScore      = usedTemplates[0]?.score ?? 0;

  return {
    usedTemplates,
    candidateCount:   candidates.length,
    usedCount:        usedTemplates.length,
    topScore,
    usedFallbackPool,
    candidateIds:     candidates.map(t => t.id),
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
