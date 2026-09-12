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
 *
 * GAUGE-NEW (추가):
 *   - students.current_level_order 기반 레벨 floor 보장
 *   - 하위 레벨 복습 CPO 제외 (ci.level_order >= cap_level)
 *   - 현재 레벨 내 확인된 아이템 비율로 floor~ceiling 매핑
 *   - 일반 일지: GREATEST 단조 증가 / 레벨 변경: fresh recompute
 *   - Level 1: 0~20%, L2: 20~35%, L3: 35~50%, L4: 50~65%, L5+: 65~80%
 *   - current_level_order=null → gauge_pct=null
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
  /** GAUGE-NEW: level-range 기반 게이지 (null = current_level_order 미설정) */
  gaugePct: number | null;
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
  gauge_pct: number | null;
  prev_curriculum_version_id: string | null;
  prev_display_pct: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GAUGE-NEW 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** level_order → 게이지 floor/ceiling. null = 미설정 또는 범위 밖 */
export function getLevelRange(
  capLevel: number | null,
): { floor: number; ceiling: number } | null {
  if (capLevel == null || capLevel <= 0) return null;
  if (capLevel === 1) return { floor: 0, ceiling: 20 };
  if (capLevel === 2) return { floor: 20, ceiling: 35 };
  if (capLevel === 3) return { floor: 35, ceiling: 50 };
  if (capLevel === 4) return { floor: 50, ceiling: 65 };
  return { floor: 65, ceiling: 80 }; // L5+
}

/**
 * computeRawGaugePct — GAUGE-NEW 핵심 계산.
 *
 * 1. cap_level 미설정 → null
 * 2. L5+ → 커리큘럼 아이템 없음 → floor(65%) 고정
 * 3. 하위 레벨 CPO 제외 (ci.level_order >= cap_level, IS NOT NULL)
 * 4. 3-session rule → confirmed sort_order
 * 5. 현재 레벨 아이템 중 sort_order <= confirmed_sort_order 비율
 * 6. floor + ratio × width
 *
 * @returns raw gauge (0-decimal 반올림된 소수점 1자리), 또는 null
 */
async function computeRawGaugePct(
  db: ConfirmationEngineDb,
  studentId: string,
  poolId: string,
  capLevel: number | null,
  activeVersionId: string,
): Promise<number | null> {
  const range = getLevelRange(capLevel);
  if (!range) return null;

  // L5+ : 커리큘럼 아이템 없으므로 floor 고정
  if (capLevel! >= 5) return range.floor;

  // 현재 레벨 전체 아이템 수
  const totalRes = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM curriculum_items
    WHERE curriculum_version_id = ${activeVersionId}
      AND level_order            = ${capLevel}
      AND is_active              = true
  `);
  const currentLevelTotal = Number((totalRes.rows[0] as any).cnt);

  if (currentLevelTotal === 0) {
    // 커리큘럼이 비어 있음 → floor 고정
    return range.floor;
  }

  // cap_level 이상 CPO (하위 레벨 복습 제외)
  // ci.level_order IS NOT NULL 조건: 미분류 아이템 제외
  const cpoRes = await db.execute(sql`
    SELECT cpo.lesson_session_id,
           cpo.observed_progress_rank,
           ci.sort_order          AS item_sort_order
    FROM curriculum_progress_observations cpo
    JOIN curriculum_items ci ON ci.id = cpo.curriculum_item_id
    WHERE cpo.student_id            = ${studentId}
      AND cpo.swimming_pool_id      = ${poolId}
      AND cpo.curriculum_version_id = ${activeVersionId}
      AND cpo.is_invalidated        = false
      AND cpo.is_gauge_eligible     = true
      AND cpo.observation_type IN ('ACTUAL_TAUGHT', 'REVIEW', 'CORRECTION')
      AND ci.level_order            IS NOT NULL
      AND ci.level_order            >= ${capLevel}
    ORDER BY cpo.observed_progress_rank DESC
  `);

  const cpos = cpoRes.rows as { lesson_session_id: string; observed_progress_rank: number; item_sort_order: number }[];

  if (cpos.length < 3) {
    // < 3 세션 → floor 고정
    return range.floor;
  }

  // 3-session rule: 3rd highest = confirmed
  const confirmedSortOrder = cpos[2].item_sort_order;

  // 현재 레벨 아이템 중 sort_order <= confirmed_sort_order
  const confirmedRes = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM curriculum_items
    WHERE curriculum_version_id = ${activeVersionId}
      AND level_order            = ${capLevel}
      AND is_active              = true
      AND sort_order             <= ${confirmedSortOrder}
  `);
  const confirmedCount = Number((confirmedRes.rows[0] as any).cnt);

  // 상위 레벨 아이템이 confirmed → 현재 레벨 완료로 취급 (cap at 1.0)
  const ratio = Math.min(confirmedCount / currentLevelTotal, 1.0);

  const rawGauge = range.floor + ratio * (range.ceiling - range.floor);
  return Math.round(rawGauge * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function roundPct(rank: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((rank / total) * 1000) / 10; // ROUND(x, 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Active version 해석 (공통)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveActiveVersionId(
  db: ConfirmationEngineDb,
  studentId: string,
  poolId: string,
): Promise<string | null> {
  const assignmentRes = await db.execute(sql`
    SELECT sca.curriculum_version_id
    FROM student_curriculum_assignments sca
    JOIN curriculum_versions cv
      ON cv.id = sca.curriculum_version_id
    WHERE sca.student_id        = ${studentId}
      AND sca.swimming_pool_id  = ${poolId}
      AND sca.is_active         = true
      AND sca.deactivated_at    IS NULL
      AND cv.archived_at        IS NULL
      AND cv.swimming_pool_id   = ${poolId}
    LIMIT 1
  `);

  if (assignmentRes.rows.length > 0) {
    return (assignmentRes.rows[0] as { curriculum_version_id: string }).curriculum_version_id;
  }

  const poolVersionRes = await db.execute(sql`
    SELECT id
    FROM curriculum_versions
    WHERE swimming_pool_id = ${poolId}
      AND is_active        = true
      AND archived_at      IS NULL
    LIMIT 1
  `);

  return poolVersionRes.rows.length > 0
    ? (poolVersionRes.rows[0] as { id: string }).id
    : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 함수 — 일반 일지 업데이트 (단조 증가)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeConfirmedProgress — 학생/풀의 confirmed progress를 계산하고 SCP에 저장.
 *
 * @param db        DB 인터페이스 (운영 db 또는 test mock)
 * @param studentId 학생 ID
 * @param poolId    수영장 ID
 * @param capLevel  students.current_level_order (GAUGE-NEW용, null=미설정)
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
  capLevel: number | null = null,
): Promise<ConfirmationResult> {
  // capLevel 미전달 시 students.current_level_order 자동 조회
  // → 기존 diary.ts 등 호출 측 수정 없이 GAUGE-NEW 자동 적용
  if (capLevel == null) {
    try {
      const lvRes = await db.execute(sql`
        SELECT current_level_order FROM students WHERE id = ${studentId} LIMIT 1
      `);
      capLevel = (lvRes.rows[0] as any)?.current_level_order ?? null;
    } catch {
      // 조회 실패 시 null 유지 (gauge_pct=null)
    }
  }

  // ── 1. Active curriculum version 결정 ─────────────────────────────────────
  //
  // 우선순위:
  //   A. student_curriculum_assignments (student-specific assignment)
  //      is_active=true, deactivated_at IS NULL
  //      cv.archived_at IS NULL  ← cv.is_active 조건 없음
  //        (pool-level CV가 비활성화됐더라도 archived 되지 않은 경우 학생 CPO 데이터를
  //         계속 집계해야 함. is_active 비활성 = "신규 배정 불가"이지, 기존 CPO 무효화 아님)
  //      cv.swimming_pool_id = poolId  (cross-pool 데이터 혼입 방지)
  //   B. Fallback: pool의 active curriculum_version (is_active=true, archived_at IS NULL)
  //
  // 다른 pool version 사용 금지, 임의 선택 금지.

  const activeVersionId = await resolveActiveVersionId(db, studentId, poolId);

  if (!activeVersionId) {
    return {
      status: "NO_ACTIVE_CURRICULUM",
      activeCurriculumVersionId: null,
      observationSessionCount: 0,
      activeConfirmedRank: 0,
      activeConfirmedTotal: 0,
      activeConfirmedPct: 0,
      displayConfirmedPct: 0,
      gaugePct: null,
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
    const gaugePct = await computeRawGaugePct(db, studentId, poolId, capLevel, activeVersionId);
    await upsertScpRow(db, {
      studentId, poolId, activeVersionId,
      activeRank: 0, activeTotal: 0, activePct: 0,
      sessionCount: 0,
      gaugePct,
      freshGauge: false,
    });
    return {
      status: "NO_ELIGIBLE_OBSERVATIONS",
      activeCurriculumVersionId: activeVersionId,
      observationSessionCount: 0,
      activeConfirmedRank: 0,
      activeConfirmedTotal: 0,
      activeConfirmedPct: 0,
      displayConfirmedPct: 0,
      gaugePct,
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
    const gaugePct = await computeRawGaugePct(db, studentId, poolId, capLevel, activeVersionId);
    const scpResult = await upsertScpRow(db, {
      studentId, poolId, activeVersionId,
      activeRank: 0, activeTotal: 0, activePct: 0,
      sessionCount,
      gaugePct,
      freshGauge: false,
    });
    return {
      status: "INSUFFICIENT_SESSIONS",
      activeCurriculumVersionId: activeVersionId,
      observationSessionCount: sessionCount,
      activeConfirmedRank: 0,
      activeConfirmedTotal: 0,
      activeConfirmedPct: 0,
      displayConfirmedPct: scpResult.displayConfirmedPct, // GREATEST로 기존 유지
      gaugePct: scpResult.gaugePct,
    };
  }

  // 3회 이상
  const confirmedRank = ranks[2]; // 3rd highest rank = confirmed rank
  const activeTotal = eligibleCpos[0].observed_total_count; // 동일 version → 일관
  const activePct = roundPct(confirmedRank, activeTotal);

  const gaugePct = await computeRawGaugePct(db, studentId, poolId, capLevel, activeVersionId);

  const scpResult = await upsertScpRow(db, {
    studentId, poolId, activeVersionId,
    activeRank: confirmedRank, activeTotal, activePct,
    sessionCount,
    gaugePct,
    freshGauge: false,
  });

  return {
    status: "CONFIRMED",
    activeCurriculumVersionId: activeVersionId,
    observationSessionCount: sessionCount,
    activeConfirmedRank: confirmedRank,
    activeConfirmedTotal: activeTotal,
    activeConfirmedPct: activePct,
    displayConfirmedPct: scpResult.displayConfirmedPct,
    gaugePct: scpResult.gaugePct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GAUGE-NEW: 레벨 변경 후 즉시 재계산 (fresh, GREATEST 없음)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * recomputeGaugePctForLevelPatch — 레벨 변경 직후 gauge_pct를 fresh 재계산해서 SCP에 저장.
 *
 * GREATEST 없이 새 레벨 floor를 즉시 반영.
 * active version이 없으면 SCP에 아무것도 쓰지 않고 null 반환.
 *
 * @param db        DB 인터페이스
 * @param studentId 학생 ID
 * @param poolId    수영장 ID
 * @param newCapLevel students.current_level_order (방금 변경된 값)
 * @returns 저장된 gauge_pct 또는 null
 */
export async function recomputeGaugePctForLevelPatch(
  db: ConfirmationEngineDb,
  studentId: string,
  poolId: string,
  newCapLevel: number | null,
): Promise<number | null> {
  const range = getLevelRange(newCapLevel);
  if (!range) {
    // null 레벨 → gauge null. SCP에서 null로 UPDATE
    await db.execute(sql`
      UPDATE student_curriculum_progress
      SET gauge_pct = NULL, updated_at = NOW()
      WHERE student_id = ${studentId} AND swimming_pool_id = ${poolId}
    `);
    return null;
  }

  const activeVersionId = await resolveActiveVersionId(db, studentId, poolId);
  if (!activeVersionId) return null;

  const freshGauge = await computeRawGaugePct(db, studentId, poolId, newCapLevel, activeVersionId);

  // freshGauge가 null이면 (해석 불가) floor 적용
  const finalGauge = freshGauge ?? range.floor;

  await db.execute(sql`
    UPDATE student_curriculum_progress
    SET gauge_pct  = ${finalGauge},
        updated_at = NOW()
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
  `);

  return finalGauge;
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
  /** GAUGE-NEW: 계산된 raw gauge_pct (null = level 미설정) */
  gaugePct: number | null;
  /** true = level 변경에 의한 fresh recompute (GREATEST 없이 저장) */
  freshGauge: boolean;
}

interface UpsertScpResult {
  displayConfirmedPct: number;
  gaugePct: number | null;
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
      display_confirmed_pct, gauge_pct,
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

  // 4. gauge_pct — 일반 일지: GREATEST, fresh: 그대로
  let newGaugePct: number | null;
  if (p.gaugePct == null) {
    newGaugePct = null;
  } else if (p.freshGauge) {
    newGaugePct = p.gaugePct;
  } else {
    const existingGauge = existing?.gauge_pct ?? null;
    newGaugePct = existingGauge == null
      ? p.gaugePct
      : Math.max(existingGauge, p.gaugePct);
    newGaugePct = Math.min(80, newGaugePct); // 절대 MAX 80%
  }

  // 5. UPSERT
  //    DB-level GREATEST: race condition에서도 display 하락 불가
  //    confirmed_at: active_confirmed_rank 변경 시만 NOW()
  //    display_updated_at: display_confirmed_pct 실제 상승 시만 NOW()
  await db.execute(sql`
    INSERT INTO student_curriculum_progress (
      student_id, swimming_pool_id,
      active_curriculum_version_id,
      active_confirmed_rank, active_confirmed_total, active_confirmed_pct,
      display_confirmed_pct,
      gauge_pct,
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
      ${newGaugePct},
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
      gauge_pct                    = ${newGaugePct},
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

  // 6. 실제 저장값 재조회 (race-safe)
  const afterRes = await db.execute(sql`
    SELECT display_confirmed_pct, gauge_pct
    FROM student_curriculum_progress
    WHERE student_id = ${p.studentId}
      AND swimming_pool_id = ${p.poolId}
  `);

  const afterRow = afterRes.rows.length > 0 ? (afterRes.rows[0] as any) : null;
  const actualDisplay = afterRow ? Number(afterRow.display_confirmed_pct) : newDisplayPct;
  const actualGauge   = afterRow?.gauge_pct != null ? Number(afterRow.gauge_pct) : newGaugePct;

  return { displayConfirmedPct: actualDisplay, gaugePct: actualGauge };
}
