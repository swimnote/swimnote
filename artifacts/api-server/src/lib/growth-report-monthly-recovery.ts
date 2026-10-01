import { sql } from "drizzle-orm";
import { getGrowthReportAnalysisIdentityHash } from "./growth-report-analysis-identity.js";
import {
  getMonthlyAutomationRunForCycle,
  isMonthlyAutomationSchemaReady,
} from "./growth-report-monthly-run.js";

export interface MonthlyRecoveryResult {
  action: "RECOVERED_UNFINISHED" | "NO_RECOVERABLE_TARGETS";
  pool_id: string;
  report_month: string;
  eligible_total: number;
  reactivated: number;
  skipped_success: number;
  skipped_policy_excluded: number;
  skipped_initial_excluded: number;
  skipped_pending_or_processing: number;
  blocked_unknown: number;
  blocked_identity: number;
  skipped_not_first_pass_failure: number;
  blocked_recovery_limit: number;
  missing: number;
  duplicate: number;
}

/**
 * The explicit operator boundary, shared by the authenticated route and tests.
 * A preparation batch's COMPLETED flag says nothing about its analysis jobs.
 * No ENGINE request is sent here and no request identity is replaced.
 */
export async function recoverMonthlyTargets(
  db: any,
  params: { poolId: string; reportPeriod: string; actorId: string; reason?: string },
): Promise<MonthlyRecoveryResult> {
  if (!params.poolId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(params.reportPeriod)) {
    throw new Error("INVALID_MONTHLY_RECOVERY_SCOPE");
  }
  if (typeof db.transaction !== "function") {
    throw new Error("MONTHLY_RECOVERY_REQUIRES_TRANSACTION");
  }
  if (!await isMonthlyAutomationSchemaReady(db)) {
    throw new Error("MONTHLY_AUTOMATION_SCHEMA_NOT_READY");
  }
  return db.transaction(async (tx: any) => {
    const cycles = await tx.execute(sql`
      SELECT id, eligible_total, eligibility_sealed_at
      FROM growth_report_cycles
      WHERE swimming_pool_id = ${params.poolId}
        AND report_period = ${params.reportPeriod}
      FOR UPDATE
    `);
    const cycle = cycles.rows[0];
    if (!cycle?.eligibility_sealed_at) throw new Error("MONTHLY_TARGETS_NOT_SEALED");
    const automationRun = await getMonthlyAutomationRunForCycle(tx, cycle.id);
    const recoveryReason = params.reason?.trim();
    if (automationRun && !recoveryReason) {
      throw new Error("MONTHLY_RECOVERY_REASON_REQUIRED");
    }
    const configuredLimit = Number(process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"] ?? 3);
    const defaultRecoveryLimit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : 3;

    const result: MonthlyRecoveryResult = {
      action: "NO_RECOVERABLE_TARGETS", pool_id: params.poolId,
      report_month: params.reportPeriod, eligible_total: Number(cycle.eligible_total),
      reactivated: 0, skipped_success: 0, skipped_policy_excluded: 0,
      skipped_initial_excluded: 0, skipped_pending_or_processing: 0,
      blocked_unknown: 0, blocked_identity: 0,
      skipped_not_first_pass_failure: 0, blocked_recovery_limit: 0,
      missing: 0, duplicate: 0,
    };
    const targets = await tx.execute(sql`
      SELECT target.student_id, target.policy_excluded_at,
        target.first_pass_outcome, report.monthly_final_disposition,
        target.recovery_epoch, target.recovery_attempt_limit,
        target.recovery_approved_at,
        report.id, report.product_status, report.analysis_request_id,
        report.analysis_request_payload, report.analysis_identity_hash,
        report.snapshot_hash, report.analysis_uncertain_at
      FROM growth_report_eligible_targets target
      LEFT JOIN growth_reports report
        ON report.cycle_id = target.cycle_id
        AND report.student_id = target.student_id
        AND report.swimming_pool_id = ${params.poolId}
        AND report.report_period = ${params.reportPeriod}
        AND report.deleted_at IS NULL
        AND report.product_status <> 'DISCARDED'
      WHERE target.cycle_id = ${cycle.id}
      ORDER BY target.student_id, report.id
    `);
    const groups = new Map<string, any[]>();
    for (const row of targets.rows) {
      const group = groups.get(row.student_id) ?? [];
      group.push(row);
      groups.set(row.student_id, group);
    }
    if (groups.size !== result.eligible_total) {
      throw new Error("MONTHLY_TARGET_COUNT_INCONSISTENT");
    }
    for (const rows of groups.values()) {
      if (rows.length !== 1) { result.duplicate++; continue; }
      const row = rows[0];
      if (row.policy_excluded_at) { result.skipped_policy_excluded++; continue; }
      // Missing historical work must be restored, not recreated with a fresh
      // request ID: remote execution may already have happened.
      if (!row.id) { result.missing++; continue; }
      if (automationRun && row.first_pass_outcome !== "failed") {
        result.skipped_not_first_pass_failure++;
        continue;
      }
      const recoveryEpoch = Number(row.recovery_epoch ?? 0);
      const recoveryLimit = Number(row.recovery_attempt_limit ?? defaultRecoveryLimit);
      if (recoveryEpoch >= recoveryLimit) {
        result.blocked_recovery_limit++;
        continue;
      }
      if (["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"].includes(row.product_status)) {
        result.skipped_success++; continue;
      }
      if (row.product_status === "EXCLUDED") { result.skipped_initial_excluded++; continue; }
      if (
        automationRun &&
        row.monthly_final_disposition &&
        row.monthly_final_disposition !== "FAILED"
      ) {
        result.skipped_not_first_pass_failure++;
        continue;
      }
      if (row.analysis_uncertain_at) { result.blocked_unknown++; continue; }
      if (row.product_status !== "FAILED") {
        result.skipped_pending_or_processing++; continue;
      }

      const request = row.analysis_request_payload;
      const identityValid = request && typeof request === "object" &&
        request.request_id === row.analysis_request_id && request.report_id === row.id &&
        request.context?.student_id === row.student_id &&
        request.context?.pool_id === params.poolId &&
        request.context?.report_period === params.reportPeriod &&
        request.snapshot?.payload_hash === row.snapshot_hash;
      if (!identityValid) { result.blocked_identity++; continue; }
      const stage = (["PREANALYSIS", "FINAL_ANALYSIS"] as const).find(
        value => getGrowthReportAnalysisIdentityHash(request, value) === row.analysis_identity_hash,
      );
      if (!stage) { result.blocked_identity++; continue; }
      const status = stage === "PREANALYSIS" ? "OPEN" : "READY_FOR_ANALYSIS";
      const updated = await tx.execute(sql`
        UPDATE growth_reports
        SET product_status = ${status}::gr_product_status_enum,
          analysis_retry_count = 0, analysis_next_attempt_at = NOW(),
          analysis_claim_token = NULL, analysis_lease_until = NULL,
          updated_at = NOW()
        WHERE id = ${row.id} AND cycle_id = ${cycle.id}
          AND swimming_pool_id = ${params.poolId}
          AND product_status = 'FAILED'
          AND analysis_uncertain_at IS NULL
          AND analysis_request_id = ${row.analysis_request_id}
          AND (analysis_lease_until IS NULL OR analysis_lease_until <= NOW())
          AND deleted_at IS NULL
        RETURNING id
      `);
      if (updated.rows.length > 0) {
        const approval = await tx.execute(sql`
          UPDATE growth_report_eligible_targets
          SET recovery_epoch = ${recoveryEpoch + 1},
              recovery_approved_at = NOW(),
              recovery_approved_by = ${params.actorId},
              recovery_approval_reason = ${recoveryReason || "LEGACY_OPERATOR_RECOVERY"},
              recovery_attempt_limit = COALESCE(
                recovery_attempt_limit,
                ${defaultRecoveryLimit}
              )
          WHERE cycle_id = ${cycle.id}
            AND student_id = ${row.student_id}
            AND recovery_epoch = ${recoveryEpoch}
            AND (
              ${!automationRun}
              OR first_pass_outcome = 'failed'
            )
            AND (recovery_attempt_limit IS NULL OR recovery_epoch < recovery_attempt_limit)
          RETURNING student_id
        `);
        if (!approval.rows.length) throw new Error("MONTHLY_RECOVERY_FENCE_LOST");
      }
      result.reactivated += updated.rows.length;
    }
    if (result.reactivated > 0) {
      result.action = "RECOVERED_UNFINISHED";
      const version = await tx.execute(sql`
        SELECT next_audit_version('growth_report_cycle', ${cycle.id}) AS v
      `);
      await tx.execute(sql`
        INSERT INTO audit_logs
          (entity_type, entity_id, entity_version, action, actor_type, actor_id,
           pool_id, before_data, after_data, reason, request_id, correlation_id, ip_hash)
        VALUES ('growth_report_cycle', ${cycle.id}, ${version.rows[0]?.v ?? 1},
          'update', 'super_admin', ${params.actorId}, ${params.poolId}, NULL,
          ${JSON.stringify(result)}::jsonb, 'MONTHLY_UNFINISHED_RECOVERY',
          NULL, NULL, NULL)
      `);
    }
    return result;
  });
}