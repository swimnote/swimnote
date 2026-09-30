/**
 * Monthly FREE growth reports only. This job runs after the 5th-day preparation
 * window and publishes successfully persisted analyses, not prepared OPEN rows.
 * The UPDATE is the final active/enrollment check and the publication claim in
 * one statement; a repeated worker run cannot publish the same row twice.
 */
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { notifyGrowthReportPublished } from "../utils/notify.js";

type Db = typeof superAdminDb;
type PublishedRow = {
  id: string;
  student_id: string;
  swimming_pool_id: string;
  report_period: string;
};

export const SEPTEMBER_2026_FREE_REPORT_PERIOD =
  "2026년 10월 5일 발급되는 무료 AI 성장리포트는 2026년 9월 1일 00:00 KST 이상, 2026년 10월 1일 00:00 KST 미만의 9월 수업 데이터를 대상으로 한다.";

/** The issue month is the KST month of the fifth; the analysis month is M-1. */
export function freeReportIssueWindow(now: Date): {
  issueYear: number;
  issueMonth: number;
  issueDay: number;
  issueHour: number;
  reportPeriod: string;
  analysisStart: string;
  issueMonthStart: string;
} {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const issueYear = kst.getUTCFullYear();
  const issueMonth = kst.getUTCMonth() + 1;
  const previous = new Date(Date.UTC(issueYear, issueMonth - 2, 1));
  const reportPeriod = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    issueYear,
    issueMonth,
    issueDay: kst.getUTCDate(),
    issueHour: kst.getUTCHours(),
    reportPeriod,
    analysisStart: `${reportPeriod}-01`,
    issueMonthStart: `${issueYear}-${String(issueMonth).padStart(2, "0")}-01`,
  };
}

export async function runMonthlyFreeAutoPublication(
  db: Db = superAdminDb,
  now: Date = new Date(),
  notify: typeof notifyGrowthReportPublished = notifyGrowthReportPublished,
): Promise<{ published: number; notificationCandidates: number }> {
  // The monthly preparation job starts at 02:00 KST on the fifth. Continue
  // every five minutes thereafter so late successful analyses can be issued.
  const window = freeReportIssueWindow(now);
  if (window.issueDay < 5 || (window.issueDay === 5 && window.issueHour < 2)) {
    return { published: 0, notificationCandidates: 0 };
  }

  // No ENGINE calls here. Only FINAL, validated/persisted, monthly reports are
  // eligible. A report still OPEN, PROCESSING, FAILED or EXCLUDED cannot pass.
  // Active state is checked at the instant of the atomic UPDATE (not only on
  // the first of the month). The same class-history interval must overlap the
  // analysis month AND remain valid on the next month's first day.
  const updated = await db.execute(sql`
    UPDATE growth_reports AS gr
    SET product_status = 'PUBLISHED'::gr_product_status_enum,
        published_at = COALESCE(gr.published_at, NOW()),
        updated_at = NOW()
    FROM growth_report_cycles AS cycle, students AS student, swimming_pools AS pool
    WHERE gr.cycle_id = cycle.id
      AND gr.student_id = student.id
      AND gr.swimming_pool_id = pool.id
      AND cycle.swimming_pool_id = pool.id
      AND cycle.report_period = ${window.reportPeriod}
      AND gr.report_period = ${window.reportPeriod}
      AND gr.report_type = 'monthly'
      AND gr.deleted_at IS NULL
      AND gr.product_status IN ('REVIEW_REQUIRED', 'READY_TO_SEND', 'APPROVED')
      AND gr.analysis_status IN (
        'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE', 'COMPLETE_WITH_PARENT_EVIDENCE'
      )
      AND gr.eligibility_version >= 4
      AND gr.exclusion_code IS NULL
      AND gr.attendance_count >= 3
      AND gr.source_event_count >= 1
      AND jsonb_typeof(gr.report_content) = 'object'
      AND gr.report_content <> '{}'::jsonb
      AND jsonb_typeof(gr.report_fact_package) = 'object'
      AND jsonb_typeof(gr.sns_summary) = 'object'
      AND gr.report_fact_package->>'grounding_result' IN ('PASS', 'REVISED_PASS')
      AND gr.report_fact_package->>'growth_framing_result' IN ('PASS', 'REVISED_PASS')
      AND student.status = 'active'
      AND student.deleted_at IS NULL
      AND student.swimming_pool_id = pool.id
      AND (COALESCE(pool.x_paid_entitlement, false) OR COALESCE(pool.x_manual_entitlement, false))
      AND NOT COALESCE(pool.x_force_disabled, false)
      AND pool.approval_status = 'approved'
      AND EXISTS (
        SELECT 1 FROM student_class_history AS history
        JOIN class_groups AS class_group ON class_group.id = history.class_group_id
        WHERE history.student_id = student.id
          AND class_group.swimming_pool_id = pool.id
          AND history.enrolled_at < ${window.issueMonthStart}::date
          AND (history.left_at IS NULL OR history.left_at >= ${window.issueMonthStart}::date)
      )
    RETURNING gr.id, gr.student_id, gr.swimming_pool_id, gr.report_period
  `);

  // Recover from a crash after publication but before sending notifications.
  // The notification table has a UNIQUE (type, ref_id, recipient_id) claim;
  // notifyGrowthReportPublished sends only for a newly inserted claim.
  const pending = await db.execute(sql`
    SELECT gr.id, gr.student_id, gr.swimming_pool_id, gr.report_period
    FROM growth_reports AS gr
    JOIN growth_report_cycles AS cycle ON cycle.id = gr.cycle_id
    WHERE cycle.report_period = ${window.reportPeriod}
      AND gr.report_period = ${window.reportPeriod}
      AND gr.report_type = 'monthly'
      AND gr.product_status = 'PUBLISHED'
      AND gr.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM parent_students AS link
        WHERE link.student_id = gr.student_id AND link.status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM notifications AS notification
            WHERE notification.type = 'GROWTH_REPORT_PUBLISHED'
              AND notification.ref_id = gr.id
              AND notification.recipient_id = link.parent_id
          )
      )
  `);
  for (const row of pending.rows as PublishedRow[]) {
    try {
      await notify({
        reportId: row.id,
        studentId: row.student_id,
        poolId: row.swimming_pool_id,
        reportPeriod: row.report_period,
      });
    } catch (error) {
      // Publication is terminal; a notification failure must not roll it back.
      console.error("[gr-auto-publish] parent notification failed:", error);
    }
  }
  return { published: updated.rows.length, notificationCandidates: pending.rows.length };
}