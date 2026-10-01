/**
 * Compatibility entrypoint for the former monthly publisher.
 *
 * It now only opens the admin review stage and sends the per-period admin
 * readiness notification. Parent publication and parent notifications are
 * intentionally absent; those remain behind explicit admin send routes.
 */
import { sql } from "drizzle-orm";
import { getMonthlyReportReadiness } from "./growth-report-monthly-readiness.js";
type Db = { execute(query: unknown): Promise<{ rows: unknown[] }> };

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

export type MonthlyReviewNotification = (params: {
  poolId: string;
  reportPeriod: string;
  message: string;
  readiness: Record<string, number>;
}) => Promise<void>;

async function defaultNotifyAdminReady(params: Parameters<MonthlyReviewNotification>[0]): Promise<void> {
  const { notifyMonthlyGrowthReportPrepared } = await import("../utils/notify.js");
  await notifyMonthlyGrowthReportPrepared(params);
}

export async function runMonthlyFreeAutoPublication(
  db: Db,
  now: Date = new Date(),
  notifyAdminReady: MonthlyReviewNotification = defaultNotifyAdminReady,
): Promise<{
  published: 0;
  notificationCandidates: number;
  adminReviewReady: number;
  reportPeriod: string;
}> {
  const window = freeReportIssueWindow(now);
  if (window.issueDay < 5 || (window.issueDay === 5 && window.issueHour < 2)) {
    return {
      published: 0,
      notificationCandidates: 0,
      adminReviewReady: 0,
      reportPeriod: window.reportPeriod,
    };
  }

  const cyclePools = await db.execute(sql`
    SELECT DISTINCT cycle.swimming_pool_id AS pool_id
    FROM growth_report_cycles cycle
    JOIN swimming_pools pool ON pool.id = cycle.swimming_pool_id
    WHERE cycle.report_period = ${window.reportPeriod}
      AND (
        COALESCE(pool.x_paid_entitlement, false)
        OR COALESCE(pool.x_manual_entitlement, false)
      )
      AND NOT COALESCE(pool.x_force_disabled, false)
      AND pool.approval_status = 'approved'
  `);

  let notificationCandidates = 0;
  let adminReviewReady = 0;
  for (const row of cyclePools.rows as Array<{ pool_id: string }>) {
    const readiness = await getMonthlyReportReadiness(db, {
      poolId: row.pool_id,
      reportPeriod: window.reportPeriod,
    });
    const message =
      `${window.reportPeriod} AI 성장리포트 발송 준비가 완료되었습니다. ` +
      `검토 가능 ${readiness.analysis_ready}건, 제외 ${readiness.excluded}건, ` +
      `데이터 부족 ${readiness.data_accumulating}건, 분석 대기 ${readiness.pending_analysis}건, ` +
      `재시도/처리 중 ${readiness.retrying}건, ` +
      `실패 ${readiness.terminal_failed}건, 발송 완료 ${readiness.published}건입니다. 리포트를 확인해 주세요.`;
    await notifyAdminReady({
      poolId: row.pool_id,
      reportPeriod: window.reportPeriod,
      message,
      readiness,
    });
    notificationCandidates++;
    adminReviewReady += readiness.analysis_ready;
  }

  // Explicitly no UPDATE to growth_reports and no parent notification call.
  return {
    published: 0,
    notificationCandidates,
    adminReviewReady,
    reportPeriod: window.reportPeriod,
  };
}