import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../../lib/incident-alerts.js", () => ({
  fireMonthlyGrowthReportIncident: vi.fn().mockResolvedValue(undefined),
}));

import { fireMonthlyGrowthReportIncident } from "../../lib/incident-alerts.js";
import {
  freeReportIssueWindow,
  runMonthlyFreeAutoPublication,
  SEPTEMBER_2026_FREE_REPORT_PERIOD,
} from "../growth-report-auto-publisher.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;
const queryParams = (value: any) => dialect.sqlToQuery(value).params;
const issueAt = new Date("2026-10-04T17:00:00.000Z"); // October 5, 02:00 KST

function makePublisherDb(
  cyclePools: Array<{ pool_id: string; report_period: string }>,
  unreadyPools: string[] = [],
  transientPools: string[] = [],
) {
  const poolByCycleId = new Map<string, string>();
  const execute = vi.fn(async (query: unknown) => {
    const q = queryText(query);
    const params = queryParams(query);
    if (q.includes("FROM growth_report_cycles") && q.includes("SELECT cycle.swimming_pool_id")) {
      return { rows: cyclePools };
    }
    if (q.includes("FROM growth_report_cycles")) {
      const poolId = String(params[0]);
      const cycleId = `cycle-${poolId}`;
      poolByCycleId.set(cycleId, poolId);
      return { rows: [{
        id: cycleId,
        eligible_total: 1,
        eligibility_sealed_at: "2026-10-01T00:00:00Z",
      }] };
    }
    if (q.includes("FOR UPDATE OF target, report")) return { rows: [] };
    if (q.includes("FROM growth_report_eligible_targets")) {
      const cycleId = String(params.at(-1));
      const poolId = poolByCycleId.get(cycleId)!;
      if (unreadyPools.includes(poolId)) {
        return { rows: [{
          student_id: `${poolId}-student`,
          target_pool_id: poolId,
          report_id: `${poolId}-failed`,
          swimming_pool_id: poolId,
          product_status: "FAILED",
          analysis_status: "FAILED",
        }] };
      }
      if (transientPools.includes(poolId)) {
        return { rows: [{
          student_id: `${poolId}-student`,
          target_pool_id: poolId,
          report_id: `${poolId}-open`,
          swimming_pool_id: poolId,
          product_status: "OPEN",
          analysis_status: "PENDING",
          analysis_retry_count: 0,
        }] };
      }
      return { rows: [{
        student_id: `${poolId}-student`,
        target_pool_id: poolId,
        report_id: `${poolId}-report`,
        swimming_pool_id: poolId,
        product_status: "REVIEW_REQUIRED",
        analysis_status: "COMPLETE",
        eligibility_version: 4,
        attendance_count: 3,
        source_event_count: 1,
        report_content: { present: true },
        report_fact_package: {
          grounding_result: "PASS",
          growth_framing_result: "PASS",
        },
        sns_summary: { present: true },
      }] };
    }
    if (q.includes("SELECT DISTINCT id AS user_id")) return { rows: [{ user_id: "admin-1" }] };
    return { rows: [] };
  });
  const db = {
    execute,
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ execute }),
    ),
  };
  return { db, execute };
}

describe("monthly FREE report admin-review opener (legacy publisher entrypoint)", () => {
  it("maps issuance to the prior analysis month in KST", () => {
    expect(freeReportIssueWindow(issueAt)).toMatchObject({
      reportPeriod: "2026-09",
      analysisStart: "2026-09-01",
      issueMonthStart: "2026-10-01",
    });
    expect(freeReportIssueWindow(new Date("2026-11-04T17:00:00Z")).reportPeriod).toBe("2026-10");
    expect(SEPTEMBER_2026_FREE_REPORT_PERIOD).toBe(
      "2026년 10월 5일 발급되는 무료 AI 성장리포트는 2026년 9월 1일 00:00 KST 이상, 2026년 10월 1일 00:00 KST 미만의 9월 수업 데이터를 대상으로 한다.",
    );
  });

  it("does not open review or notify anyone before the fifth-day 02:00 KST window", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const notifyAdmin = vi.fn();
    const result = await runMonthlyFreeAutoPublication(
      { execute } as any,
      new Date("2026-10-04T16:59:59Z"),
      notifyAdmin,
    );
    expect(result).toMatchObject({ published: 0, notificationCandidates: 0, adminReviewReady: 0 });
    expect(execute).toHaveBeenCalledOnce();
    expect(notifyAdmin).not.toHaveBeenCalled();
  });

  it("alerts for a clear pre-deadline failure but not each transient queued report", async () => {
    vi.mocked(fireMonthlyGrowthReportIncident).mockClear();
    const failedDb = makePublisherDb([
      { pool_id: "pool-failed", report_period: "2026-09" },
    ], ["pool-failed"]);
    const notifyAdmin = vi.fn();
    await runMonthlyFreeAutoPublication(
      failedDb.db as any,
      new Date("2026-10-04T16:59:59Z"),
      notifyAdmin,
    );
    expect(fireMonthlyGrowthReportIncident).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "pool-failed",
      incidentType: "FAILED",
    }));
    expect(notifyAdmin).not.toHaveBeenCalled();

    vi.mocked(fireMonthlyGrowthReportIncident).mockClear();
    const transientDb = makePublisherDb([
      { pool_id: "pool-transient", report_period: "2026-09" },
    ], [], ["pool-transient"]);
    await runMonthlyFreeAutoPublication(
      transientDb.db as any,
      new Date("2026-10-04T16:59:59Z"),
      notifyAdmin,
    );
    expect(fireMonthlyGrowthReportIncident).not.toHaveBeenCalled();
  });

  it("does not record or announce READY before the fifth-day dispatch window", async () => {
    const { db, execute } = makePublisherDb([
      { pool_id: "pool-ready-early", report_period: "2026-09" },
    ]);
    const notifyAdmin = vi.fn();
    await runMonthlyFreeAutoPublication(
      db as any,
      new Date("2026-10-04T16:59:59Z"),
      notifyAdmin,
    );

    expect(notifyAdmin).not.toHaveBeenCalled();
    const queries = execute.mock.calls.map(([query]) => queryText(query));
    expect(queries.some(query => query.includes("SET ready_at = COALESCE"))).toBe(false);
    expect(queries.some(query => query.includes("INSERT INTO growth_report_notification_outbox"))).toBe(false);
  });

  it("keeps cycles independent, scans sealed historical outstanding cycles, and notifies only READY", async () => {
    const { db, execute } = makePublisherDb([
      { pool_id: "pool-a", report_period: "2026-09" },
      { pool_id: "pool-b", report_period: "2026-09" },
      { pool_id: "pool-c", report_period: "2026-08" },
    ], ["pool-b"]);
    const notifyAdmin = vi.fn().mockResolvedValue(undefined);
    const result = await runMonthlyFreeAutoPublication(db as any, issueAt, notifyAdmin);

    expect(result).toEqual({
      published: 0,
      notificationCandidates: 2,
      adminReviewReady: 2,
      reportPeriod: "2026-09",
    });
    expect(notifyAdmin).toHaveBeenCalledTimes(2);
    expect(notifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "pool-a",
      reportPeriod: "2026-09",
      readiness: expect.objectContaining({ eligible_total: 1, generated_total: 1, ready: true }),
    }));
    expect(notifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "pool-c",
      reportPeriod: "2026-08",
    }));
    expect(notifyAdmin).not.toHaveBeenCalledWith(expect.objectContaining({ poolId: "pool-b" }));

    const cycleScan = queryText(execute.mock.calls[0][0]);
    expect(cycleScan).toContain("eligibility_sealed_at IS NOT NULL");
    expect(cycleScan).toContain("cycle.report_period < ");
    expect(cycleScan).toContain("cycle.ready_at IS NULL");
    expect(execute.mock.calls.map(([query]) => queryText(query))
      .filter(query => query.includes("UPDATE growth_report_notification_outbox")).length).toBe(0);
  });

  it("persists READY notification intent under the cycle transaction and never parent-publishes", async () => {
    const { db, execute } = makePublisherDb([
      { pool_id: "pool-a", report_period: "2026-09" },
    ]);
    await runMonthlyFreeAutoPublication(db as any, issueAt, vi.fn());

    const calls = execute.mock.calls.map(([query]) => queryText(query));
    expect(calls.some(query => query.includes("FOR UPDATE"))).toBe(true);
    expect(calls.some(query => query.includes("SET ready_at = COALESCE"))).toBe(true);
    expect(calls.some(query => query.includes("INSERT INTO growth_report_notification_outbox"))).toBe(true);
    expect(calls.some(query => query.includes("UPDATE growth_reports"))).toBe(false);
    expect(calls.some(query => query.includes("GROWTH_REPORT_PUBLISHED"))).toBe(false);
  });

  it("has no automatic parent-publication path and uses KST cron/review semantics", async () => {
    const { readFileSync } = await import("node:fs");
    const batchWorker = readFileSync(new URL("../growth-report-batch-worker.ts", import.meta.url), "utf8");
    const scheduler = readFileSync(new URL("../growth-report-scheduler.ts", import.meta.url), "utf8");
    const autoPublisher = readFileSync(new URL("../growth-report-auto-publisher.ts", import.meta.url), "utf8");
    expect(batchWorker).not.toContain("sendAdminReadyPush");
    expect(batchWorker).not.toContain("runScheduledPushes");
    expect(batchWorker).toContain("retryGrowthReportNotifications");
    expect(batchWorker).not.toContain("retryGrowthReportNotificationOutbox");
    expect(batchWorker).toContain('{ timezone: "Asia/Seoul" }');
    expect(scheduler).toContain('{ timezone: "Asia/Seoul" }');
    expect(batchWorker).not.toContain("SET product_status = 'PUBLISHED'");
    expect(autoPublisher).toContain("notifyMonthlyGrowthReportPrepared");
    expect(autoPublisher).not.toContain("notifyBatchComplete");
    expect(autoPublisher).not.toContain("autoApproveAndPublishForDelivery");
    expect(autoPublisher).not.toContain("notifyGrowthReportPublished");
  });
});