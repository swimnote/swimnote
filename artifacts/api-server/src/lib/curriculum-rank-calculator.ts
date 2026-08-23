/**
 * curriculum-rank-calculator.ts — GAUGE-02: Progress Rank Calculator
 *
 * curriculum_items의 실제 1-based progress rank / total active count / percent를
 * read-only로 계산한다.
 *
 * 설계 원칙 (V3 FINAL):
 *   - ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) — raw sort_order 직접 사용 금지
 *   - active items only (is_active=true)
 *   - sort_order=0 시작 / gap / 비연속 허용 — rank는 ROW_NUMBER() 기준
 *   - 마지막 active item은 항상 100.0%
 *   - deterministic: sort_order 동점 시 id ASC 보조 정렬
 *   - version 격리: item이 요청한 version에 속하지 않으면 fail-closed
 *   - Professional V2 / GPT / 외부 AI 의존성 없음
 *   - production DB write 금지 (SELECT only)
 *
 * 오류 정책 (fail-closed):
 *   - curriculumVersionId 없음 → CurriculumRankError("CURRICULUM_VERSION_NOT_FOUND")
 *   - curriculumItemId 없음 → CurriculumRankError("CURRICULUM_ITEM_NOT_FOUND")
 *   - item이 해당 version에 없음 → CurriculumRankError("CURRICULUM_ITEM_NOT_IN_VERSION")
 *   - item이 inactive → CurriculumRankError("CURRICULUM_ITEM_INACTIVE")
 *   - active item 0개 → CurriculumRankError("CURRICULUM_NO_ACTIVE_ITEMS")
 */

import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// 오류 타입
// ─────────────────────────────────────────────────────────────────────────────

export type CurriculumRankErrorCode =
  | "CURRICULUM_VERSION_NOT_FOUND"
  | "CURRICULUM_ITEM_NOT_FOUND"
  | "CURRICULUM_ITEM_NOT_IN_VERSION"
  | "CURRICULUM_ITEM_INACTIVE"
  | "CURRICULUM_NO_ACTIVE_ITEMS";

export class CurriculumRankError extends Error {
  readonly code: CurriculumRankErrorCode;

  constructor(code: CurriculumRankErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CurriculumRankError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 반환 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumRankResult {
  /** 1-based ROW_NUMBER() rank (raw sort_order 아님) */
  progressRank: number;
  /** 현재 version의 active item 총 수 */
  totalCount: number;
  /** ROUND(progressRank / totalCount * 100, 1) */
  progressPct: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 인터페이스 (운영 + 테스트 mock 주입)
// ─────────────────────────────────────────────────────────────────────────────

export interface RankCalculatorDb {
  execute(query: ReturnType<typeof sql.raw>): Promise<{ rows: unknown[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 계산 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeItemRank — curriculum item의 1-based progress rank를 계산한다.
 *
 * @param db                  DB 인터페이스 (superAdminDb 또는 test mock)
 * @param curriculumVersionId curriculum_versions.id
 * @param curriculumItemId    curriculum_items.id
 *
 * @throws CurriculumRankError  입력 누락 / item 미존재 / inactive / active 0개
 *
 * @example
 *   const { progressRank, totalCount, progressPct } =
 *     await computeItemRank(superAdminDb, "cv_abc", "ci_xyz");
 *   // progressPct = 100.0 이면 마지막 항목
 */
export async function computeItemRank(
  db: RankCalculatorDb,
  curriculumVersionId: string,
  curriculumItemId: string,
): Promise<CurriculumRankResult> {
  // ── 입력 누락 guard ──────────────────────────────────────────────────────────
  if (!curriculumVersionId || !curriculumVersionId.trim()) {
    throw new CurriculumRankError("CURRICULUM_VERSION_NOT_FOUND");
  }
  if (!curriculumItemId || !curriculumItemId.trim()) {
    throw new CurriculumRankError("CURRICULUM_ITEM_NOT_FOUND");
  }

  // ── ROW_NUMBER() 계산 쿼리 ────────────────────────────────────────────────
  //
  // 설계 V3 FINAL:
  //   - is_active=true 필터 (inactive 완전 제외)
  //   - ORDER BY sort_order ASC, id ASC (deterministic tie-breaker)
  //   - COUNT(*) OVER () = active item 총 수 (window fn, 서브쿼리 불필요)
  //   - WHERE ranked.id = $itemId: 단일 행 반환
  //     → item이 version에 없거나 inactive면 0행 → fail-closed
  //
  const result = await db.execute(sql.raw(`
    WITH ranked AS (
      SELECT
        ci.id,
        ci.is_active,
        ROW_NUMBER() OVER (
          ORDER BY ci.sort_order ASC, ci.id ASC
        ) AS progress_rank,
        COUNT(*) OVER () AS total_count
      FROM curriculum_items ci
      WHERE ci.curriculum_version_id = '${escapeSql(curriculumVersionId)}'
        AND ci.is_active = true
    )
    SELECT
      progress_rank,
      total_count
    FROM ranked
    WHERE id = '${escapeSql(curriculumItemId)}'
  `));

  // ── active items 0개 또는 item 미발견 구분 ────────────────────────────────
  if (!result.rows || result.rows.length === 0) {
    // item 자체가 version에 존재하는지 / inactive인지 구분
    const itemCheck = await db.execute(sql.raw(`
      SELECT id, is_active
      FROM curriculum_items
      WHERE id        = '${escapeSql(curriculumItemId)}'
        AND curriculum_version_id = '${escapeSql(curriculumVersionId)}'
      LIMIT 1
    `));

    if (!itemCheck.rows || itemCheck.rows.length === 0) {
      // item이 해당 version에 아예 없음 (다른 version이거나 미존재)
      // 다른 version에 속하는지 확인
      const crossVersionCheck = await db.execute(sql.raw(`
        SELECT id FROM curriculum_items
        WHERE id = '${escapeSql(curriculumItemId)}'
        LIMIT 1
      `));

      if (crossVersionCheck.rows && crossVersionCheck.rows.length > 0) {
        // item은 존재하지만 다른 version 소속
        throw new CurriculumRankError(
          "CURRICULUM_ITEM_NOT_IN_VERSION",
          `Item ${curriculumItemId} does not belong to version ${curriculumVersionId}`,
        );
      }

      // item 자체가 존재하지 않음
      throw new CurriculumRankError(
        "CURRICULUM_ITEM_NOT_FOUND",
        `Curriculum item ${curriculumItemId} not found`,
      );
    }

    // item은 해당 version에 존재하지만 inactive
    const row = itemCheck.rows[0] as { id: string; is_active: boolean };
    if (!row.is_active) {
      throw new CurriculumRankError(
        "CURRICULUM_ITEM_INACTIVE",
        `Curriculum item ${curriculumItemId} is inactive`,
      );
    }

    // item이 active인데도 rank 쿼리 결과 0행 → active item이 0개
    throw new CurriculumRankError(
      "CURRICULUM_NO_ACTIVE_ITEMS",
      `No active items found for version ${curriculumVersionId}`,
    );
  }

  // ── 결과 파싱 ────────────────────────────────────────────────────────────────
  const row = result.rows[0] as {
    progress_rank: string | number;
    total_count:   string | number;
  };

  const progressRank = Number(row.progress_rank);
  const totalCount   = Number(row.total_count);

  if (!Number.isFinite(progressRank) || progressRank < 1) {
    throw new CurriculumRankError(
      "CURRICULUM_NO_ACTIVE_ITEMS",
      `Invalid progress_rank: ${progressRank}`,
    );
  }
  if (!Number.isFinite(totalCount) || totalCount < 1) {
    throw new CurriculumRankError(
      "CURRICULUM_NO_ACTIVE_ITEMS",
      `Invalid total_count: ${totalCount}`,
    );
  }

  // ── percent 계산 ─────────────────────────────────────────────────────────
  //   ROUND(progressRank / totalCount * 100, 1)
  //   마지막 item(rank===total)은 반드시 100.0 (부동소수점 안전 처리)
  const rawPct      = (progressRank / totalCount) * 100;
  const progressPct = progressRank === totalCount
    ? 100.0
    : Math.round(rawPct * 10) / 10;

  return { progressRank, totalCount, progressPct };
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SQL 인젝션 방지용 최소 이스케이프.
 * ID 컬럼은 단따옴표 포함 불가 — 발견 즉시 throw.
 * (production ID는 모두 'cv_xxx' / 'ci_xxx' 형식, 단따옴표 없음)
 */
function escapeSql(value: string): string {
  if (value.includes("'")) {
    throw new Error(`Invalid ID value (contains single quote): ${value.slice(0, 40)}`);
  }
  return value;
}
