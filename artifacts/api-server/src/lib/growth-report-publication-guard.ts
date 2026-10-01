import { sql, type SQL } from "drizzle-orm";

/**
 * The final, shared database predicate for monthly parent publication.
 *
 * Keep this fragment in the UPDATE statement that claims publication, rather
 * than relying on an earlier read: eligibility and class membership may change
 * between review and send. The alias is a SQL identifier supplied by our own
 * call sites (not user input).
 */
export function monthlyPublicationGuard(alias = "gr"): SQL {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid monthly publication guard alias: ${alias}`);
  }

  const report = sql.raw(alias);
  return sql`
    ${report}.cycle_id IS NOT NULL
    AND ${report}.product_status IN ('REVIEW_REQUIRED', 'READY_TO_SEND', 'APPROVED')
    AND ${report}.published_at IS NULL
    AND ${report}.report_type = 'monthly'
    AND NOW() >= (
      ((${report}.report_period || '-01')::date
        + INTERVAL '1 month' + INTERVAL '4 days')::date::timestamp
        AT TIME ZONE 'Asia/Seoul'
    )
    AND ${report}.analysis_status IN (
      'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE', 'COMPLETE_WITH_PARENT_EVIDENCE'
    )
    AND ${report}.eligibility_version >= 4
    AND ${report}.exclusion_code IS NULL
    AND ${report}.attendance_count >= 3
    AND ${report}.source_event_count >= 1
    AND jsonb_typeof(${report}.report_content) = 'object'
    AND ${report}.report_content <> '{}'::jsonb
    AND COALESCE(
      NULLIF(BTRIM(${report}.report_content->>'summary_text'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,core_growth,text}'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,swimming_progress,text}'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,behavioral_strengths,text}'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,longitudinal_comparison,text}'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,success_conditions,text}'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,parent_support,text}'), ''),
      NULLIF(BTRIM(${report}.report_content #>> '{sections,next_growth_direction,text}'), '')
    ) IS NOT NULL
    AND jsonb_typeof(${report}.report_fact_package) = 'object'
    AND ${report}.report_fact_package <> '{}'::jsonb
    AND ${report}.report_fact_package->>'grounding_result' IN ('PASS', 'REVISED_PASS')
    AND ${report}.report_fact_package->>'growth_framing_result' IN ('PASS', 'REVISED_PASS')
    AND jsonb_typeof(${report}.sns_summary) = 'object'
    AND ${report}.sns_summary <> '{}'::jsonb
    AND EXISTS (
      SELECT 1
      FROM growth_report_cycles AS publication_cycle
      JOIN swimming_pools AS publication_pool
        ON publication_pool.id = ${report}.swimming_pool_id
      JOIN students AS publication_student
        ON publication_student.id = ${report}.student_id
      WHERE publication_cycle.id = ${report}.cycle_id
        AND publication_cycle.swimming_pool_id = ${report}.swimming_pool_id
        AND publication_cycle.report_period = ${report}.report_period
        AND publication_student.swimming_pool_id = publication_pool.id
        AND publication_student.status = 'active'
        AND publication_student.deleted_at IS NULL
        AND (
          COALESCE(publication_pool.x_paid_entitlement, false)
          OR COALESCE(publication_pool.x_manual_entitlement, false)
        )
        AND NOT COALESCE(publication_pool.x_force_disabled, false)
        AND publication_pool.approval_status = 'approved'
        AND publication_pool.deactivated_at IS NULL
        AND publication_pool.deletion_scheduled_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM student_class_history AS publication_history
          JOIN class_groups AS publication_class
            ON publication_class.id = publication_history.class_group_id
          WHERE publication_history.student_id = publication_student.id
            AND publication_history.swimming_pool_id = publication_pool.id
            AND publication_class.swimming_pool_id = publication_pool.id
            AND publication_class.is_deleted = false
            AND publication_history.enrolled_at
              < (publication_cycle.report_period || '-01')::date + INTERVAL '1 month'
            AND (
              publication_history.left_at IS NULL
              OR publication_history.left_at >= (publication_cycle.report_period || '-01')::date
            )
            AND (
              publication_history.left_at IS NULL
              OR publication_history.left_at
                >= (publication_cycle.report_period || '-01')::date + INTERVAL '1 month'
            )
        )
    )
  `;
}