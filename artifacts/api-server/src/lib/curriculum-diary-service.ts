/**
 * curriculum-diary-service.ts
 *
 * ACTIVE Curriculum 기반 일지 템플릿 화면 + Normal AI Diary 검색 서비스.
 *
 * 설계 원칙:
 *   - curriculum_items 가 APP의 Curriculum 정본 (diary_templates 복제 금지)
 *   - pool_level_settings 로 level_name 조회 (level_order 기준)
 *   - ACTIVE curriculum = is_active=true AND import_status='ACTIVE'
 *   - source_trace 필드를 검색 텍스트로 사용 (title + goal + coaching_point 합성)
 */

import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import type { ExtractedMeaning } from './diary-parser.js';
import {
  CANDIDATE_MIN_CONCEPT_OVERLAP,
  USAGE_MIN_SCORE,
  TOP_K_USAGE,
  type ScoringBreakdown,
  type ScoredTemplate,
  type TemplateSearchResult,
} from './diary-template-search.js';

// ── 타입 정의 ────────────────────────────────────────────────────────────────

export interface CurriculumVersion {
  id:          string;
  pool_id:     string;
  version_name: string;
  is_active:   boolean;
  import_status: string;
}

export interface CurriculumLevel {
  level_order:   number;
  level_name:    string;
  node_count:    number;   // is_test_item=false 기준
  test_count:    number;
}

export interface CurriculumNode {
  id:               string;
  display_no:       string;
  level_order:      number;
  sequence_in_level: number;
  stroke:           string;
  domain:           string;
  skill_group:      string;
  atomic_skill:     string;
  title:            string;
  source_trace:     string;
  is_test_item:     boolean;
  goal?:            string;
  coaching_point?:  string;
}

// ── 내부 타입 ────────────────────────────────────────────────────────────────

interface RawCurriculumNode {
  id:               string;
  display_no:       string;
  level_order:      number;
  stroke:           string;
  domain:           string;
  skill_group:      string;
  atomic_skill:     string;
  title:            string;
  source_trace:     string | null;
}

// stroke enum → 한글 레이블 (표시용)
export const STROKE_LABELS: Record<string, string> = {
  general:      '공통/물적응',
  freestyle:    '자유형',
  backstroke:   '배영',
  breaststroke: '평영',
  butterfly:    '접영',
  im:           'IM',
};

// domain enum → 한글 레이블
export const DOMAIN_LABELS: Record<string, string> = {
  water_adaptation: '물적응',
  breathing:        '호흡',
  technique:        '기술',
  coordination:     '협응',
  endurance:        '지구력',
};

// ── Stroke / Domain 매핑 (Normal AI Diary 검색용) ───────────────────────────

const STROKE_KEYWORDS: [string, string[]][] = [
  ['자유형',    ['freestyle', '자유형']],
  ['배영',      ['backstroke', '배영']],
  ['평영',      ['breaststroke', '평영']],
  ['접영',      ['butterfly', '접영']],
  ['IM',        ['im', 'IM', '개인혼영']],
];

const DOMAIN_KEYWORDS: [string, string[]][] = [
  ['호흡',     ['breathing']],
  ['물적응',   ['water_adaptation']],
  ['기술',     ['technique']],
  ['협응',     ['coordination']],
  ['지구력',   ['endurance']],
];

// ── ACTIVE Curriculum Resolver ───────────────────────────────────────────────

/**
 * pool의 ACTIVE curriculum_version을 반환합니다.
 * import_status='ACTIVE' AND is_active=true.
 * 0개 → null, 2개 이상 → 첫 번째 반환(경고 로그).
 */
export async function getActiveCurriculumVersion(
  poolId: string,
): Promise<CurriculumVersion | null> {
  const rows = await db.execute(sql`
    SELECT id, swimming_pool_id AS pool_id, version_name, is_active, import_status
    FROM curriculum_versions
    WHERE swimming_pool_id = ${poolId}
      AND is_active = true
      AND import_status = 'ACTIVE'
    ORDER BY created_at DESC
    LIMIT 2
  `);

  const list = rows.rows as CurriculumVersion[];
  if (list.length === 0) return null;
  if (list.length > 1) {
    console.warn(`[curriculum-diary] WARNING: ${poolId} has ${list.length} ACTIVE curriculum versions`);
  }
  return list[0]!;
}

/**
 * pool에 ACTIVE curriculum이 있는지 boolean 확인.
 * Normal AI Diary 검색 라우팅용.
 */
export async function hasCurriculumBasedDiary(poolId: string): Promise<boolean> {
  const v = await getActiveCurriculumVersion(poolId);
  return v !== null;
}

// ── Level 목록 ───────────────────────────────────────────────────────────────

/**
 * ACTIVE curriculum의 레벨 목록을 반환합니다.
 * level_name은 pool_level_settings 테이블에서 가져옵니다.
 * node_count = is_test_item=false 기준.
 */
export async function getCurriculumLevels(poolId: string): Promise<{
  version: CurriculumVersion | null;
  levels: CurriculumLevel[];
}> {
  const version = await getActiveCurriculumVersion(poolId);
  if (!version) return { version: null, levels: [] };

  // level_order별 집계
  const countRows = await db.execute(sql`
    SELECT
      level_order,
      COUNT(*) FILTER (WHERE NOT is_test_item) AS node_count,
      COUNT(*) FILTER (WHERE is_test_item)     AS test_count
    FROM curriculum_items
    WHERE curriculum_version_id = ${version.id}
      AND is_active = true
    GROUP BY level_order
    ORDER BY level_order ASC
  `);

  // pool_level_settings에서 level_name 조회
  const settingsRows = await db.execute(sql`
    SELECT level_order, level_name
    FROM pool_level_settings
    WHERE pool_id = ${poolId}
      AND is_active = true
    ORDER BY level_order ASC
  `);

  const settingsMap = new Map<number, string>(
    (settingsRows.rows as { level_order: number; level_name: string }[])
      .map(r => [r.level_order, r.level_name]),
  );

  const levels: CurriculumLevel[] = (countRows.rows as any[]).map(r => ({
    level_order: Number(r.level_order),
    level_name:  settingsMap.get(Number(r.level_order)) ?? `Level ${r.level_order}`,
    node_count:  Number(r.node_count),
    test_count:  Number(r.test_count),
  }));

  return { version, levels };
}

// ── Node 목록 ────────────────────────────────────────────────────────────────

/**
 * curriculum_items 노드 목록을 반환합니다.
 * Filters: level_order, stroke, domain, skill_group (all optional)
 */
export async function getCurriculumNodes(
  poolId:  string,
  filters: {
    level_order?:  number;
    stroke?:       string;
    domain?:       string;
    skill_group?:  string;
    is_test_item?: boolean;
    limit?:        number;
    offset?:       number;
  } = {},
): Promise<{ nodes: CurriculumNode[]; total: number }> {
  const version = await getActiveCurriculumVersion(poolId);
  if (!version) return { nodes: [], total: 0 };

  const conds: any[] = [
    sql`curriculum_version_id = ${version.id}`,
    sql`is_active = true`,
  ];

  if (filters.level_order != null) conds.push(sql`level_order = ${filters.level_order}`);
  if (filters.stroke)              conds.push(sql`stroke = ${filters.stroke}`);
  if (filters.domain)              conds.push(sql`domain = ${filters.domain}`);
  if (filters.skill_group)         conds.push(sql`skill_group = ${filters.skill_group}`);
  if (filters.is_test_item != null) conds.push(sql`is_test_item = ${filters.is_test_item}`);

  const whereClause = sql.join(conds, sql` AND `);
  const limit  = filters.limit  ?? 200;
  const offset = filters.offset ?? 0;

  const [dataRows, countRow] = await Promise.all([
    db.execute(sql`
      SELECT
        id, display_no, level_order, sequence_in_level,
        stroke, domain, skill_group, atomic_skill,
        title, source_trace, is_test_item,
        node_data->>'goal'           AS goal,
        node_data->>'coaching_point' AS coaching_point
      FROM curriculum_items
      WHERE ${whereClause}
      ORDER BY sort_order ASC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS total FROM curriculum_items WHERE ${whereClause}
    `),
  ]);

  const nodes: CurriculumNode[] = (dataRows.rows as any[]).map(r => ({
    id:               r.id,
    display_no:       r.display_no ?? '',
    level_order:      Number(r.level_order),
    sequence_in_level: Number(r.sequence_in_level),
    stroke:           r.stroke   ?? 'general',
    domain:           r.domain   ?? 'technique',
    skill_group:      r.skill_group ?? '',
    atomic_skill:     r.atomic_skill ?? '',
    title:            r.title    ?? '',
    source_trace:     r.source_trace ?? '',
    is_test_item:     Boolean(r.is_test_item),
    goal:             r.goal     ?? undefined,
    coaching_point:   r.coaching_point ?? undefined,
  }));

  return { nodes, total: Number((countRow.rows[0] as any)?.total ?? 0) };
}

// ── Stroke/Domain 집계 (필터 UI용) ──────────────────────────────────────────

export async function getCurriculumFacets(
  poolId:      string,
  level_order?: number,
): Promise<{ strokes: string[]; domains: string[]; skill_groups: string[] }> {
  const version = await getActiveCurriculumVersion(poolId);
  if (!version) return { strokes: [], domains: [], skill_groups: [] };

  const conds = [
    sql`curriculum_version_id = ${version.id}`,
    sql`is_active = true`,
    sql`NOT is_test_item`,
  ];
  if (level_order != null) conds.push(sql`level_order = ${level_order}`);
  const where = sql.join(conds, sql` AND `);

  const rows = await db.execute(sql`
    SELECT DISTINCT stroke, domain, skill_group
    FROM curriculum_items WHERE ${where}
    ORDER BY stroke, domain, skill_group
  `);

  const strokes     = [...new Set((rows.rows as any[]).map(r => r.stroke))].filter(Boolean);
  const domains     = [...new Set((rows.rows as any[]).map(r => r.domain))].filter(Boolean);
  const skillGroups = [...new Set((rows.rows as any[]).map(r => r.skill_group))].filter(Boolean);

  return { strokes, domains, skill_groups: skillGroups };
}

// ── Normal AI Diary 검색 (curriculum_items 기반) ────────────────────────────

/**
 * curriculum_items에서 교사 입력 의미를 기반으로 최적 노드를 찾습니다.
 *
 * Scoring (diary-template-search.ts와 동일 구조, USAGE_MIN_SCORE=1.40):
 *   strokeMatch      (0|1) — meaning.strokes와 ci.stroke enum 매칭
 *   focusMatch       (0|1) — meaning.skills 키워드가 atomic_skill/domain에 포함
 *   conceptOverlap   (0~1) — meaning.allKeywords 중 source_trace에 포함 비율
 *   observationMatch (0|1) — meaning.issues 키워드가 source_trace에 포함
 *
 * 반환: TemplateSearchResult (기존 searchTemplates와 동일 인터페이스)
 *   usedTemplates[].template_text = source_trace (AI 프롬프트용)
 *   usedTemplates[].level_id      = curriculum_items.id
 *   usedTemplates[].level_name    = `${stroke}/${domain}` (메타용)
 */
export async function searchCurriculumForDiary(
  poolId:  string,
  meaning: ExtractedMeaning,
): Promise<TemplateSearchResult> {

  const version = await getActiveCurriculumVersion(poolId);
  if (!version) {
    return emptyResult();
  }

  // source_trace를 검색 텍스트로 로드 (is_test_item=false, LIMIT 550)
  const rows = await db.execute(sql`
    SELECT id, stroke, domain, skill_group, atomic_skill, source_trace, title
    FROM curriculum_items
    WHERE curriculum_version_id = ${version.id}
      AND is_active = true
      AND NOT is_test_item
      AND source_trace IS NOT NULL
    ORDER BY sort_order ASC
    LIMIT 600
  `);

  if (rows.rows.length === 0) return emptyResult();

  const raws = rows.rows as RawCurriculumNode[];

  // ── 스코어링 ────────────────────────────────────────────────────────────
  const scored: ScoredTemplate[] = raws.map(node => {
    const breakdown = scoreCurriculumNode(node, meaning);
    return {
      id:            node.id,
      level_id:      node.id,        // curriculum_items.id
      level_name:    `${node.stroke}/${node.domain}`,
      template_text: node.source_trace ?? node.title ?? '',
      score:         breakdown.score,
      breakdown,
    };
  });

  // ── 후보 필터링 ──────────────────────────────────────────────────────────
  const hasAnySignal = meaning.allKeywords.length > 0;
  let candidates: ScoredTemplate[];

  if (hasAnySignal) {
    candidates = scored.filter(t => t.breakdown.conceptOverlap >= CANDIDATE_MIN_CONCEPT_OVERLAP);
    if (candidates.length === 0) {
      candidates = scored
        .filter(t => t.breakdown.strokeMatch > 0 || t.breakdown.focusMatch > 0)
        .slice(0, 3);
    }
  } else {
    candidates = scored;
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedTemplates = candidates
    .filter(t => t.score >= USAGE_MIN_SCORE)
    .slice(0, TOP_K_USAGE);

  return {
    usedTemplates,
    candidateCount:   candidates.length,
    usedCount:        usedTemplates.length,
    topScore:         usedTemplates[0]?.score ?? 0,
    usedFallbackPool: false,
    candidateIds:     candidates.map(t => t.id),
    topBreakdown:     usedTemplates[0]?.breakdown ?? null,
  };
}

// ── 내부: curriculum node 스코어링 ──────────────────────────────────────────

function scoreCurriculumNode(
  node:    RawCurriculumNode,
  meaning: ExtractedMeaning,
): ScoringBreakdown {
  const text = node.source_trace ?? node.title ?? '';

  // strokeMatch: meaning.strokes와 node.stroke enum 매칭
  let strokeMatch = 0;
  const meaningStrokes = meaning.strokes ?? [];
  for (const [label, enums] of STROKE_KEYWORDS) {
    if (enums.includes(node.stroke)) {
      if (
        meaningStrokes.includes(label as any) ||
        meaningStrokes.some(s => enums.includes(s as string))
      ) {
        strokeMatch = 1;
        break;
      }
    }
  }

  // focusMatch: meaning.skills 키워드가 atomic_skill 또는 domain에 포함
  let focusMatch = 0;
  const meaningSkills = meaning.skills ?? [];
  const nodeFocusText = `${node.atomic_skill} ${node.domain} ${node.skill_group}`.toLowerCase();
  for (const skill of meaningSkills) {
    if (nodeFocusText.includes(skill.toLowerCase())) {
      focusMatch = 1;
      break;
    }
  }
  // domain keyword 매칭도 focusMatch에 포함
  if (focusMatch === 0) {
    for (const [label, domains] of DOMAIN_KEYWORDS) {
      if (domains.includes(node.domain)) {
        if (meaningSkills.some(s => s.includes(label))) {
          focusMatch = 1;
          break;
        }
      }
    }
  }

  // conceptOverlap: meaning.allKeywords 중 source_trace에 포함 비율
  const inputKws = meaning.allKeywords ?? [];
  const conceptOverlap = inputKws.length === 0
    ? 0
    : inputKws.filter(kw => text.includes(kw)).length / inputKws.length;

  // observationMatch: meaning.issues 키워드가 source_trace에 포함
  const observationMatch =
    (meaning.issues?.length ?? 0) > 0 &&
    meaning.issues!.some(iss => text.includes(iss))
      ? 1 : 0;

  const score = strokeMatch + focusMatch + conceptOverlap + observationMatch;
  return { strokeMatch, focusMatch, conceptOverlap, observationMatch, score };
}

function emptyResult(): TemplateSearchResult {
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
