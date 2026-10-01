import { sql } from "drizzle-orm";
import {
  isMonthlyAutomationSchemaReady,
  getMonthlyAutomationRunForCycle,
  recordMonthlyFirstPassOutcome,
} from "./growth-report-monthly-run.js";
import { transitionReportStatus } from "./growth-report-service.js";

export const INSUFFICIENT_EVIDENCE_NOTICE =
  "이번 달은 성장 판단에 필요한 충분한 변화 근거가 아직 축적되지 않았습니다.";
export const INSUFFICIENT_EVIDENCE_DISPOSITION = "INSUFFICIENT_EVIDENCE";
export const INSUFFICIENT_EVIDENCE_VERSION = 1;

export function buildInsufficientEvidenceNotice(studentName: string) {
  return {
    student_name: studentName,
    composition_version: "APP_MONTHLY_NOTICE_V1",
    summary_text: INSUFFICIENT_EVIDENCE_NOTICE,
    sections: {},
  };
}

type Db = {
  execute(query: unknown): Promise<{ rows: any[] }>;
};

async function isMonthlyDispositionSchemaReady(db: Db): Promise<boolean> {
  if (!await isMonthlyAutomationSchemaReady(db)) return false;
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE table_name = 'growth_reports'
          AND column_name IN ('monthly_final_disposition', 'monthly_disposition_version')
      ) = 2
      AND COUNT(*) FILTER (
        WHERE table_name = 'growth_report_eligible_targets'
          AND column_name = 'first_pass_outcome'
      ) = 1 AS schema_ready
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'growth_reports'
          AND column_name IN ('monthly_final_disposition', 'monthly_disposition_version'))
        OR (table_name = 'growth_report_eligible_targets'
          AND column_name = 'first_pass_outcome')
      )
  `);
  const ready = result.rows[0]?.schema_ready;
  return ready === true || ready === "t";
}

/** True only for reports in the active run's sealed, fixed pool manifest. */
export async function isMonthlyDispositionRun(
  db: Db,
  reportId: string,
  requestId: string,
  payloadHash: string,
): Promise<boolean> {
  if (!await isMonthlyDispositionSchemaReady(db)) return false;
  const result = await db.execute(sql`
    SELECT report.cycle_id
    FROM growth_reports report
    JOIN growth_report_cycles cycle
      ON cycle.id = report.cycle_id
     AND cycle.swimming_pool_id = report.swimming_pool_id
     AND cycle.report_period = report.report_period
     AND cycle.eligibility_sealed_at IS NOT NULL
     AND cycle.eligible_total IS NOT NULL
    JOIN growth_report_eligible_targets target
      ON target.cycle_id = cycle.id
     AND target.student_id = report.student_id
     AND target.first_pass_completed_at IS NULL
     AND target.first_pass_outcome IS NULL
     AND target.policy_excluded_at IS NULL
    WHERE report.id = ${reportId}
      AND report.deleted_at IS NULL
      AND (report.report_type = 'monthly' OR report.report_type IS NULL)
      AND report.analysis_request_id = ${requestId}
      AND report.snapshot_hash = ${payloadHash}
      AND report.monthly_final_disposition IS NULL
      AND report.report_content IS NULL
      AND report.report_fact_package IS NULL
      AND report.sns_summary IS NULL
      AND (
        report.analysis_status IS NULL
        OR report.analysis_status NOT IN (
          'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE', 'COMPLETE_WITH_PARENT_EVIDENCE'
        )
      )
      AND report.analysis_response_payload->>'analysis_status' = 'DATA_ACCUMULATING'
      AND report.analysis_response_payload->>'request_id' = ${requestId}
      AND report.analysis_response_payload->>'report_id' = report.id
      AND report.analysis_response_payload->'trace'->>'payload_hash' = ${payloadHash}
    LIMIT 1
  `);
  const cycleId = result.rows[0]?.cycle_id;
  if (typeof cycleId !== "string" || !cycleId) return false;
  const run = await getMonthlyAutomationRunForCycle(db, cycleId);
  return run !== null && run.is_manifested_pool === true &&
    run.first_pass_completed_at == null;
}

/**
 * Convert a registered run's sealed monthly DATA_ACCUMULATING result into a
 * truthful APP notice. The ENGINE request/response/hash and analysis status
 * remain intact; only its APP presentation and disposition metadata change.
 */
export async function prepareMonthlyInsufficientEvidence(
  db: Db,
  params: {
    reportId: string;
    requestId: string;
    payloadHash: string;
    claimToken: string;
  },
): Promise<boolean> {
  if (!await isMonthlyDispositionSchemaReady(db)) return false;
  const reportResult = await db.execute(sql`
    SELECT
      report.id,
      report.student_id,
      report.swimming_pool_id,
      report.cycle_id,
      report.report_period,
      report.report_type,
      report.product_status,
      report.analysis_status,
      report.analysis_request_id,
      report.snapshot_hash,
      report.analysis_response_payload,
      report.analysis_uncertain_at,
      report.exclusion_code,
      report.analysis_claim_token,
      report.analysis_lease_until,
      student.name AS student_name
    FROM growth_reports report
    JOIN growth_report_cycles cycle
      ON cycle.id = report.cycle_id
     AND cycle.swimming_pool_id = report.swimming_pool_id
     AND cycle.report_period = report.report_period
     AND cycle.eligibility_sealed_at IS NOT NULL
     AND cycle.eligible_total IS NOT NULL
    JOIN growth_report_eligible_targets target
      ON target.cycle_id = cycle.id
     AND target.student_id = report.student_id
     AND target.first_pass_completed_at IS NULL
     AND target.first_pass_outcome IS NULL
     AND target.policy_excluded_at IS NULL
    JOIN students student
      ON student.id = report.student_id
     AND student.swimming_pool_id = cycle.swimming_pool_id
     AND LOWER(student.status::text) = 'active'
     AND student.deleted_at IS NULL
    WHERE report.id = ${params.reportId}
      AND report.deleted_at IS NULL
      AND (report.report_type = 'monthly' OR report.report_type IS NULL)
      AND report.analysis_request_id = ${params.requestId}
      AND report.snapshot_hash = ${params.payloadHash}
      AND report.analysis_uncertain_at IS NULL
      AND report.exclusion_code IS NULL
      AND report.monthly_final_disposition IS NULL
      AND report.report_content IS NULL
      AND report.report_fact_package IS NULL
      AND report.sns_summary IS NULL
      AND (
        report.analysis_status IS NULL
        OR report.analysis_status NOT IN (
          'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE', 'COMPLETE_WITH_PARENT_EVIDENCE'
        )
      )
      AND report.analysis_claim_token = ${params.claimToken}
      AND report.analysis_lease_until > NOW()
    FOR UPDATE OF report, target
  `);
  const report = reportResult.rows[0];
  if (!report || !String(report.student_name ?? "").trim()) return false;

  const run = await getMonthlyAutomationRunForCycle(db, String(report.cycle_id));
  if (!run || run.is_manifested_pool !== true || run.report_period !== report.report_period ||
    run.first_pass_completed_at != null) return false;

  const storedResponse = typeof report.analysis_response_payload === "string"
    ? JSON.parse(report.analysis_response_payload)
    : report.analysis_response_payload;
  if (
    !storedResponse ||
    storedResponse.analysis_status !== "DATA_ACCUMULATING" ||
    storedResponse.request_id !== params.requestId ||
    storedResponse.report_id !== params.reportId ||
    storedResponse.trace?.payload_hash !== params.payloadHash ||
    !["PREANALYZING", "ANALYZING"].includes(String(report.product_status))
  ) return false;

  const content = buildInsufficientEvidenceNotice(String(report.student_name));
  const update = await db.execute(sql`
    UPDATE growth_reports
    SET analysis_status = 'DATA_ACCUMULATING'::gr_analysis_status_enum,
        report_content = ${JSON.stringify(content)}::jsonb,
        report_fact_package = NULL,
        sns_summary = NULL,
        monthly_final_disposition = ${INSUFFICIENT_EVIDENCE_DISPOSITION},
        monthly_disposition_version = ${INSUFFICIENT_EVIDENCE_VERSION},
        updated_at = NOW()
    WHERE id = ${params.reportId}
      AND cycle_id = ${report.cycle_id}
      AND analysis_request_id = ${params.requestId}
      AND snapshot_hash = ${params.payloadHash}
      AND analysis_status IS DISTINCT FROM 'FAILED'::gr_analysis_status_enum
      AND analysis_claim_token = ${params.claimToken}
      AND analysis_lease_until > NOW()
      AND product_status = ${report.product_status}::gr_product_status_enum
      AND deleted_at IS NULL
    RETURNING id
  `);
  if (!update.rows.length) return false;

  await transitionReportStatus({
    db,
    reportId: params.reportId,
    toStatus: "PARTIAL",
    actorType: "system",
    actorId: null,
    reason: "ENGINE_DATA_ACCUMULATING",
  });
  await transitionReportStatus({
    db,
    reportId: params.reportId,
    toStatus: "REVIEW_REQUIRED",
    actorType: "system",
    actorId: null,
    reason: "APP_MONTHLY_INSUFFICIENT_EVIDENCE",
  });
  await db.execute(sql`
    UPDATE growth_reports
    SET analysis_claim_token = NULL,
        analysis_lease_until = NULL,
        analysis_next_attempt_at = NULL,
        updated_at = NOW()
    WHERE id = ${params.reportId}
      AND analysis_request_id = ${params.requestId}
      AND product_status = 'REVIEW_REQUIRED'::gr_product_status_enum
      AND deleted_at IS NULL
  `);

  const recorded = await recordMonthlyFirstPassOutcome(db, {
    cycleId: String(report.cycle_id),
    studentId: String(report.student_id),
    outcome: "insufficient_evidence",
  });
  if (recorded !== "recorded" && recorded !== "already_recorded") {
    throw new Error(`MONTHLY_INSUFFICIENT_EVIDENCE_OUTCOME_${recorded.toUpperCase()}`);
  }
  return true;
}