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
 * pool-specific curriculum_items 조회.
 * canonical source: curriculum_versions (x-curriculum-v1, is_active=true)
 *                   → curriculum_items (is_active=true)
 *
 * 금지:
 *   - global_template_sets / diary_templates 참조
 *   - 다른 pool의 item 포함
 *   - archived/inactive item 포함
 *   - 300개 미만 허용
 *   - fallback 추가
 */
export async function buildXCurriculumScope(
  poolId: string,
): Promise<PcCurriculumScope> {
  // Step 1: X managed curriculum_version 조회 (is_active=true)
  const versionResult = await superAdminDb.execute(sql`
    SELECT id
    FROM curriculum_versions
    WHERE swimming_pool_id = ${poolId}
      AND is_active        = true
    LIMIT 1
  `);

  if (!versionResult.rows.length) {
    throw new CurriculumScopeError(
      "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      `X pool ${poolId} has no active curriculum version`,
    );
  }

  const versionId = (versionResult.rows[0] as any).id as string;

  // Step 2: active items 카운트 (300개 gate)
  const countResult = await superAdminDb.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM curriculum_items
    WHERE curriculum_version_id = ${versionId}
      AND is_active             = true
  `);

  const itemCount = Number((countResult.rows[0] as any)?.cnt ?? 0);
  if (itemCount < NORMAL_MIN_CURRICULUM_ITEMS) {
    throw new CurriculumScopeError(
      "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      `X pool ${poolId} has ${itemCount} curriculum items (minimum ${NORMAL_MIN_CURRICULUM_ITEMS})`,
    );
  }

  // Step 3: items 로드 (eligibility와 동일 source)
  const itemsResult = await superAdminDb.execute(sql`
    SELECT id, title, description, sort_order
    FROM curriculum_items
    WHERE curriculum_version_id = ${versionId}
      AND is_active             = true
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
  }));

  return {
    source:           "X_POOL",
    curriculum_items: curriculumItems,
  };
}

// ─── STUDENT PROGRESS ─────────────────────────────────────────────────────────

/**
 * 학생 progress 구성.
 *
 * 현재 canonical rule (WP2.1):
 *   current_curriculum_id = curriculum_items.id (실제 item ID)만 허용.
 *
 * 금지:
 *   - curriculum_version_id를 current_curriculum_id로 위장하는 것
 *   - APP에서 진도를 추론하거나 sort_order로 임의 결정
 *
 * DB 구조 조사 결과:
 *   - student_curriculum_assignments.curriculum_version_id = VERSION ID (item ID 아님)
 *   - growth_events.curriculum_item_id = 실제 item ID이나,
 *     현재 학생의 "현재 item"을 단일값으로 확정하는 canonical helper 없음
 *
 * 따라서: current_curriculum_id를 생략하고 undefined 반환.
 * 향후 canonical current-item helper가 추가되면 여기서 재사용할 것.
 */
/**
 * buildStudentProgress — student_curriculum_progress(SCP) 조회 후
 * ENGINE student_progress context 반환.
 *
 * GAUGE-08: confirmed_progress_pct = SCP.display_confirmed_pct
 *   (cross-version monotonic UI gauge, 학부모에게 표시되는 값과 동일)
 *
 * 금지:
 *   - active_confirmed_pct를 confirmed_progress_pct로 위장
 *   - 0을 "시작점"으로 단정하여 전송 (SCP 없으면 undefined 반환)
 *   - SCP를 실력/숙련도/점수로 해석
 *
 * SCP 없음 → undefined (기존 Parent Curriculum 동작 그대로 유지).
 *
 * Security: student_id + swimming_pool_id 반드시 둘 다 사용 (단독 조회 금지).
 */
export async function buildStudentProgress(
  studentId: string,
  poolId:    string,
): Promise<PcStudentProgress | undefined> {
  const res = await superAdminDb.execute(sql`
    SELECT
      display_confirmed_pct,
      active_confirmed_pct,
      active_confirmed_rank,
      active_confirmed_total,
      active_curriculum_version_id,
      observation_session_count,
      confirmed_at
    FROM student_curriculum_progress
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
    LIMIT 1
  `);

  if (!(res.rows as any[]).length) return undefined;

  const r = (res.rows as any[])[0];
  return {
    confirmed_progress_pct:    r.display_confirmed_pct  != null ? Number(r.display_confirmed_pct)  : null,
    active_progress_pct:       r.active_confirmed_pct   != null ? Number(r.active_confirmed_pct)   : null,
    active_confirmed_rank:     Number(r.active_confirmed_rank  ?? 0),
    active_total_count:        Number(r.active_confirmed_total ?? 0),
    active_version_id:         r.active_curriculum_version_id ?? null,
    observation_session_count: Number(r.observation_session_count ?? 0),
    confirmed_at:              r.confirmed_at != null ? String(r.confirmed_at) : null,
  };
}
