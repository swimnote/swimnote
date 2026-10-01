import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  KnownGrowthReportPushRejection,
  notifyGrowthReportAdminsReady,
  retryPendingGrowthReportNotifications,
  type GrowthReportNotification,
} from "../growth-report-notification-outbox.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;
const queryParams = (value: any) => dialect.sqlToQuery(value).params;

const adminNotification: GrowthReportNotification = {
  type: "GROWTH_REPORT_BATCH_READY",
  recipientId: "admin-1",
  recipientType: "user",
  poolId: "pool-1",
  reportPeriod: "2026-09",
  title: "AI 성장리포트 발송 준비 완료",
  body: "review opened",
  deepLink: "/admin/growth-reports/monthly-list",
  payload: { screen: "growth_report_list", pool_id: "pool-1" },
};

function makeReadyDb() {
  return {
    execute: vi.fn()
      .mockResolvedValueOnce({ rows: [{ user_id: "admin-1" }] })
      .mockResolvedValueOnce({ rows: [] }) // idempotent outbox insert
      .mockResolvedValueOnce({ rows: [{
        id: "grnot_admin_pool-1_2026-09_admin-1",
        lease_token: "lease-1",
        notification_type: "GROWTH_REPORT_BATCH_READY",
        recipient_id: "admin-1",
        recipient_type: "user",
        swimming_pool_id: "pool-1",
        report_period: "2026-09",
        title: adminNotification.title,
        body: adminNotification.body,
        deep_link: adminNotification.deepLink,
        payload: adminNotification.payload,
      }] }) // claim
      .mockResolvedValueOnce({ rows: [] }) // feed insert
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] }) // dispatch fence
      .mockResolvedValueOnce({ rows: [] }), // final state update
  };
}

describe("monthly admin-ready notification outbox", () => {
  it("creates an idempotent admin-only pool/period intent and records delivery", async () => {
    const db = makeReadyDb();
    const sender = vi.fn().mockResolvedValue({ providerReceiptId: "ticket-1" });

    expect(await notifyGrowthReportAdminsReady(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09", message: "review opened" },
      sender,
    )).toBe(1);

    const recipientQuery = queryText(db.execute.mock.calls[0][0]);
    expect(recipientQuery).toContain("role = 'pool_admin'");
    expect(recipientQuery).toContain("swimming_pool_id = ");
    const insertQuery = queryText(db.execute.mock.calls[1][0]);
    expect(insertQuery).toContain("GROWTH_REPORT_BATCH_READY");
    expect(insertQuery).not.toContain("report_id");
    expect(insertQuery).toContain("'user'");
    expect(queryParams(db.execute.mock.calls[1][0])).toEqual(expect.arrayContaining([
      "pool-1", "2026-09", "admin-1",
    ]));
    expect(queryText(db.execute.mock.calls[2][0])).toContain("status = 'CLAIMED'");
    expect(queryText(db.execute.mock.calls[3][0])).toContain("INSERT INTO notifications");
    expect(queryText(db.execute.mock.calls[4][0])).toContain("status = 'DISPATCHING'");
    expect(queryText(db.execute.mock.calls[5][0])).toContain("status = 'DELIVERED'");
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: "admin-1",
      recipientType: "user",
      poolId: "pool-1",
      reportPeriod: "2026-09",
    }));
  });

  it("returns an explicitly rejected send to PENDING for a later retry", async () => {
    const db = makeReadyDb();
    await notifyGrowthReportAdminsReady(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09", message: "ready" },
      vi.fn().mockRejectedValue(new KnownGrowthReportPushRejection("explicit rejection")),
    );

    expect(db.execute).toHaveBeenCalledTimes(6);
    expect(queryParams(db.execute.mock.calls[5][0])).toContain("PENDING");
    expect(queryText(db.execute.mock.calls[5][0])).toContain("next_attempt_at");
  });

  it("marks ambiguous provider outcomes UNCERTAIN and excludes them from retries", async () => {
    const db = makeReadyDb();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await notifyGrowthReportAdminsReady(
        db as any,
        { poolId: "pool-1", reportPeriod: "2026-09", message: "ready" },
        vi.fn().mockRejectedValue(new Error("acknowledgement lost")),
      );
    } finally {
      log.mockRestore();
    }
    expect(queryParams(db.execute.mock.calls[5][0])).toContain("UNCERTAIN");

    const retryDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // stale dispatches -> uncertain
        .mockResolvedValueOnce({ rows: [] }), // due pending/expired claims only
    };
    await retryPendingGrowthReportNotifications(retryDb as any, vi.fn());
    expect(queryText(retryDb.execute.mock.calls[0][0])).toContain("DISPATCHING");
    expect(queryText(retryDb.execute.mock.calls[1][0])).toContain("GROWTH_REPORT_BATCH_READY");
    expect(queryText(retryDb.execute.mock.calls[1][0])).toContain("status = 'PENDING'");
    expect(queryText(retryDb.execute.mock.calls[1][0])).not.toContain("UNCERTAIN");
  });

  it("reclaims expired pre-dispatch claims only for admin-ready rows", async () => {
    const retryDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // ambiguous sends marked uncertain only
        .mockResolvedValueOnce({ rows: [{ id: "admin-outbox" }] })
        .mockResolvedValueOnce({ rows: [] }), // claim lost to another worker
    };
    expect(await retryPendingGrowthReportNotifications(retryDb as any, vi.fn())).toBe(0);
    const pendingQuery = queryText(retryDb.execute.mock.calls[1][0]);
    expect(pendingQuery).toContain("GROWTH_REPORT_BATCH_READY");
    expect(pendingQuery).toContain("lease_until < NOW()");
    expect(pendingQuery).not.toContain("GROWTH_REPORT_PUBLISHED");
    expect(queryText(retryDb.execute.mock.calls[2][0])).toContain("status = 'CLAIMED'");
  });
});