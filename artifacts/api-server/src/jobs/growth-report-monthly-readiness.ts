import { sql } from "drizzle-orm";

export type MonthlyReportReadiness = {
  analysis_ready: number;
  insufficient_evidence: number;
  excluded: number;
  data_accumulating: number;
  retrying: number;
  pending_analysis: number;
  terminal_failed: number;
  published: number;
  other: number;
  total: number;
  eligible_total: number;
  generated_total: number;
  insufficient_evidence_total: number;
  policy_excluded_total: number;
  resolved_total: number;
  remaining_count: number;
  queued: number;
  processing: number;
  retry_pending: number;
  failed: number;
  unknown: number;
  missing: number;
  duplicate: number;
  wrong_pool: number;
  ready: boolean;
  empty_target: boolean;
  snapshot_sealed: boolean;
};

export type ReadinessReportRow = {
  product_status?: string | null;
  analysis_status?: string | null;
  exclusion_code?: string | null;
  analysis_retry_count?: number | string | null;
  readiness_eligible?: boolean | string | null;
  monthly_final_disposition?: string | null;
};

type MonthlyCycle = {
  id: string;
  swimming_pool_id: string;
  eligible_total: number | string | null;
  eligibility_sealed_at: unknown;
};

type ReconciliationRow = {
  student_id: string;
  target_pool_id?: string | null;
  report_id?: string | null;
  swimming_pool_id?: string | null;
  product_status?: string | null;
  analysis_status?: string | null;
  exclusion_code?: string | null;
  analysis_retry_count?: number | string | null;
  analysis_next_attempt_at?: unknown;
  analysis_claim_token?: string | null;
  analysis_lease_until?: unknown;
  analysis_call_started_at?: unknown;
  analysis_uncertain_at?: unknown;
  eligibility_version?: number | string | null;
  attendance_count?: number | string | null;
  source_event_count?: number | string | null;
  report_content?: unknown;
  report_fact_package?: unknown;
  sns_summary?: unknown;
  monthly_final_disposition?: string | null;
  monthly_disposition_version?: number | string | null;
  first_pass_outcome?: string | null;
  report_period?: string | null;
  withdrawal_evidence_valid?: boolean | string | null;
};

type WithdrawalCandidate = ReconciliationRow & {
  confirmed_at: unknown;
  withdrawal_id: string;
  withdrawn_at: unknown;
  current_student_withdrawn_at: unknown;
  current_student_status: string;
  student_deleted_at: unknown;
};

export type MonthlyReadinessExecutor = {
  execute(query: unknown): Promise<{ rows: unknown[] }>;
};

export type MonthlyReadinessDb = MonthlyReadinessExecutor & {
  transaction<T>(callback: (tx: MonthlyReadinessExecutor) => Promise<T>): Promise<T>;
};

export type MonthlyReadyIntentWriter = (
  tx: MonthlyReadinessExecutor,
  readiness: MonthlyReportReadiness,
) => Promise<void>;

export function monthlyReadinessStatus(row: ReadinessReportRow): string {
  const product = String(row.product_status ?? "").toUpperCase();
  const analysis = String(row.analysis_status ?? "").toUpperCase();
  const attempts = Number(row.analysis_retry_count ?? 0);
  const ready = row.readiness_eligible === true || row.readiness_eligible === "t";
  if (product === "PUBLISHED") return "PUBLISHED";
  if (product === "EXCLUDED" || row.exclusion_code) return "EXCLUDED";
  if (
    row.monthly_final_disposition === "INSUFFICIENT_EVIDENCE" &&
    analysis === "DATA_ACCUMULATING" &&
    ["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"].includes(product)
  ) {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (analysis === "DATA_ACCUMULATING" || product === "DATA_ACCUMULATING") {
    return "DATA_ACCUMULATING";
  }
  if (product === "FAILED" || analysis === "FAILED" || analysis === "MAX_RETRY_EXCEEDED") {
    return "TERMINAL_FAILED";
  }
  if (
    ["PREANALYZING", "ANALYZING", "REGENERATING"].includes(product) ||
    ["PROCESSING", "RETRYING"].includes(analysis)
  ) return "RETRYING";
  if (["OPEN", "READY_FOR_ANALYSIS"].includes(product)) {
    return attempts > 0 ? "RETRYING" : "PENDING_ANALYSIS";
  }
  if (ready) return "ANALYSIS_READY";
  return "OTHER";
}

export function classifyMonthlyReadiness(
  rows: ReadinessReportRow[],
): Pick<MonthlyReportReadiness,
  "analysis_ready" | "insufficient_evidence" | "excluded" | "data_accumulating" | "retrying" |
  "pending_analysis" | "terminal_failed" | "published" | "other" | "total"
> {
  const result = {
    analysis_ready: 0,
    insufficient_evidence: 0,
    excluded: 0,
    data_accumulating: 0,
    retrying: 0,
    pending_analysis: 0,
    terminal_failed: 0,
    published: 0,
    other: 0,
    total: rows.length,
  };

  for (const row of rows) {
    switch (monthlyReadinessStatus(row)) {
      case "PUBLISHED": result.published++; break;
      case "EXCLUDED": result.excluded++; break;
      case "DATA_ACCUMULATING": result.data_accumulating++; break;
      case "TERMINAL_FAILED": result.terminal_failed++; break;
      case "RETRYING": result.retrying++; break;
      case "PENDING_ANALYSIS": result.pending_analysis++; break;
      case "ANALYSIS_READY": result.analysis_ready++; break;
      case "INSUFFICIENT_EVIDENCE": result.insufficient_evidence++; break;
      default: result.other++; break;
    }
  }

  return result;
}

function hasObjectContent(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    !Array.isArray(value) && Object.keys(value).length > 0;
}

function passedStoredCheck(value: unknown): boolean {
  return value === "PASS" || value === "REVISED_PASS";
}

function completedReportIsQualified(row: ReconciliationRow): boolean {
  const packageData = row.report_fact_package as Record<string, unknown> | null;
  return ["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"]
      .includes(String(row.product_status ?? "").toUpperCase()) &&
    row.analysis_uncertain_at == null &&
    ["COMPLETE", "COMPLETE_WITH_QUESTIONS_AVAILABLE", "COMPLETE_WITH_PARENT_EVIDENCE"]
      .includes(String(row.analysis_status ?? "").toUpperCase()) &&
    Number(row.eligibility_version ?? 0) >= 4 &&
    !row.exclusion_code &&
    Number(row.attendance_count ?? 0) >= 3 &&
    Number(row.source_event_count ?? 0) >= 1 &&
    hasObjectContent(row.report_content) &&
    hasObjectContent(packageData) &&
    hasObjectContent(row.sns_summary) &&
    passedStoredCheck(packageData?.grounding_result) &&
    passedStoredCheck(packageData?.growth_framing_result);
}

function insufficientEvidenceReportIsResolved(row: ReconciliationRow): boolean {
  const content = row.report_content as Record<string, unknown> | null;
  return row.monthly_final_disposition === "INSUFFICIENT_EVIDENCE" &&
    Number(row.monthly_disposition_version) === 1 &&
    row.first_pass_outcome === "insufficient_evidence" &&
    ["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"]
      .includes(String(row.product_status ?? "").toUpperCase()) &&
    String(row.analysis_status ?? "").toUpperCase() === "DATA_ACCUMULATING" &&
    row.analysis_uncertain_at == null &&
    !row.exclusion_code &&
    row.report_fact_package == null &&
    row.sns_summary == null &&
    typeof content?.["student_name"] === "string" &&
    !!content["student_name"].trim() &&
    content["composition_version"] === "APP_MONTHLY_NOTICE_V1" &&
    content?.["summary_text"] ===
      "이번 달은 성장 판단에 필요한 충분한 변화 근거가 아직 축적되지 않았습니다." &&
    !!content["sections"] &&
    typeof content["sections"] === "object" &&
    !Array.isArray(content["sections"]) &&
    Object.keys(content["sections"] as object).length === 0;
}

function isUnattemptedQueuedReport(row: ReconciliationRow): boolean {
  return ["OPEN", "READY_FOR_ANALYSIS"].includes(
    String(row.product_status ?? "").toUpperCase(),
  ) &&
    row.analysis_status == null &&
    Number(row.analysis_retry_count ?? 0) === 0 &&
    row.analysis_claim_token == null &&
    row.analysis_lease_until == null &&
    row.analysis_call_started_at == null &&
    row.analysis_uncertain_at == null &&
    !row.exclusion_code;
}

function isGeneratedNonPublishedReport(row: ReconciliationRow): boolean {
  return ["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED"].includes(
    String(row.product_status ?? "").toUpperCase(),
  ) && completedReportIsQualified(row);
}

function isTrue(value: unknown): boolean {
  return value === true || value === "t";
}

function isFailure(row: ReconciliationRow): boolean {
  return ["FAILED", "MAX_RETRY_EXCEEDED"].includes(String(row.product_status ?? "").toUpperCase()) ||
    ["FAILED", "MAX_RETRY_EXCEEDED"].includes(String(row.analysis_status ?? "").toUpperCase());
}

function isUnknown(row: ReconciliationRow): boolean {
  return row.analysis_uncertain_at != null ||
    ["UNKNOWN", "UNCERTAIN"].includes(String(row.product_status ?? "").toUpperCase()) ||
    ["UNKNOWN", "UNCERTAIN"].includes(String(row.analysis_status ?? "").toUpperCase());
}

function isDataAccumulating(row: ReconciliationRow): boolean {
  return String(row.product_status ?? "").toUpperCase() === "DATA_ACCUMULATING" ||
    String(row.analysis_status ?? "").toUpperCase() === "DATA_ACCUMULATING";
}

function isProcessing(row: ReconciliationRow): boolean {
  return ["PREANALYZING", "ANALYZING", "REGENERATING"].includes(
    String(row.product_status ?? "").toUpperCase(),
  ) || String(row.analysis_status ?? "").toUpperCase() === "PROCESSING";
}

function isRetryPending(row: ReconciliationRow, now: number): boolean {
  const nextAttemptValue = row.analysis_next_attempt_at;
  const nextAttempt = nextAttemptValue == null
    ? Number.NaN
    : nextAttemptValue instanceof Date
      ? nextAttemptValue.getTime()
      : new Date(nextAttemptValue as string | number).getTime();
  return String(row.analysis_status ?? "").toUpperCase() === "RETRYING" ||
    (["OPEN", "READY_FOR_ANALYSIS"].includes(String(row.product_status ?? "").toUpperCase()) &&
      Number(row.analysis_retry_count ?? 0) > 0) ||
    nextAttempt > now;
}

function isQueued(row: ReconciliationRow): boolean {
  return ["OPEN", "READY_FOR_ANALYSIS"].includes(String(row.product_status ?? "").toUpperCase()) ||
    ["QUEUED", "PENDING"].includes(String(row.analysis_status ?? "").toUpperCase());
}

function isEligiblePolicyDisposition(
  targetRows: ReconciliationRow[],
  reports: ReconciliationRow[],
  now: number,
): boolean {
  if (!targetRows.some(row => isTrue(row.withdrawal_evidence_valid))) return false;
  if (reports.length !== 1) return false;
  const report = reports[0];
  if (
    report.swimming_pool_id !== targetRows[0].target_pool_id ||
    String(report.product_status ?? "").toUpperCase() !== "EXCLUDED" ||
    report.exclusion_code !== "POST_ELIGIBILITY_WITHDRAWAL" ||
    completedReportIsQualified(report) ||
    isFailure(report) ||
    isUnknown(report) ||
    isDataAccumulating(report) ||
    isProcessing(report) ||
    isRetryPending(report, now)
  ) return false;
  // The distinct exclusion code proves that the guarded transition below
  // changed an eligible report. Initial eligibility EXCLUDED is not policy.
  return true;
}

function emptyReadiness(snapshotSealed = false): MonthlyReportReadiness {
  return {
    analysis_ready: 0,
    insufficient_evidence: 0,
    excluded: 0,
    data_accumulating: 0,
    retrying: 0,
    pending_analysis: 0,
    terminal_failed: 0,
    published: 0,
    other: 0,
    total: 0,
    eligible_total: 0,
    generated_total: 0,
    insufficient_evidence_total: 0,
    policy_excluded_total: 0,
    resolved_total: 0,
    remaining_count: 0,
    queued: 0,
    processing: 0,
    retry_pending: 0,
    failed: 0,
    unknown: 0,
    missing: 0,
    duplicate: 0,
    wrong_pool: 0,
    ready: false,
    empty_target: false,
    snapshot_sealed: snapshotSealed,
  };
}

/**
 * Reconcile every sealed target against every actual, non-deleted report row.
 * There is intentionally no DISTINCT/latest selection: duplicate logical
 * reports and wrong-pool records remain visible to the readiness gate.
 */
export function summarizeMonthlyTargetRows(
  eligibleTotalValue: number | string | null,
  targetRows: ReconciliationRow[],
  snapshotSealed: boolean,
  now = Date.now(),
): MonthlyReportReadiness {
  const result = emptyReadiness(snapshotSealed);
  const parsedEligibleTotal = Number(eligibleTotalValue ?? 0);
  const eligibleTotal = Number.isFinite(parsedEligibleTotal)
    ? Math.max(0, parsedEligibleTotal)
    : 0;
  result.eligible_total = eligibleTotal;

  const targets = new Map<string, ReconciliationRow[]>();
  for (const row of targetRows) {
    const group = targets.get(row.student_id) ?? [];
    group.push(row);
    targets.set(row.student_id, group);
  }

  const legacyReportRows: ReadinessReportRow[] = [];
  let generated = 0;
  let insufficientEvidence = 0;
  let policyExcluded = 0;

  for (const rows of targets.values()) {
    const reports = rows.filter(row => row.report_id != null);
    const wrongPool = reports.some(row => row.swimming_pool_id !== rows[0].target_pool_id);
    const generatedReport = reports.length === 1 &&
      !wrongPool &&
      completedReportIsQualified(reports[0]);
    const insufficientEvidenceReport = reports.length === 1 &&
      !wrongPool &&
      insufficientEvidenceReportIsResolved(reports[0]);
    const policyDisposition = !generatedReport &&
      !insufficientEvidenceReport &&
      isEligiblePolicyDisposition(rows, reports, now);

    if (reports.length > 1) result.duplicate++;
    if (wrongPool) result.wrong_pool++;
    if (generatedReport) generated++;
    if (insufficientEvidenceReport) insufficientEvidence++;
    if (policyDisposition) policyExcluded++;
    if (reports.length === 0 && !policyDisposition) result.missing++;

    if (reports.length === 1 && !wrongPool && !generatedReport &&
      !insufficientEvidenceReport && !policyDisposition) {
      const report = reports[0];
      if (isFailure(report)) result.failed++;
      else if (isUnknown(report)) result.unknown++;
      else if (isProcessing(report)) result.processing++;
      else if (isRetryPending(report, now)) result.retry_pending++;
      else if (isQueued(report)) result.queued++;
      else if (String(report.analysis_status ?? "").toUpperCase() === "DATA_ACCUMULATING" ||
        String(report.product_status ?? "").toUpperCase() === "DATA_ACCUMULATING") {
        result.unknown++;
      } else result.unknown++;
    } else if (reports.length > 1 || wrongPool) {
      // A malformed identity cannot be made ready by a status on one of its rows.
      result.unknown++;
    }

    for (const report of reports) {
      legacyReportRows.push({
        product_status: report.product_status,
        analysis_status: report.analysis_status,
        exclusion_code: report.exclusion_code,
        analysis_retry_count: report.analysis_retry_count,
        readiness_eligible: completedReportIsQualified(report),
        monthly_final_disposition: insufficientEvidenceReportIsResolved(report)
          ? "INSUFFICIENT_EVIDENCE"
          : null,
      });
    }
  }

  const legacy = classifyMonthlyReadiness(legacyReportRows);
  Object.assign(result, legacy);
  result.eligible_total = eligibleTotal;
  result.generated_total = generated;
  result.insufficient_evidence_total = insufficientEvidence;
  result.policy_excluded_total = policyExcluded;
  result.resolved_total = generated + insufficientEvidence + policyExcluded;
  result.remaining_count = Math.max(0, result.eligible_total - result.resolved_total);

  const targetIdentityCount = targets.size;
  if (targetIdentityCount < result.eligible_total) {
    result.missing += result.eligible_total - targetIdentityCount;
  } else if (targetIdentityCount > result.eligible_total) {
    result.unknown += targetIdentityCount - result.eligible_total;
  }

  result.empty_target = snapshotSealed && result.eligible_total === 0;
  result.ready = snapshotSealed &&
    result.eligible_total > 0 &&
    targetIdentityCount === result.eligible_total &&
    result.resolved_total === result.eligible_total &&
    result.queued === 0 &&
    result.processing === 0 &&
    result.retry_pending === 0 &&
    result.failed === 0 &&
    result.unknown === 0 &&
    result.missing === 0 &&
    result.duplicate === 0 &&
    result.wrong_pool === 0;
  return result;
}

async function reconcileWithinTransaction(
  tx: MonthlyReadinessExecutor,
  params: { poolId: string; reportPeriod: string },
  onReady?: MonthlyReadyIntentWriter,
  recordReady = true,
): Promise<MonthlyReportReadiness> {
  const cycleQuery = recordReady
    ? sql`
        SELECT id, swimming_pool_id, eligible_total, eligibility_sealed_at
        FROM growth_report_cycles
        WHERE swimming_pool_id = ${params.poolId}
          AND report_period = ${params.reportPeriod}
        FOR UPDATE
      `
    : sql`
        SELECT id, swimming_pool_id, eligible_total, eligibility_sealed_at
        FROM growth_report_cycles
        WHERE swimming_pool_id = ${params.poolId}
          AND report_period = ${params.reportPeriod}
      `;
  const cycleResult = await tx.execute(cycleQuery);
  const cycle = (cycleResult.rows as MonthlyCycle[])[0];
  if (!cycle || cycle.eligibility_sealed_at == null) return emptyReadiness(false);

  if (recordReady) await transitionPostSealWithdrawals(tx, cycle);

  const reconciliation = await tx.execute(sql`
    SELECT
      target.student_id,
      cycle.swimming_pool_id AS target_pool_id,
      report.id AS report_id,
      report.swimming_pool_id,
      report.product_status,
      report.analysis_status,
      report.exclusion_code,
      report.analysis_retry_count,
      report.analysis_next_attempt_at,
      report.analysis_claim_token,
      report.analysis_lease_until,
      report.analysis_call_started_at,
      report.analysis_uncertain_at,
      report.eligibility_version,
      report.attendance_count,
      report.source_event_count,
      report.report_content,
      report.report_fact_package,
      report.sns_summary,
      to_jsonb(report)->>'monthly_final_disposition' AS monthly_final_disposition,
      to_jsonb(report)->>'monthly_disposition_version' AS monthly_disposition_version,
      to_jsonb(target)->>'first_pass_outcome' AS first_pass_outcome,
      report.report_period,
      (
        target.policy_excluded_at IS NOT NULL
        AND target.policy_exclusion_reason IS NOT NULL
        AND btrim(target.policy_exclusion_reason) <> ''
        AND target.policy_evidence_ref = withdrawal.id
        AND target.policy_excluded_at > target.confirmed_at
        AND withdrawal.withdrawn_at > target.confirmed_at
        AND target.policy_excluded_at >= withdrawal.withdrawn_at
        AND withdrawal.pool_id = cycle.swimming_pool_id
        AND withdrawal.original_student_id = target.student_id
        AND withdrawal.withdrawn_by_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM students current_student
          WHERE current_student.id = target.student_id
            AND current_student.swimming_pool_id = cycle.swimming_pool_id
            AND current_student.withdrawn_at IS NOT NULL
            AND current_student.withdrawn_at > target.confirmed_at
            AND current_student.withdrawn_at = withdrawal.withdrawn_at
            AND (
              LOWER(current_student.status::text) IS DISTINCT FROM 'active'
              OR current_student.deleted_at IS NOT NULL
            )
        )
      ) AS withdrawal_evidence_valid
    FROM growth_report_eligible_targets target
    JOIN growth_report_cycles cycle ON cycle.id = target.cycle_id
    LEFT JOIN growth_reports report
      ON report.cycle_id = target.cycle_id
      AND report.student_id = target.student_id
      AND report.deleted_at IS NULL
    LEFT JOIN withdrawn_member_archives withdrawal
      ON withdrawal.id = target.policy_evidence_ref
    WHERE target.cycle_id = ${cycle.id}
    ORDER BY target.student_id, report.created_at, report.id
  `);
  const targetRows = reconciliation.rows as ReconciliationRow[];
  const readiness = summarizeMonthlyTargetRows(
    cycle.eligible_total,
    targetRows,
    true,
  );

  if (readiness.ready && recordReady) {
    await tx.execute(sql`
      UPDATE growth_report_cycles
      SET ready_at = COALESCE(ready_at, NOW()), updated_at = NOW()
      WHERE id = ${cycle.id}
        AND eligibility_sealed_at IS NOT NULL
        AND eligible_total = ${readiness.eligible_total}
    `);
    await onReady?.(tx, readiness);
  }
  return readiness;
}

/**
 * Materialize a verified post-seal withdrawal only when delivery has become
 * impossible and the corresponding report is either untouched queued work or
 * a quality-qualified, non-PUBLISHED report. FOR UPDATE serializes this
 * transition against the analysis worker's atomic claim.
 */
async function transitionPostSealWithdrawals(
  tx: MonthlyReadinessExecutor,
  cycle: MonthlyCycle,
): Promise<void> {
  const candidateResult = await tx.execute(sql`
    SELECT
      target.student_id,
      target.confirmed_at,
      cycle.swimming_pool_id AS target_pool_id,
      report.id AS report_id,
      report.swimming_pool_id,
      report.product_status,
      report.analysis_status,
      report.exclusion_code,
      report.analysis_retry_count,
      report.analysis_claim_token,
      report.analysis_lease_until,
      report.analysis_call_started_at,
      report.analysis_uncertain_at,
      report.eligibility_version,
      report.attendance_count,
      report.source_event_count,
      report.report_content,
      report.report_fact_package,
      report.sns_summary,
      withdrawal.id AS withdrawal_id,
      withdrawal.withdrawn_at,
      student.status AS current_student_status,
      student.withdrawn_at AS current_student_withdrawn_at,
      student.deleted_at AS student_deleted_at
    FROM growth_report_eligible_targets target
    JOIN growth_report_cycles cycle ON cycle.id = target.cycle_id
    JOIN growth_reports report
      ON report.cycle_id = target.cycle_id
      AND report.student_id = target.student_id
      AND report.deleted_at IS NULL
    JOIN withdrawn_member_archives withdrawal
      ON withdrawal.original_student_id = target.student_id
      AND withdrawal.pool_id = cycle.swimming_pool_id
      AND withdrawal.withdrawn_at > target.confirmed_at
      AND withdrawal.withdrawn_at <= NOW()
      AND withdrawal.withdrawn_by_id IS NOT NULL
    JOIN students student
      ON student.id = target.student_id
      AND student.swimming_pool_id = cycle.swimming_pool_id
       AND student.withdrawn_at IS NOT NULL
       AND student.withdrawn_at > target.confirmed_at
       AND student.withdrawn_at = withdrawal.withdrawn_at
       AND (
         LOWER(student.status::text) IS DISTINCT FROM 'active'
         OR student.deleted_at IS NOT NULL
       )
    WHERE target.cycle_id = ${cycle.id}
      AND target.policy_excluded_at IS NULL
      AND target.policy_exclusion_reason IS NULL
      AND target.policy_evidence_ref IS NULL
    ORDER BY target.student_id, report.created_at, report.id
    FOR UPDATE OF target, report, student
  `);

  const byStudent = new Map<string, WithdrawalCandidate[]>();
  for (const candidate of candidateResult.rows as WithdrawalCandidate[]) {
    const candidates = byStudent.get(candidate.student_id) ?? [];
    candidates.push(candidate);
    byStudent.set(candidate.student_id, candidates);
  }

  for (const candidates of byStudent.values()) {
    // A duplicate report identity is a reconciliation failure, never a
    // withdrawal disposition.
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    if (
      candidate.swimming_pool_id !== cycle.swimming_pool_id ||
      (
        String(candidate.current_student_status ?? "").toLowerCase() === "active" &&
        candidate.student_deleted_at == null
      ) ||
      candidate.current_student_withdrawn_at == null
    ) continue;

    const queued = isUnattemptedQueuedReport(candidate);
    const generated = isGeneratedNonPublishedReport(candidate);
    if (!queued && !generated) continue;

    const updatedReport = queued
      ? await tx.execute(sql`
          UPDATE growth_reports
          SET product_status = 'EXCLUDED',
              exclusion_code = 'POST_ELIGIBILITY_WITHDRAWAL',
              updated_at = NOW()
          WHERE id = ${candidate.report_id}
            AND cycle_id = ${cycle.id}
            AND student_id = ${candidate.student_id}
            AND swimming_pool_id = ${cycle.swimming_pool_id}
            AND deleted_at IS NULL
            AND product_status IN ('OPEN', 'READY_FOR_ANALYSIS')
            AND analysis_status IS NULL
            AND COALESCE(analysis_retry_count, 0) = 0
            AND analysis_claim_token IS NULL
            AND analysis_lease_until IS NULL
            AND analysis_call_started_at IS NULL
            AND analysis_uncertain_at IS NULL
            AND exclusion_code IS NULL
          RETURNING id
        `)
      : await tx.execute(sql`
          UPDATE growth_reports
          SET product_status = 'EXCLUDED',
              exclusion_code = 'POST_ELIGIBILITY_WITHDRAWAL',
              updated_at = NOW()
          WHERE id = ${candidate.report_id}
            AND cycle_id = ${cycle.id}
            AND student_id = ${candidate.student_id}
            AND swimming_pool_id = ${cycle.swimming_pool_id}
            AND deleted_at IS NULL
            AND product_status IN ('REVIEW_REQUIRED', 'READY_TO_SEND', 'APPROVED')
            AND analysis_status IN (
              'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE', 'COMPLETE_WITH_PARENT_EVIDENCE'
            )
            AND exclusion_code IS NULL
          RETURNING id
        `);
    if (!updatedReport.rows.length) continue;

    const updatedTarget = await tx.execute(sql`
      UPDATE growth_report_eligible_targets
      SET policy_excluded_at = NOW(),
          policy_exclusion_reason = 'POST_ELIGIBILITY_WITHDRAWAL',
          policy_evidence_ref = ${candidate.withdrawal_id}
      WHERE cycle_id = ${cycle.id}
        AND student_id = ${candidate.student_id}
        AND confirmed_at = ${candidate.confirmed_at}
        AND policy_excluded_at IS NULL
        AND policy_exclusion_reason IS NULL
        AND policy_evidence_ref IS NULL
      RETURNING student_id
    `);
    if (!updatedTarget.rows.length) {
      // Roll back the report state change too; never leave half a disposition.
      throw new Error("MONTHLY_WITHDRAWAL_DISPOSITION_CONFLICT");
    }
  }
}

/**
 * Cycle lock, reconciliation, ready_at, and optional durable notification
 * intent creation share one transaction. An empty target is never READY.
 */
export async function reconcileMonthlyCycle(
  db: MonthlyReadinessDb,
  params: { poolId: string; reportPeriod: string },
  onReady?: MonthlyReadyIntentWriter,
  options: { recordReady?: boolean } = {},
): Promise<MonthlyReportReadiness> {
  return db.transaction(tx =>
    reconcileWithinTransaction(tx, params, onReady, options.recordReady ?? true),
  );
}

/** Backwards-compatible public entrypoint; now returns sealed-target readiness. */
export const getMonthlyReportReadiness = reconcileMonthlyCycle;