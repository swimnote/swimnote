/**
 * growth-report-snapshot-builder.ts
 *
 * Builds an immutable GrowthReportAnalysisRequest from APP DB data.
 *
 * RESPONSIBILITY BOUNDARY (GR3 spec §1):
 *   - DB query + transform only
 *   - No metric interpretation
 *   - No question creation
 *   - No analysis logic
 *
 * Cutoff policy (GR2 §9):
 *   analysis_cutoff_at = parent_input_open_at = 25th 00:00 Asia/Seoul (UTC)
 *   analysis_from      = null (정책 미확정)
 *
 * Privacy (GR3 spec §41):
 *   - student_id used as internal ref only (no phone/address)
 *   - raw diary content is NOT logged
 */

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  GR_CONTRACT_VERSION,
  GR_SNAPSHOT_VERSION,
  computeCanonicalHash,
  getMaxHistoryPeriods,
  type GrowthReportAnalysisRequest,
  type DiarySnapshotItem,
  type GrowthEventSnapshotItem,
  type AttendanceSnapshotItem,
  type CurriculumStateSnapshot,
  type LongitudinalSnapshot,
  type ParentAnswerSnapshot,
} from "./growth-report-engine-client.js";
import { getPublishedReportHistory } from "./growth-report-service.js";

// ─── Builder input ────────────────────────────────────────────────────────────

export interface BuildSnapshotInput {
  report: {
    id: string;
    student_id: string;
    swimming_pool_id: string;
    cycle_id: string;
    report_period: string;
    teacher_reviewed_by?: string | null;
    teacher_reviewed_at?: string | null;
  };
  cycle: {
    id: string;
    analysis_from: string | null;
    analysis_cutoff_at: string;       // 25th 00:00 Asia/Seoul expressed as UTC ISO
    parent_input_open_at: string;
    report_period: string;
    timezone: string;
  };
  /**
   * requestId — supply the SAME UUID to retry an identical snapshot.
   * Omit (or pass undefined) to generate a fresh UUID for a new analysis attempt.
   */
  requestId?: string;
}

export interface BuiltSnapshot {
  request: GrowthReportAnalysisRequest;
  requestId: string;
  payloadHash: string;
}

// ─── Diary query ──────────────────────────────────────────────────────────────

/**
 * queryDiaries — fetches class_diaries rows that have a student note for
 * `studentId`.  Only this student's note is included in `student_notes`;
 * other students' private notes are excluded (privacy boundary).
 * lesson_date < cutoff date portion (cutoff is UTC ISO, date comparison is text).
 */
async function queryDiaries(
  db: any,
  studentId: string,
  poolId: string,
  cutoffAt: string,
): Promise<DiarySnapshotItem[]> {
  // cutoffAt is UTC ISO like "2026-08-24T15:00:00.000Z" → date "2026-08-24"
  const cutoffDate = cutoffAt.slice(0, 10);

  const rows = await db.execute(sql`
    SELECT
      cd.id,
      cd.lesson_date,
      cd.common_content,
      cg.level   AS class_level,
      cdn.note_content,
      cdn.student_id AS note_student_id
    FROM class_diaries cd
    INNER JOIN class_diary_student_notes cdn
      ON cdn.diary_id = cd.id
     AND cdn.student_id = ${studentId}
     AND cdn.is_deleted = false
    LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
    WHERE cd.swimming_pool_id = ${poolId}
      AND cd.is_deleted = false
      AND cd.lesson_date < ${cutoffDate}
    ORDER BY cd.lesson_date ASC
  `);

  return (rows.rows as any[]).map(
    (r): DiarySnapshotItem => ({
      id:             r.id as string,
      lesson_date:    r.lesson_date as string,
      common_content: (r.common_content ?? null) as string | null,
      student_notes: [
        {
          student_ref: r.note_student_id as string,
          content:     (r.note_content ?? null) as string | null,
        },
      ],
      level:        (r.class_level  ?? null) as string | null,
      stroke_code:  null,
      focus_points: null,
    }),
  );
}

// ─── Growth events query ──────────────────────────────────────────────────────

/**
 * queryGrowthEvents — fetches non-invalidated growth_events for `studentId`
 * with occurred_at < cutoffAt.
 * All growth_match_status values are included — ENGINE decides relevance.
 */
async function queryGrowthEvents(
  db: any,
  studentId: string,
  poolId: string,
  cutoffAt: string,
): Promise<GrowthEventSnapshotItem[]> {
  const rows = await db.execute(sql`
    SELECT
      id,
      student_id,
      created_at  AS occurred_at,
      source      AS event_type,
      growth_match_status,
      confidence,
      evidence_text,
      evidence_metadata,
      evidence_validation
    FROM growth_events
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
      AND is_invalidated   = false
      AND created_at       < ${cutoffAt}
    ORDER BY created_at ASC
  `);

  return (rows.rows as any[]).map(
    (r): GrowthEventSnapshotItem => ({
      id:                 r.id as string,
      student_ref:        r.student_id as string,
      occurred_at:        r.occurred_at instanceof Date
                            ? r.occurred_at.toISOString()
                            : String(r.occurred_at),
      event_type:         r.event_type as string,
      description:        (r.evidence_text     ?? null) as string | null,
      context:            r.evidence_metadata  ?? null,
      result:             r.evidence_validation ?? null,
      confidence:         r.confidence != null ? Number(r.confidence) : null,
      growth_match_status: r.growth_match_status as string,
    }),
  );
}

// ─── Attendance query ─────────────────────────────────────────────────────────

/**
 * queryAttendance — fetches attendance records where date < cutoff date.
 */
async function queryAttendance(
  db: any,
  studentId: string,
  poolId: string,
  cutoffAt: string,
): Promise<AttendanceSnapshotItem[]> {
  const cutoffDate = cutoffAt.slice(0, 10);

  const rows = await db.execute(sql`
    SELECT id, student_id, date, status
    FROM attendance
    WHERE student_id       = ${studentId}
      AND swimming_pool_id  = ${poolId}
      AND date             < ${cutoffDate}
    ORDER BY date ASC
  `);

  return (rows.rows as any[]).map(
    (r): AttendanceSnapshotItem => ({
      id:           r.id as string,
      student_ref:  r.student_id as string,
      lesson_date:  r.date as string,
      status:       r.status as string,
      duration_min: null,
    }),
  );
}

// ─── Curriculum progress gauge helpers (GAUGE-07) ────────────────────────────

/** Raw SCP fields needed for the progress snapshot. */
interface ScpGaugeRow {
  display_confirmed_pct: number | null;
  active_confirmed_pct: number | null;
  active_confirmed_rank: number;
  active_confirmed_total: number;
  active_curriculum_version_id: string | null;
  observation_session_count: number;
}

/**
 * queryScpGaugeProgress — reads student_curriculum_progress for the given
 * student+pool.  Returns null if no SCP row exists yet (safe fallback: null
 * fields, zero counters — meaning "undetermined", not "zero progress").
 */
async function queryScpGaugeProgress(
  db: any,
  studentId: string,
  poolId: string,
): Promise<ScpGaugeRow | null> {
  const res = await db.execute(sql`
    SELECT
      display_confirmed_pct,
      active_confirmed_pct,
      active_confirmed_rank,
      active_confirmed_total,
      active_curriculum_version_id,
      observation_session_count
    FROM student_curriculum_progress
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  if (!(res.rows as any[]).length) return null;
  const r = (res.rows as any[])[0];
  return {
    display_confirmed_pct:          r.display_confirmed_pct        != null ? Number(r.display_confirmed_pct)   : null,
    active_confirmed_pct:           r.active_confirmed_pct         != null ? Number(r.active_confirmed_pct)    : null,
    active_confirmed_rank:          Number(r.active_confirmed_rank  ?? 0),
    active_confirmed_total:         Number(r.active_confirmed_total ?? 0),
    active_curriculum_version_id:   r.active_curriculum_version_id ?? null,
    observation_session_count:      Number(r.observation_session_count ?? 0),
  };
}

/**
 * queryPreviousReportCurriculumPct — reads the most-recent PUBLISHED report
 * (same student + pool, excluding currentReportId) and returns its immutable
 * curriculum_state.confirmed_progress_pct from report_content JSONB.
 *
 * Returns null when:
 *   - no previous PUBLISHED report exists (first report)
 *   - previous report's curriculum_state is missing/null
 *   - the snapshot pre-dates GAUGE-07 (field absent)
 *
 * IMPORTANT: period_start_pct MUST come from the previous report's immutable
 * JSONB, never re-computed from current SCP. This preserves monotonicity even
 * if SCP is later updated.
 */
async function queryPreviousReportCurriculumPct(
  db: any,
  studentId: string,
  poolId: string,
  currentReportId: string,
): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT report_content
    FROM growth_reports
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
      AND product_status   = 'PUBLISHED'
      AND deleted_at       IS NULL
      AND id               != ${currentReportId}
    ORDER BY published_at DESC
    LIMIT 1
  `);
  if (!(res.rows as any[]).length) return null;
  const rc = (res.rows as any[])[0]?.report_content;
  if (!rc || typeof rc !== "object" || Array.isArray(rc)) return null;
  const cs = (rc as Record<string, unknown>).curriculum_state;
  if (!cs || typeof cs !== "object" || Array.isArray(cs)) return null;
  const pct = (cs as Record<string, unknown>).confirmed_progress_pct;
  if (pct == null) return null;
  return typeof pct === "number" ? pct : Number(pct);
}

/**
 * mergeGaugeIntoState — merges GAUGE-07 progress fields into a
 * CurriculumStateSnapshot (or creates a minimal one if base is null but
 * SCP data exists — ensures gauge info is never silently dropped).
 */
function mergeGaugeIntoState(
  base: CurriculumStateSnapshot | null,
  scp: ScpGaugeRow | null,
  periodStartPct: number | null,
): CurriculumStateSnapshot | null {
  const confirmedPct  = scp?.display_confirmed_pct  ?? null;
  const rank          = scp?.active_confirmed_rank   ?? 0;
  const total         = scp?.active_confirmed_total  ?? 0;
  const versionId     = scp?.active_curriculum_version_id ?? null;
  const sessionCount  = scp?.observation_session_count ?? 0;

  const deltaPct: number | null =
    confirmedPct != null && periodStartPct != null
      ? Math.round((confirmedPct - periodStartPct) * 10) / 10
      : null;

  const gaugeFields = {
    confirmed_progress_pct:   confirmedPct,
    active_confirmed_rank:    rank,
    active_total_count:       total,
    active_version_id:        versionId,
    period_start_pct:         periodStartPct,
    progress_delta_pct:       deltaPct,
    observation_session_count: sessionCount,
  };

  if (base !== null) {
    return { ...base, ...gaugeFields };
  }
  // base is null: if SCP exists, create a minimal curriculum_state so gauge
  // data is not silently lost (pool may have curriculum even without assignment)
  if (scp !== null) {
    return {
      curriculum_id:  null,
      current_level:  null,
      stage:          null,
      recent_topics:  [],
      mastery_flags:  null,
      ...gaugeFields,
    };
  }
  // Neither curriculum assignment nor SCP — pool truly has no curriculum data
  return null;
}

// ─── Curriculum state query ───────────────────────────────────────────────────

/**
 * queryCurriculumState — fetches the student's active curriculum assignment
 * and latest level.  Returns null if no curriculum/level exists (valid for
 * pools that don't use curriculum).
 */
async function queryCurriculumState(
  db: any,
  studentId: string,
  poolId: string,
): Promise<CurriculumStateSnapshot | null> {
  // Active curriculum assignment
  const assignRows = await db.execute(sql`
    SELECT curriculum_version_id
    FROM student_curriculum_assignments
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
      AND is_active        = true
    ORDER BY assigned_at DESC
    LIMIT 1
  `);
  const cvId = (assignRows.rows as any[])[0]?.curriculum_version_id as string | undefined;

  // Latest level
  const levelRows = await db.execute(sql`
    SELECT level, level_order
    FROM student_levels
    WHERE student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
    ORDER BY level_order DESC
    LIMIT 1
  `);
  const currentLevel = ((levelRows.rows as any[])[0]?.level ?? null) as string | null;

  if (!cvId && !currentLevel) return null;

  // Recent topics from curriculum items (max 10 active items)
  let recentTopics: string[] = [];
  if (cvId) {
    const itemRows = await db.execute(sql`
      SELECT title
      FROM curriculum_items
      WHERE curriculum_version_id = ${cvId}
        AND is_active             = true
      ORDER BY sort_order ASC
      LIMIT 10
    `);
    recentTopics = (itemRows.rows as any[])
      .map((r) => r.title as string)
      .filter(Boolean);
  }

  return {
    curriculum_id: cvId ?? null,
    current_level: currentLevel,
    stage:         null, // stage computed from growth_events by ENGINE
    recent_topics: recentTopics,
    mastery_flags: null, // mastery computed from growth_events by ENGINE
  };
}

// ─── Parent answers query ─────────────────────────────────────────────────────

/**
 * queryParentAnswers — fetches answers from growth_report_answers for this
 * report, joined with question.metric_id.
 * Returns [] if no answers (valid — Pass 1 typically has no answers).
 */
async function queryParentAnswers(
  db: any,
  reportId: string,
): Promise<ParentAnswerSnapshot[]> {
  const rows = await db.execute(sql`
    SELECT
      gra.question_id,
      grq.metric_id,
      gra.selected_values,
      gra.answered_at,
      gra.parent_account_id
    FROM growth_report_answers gra
    INNER JOIN growth_report_questions grq ON grq.id = gra.question_id
    WHERE gra.report_id = ${reportId}
    ORDER BY gra.answered_at ASC
  `);

  return (rows.rows as any[]).map(
    (r): ParentAnswerSnapshot => ({
      question_id:        r.question_id as string,
      metric_id:          r.metric_id as string,
      selected_values:    (r.selected_values ?? []) as unknown[],
      answered_at:        r.answered_at instanceof Date
                            ? r.answered_at.toISOString()
                            : String(r.answered_at),
      parent_account_ref: (r.parent_account_id ?? null) as string | null,
    }),
  );
}

// ─── Longitudinal assembler ───────────────────────────────────────────────────

/**
 * buildLongitudinal — converts published report history to a structured
 * longitudinal snapshot.
 *
 * IMPORTANT:
 *   - Natural language report body is NOT forwarded (§14 spec).
 *   - observation_target.verified_this_period is NOT computed by APP (§14).
 *     ENGINE verifies whether the target was achieved.
 */
function buildLongitudinal(
  publishedReports: any[],
  maxPeriods: number,
): LongitudinalSnapshot {
  const reports = publishedReports.slice(0, maxPeriods);

  const metric_state_history:            unknown[] = [];
  const positive_growth_signal_history:  unknown[] = [];
  const success_condition_history:       unknown[] = [];
  const support_lever_history:           unknown[] = [];
  const parent_evidence_history:         unknown[] = [];
  const observation_target_history:      unknown[] = [];
  const previous_report_structured_results: unknown[] = [];

  for (const rep of reports) {
    const rc = rep.report_content as Record<string, unknown> | null;
    if (!rc) continue;

    if (Array.isArray(rc["metric_states"]))
      metric_state_history.push(...(rc["metric_states"] as unknown[]));
    if (Array.isArray(rc["positive_growth_signals"]))
      positive_growth_signal_history.push(...(rc["positive_growth_signals"] as unknown[]));
    if (Array.isArray(rc["success_conditions"]))
      success_condition_history.push(...(rc["success_conditions"] as unknown[]));
    if (Array.isArray(rc["support_levers"]))
      support_lever_history.push(...(rc["support_levers"] as unknown[]));
    if (Array.isArray(rc["parent_evidence"]))
      parent_evidence_history.push(...(rc["parent_evidence"] as unknown[]));

    // observation targets — WITHOUT verified_this_period (APP must not compute)
    if (Array.isArray(rc["next_observation_targets"])) {
      for (const ot of rc["next_observation_targets"] as any[]) {
        observation_target_history.push({
          report_period: rep.report_period,
          target:        ot,
          // verified_this_period intentionally absent — ENGINE verifies
        });
      }
    }

    // Structured result summary: no natural language body forwarded
    previous_report_structured_results.push({
      report_period:       rep.report_period,
      analysis_status:     rep.analysis_status   ?? null,
      metric_states:       rc["metric_states"]   ?? null,
      success_conditions:  rc["success_conditions"] ?? null,
      support_levers:      rc["support_levers"]  ?? null,
      positive_signals:    rc["positive_growth_signals"] ?? null,
      next_growth_targets: rc["next_growth_targets"] ?? null,
    });
  }

  return {
    metric_state_history,
    positive_growth_signal_history,
    success_condition_history,
    support_lever_history,
    parent_evidence_history,
    observation_target_history,
    previous_report_structured_results,
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * buildAnalysisSnapshot — queries all data sources in parallel and assembles
 * an immutable GrowthReportAnalysisRequest.
 *
 * The snapshot is fixed at build time; no re-fetch happens between hash
 * computation and ENGINE call.
 *
 * Supply `input.requestId` to retry with the same UUID + same payload hash.
 * Omit it to start a fresh analysis attempt with a new UUID.
 */
export async function buildAnalysisSnapshot(
  db: any,
  input: BuildSnapshotInput,
): Promise<BuiltSnapshot> {
  const { report, cycle } = input;
  const requestId  = input.requestId ?? randomUUID();
  const cutoffAt   = cycle.analysis_cutoff_at;
  const maxPeriods = getMaxHistoryPeriods();

  // Parallel data fetch — consistent snapshot moment
  const [
    diaries,
    growthEvents,
    attendance,
    curriculumStateBase,
    parentAnswers,
    publishedHistory,
    scpGauge,
    previousCurriculumPct,
  ] = await Promise.all([
    queryDiaries(db, report.student_id, report.swimming_pool_id, cutoffAt),
    queryGrowthEvents(db, report.student_id, report.swimming_pool_id, cutoffAt),
    queryAttendance(db, report.student_id, report.swimming_pool_id, cutoffAt),
    queryCurriculumState(db, report.student_id, report.swimming_pool_id),
    queryParentAnswers(db, report.id),
    getPublishedReportHistory({
      db,
      studentId: report.student_id,
      poolId:    report.swimming_pool_id,
      limit:     maxPeriods,
    }),
    // GAUGE-07: read current SCP progress gauge
    queryScpGaugeProgress(db, report.student_id, report.swimming_pool_id),
    // GAUGE-07: read previous PUBLISHED report's immutable confirmed_progress_pct
    queryPreviousReportCurriculumPct(
      db,
      report.student_id,
      report.swimming_pool_id,
      report.id,
    ),
  ]);

  // GAUGE-07: merge gauge fields into curriculum_state snapshot
  const curriculumState = mergeGaugeIntoState(
    curriculumStateBase,
    scpGauge,
    previousCurriculumPct,
  );

  const longitudinal = buildLongitudinal(publishedHistory, maxPeriods);

  // Snapshot body (without payload_hash — hash computed from this)
  const snapshotBody: Omit<GrowthReportAnalysisRequest["snapshot"], "payload_hash"> = {
    snapshot_version: GR_SNAPSHOT_VERSION,
    created_at:       new Date().toISOString(),
    diaries,
    growth_events:    growthEvents,
    attendance,
    curriculum_state: curriculumState,
    ...(report.teacher_reviewed_by
      ? {
          teacher_review: {
            reviewed_by: report.teacher_reviewed_by,
            reviewed_at: report.teacher_reviewed_at ?? null,
          },
        }
      : {}),
    longitudinal,
    parent_answers: parentAnswers,
  };

  const payloadHash = computeCanonicalHash(snapshotBody);

  const request: GrowthReportAnalysisRequest = {
    contract_version: GR_CONTRACT_VERSION,
    request_id:       requestId,
    report_id:        report.id,
    context: {
      student_id:         report.student_id,
      pool_id:            report.swimming_pool_id,
      organization_id:    null,
      report_period:      cycle.report_period,
      analysis_from:      cycle.analysis_from,     // always null (GR2 policy)
      analysis_cutoff_at: cutoffAt,
      timezone:           cycle.timezone,
    },
    snapshot: {
      ...snapshotBody,
      payload_hash: payloadHash,
    },
  };

  return { request, requestId, payloadHash };
}
