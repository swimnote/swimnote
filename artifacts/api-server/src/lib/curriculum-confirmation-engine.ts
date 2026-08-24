/**
 * curriculum-confirmation-engine.ts — GAUGE-05: 3-Session Confirmation Engine
 *
 * 목적:
 *   eligible CPO(curriculum_progress_observations) 기반
 *   3-session confirmed rank를 계산하고
 *   student_curriculum_progress(SCP)에 저장한다.
 *
 * 핵심 설계 (V3 FINAL):
 *   - active version: student_curriculum_assignments 우선 → pool 활성 version fallback
 *   - 3-session rule: DESC sort → ranks[2] = confirmed rank (수학적 동치 검증됨)
 *   - activeConfirmedPct: version 내부 factual position (내려갈 수 있음)
 *   - displayConfirmedPct: lifetime monotonic (GREATEST — 절대 하락 금지)
 *   - DB-level race protection: GREATEST(existing.display, EXCLUDED.display)
 *   - 0~2 sessions: active rank=0, display 유지, SCP row 생성 (session_count 추적용)
 *   - AI / Professional V2 / 외부 LLM 의존성 없음
 *   - production DB write는 호출 시점에서만 제어 (engine 자체는 UPSERT 수행)
 */

import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmationStatus =
  | "CONFIRMED"
  | "INSUFFICIENT_SESSIONS"
  | "NO_ACTIVE_CURRICULUM"
  | "NO_ELIGIBLE_OBSERVATIONS";

export interface ConfirmationResult {
  status: ConfirmationStatus;
  /** 실제 사용된 active curriculum version ID (no active → null) */
  activeCurriculumVersionId: string | null;
  /** 현재 active version의 eligible session 수 */
  observationSessionCount: number;
  /** active version 내부 factual confirmed rank (< 3 sessions → 0) */
  activeConfirmedRank: number;
  /** active version의 total active item count (< 3 sessions → 0) */
  activeConfirmedTotal: number;
  /** activeConfirmedRank / activeConfirmedTotal * 100, 1-decimal */
  activeConfirmedPct: number;
  /** lifetime monotonic display gauge (절대 하락 금지) */
  displayConfirmedPct: number;
}

export interface ConfirmationEngineDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 타입
// ─────────────────────────────────────────────────────────────────────────────

interface EligibleCpoRow {
  lesson_session_id: string;
  observed_progress_rank: number;
  observed_total_count: number;
}

interface ExistingScpRow {
  id: string;
  active_curriculum_version_id: string;
  active_confirmed_rank: number;
  active_confirmed_total: number;
  active_confirmed_pct: number;
  display_confirmed_pct: number;
  prev_curriculum_version_id: string | null;
  prev_display_pct: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function roundPct(rank: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((rank / total) * 1000) / 10; // ROUND(x, 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeConfirmedProgress — 학생/풀의 confirmed progress를 계산하고 SCP에 저장.
 *
 * @param db        DB 인터페이스 (운영 db 또는 test mock)
 * @param studentId 학생 ID
 * @param poolId    수영장 ID
 *
 * @returns ConfirmationResult
 *
 * Failure policy:
 *   - 오류 시 throw — 호출 측에서 .catch()로 fail-safe 처리
 *   - Diary 저장 안정성 위해 diary.ts에서는 fire-and-forget 호출
 */
export async function computeConfirmedProgress(
  db: ConfirmationEngineDb,
  studentId: string,
  poolId: string,
): Promise<ConfirmationResult> {
  // ── 1. Active curriculum version 결정 ─────────────────────────────────────
  //
  // 우선순위:
  //   A. student_curriculum_assignments (student-specific assignment)
  //      is_active=true, deactivated_at IS NULL, cv.is_active=true, cv.archived_at IS NULL
  //   B. Fallback: pool의 active curriculum_version (is_active=true, archived_at IS NULL)
  //
  // 다른 pool version 사용 금지, 임의 선택 금지.

  const assignmentRes = await db.execute(sql`
    SELECT sca.curriculum_version_id
    FROM student_curriculum_assignments sca
    JOIN curriculum_versions cv
      ON cv.id = sca.curriculum_version_id
    WHERE sca.student_id        = ${studentId}
      AND sca.swimming_pool_id  = ${poolId}
      AND sca.is_active         = true
      AND sca.deactivated_at    IS NULL
      AND cv.is_active          = true
      AND cv.archived_at        IS NULL
      AND cv.swimming_pool_id   = ${poolId}
    LIMIT 1
  `);

  let activeVersionId: string | null = null;

  if (assignmentRes.rows.length > 0) {
    activeVersionId = (assignmentRes.rows[0] as { curriculum_version_id: string }).curriculum_version_id;
  } else {
    // Fallback: pool active version
    const poolVersionRes = await db.execute(sql`
      SELECT id
      FROM curriculum_versions
      WHERE swimming_pool_id = ${poolId}
        AND is_active        = true
        AND archived_at      IS NULL
      LIMIT 1
    `);

    if (poolVersionRes.rows.length > 0) {
      activeVersionId = (poolVersionRes.rows[0] as { id: string }).id;
    }
  }

  if (!activeVersionId) {
    return {
      status: "NO_ACTIVE_CURRICULUM",
      activeCurriculumVersionId: null,
      observationSessionCount: 0,
      activeConfirmedRank: 0,
      activeConfirmedTotal: 0,
      activeConfirmedPct: 0,
      displayConfirmedPct: 0,
    };
  }

  // ── 2. Eligible CPO 조회 ──────────────────────────────────────────────────
  //
  // 조건:
  //   student_id, swimming_pool_id, curriculum_version_id 매칭
  //   is_invalidated=false, is_gauge_eligible=true
  //   observation_type IN (ACTUAL_TAUGHT, REVIEW, CORRECTION)
  //   CPO UNIQUE(lesson_session_id, student_id) → session당 최대 1행 구조적 보장

  const cpoRes = await db.execute(sql`
    SELECT lesson_session_id, observed_progress_rank, observed_total_count
    FROM curriculum_progress_observations
    WHERE student_id              = ${studentId}
      AND swimming_pool_id        = ${poolId}
      AND curriculum_version_id   = ${activeVersionId}
      AND is_invalidated          = false
      AND is_gauge_eligible       = true
      AND observation_type IN ('ACTUAL_TAUGHT', 'REVIEW', 'CORRECTION')
    ORDER BY observed_progress_rank DESC
  `);

  const eligibleCpos = cpoRes.rows as EligibleCpoRow[];
  const sessionCount = eligibleCpos.length;

  if (sessionCount === 0) {
    // eligible CPO 없음 — SCP 0-progress row 유지
    await upsertScpRow(db, {
      studentId, poolId, activeVersionId,
      activeRank: 0, activeTotal: 0, activePct: 0,
      sessionCount: 0,
    });
    return {
      status: "NO_ELIGIBLE_OBSERVATIONS",
      activeCurriculumVersionId: activeVersionId,
      observationSessionCount: 0,
      activeConfirmedRank: 0,
      activeConfirmedTotal: 0,
      activeConfirmedPct: 0,
      displayConfirmedPct: 0,
    };
  }

  // ── 3. 3-Session Confirmation Algorithm ───────────────────────────────────
  //
  // 설계 V3 FINAL:
  //   eligible ranks DESC 정렬 후 ranks[2] (0-indexed) = confirmed rank
  //   수학적 동치: "가장 높은 P where count(r >= P) >= 3"
  //
  //   [56,70,87] → [87,70,56] → [2]=56 ✓
  //   [56,70,70,87] → [87,70,70,56] → [2]=70 ✓ (not 56)
  //   [78,81,85] → [85,81,78] → [2]=78 ✓
  //
  // CPO UNIQUE(lesson_session_id, student_id) → 중복 session 구조적 불가.

  const ranks = eligibleCpos.map((c) => c.observed_progress_rank); // already DESC sorted

  if (sessionCount < 3) {
    // 2회 이하 → active=0, display 기존 유지 (SCP row 생성으로 session_count 추적)
    const scpResult = await upsertScpRow(db, {
      studentId, poolId, activeVersionId,
      activeRank: 0, activeTotal: 0, activePct: 0,
      sessionCount,
    });
    return {
      status: "INSUFFICIENT_SESSIONS",
      activeCurriculumVersionId: activeVersionId,
      observationSessionCount: sessionCount,
      activeConfirmedRank: 0,
      activeConfirmedTotal: 0,
      activeConfirmedPct: 0,
      displayConfirmedPct: scpResult.displayConfirmedPct, // GREATEST로 기존 유지
    };
  }

  // 3회 이상
  const confirmedRank = ranks[2]; // 3rd highest rank = confirmed rank
  const activeTotal = eligibleCpos[0].observed_total_count; // 동일 version → 일관
  const activePct = roundPct(confirmedRank, activeTotal);

  const scpResult = await upsertScpRow(db, {
    studentId, poolId, activeVersionId,
    activeRank: confirmedRank, activeTotal, activePct,
    sessionCount,
  });

  return {
    status: "CONFIRMED",
    activeCurriculumVersionId: activeVersionId,
    observationSessionCount: sessionCount,
    activeConfirmedRank: confirmedRank,
    activeConfirmedTotal: activeTotal,
    activeConfirmedPct: activePct,
    displayConfirmedPct: scpResult.displayConfirmedPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCP UPSERT (race-safe with GREATEST)
// ─────────────────────────────────────────────────────────────────────────────

interface UpsertScpParams {
  studentId: string;
  poolId: string;
  activeVersionId: string;
  activeRank: number;
  activeTotal: number;
  activePct: number;
  sessionCount: number;
}

interface UpsertScpResult {
  displayConfirmedPct: number;
}

async function upsertScpRow(
  db: ConfirmationEngineDb,
  p: UpsertScpParams,
): Promise<UpsertScpResult> {
  // 1. 기존 SCP 조회 — version 변경 감지 및 prev_* 처리에 사용
  const existingRes = await db.execute(sql`
    SELECT
      id, active_curriculum_version_id,
      active_confirmed_rank, active_confirmed_total, active_confirmed_pct,
      display_confirmed_pct,
      prev_curriculum_version_id, prev_display_pct
    FROM student_curriculum_progress
    WHERE student_id = ${p.studentId}
      AND swimming_pool_id = ${p.poolId}
  `);

  const existing = existingRes.rows.length > 0
    ? (existingRes.rows[0] as ExistingScpRow)
    : null;

  // 2. Version 전환 감지 → prev_* 업데이트
  const isVersionChange = existing !== null &&
    existing.active_curriculum_version_id !== p.activeVersionId;

  const prevVersionId: string | null = isVersionChange
    ? existing!.active_curriculum_version_id
    : (existing?.prev_curriculum_version_id ?? null);

  const prevDisplayPct: number | null = isVersionChange
    ? existing!.display_confirmed_pct
    : (existing?.prev_display_pct ?? null);

  // 3. Display percent — application-level MAX (DB-level GREATEST가 race 보호)
  const existingDisplay = existing?.display_confirmed_pct ?? 0;
  const newDisplayPct = Math.max(existingDisplay, p.activePct);

  // 4. UPSERT
  //    DB-level GREATEST: race condition에서도 display 하락 불가
  //    confirmed_at: active_confirmed_rank 변경 시만 NOW()
  //    display_updated_at: display_confirmed_pct 실제 상승 시만 NOW()
  await db.execute(sql`
    INSERT INTO student_curriculum_progress (
      student_id, swimming_pool_id,
      active_curriculum_version_id,
      active_confirmed_rank, active_confirmed_total, active_confirmed_pct,
      display_confirmed_pct,
      confirmed_at, display_updated_at,
      observation_session_count,
      prev_curriculum_version_id, prev_display_pct,
      updated_at
    )
    VALUES (
      ${p.studentId}, ${p.poolId},
      ${p.activeVersionId},
      ${p.activeRank}, ${p.activeTotal}, ${p.activePct},
      ${newDisplayPct},
      NOW(), NOW(),
      ${p.sessionCount},
      ${prevVersionId}, ${prevDisplayPct},
      NOW()
    )
    ON CONFLICT (student_id, swimming_pool_id) DO UPDATE SET
      active_curriculum_version_id = ${p.activeVersionId},
      active_confirmed_rank        = ${p.activeRank},
      active_confirmed_total       = ${p.activeTotal},
      active_confirmed_pct         = ${p.activePct},
      display_confirmed_pct        = GREATEST(
        student_curriculum_progress.display_confirmed_pct,
        ${newDisplayPct}
      ),
      confirmed_at = CASE
        WHEN ${p.activeRank} <> student_curriculum_progress.active_confirmed_rank
        THEN NOW()
        ELSE student_curriculum_progress.confirmed_at
      END,
      display_updated_at = CASE
        WHEN GREATEST(
          student_curriculum_progress.display_confirmed_pct,
          ${newDisplayPct}
        ) > student_curriculum_progress.display_confirmed_pct
        THEN NOW()
        ELSE student_curriculum_progress.display_updated_at
      END,
      observation_session_count    = ${p.sessionCount},
      prev_curriculum_version_id   = ${prevVersionId},
      prev_display_pct             = ${prevDisplayPct},
      updated_at                   = NOW()
  `);

  // 5. GREATEST 적용 결과 반환 (후속 결과 조회용)
  //    race-safe: DB가 GREATEST 적용했을 수 있으므로 실제 값 재조회
  const afterRes = await db.execute(sql`
    SELECT display_confirmed_pct
    FROM student_curriculum_progress
    WHERE student_id = ${p.studentId}
      AND swimming_pool_id = ${p.poolId}
  `);

  const actualDisplay = afterRes.rows.length > 0
    ? Number((afterRes.rows[0] as { display_confirmed_pct: number | string }).display_confirmed_pct)
    : newDisplayPct;

  return { displayConfirmedPct: actualDisplay };
}
