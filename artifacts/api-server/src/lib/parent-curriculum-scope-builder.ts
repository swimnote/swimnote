/**
 * parent-curriculum-scope-builder.ts
 *
 * APP DB → ENGINE curriculum_scope + student_progress 구성.
 *
 * 책임:
 *   - NORMAL: pool active curriculum_version의 active items 조회 + 300개 gate
 *   - X:      ACTIVE global_template_set의 x_global diary_templates 조회
 *   - student_progress: active curriculum assignment 조회
 *
 * 금지:
 *   - GPT 호출
 *   - 다른 수영장 데이터 참조
 *   - 다음 진도 추론
 *   - 수영 지식 판단
 */

import { superAdminDb } from "@workspace/db";
import { sql }          from "drizzle-orm";
import { getActiveGlobalTemplateSet } from "./diary-template-search.js";
import type { PcCurriculumItem, PcCurriculumScope, PcStudentProgress } from "./parent-curriculum-engine-client.js";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** NORMAL mode 활성화 최소 curriculum_items 수 */
export const NORMAL_MIN_CURRICULUM_ITEMS = 300;

/** ENGINE에 전송할 curriculum_items 최대 수 */
const MAX_CURRICULUM_ITEMS = 2_000;

// ─── 오류 코드 ────────────────────────────────────────────────────────────────

export class CurriculumScopeError extends Error {
  constructor(
    public readonly code:
      | "CURRICULUM_SEARCH_NOT_ELIGIBLE"
      | "NO_ACTIVE_CURRICULUM_VERSION"
      | "X_GLOBAL_SET_UNAVAILABLE"
      | "X_GLOBAL_DATA_INTEGRITY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "CurriculumScopeError";
  }
}

// ─── NORMAL MODE ──────────────────────────────────────────────────────────────

/**
 * NORMAL mode 커리큘럼 Scope 구성.
 *
 * 1. 해당 pool의 active curriculum_version 조회
 * 2. is_active=true curriculum_items 수 카운트
 * 3. 300개 미만 → CURRICULUM_SEARCH_NOT_ELIGIBLE
 * 4. items 로드 → PcCurriculumScope 반환
 */
export async function buildNormalCurriculumScope(
  poolId: string,
): Promise<PcCurriculumScope> {
  // Step 1: active version 조회
  const versionResult = await superAdminDb.execute(sql`
    SELECT id
    FROM curriculum_versions
    WHERE swimming_pool_id = ${poolId}
      AND is_active = true
    LIMIT 1
  `);

  if (!versionResult.rows.length) {
    throw new CurriculumScopeError(
      "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      `NORMAL pool ${poolId} has no active curriculum version`,
    );
  }

  const versionId = (versionResult.rows[0] as any).id as string;

  // Step 2: active items 카운트 (300개 gate)
  const countResult = await superAdminDb.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM curriculum_items
    WHERE curriculum_version_id = ${versionId}
      AND is_active = true
  `);

  const itemCount = Number((countResult.rows[0] as any)?.cnt ?? 0);
  if (itemCount < NORMAL_MIN_CURRICULUM_ITEMS) {
    throw new CurriculumScopeError(
      "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      `NORMAL pool ${poolId} has ${itemCount} curriculum items (minimum ${NORMAL_MIN_CURRICULUM_ITEMS})`,
    );
  }

  // Step 3: items 로드
  const itemsResult = await superAdminDb.execute(sql`
    SELECT id, title, description, sort_order
    FROM curriculum_items
    WHERE curriculum_version_id = ${versionId}
      AND is_active = true
    ORDER BY sort_order ASC
    LIMIT ${MAX_CURRICULUM_ITEMS}
  `);

  const curriculumItems: PcCurriculumItem[] = (
    itemsResult.rows as Array<{
      id:          string;
      title:       string;
      description: string | null;
      sort_order:  number;
    }>
  ).map((row) => ({
    id:      row.id,
    title:   row.title,
    content: row.description ?? "",
    order:   row.sort_order,
    // level 없음 — optional이므로 생략
  }));

  return {
    source:          "POOL",
    curriculum_items: curriculumItems,
  };
}

// ─── X MODE ───────────────────────────────────────────────────────────────────

/**
 * X mode 커리큘럼 Scope 구성.
 *
 * ACTIVE global_template_set의 x_global diary_templates 로드.
 * title=category, content=template_text, level=level_name|null, order=sort_order
 */
export async function buildXCurriculumScope(): Promise<PcCurriculumScope> {
  // Step 1: ACTIVE global_template_set 조회 (getActiveGlobalTemplateSet 재사용)
  const activeSet = await getActiveGlobalTemplateSet();

  if (activeSet === null) {
    throw new CurriculumScopeError(
      "X_GLOBAL_SET_UNAVAILABLE",
      "No ACTIVE global_template_set found",
    );
  }
  if (activeSet === "DATA_INTEGRITY_ERROR") {
    throw new CurriculumScopeError(
      "X_GLOBAL_DATA_INTEGRITY_ERROR",
      "Multiple ACTIVE global_template_sets found — data integrity error",
    );
  }

  // Step 2: x_global diary_templates 로드
  // title=category, content=template_text, level=level_name(nullable), order=sort_order
  const templatesResult = await superAdminDb.execute(sql`
    SELECT
      dt.id,
      dt.category                         AS title,
      dt.template_text                    AS content,
      COALESCE(dtl.level_name, NULL)      AS level_name,
      dt.sort_order
    FROM diary_templates dt
    LEFT JOIN diary_template_levels dtl ON dtl.id = dt.level_id
    WHERE dt.scope                  = 'x_global'
      AND dt.global_template_set_id = ${activeSet.id}
      AND dt.swimming_pool_id       IS NULL
      AND dt.is_active              = true
    ORDER BY dt.sort_order ASC
    LIMIT ${MAX_CURRICULUM_ITEMS}
  `);

  if (!templatesResult.rows.length) {
    throw new CurriculumScopeError(
      "X_GLOBAL_SET_UNAVAILABLE",
      `ACTIVE global_template_set ${activeSet.id} has no x_global templates`,
    );
  }

  const curriculumItems: PcCurriculumItem[] = (
    templatesResult.rows as Array<{
      id:         string;
      title:      string | null;
      content:    string;
      level_name: string | null;
      sort_order: number;
    }>
  ).map((row) => {
    const item: PcCurriculumItem = {
      id:      row.id,
      title:   row.title ?? "",
      content: row.content,
      order:   row.sort_order,
    };
    if (row.level_name !== null && row.level_name !== undefined) {
      item.level = row.level_name;
    }
    return item;
  });

  return {
    source:           "X_GLOBAL",
    template_set_id:  activeSet.id,
    curriculum_items: curriculumItems,
  };
}

// ─── STUDENT PROGRESS ─────────────────────────────────────────────────────────

/**
 * 학생 progress 구성.
 *
 * student_curriculum_assignments에서 active assignment 조회.
 * 실제로 저장된 사실만 반환 — 진도 추론 금지.
 * assignment가 없으면 undefined 반환 (optional).
 */
export async function buildStudentProgress(
  studentId: string,
  poolId:    string,
): Promise<PcStudentProgress | undefined> {
  const result = await superAdminDb.execute(sql`
    SELECT sca.curriculum_version_id
    FROM student_curriculum_assignments sca
    WHERE sca.student_id       = ${studentId}
      AND sca.swimming_pool_id = ${poolId}
      AND sca.is_active        = true
    LIMIT 1
  `);

  if (!result.rows.length) {
    return undefined; // progress 없음 — optional field 생략
  }

  const row = result.rows[0] as any;
  const progress: PcStudentProgress = {};

  if (row.curriculum_version_id) {
    progress.current_curriculum_id = row.curriculum_version_id;
  }

  return Object.keys(progress).length > 0 ? progress : undefined;
}
