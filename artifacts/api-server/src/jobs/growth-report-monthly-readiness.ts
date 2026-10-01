import { sql } from "drizzle-orm";

export type MonthlyReportReadiness = {
  analysis_ready: number;
  excluded: number;
  data_accumulating: number;
  retrying: number;
  pending_analysis: number;
  terminal_failed: number;
  published: number;
  other: number;
  total: number;
};

export type ReadinessReportRow = {
  product_status?: string | null;
  analysis_status?: string | null;
  exclusion_code?: string | null;
  analysis_retry_count?: number | string | null;
  readiness_eligible?: boolean | string | null;
};

export function monthlyReadinessStatus(row: ReadinessReportRow): string {
  const product = String(row.product_status ?? "").toUpperCase();
  const analysis = String(row.analysis_status ?? "").toUpperCase();
  const attempts = Number(row.analysis_retry_count ?? 0);
  const ready = row.readiness_eligible === true || row.readiness_eligible === "t";
  if (product === "PUBLISHED") return "PUBLISHED";
  if (product === "EXCLUDED" || row.exclusion_code) return "EXCLUDED";
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
): MonthlyReportReadiness {
  const result: MonthlyReportReadiness = {
    analysis_ready: 0,
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
      default: result.other++; break;
    }
  }

  return result;
}

/**
 * Read the actual latest monthly report rows. Batch-job status is deliberately
 * not used as a proxy for whether an administrator has reviewable reports.
 */
export async function getMonthlyReportReadiness(
  db: { execute(query: unknown): Promise<{ rows: unknown[] }> },
  params: { poolId: string; reportPeriod: string },
): Promise<MonthlyReportReadiness> {
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (gr.student_id, gr.cycle_id)
        gr.id, gr.student_id, gr.cycle_id, gr.product_status,
        gr.analysis_status, gr.exclusion_code, gr.eligibility_version,
        gr.analysis_retry_count,
        gr.attendance_count, gr.source_event_count, gr.report_content,
        gr.report_fact_package, gr.sns_summary, gr.swimming_pool_id
      FROM growth_reports gr
      WHERE gr.swimming_pool_id = ${params.poolId}
        AND gr.report_period = ${params.reportPeriod}
        AND gr.cycle_id IS NOT NULL
        AND gr.deleted_at IS NULL
      ORDER BY gr.student_id, gr.cycle_id,
        gr.version_number DESC NULLS LAST, gr.created_at DESC
    )
    SELECT latest.product_status, latest.analysis_status, latest.exclusion_code,
      latest.analysis_retry_count,
      (
        latest.product_status IN ('REVIEW_REQUIRED', 'READY_TO_SEND', 'APPROVED')
        AND latest.analysis_status IN (
          'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE', 'COMPLETE_WITH_PARENT_EVIDENCE'
        )
        AND latest.eligibility_version >= 4
        AND latest.exclusion_code IS NULL
        AND latest.attendance_count >= 3
        AND latest.source_event_count >= 1
        AND jsonb_typeof(latest.report_content) = 'object'
        AND latest.report_content <> '{}'::jsonb
        AND jsonb_typeof(latest.report_fact_package) = 'object'
        AND jsonb_typeof(latest.sns_summary) = 'object'
        AND latest.report_fact_package->>'grounding_result' IN ('PASS', 'REVISED_PASS')
        AND latest.report_fact_package->>'growth_framing_result' IN ('PASS', 'REVISED_PASS')
        AND student.status = 'active'
        AND student.deleted_at IS NULL
        AND student.swimming_pool_id = latest.swimming_pool_id
        AND EXISTS (
          SELECT 1
          FROM student_class_history history
          JOIN class_groups class_group ON class_group.id = history.class_group_id
          JOIN growth_report_cycles cycle ON cycle.id = latest.cycle_id
          WHERE history.student_id = latest.student_id
            AND class_group.swimming_pool_id = latest.swimming_pool_id
            AND history.enrolled_at < (to_date(cycle.report_period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month')
            AND (history.left_at IS NULL OR history.left_at >= (to_date(cycle.report_period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month'))
        )
      ) AS readiness_eligible
    FROM latest
    JOIN students student ON student.id = latest.student_id
  `);
  return classifyMonthlyReadiness(rows.rows as ReadinessReportRow[]);
}