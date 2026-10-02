/**
 * Compatibility entrypoint for the former monthly publisher.
 *
 * It now only opens the admin review stage and sends the per-period admin
 * readiness notification. Parent publication and parent notifications are
 * intentionally absent; those remain behind explicit admin send routes.
 */
import { sql } from "drizzle-orm";
import {
  reconcileMonthlyCycle,
  type MonthlyReadinessDb,
  type MonthlyReportReadiness,
} from "./growth-report-monthly-readiness.js";
import { finishMonthlyFirstPass } from "../lib/growth-report-monthly-run.js";
import { fireMonthlyGrowthReportIncident } from "../lib/incident-alerts.js";
import { insertGrowthReportAdminReadyIntents } from "../utils/growth-report-notification-outbox.js";
type Db = MonthlyReadinessDb;

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
  readiness: Record<string, number | boolean>;
}) => Promise<void>;

async function defaultNotifyAdminReady(params: Parameters<MonthlyReviewNotification>[0]): Promise<void> {
  const { notifyMonthlyGrowthReportPrepared } = await import("../utils/notify.js");
  // The legacy notification wrapper accepts numeric summaries only. Boolean
  // gate flags remain available to the outbox callers that support them.
  const numericReadiness = Object.fromEntries(
    Object.entries(params.readiness).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number",
    ),
  );
  await notifyMonthlyGrowthReportPrepared({ ...params, readiness: numericReadiness });
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
  const afterIssueWindow = window.issueDay > 5 ||
    (window.issueDay === 5 && window.issueHour >= 2);

  const cyclePools = await db.execute(sql`
    SELECT cycle.swimming_pool_id AS pool_id, cycle.report_period
         , cycle.id AS cycle_id
    FROM growth_report_cycles cycle
    JOIN swimming_pools pool ON pool.id = cycle.swimming_pool_id
    WHERE cycle.eligibility_sealed_at IS NOT NULL
      AND COALESCE(cycle.eligible_total, 0) > 0
      AND (
        (
          cycle.report_period = ${window.reportPeriod}
          AND (
            COALESCE(pool.x_paid_entitlement, false)
            OR COALESCE(pool.x_manual_entitlement, false)
          )
          AND NOT COALESCE(pool.x_force_disabled, false)
          AND pool.approval_status = 'approved'
        )
        OR (
          cycle.report_period < ${window.reportPeriod}
          AND cycle.ready_at IS NULL
        )
      )
    ORDER BY cycle.report_period, cycle.swimming_pool_id
  `);

  let notificationCandidates = 0;
  let adminReviewReady = 0;
  for (const row of cyclePools.rows as Array<{
    pool_id: string;
    report_period?: string;
    cycle_id: string;
  }>) {
    const reportPeriod = row.report_period ?? window.reportPeriod;
    try {
      const notificationMessage = (_readiness: MonthlyReportReadiness) =>
        "이번 달 AI 성장리포트 발급이 완료되었습니다.\nSWIMNOTE에서 검수 후 학부모에게 발송해 주세요.";

      const readiness = await reconcileMonthlyCycle(
        db,
        { poolId: row.pool_id, reportPeriod },
        async (tx, readyReadiness) => {
          await insertGrowthReportAdminReadyIntents(tx, {
            poolId: row.pool_id,
            reportPeriod,
            message: notificationMessage(readyReadiness),
            readiness: readyReadiness,
          });
        },
        { recordReady: afterIssueWindow },
      );

      if (readiness.empty_target || !readiness.snapshot_sealed) continue;
      if (!readiness.ready) {
        const incidentType = readiness.failed > 0
          ? "FAILED"
          : readiness.unknown > 0
            ? "UNKNOWN"
            : readiness.missing > 0 || readiness.duplicate > 0 || readiness.wrong_pool > 0
              ? "RECONCILIATION"
              : afterIssueWindow
                ? "NOT_READY"
                : undefined;
        if (incidentType) {
          await fireMonthlyGrowthReportIncident({
            poolId: row.pool_id,
            reportPeriod,
            incidentType,
            readiness,
          });
        }
        continue;
      }

      if (!afterIssueWindow) continue;
      await notifyAdminReady({
        poolId: row.pool_id,
        reportPeriod,
        message: notificationMessage(readiness),
        readiness,
      });
      notificationCandidates++;
      adminReviewReady += readiness.generated_total;
    } catch (error) {
      // Each pool/month is isolated: a transient failure here cannot block
      // readiness evaluation or notification for another sealed cycle.
      console.error(
        `[growth-report-monthly] reconciliation failed for pool=${row.pool_id} month=${reportPeriod}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const firstPassSummary = await finishMonthlyFirstPass(db, window.reportPeriod);
    if (firstPassSummary) {
      const { notifyMonthlySuperAdminEvent } = await import("../utils/notify.js");
      await notifyMonthlySuperAdminEvent({
        reportPeriod: window.reportPeriod,
        eventType: "FIRST_PASS_FINISHED",
        summary: firstPassSummary,
      });
    }
  } catch (error) {
    console.error(
      `[growth-report-monthly] first-pass summary failed for month=${window.reportPeriod}:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  // Explicitly no UPDATE to growth_reports and no parent notification call.
  return {
    published: 0,
    notificationCandidates,
    adminReviewReady,
    reportPeriod: window.reportPeriod,
  };
}