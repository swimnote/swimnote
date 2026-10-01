import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  freeReportIssueWindow,
  runMonthlyFreeAutoPublication,
  SEPTEMBER_2026_FREE_REPORT_PERIOD,
} from "../growth-report-auto-publisher.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;
const issueAt = new Date("2026-10-04T17:00:00.000Z"); // October 5, 02:00 KST

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
    const execute = vi.fn();
    const notifyAdmin = vi.fn();
    const result = await runMonthlyFreeAutoPublication(
      { execute } as any,
      new Date("2026-10-04T16:59:59Z"),
      notifyAdmin,
    );
    expect(result).toMatchObject({ published: 0, notificationCandidates: 0, adminReviewReady: 0 });
    expect(execute).not.toHaveBeenCalled();
    expect(notifyAdmin).not.toHaveBeenCalled();
  });

  it("opens review from actual report rows, includes partial failures, and never parent-publishes", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ pool_id: "pool-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { product_status: "READY_TO_SEND", analysis_status: "COMPLETE", readiness_eligible: true },
          { product_status: "EXCLUDED", analysis_status: "INVALID", exclusion_code: "NOT_ELIGIBLE" },
          { product_status: "OPEN", analysis_status: "DATA_ACCUMULATING" },
          { product_status: "FAILED", analysis_status: "FAILED" },
          { product_status: "PUBLISHED", analysis_status: "COMPLETE" },
        ],
      });
    const notifyAdmin = vi.fn().mockResolvedValue(undefined);
    const result = await runMonthlyFreeAutoPublication(
      { execute } as any,
      issueAt,
      notifyAdmin,
    );

    expect(result).toEqual({
      published: 0,
      notificationCandidates: 1,
      adminReviewReady: 1,
      reportPeriod: "2026-09",
    });
    expect(notifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "pool-1",
      reportPeriod: "2026-09",
      readiness: {
        analysis_ready: 1,
        excluded: 1,
        data_accumulating: 1,
        retrying: 0,
        pending_analysis: 0,
        terminal_failed: 1,
        published: 1,
        other: 0,
        total: 5,
      },
    }));
    const cycleQuery = queryText(execute.mock.calls[0][0]);
    expect(cycleQuery).toContain("growth_report_cycles");
    expect(cycleQuery).not.toContain("UPDATE growth_reports");
    expect(cycleQuery).not.toContain("GROWTH_REPORT_PUBLISHED");
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