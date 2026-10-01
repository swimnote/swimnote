import { sql } from "drizzle-orm";
import {
  FREE_GROWTH_REPORT_ELIGIBLE_SQL,
  GROWTH_REPORT_ELIGIBILITY_VERSION,
  GROWTH_REPORT_MIN_ATTENDANCE_COUNT,
  GROWTH_REPORT_MIN_SOURCE_RECORDS,
  evaluateStudentGrowthReportEligibility,
  getGrowthReportAnalysisPeriod,
} from "./growth-report-eligibility.js";
import {
  queryAttendanceForEligibility,
  queryDiariesForEligibility,
} from "./growth-report-snapshot-builder.js";
const MIN_BACKFILL_ELIGIBILITY_VERSION = 4;

export interface MonthlyEligibilityTarget {
  studentId: string;
  confirmedAt?: string;
  eligibilityVersion: number;
  eligibilityEvidence: Record<string, unknown>;
  sourceProvenance: "LIVE_SEAL" | "LEGACY_STORED_EVIDENCE";
}
export interface MonthlyTargetManifest {
  cycleId: string;
  poolId: string;
  reportPeriod: string;
  eligibleTotal: number;
  sealedAt: string;
  targets: MonthlyEligibilityTarget[];
}
interface CycleRow {
  id: string;
  swimming_pool_id: string;
  report_period: string;
  analysis_from: string | Date | null;
  eligible_total: number | string | null;
  eligibility_sealed_at: string | Date | null;
}
function asIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function asDateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
function requireTransaction(db: any): (operation: (tx: any) => Promise<unknown>) => Promise<unknown> {
  if (typeof db?.transaction !== "function") {
    throw new Error("Monthly target sealing requires a transactional database adapter.");
  }
  return db.transaction.bind(db);
}
function requireValidPeriod(reportPeriod: string): void {
  getGrowthReportAnalysisPeriod(reportPeriod);
}
async function lockCycle(
  tx: any,
  cycleId: string,
  poolId: string,
  reportPeriod: string,
): Promise<CycleRow> {
  const result = await tx.execute(sql`
    SELECT id, swimming_pool_id, report_period, analysis_from,
           eligible_total, eligibility_sealed_at
    FROM growth_report_cycles
    WHERE id = ${cycleId}
    FOR UPDATE
  `);
  const cycle = (result.rows as CycleRow[])[0];
  if (!cycle) throw new Error(`Monthly target cycle not found: ${cycleId}`);
  if (cycle.swimming_pool_id !== poolId || cycle.report_period !== reportPeriod) {
    throw new Error("Monthly target cycle context does not match pool and report period.");
  }
  return cycle;
}
async function readManifest(
  tx: any,
  cycle: CycleRow,
  poolId: string,
  reportPeriod: string,
): Promise<MonthlyTargetManifest> {
  const rows = await tx.execute(sql`
    SELECT student_id, confirmed_at, eligibility_version, eligibility_evidence, source_provenance
    FROM growth_report_eligible_targets
    WHERE cycle_id = ${cycle.id}
    ORDER BY student_id
  `);
  const targets = (rows.rows as any[]).map((row) => ({
    studentId: String(row.student_id),
    confirmedAt: asIso(row.confirmed_at)!,
    eligibilityVersion: Number(row.eligibility_version),
    eligibilityEvidence: row.eligibility_evidence as Record<string, unknown>,
    sourceProvenance: row.source_provenance as MonthlyEligibilityTarget["sourceProvenance"],
  }));
  const eligibleTotal = Number(cycle.eligible_total ?? targets.length);
  if (targets.length !== eligibleTotal) {
    throw new Error(
      `Sealed monthly target count mismatch for cycle ${cycle.id}: ` +
      `stored=${eligibleTotal} rows=${targets.length}`,
    );
  }
  const sealedAt = asIso(cycle.eligibility_sealed_at);
  if (!sealedAt) throw new Error(`Cycle ${cycle.id} has targets but no eligibility seal timestamp.`);
  return {
    cycleId: cycle.id,
    poolId,
    reportPeriod,
    eligibleTotal,
    sealedAt,
    targets,
  };
}
async function assertPoolEligible(tx: any, poolId: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT id
    FROM swimming_pools
    WHERE id = ${poolId}
      AND ${sql.raw(FREE_GROWTH_REPORT_ELIGIBLE_SQL)}
    LIMIT 1
  `);
  if (!(result.rows as any[]).length) {
    throw new Error(`Pool ${poolId} is not approved for monthly Growth Reports.`);
  }
}
function liveEligibilityEvidence(input: {
  reportPeriod: string;
  attendanceCount: number;
  sourceEventCount: number;
  classGroupIds: unknown;
  continuityDate: string;
}): Record<string, unknown> {
  return {
    policy: "MONTHLY_FINAL_ELIGIBILITY",
    report_period: input.reportPeriod,
    attendance_count: input.attendanceCount,
    source_event_count: input.sourceEventCount,
    reregistered: true,
    continuity_date: input.continuityDate,
    qualifying_class_group_ids: input.classGroupIds,
    eligibility_version: GROWTH_REPORT_ELIGIBILITY_VERSION,
  };
}
async function insertReportRows(
  tx: any,
  cycle: CycleRow,
  poolId: string,
  reportPeriod: string,
): Promise<void> {
  const period = getGrowthReportAnalysisPeriod(reportPeriod);
  await tx.execute(sql`
    INSERT INTO growth_reports (
      student_id, swimming_pool_id, cycle_id, report_period,
      product_status, parent_input_status, snapshot_version,
      period_start, period_end, eligibility_version,
      attendance_count, source_event_count
    )
    SELECT target.student_id, ${poolId}, ${cycle.id}, ${reportPeriod},
           'NOT_OPEN', 'NONE', 0, ${period.startDate}::date,
           (${period.endDateExclusive}::date - INTERVAL '1 day')::date,
           target.eligibility_version,
           (target.eligibility_evidence->>'attendance_count')::integer,
           (target.eligibility_evidence->>'source_event_count')::integer
    FROM growth_report_eligible_targets target
    WHERE target.cycle_id = ${cycle.id}
    ON CONFLICT DO NOTHING
  `);
}
async function persistTargetReportEvidence(
  tx: any,
  cycle: CycleRow,
  poolId: string,
  reportPeriod: string,
): Promise<void> {
  await insertReportRows(tx, cycle, poolId, reportPeriod);
  await tx.execute(sql`
    UPDATE growth_reports gr
    SET eligibility_version = target.eligibility_version,
        attendance_count = (target.eligibility_evidence->>'attendance_count')::integer,
        source_event_count = (target.eligibility_evidence->>'source_event_count')::integer,
        updated_at = now()
    FROM growth_report_eligible_targets target
    WHERE target.cycle_id = ${cycle.id}
      AND gr.cycle_id = target.cycle_id
      AND gr.student_id = target.student_id
      AND gr.product_status = 'OPEN'
      AND gr.analysis_request_id IS NULL
      AND gr.analysis_request_payload IS NULL
      AND gr.analysis_status IS NULL
      AND COALESCE(gr.eligibility_version, 0) = 0
      AND COALESCE(gr.attendance_count, 0) = 0
      AND COALESCE(gr.source_event_count, 0) = 0
  `);
}
async function sealNewManifest(
  tx: any,
  cycle: CycleRow,
  poolId: string,
  reportPeriod: string,
  targets: MonthlyEligibilityTarget[],
): Promise<MonthlyTargetManifest> {
  for (const target of targets) {
    await tx.execute(sql`
      INSERT INTO growth_report_eligible_targets (
        cycle_id, student_id, confirmed_at, eligibility_version,
        eligibility_evidence, source_provenance
      ) VALUES (
        ${cycle.id}, ${target.studentId},
        COALESCE(${target.confirmedAt ?? null}::timestamptz, now()),
        ${target.eligibilityVersion},
        ${JSON.stringify(target.eligibilityEvidence)}::jsonb, ${target.sourceProvenance}
      )
      ON CONFLICT (cycle_id, student_id) DO NOTHING
    `);
  }
  const stored = await tx.execute(sql`
    SELECT student_id, confirmed_at, eligibility_version, eligibility_evidence, source_provenance
    FROM growth_report_eligible_targets
    WHERE cycle_id = ${cycle.id}
    ORDER BY student_id
  `);
  if ((stored.rows as any[]).length !== targets.length) {
    throw new Error(
      `Monthly target seal conflict for cycle ${cycle.id}: ` +
      `computed=${targets.length} stored=${(stored.rows as any[]).length}`,
    );
  }
  await persistTargetReportEvidence(tx, cycle, poolId, reportPeriod);
  await tx.execute(sql`
    UPDATE growth_report_cycles
    SET eligible_total = ${targets.length},
        eligibility_sealed_at = now(),
        updated_at = now()
    WHERE id = ${cycle.id}
      AND eligibility_sealed_at IS NULL
  `);
  const sealed = await tx.execute(sql`
    SELECT id, swimming_pool_id, report_period, analysis_from,
           eligible_total, eligibility_sealed_at
    FROM growth_report_cycles
    WHERE id = ${cycle.id}
  `);
  const sealedCycle = (sealed.rows as CycleRow[])[0];
  if (!sealedCycle) throw new Error(`Cycle disappeared during target sealing: ${cycle.id}`);
  return readManifest(tx, sealedCycle, poolId, reportPeriod);
}

export async function sealMonthlyTargets(
  db: any,
  input: { cycleId: string; poolId: string; reportPeriod: string },
): Promise<MonthlyTargetManifest> {
  requireValidPeriod(input.reportPeriod);
  const transaction = requireTransaction(db);
  return transaction(async (tx: any) => {
    await tx.execute(sql.raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"));
    const cycle = await lockCycle(tx, input.cycleId, input.poolId, input.reportPeriod);
    if (cycle.eligibility_sealed_at) {
      await persistTargetReportEvidence(tx, cycle, input.poolId, input.reportPeriod);
      return readManifest(tx, cycle, input.poolId, input.reportPeriod);
    }

    const historicalEvidence = await tx.execute(sql`
      SELECT id
      FROM growth_reports
      WHERE cycle_id = ${input.cycleId}
        AND deleted_at IS NULL
        AND (
          COALESCE(eligibility_version, 0) > 0
          OR analysis_request_id IS NOT NULL
          OR analysis_request_payload IS NOT NULL
          OR analysis_status IS NOT NULL
        )
      LIMIT 1
    `);
    if ((historicalEvidence.rows as any[]).length) {
      throw new Error(
        `Cycle ${input.cycleId} contains saved eligibility or analysis evidence; ` +
        "use backfillLegacyMonthlyTargets instead of live recalculation.",
      );
    }
    await assertPoolEligible(tx, input.poolId);

    const period = getGrowthReportAnalysisPeriod(input.reportPeriod);
    const analysisFrom = asDateOnly(cycle.analysis_from);
    const diaryStart = analysisFrom && analysisFrom > period.startDate
      ? analysisFrom
      : period.startDate;
    const candidates = await tx.execute(sql`
      SELECT s.id AS student_id,
             array_agg(DISTINCT sch.class_group_id ORDER BY sch.class_group_id)
               AS qualifying_class_group_ids
      FROM students s
      JOIN student_class_history sch ON sch.student_id = s.id
      JOIN class_groups cg ON cg.id = sch.class_group_id
      WHERE cg.swimming_pool_id = ${input.poolId}
        AND sch.swimming_pool_id = ${input.poolId}
        AND (
          s.status = 'active'
          OR s.withdrawn_at >= (${period.endDateExclusive}::date::timestamp AT TIME ZONE 'Asia/Seoul')
          OR s.deleted_at >= (${period.endDateExclusive}::date::timestamp AT TIME ZONE 'Asia/Seoul')
        )
        AND (
          s.deleted_at IS NULL
          OR s.deleted_at >= (${period.endDateExclusive}::date::timestamp AT TIME ZONE 'Asia/Seoul')
        )
        AND sch.enrolled_at < ${period.endDateExclusive}::date
        AND (sch.left_at IS NULL OR sch.left_at >= ${period.endDateExclusive}::date)
      GROUP BY s.id
      ORDER BY s.id
    `);

    const targets: MonthlyEligibilityTarget[] = [];
    for (const candidate of candidates.rows as any[]) {
      const studentId = String(candidate.student_id);
      const [attendanceCount, sourceEventCount] = await Promise.all([
        queryAttendanceForEligibility(
          tx,
          studentId,
          input.poolId,
          period.startDate,
          period.endDateExclusive,
        ),
        queryDiariesForEligibility(
          tx,
          studentId,
          input.poolId,
          period.endDateExclusive,
          diaryStart,
        ),
      ]);
      const eligibility = evaluateStudentGrowthReportEligibility({
        attendanceCount,
        sourceEventCount,
        reregistered: true,
      });
      if (!eligibility.eligible) continue;
      targets.push({
        studentId,
        eligibilityVersion: eligibility.eligibility_version,
        sourceProvenance: "LIVE_SEAL",
        eligibilityEvidence: liveEligibilityEvidence({
          reportPeriod: input.reportPeriod,
          attendanceCount,
          sourceEventCount,
          classGroupIds: candidate.qualifying_class_group_ids,
          continuityDate: period.endDateExclusive,
        }),
      });
    }
    return sealNewManifest(tx, cycle, input.poolId, input.reportPeriod, targets);
  }) as Promise<MonthlyTargetManifest>;
}

function parseSavedRequest(value: unknown): Record<string, any> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function legacyEvidence(
  row: any,
  poolId: string,
  reportPeriod: string,
  backfilledAt: string,
): { confirmedAt: string; evidence: Record<string, unknown> } {
  const request = parseSavedRequest(row.analysis_request_payload);
  const context = request?.context;
  const historicalConfirmation = request?.snapshot?.created_at;
  const requestMatches =
    request?.report_id === row.report_id &&
    request?.request_id === row.analysis_request_id &&
    typeof row.snapshot_hash === "string" &&
    request?.snapshot?.payload_hash === row.snapshot_hash &&
    typeof historicalConfirmation === "string" &&
    Number.isFinite(Date.parse(historicalConfirmation)) &&
    context?.student_id === row.student_id &&
    context?.pool_id === poolId &&
    context?.report_period === reportPeriod;
  if (!requestMatches) {
    throw new Error(
      `Legacy eligibility evidence is incomplete or mismatched for report ${row.report_id}.`,
    );
  }
  return {
    confirmedAt: new Date(historicalConfirmation).toISOString(),
    evidence: {
      source: "SAVED_GROWTH_REPORT_ELIGIBILITY",
      report_id: row.report_id,
      cycle_id: row.cycle_id,
      report_period: reportPeriod,
      request_id: row.analysis_request_id,
      snapshot_hash: row.snapshot_hash,
      request_snapshot_created_at: historicalConfirmation,
      backfilled_at: backfilledAt,
      request_context: {
        student_id: row.student_id,
        pool_id: poolId,
        report_period: reportPeriod,
      },
      eligibility_version: Number(row.eligibility_version),
      attendance_count: Number(row.attendance_count),
      source_event_count: Number(row.source_event_count),
      exclusion_code: null,
    },
  };
}

export async function backfillLegacyMonthlyTargets(
  db: any,
  input: { poolId: string; reportPeriod: string },
): Promise<MonthlyTargetManifest> {
  requireValidPeriod(input.reportPeriod);
  const transaction = requireTransaction(db);
  return transaction(async (tx: any) => {
    await tx.execute(sql.raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"));
    const cycleResult = await tx.execute(sql`
      SELECT id, swimming_pool_id, report_period, analysis_from,
             eligible_total, eligibility_sealed_at
      FROM growth_report_cycles
      WHERE swimming_pool_id = ${input.poolId}
        AND report_period = ${input.reportPeriod}
      FOR UPDATE
    `);
    const cycle = (cycleResult.rows as CycleRow[])[0];
    if (!cycle) {
      throw new Error(
        `Legacy monthly target cycle not found for ${input.poolId}/${input.reportPeriod}.`,
      );
    }
    if (cycle.eligibility_sealed_at) {
      return readManifest(tx, cycle, input.poolId, input.reportPeriod);
    }

    const recordedAtResult = await tx.execute(sql`
      SELECT transaction_timestamp() AS recorded_at
    `);
    const backfilledAt = asIso((recordedAtResult.rows as any[])[0]?.recorded_at);
    if (!backfilledAt) {
      throw new Error(`Could not establish the legacy backfill time for cycle ${cycle.id}.`);
    }

    const rows = await tx.execute(sql`
      SELECT gr.id AS report_id, gr.student_id, gr.cycle_id,
             gr.report_period, gr.swimming_pool_id,
             gr.analysis_request_id, gr.analysis_request_payload,
             gr.snapshot_hash,
             gr.eligibility_version, gr.attendance_count,
             gr.source_event_count, gr.exclusion_code, gr.product_status
      FROM growth_reports gr
      WHERE gr.cycle_id = ${cycle.id}
        AND gr.swimming_pool_id = ${input.poolId}
        AND gr.report_period = ${input.reportPeriod}
        AND gr.deleted_at IS NULL
        AND gr.product_status <> 'EXCLUDED'
        AND gr.exclusion_code IS NULL
        AND gr.eligibility_version >= ${MIN_BACKFILL_ELIGIBILITY_VERSION}
        AND gr.attendance_count >= ${GROWTH_REPORT_MIN_ATTENDANCE_COUNT}
        AND gr.source_event_count >= ${GROWTH_REPORT_MIN_SOURCE_RECORDS}
      ORDER BY gr.student_id, gr.id
    `);

    const targets: MonthlyEligibilityTarget[] = (rows.rows as any[]).map((row) => {
      const legacy = legacyEvidence(row, input.poolId, input.reportPeriod, backfilledAt);
      return {
        studentId: String(row.student_id),
        confirmedAt: legacy.confirmedAt,
        eligibilityVersion: Number(row.eligibility_version),
        sourceProvenance: "LEGACY_STORED_EVIDENCE",
        eligibilityEvidence: legacy.evidence,
      };
    });
    if (new Set(targets.map((target) => target.studentId)).size !== targets.length) {
      throw new Error(`Duplicate legacy target identity in cycle ${cycle.id}.`);
    }
    return sealNewManifest(tx, cycle, input.poolId, input.reportPeriod, targets);
  }) as Promise<MonthlyTargetManifest>;
}

export async function getSealedMonthlyTargetRoster(
  db: { execute(query: unknown): Promise<{ rows: unknown[] }> },
  cycleId: string,
): Promise<Array<{ studentId: string }>> {
  const result = await db.execute(sql`
    SELECT student_id
    FROM growth_report_eligible_targets
    WHERE cycle_id = ${cycleId}
    ORDER BY student_id
  `);
  return (result.rows as Array<{ student_id: string }>).map((row) => ({
    studentId: row.student_id,
  }));
}