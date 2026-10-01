import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  enqueueGrowthReportNotification,
  KnownGrowthReportPushRejection,
  notifyGrowthReportAdminsReady,
  reconcileGrowthReportNotification,
  recoverPublishedGrowthReportNotificationIntents,
  retryPendingGrowthReportNotifications,
  UncertainGrowthReportPushError,
  type GrowthReportNotification,
} from "../growth-report-notification-outbox.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;
const queryParams = (value: any) => dialect.sqlToQuery(value).params;

const parentNotification: GrowthReportNotification = {
  type: "GROWTH_REPORT_PUBLISHED",
  recipientId: "parent-1",
  recipientType: "parent_account",
  poolId: "pool-1",
  reportId: "report-1",
  reportPeriod: "2026-09",
  title: "title",
  body: "body",
};

describe("growth report notification outbox", () => {
  it("uses unique admin-period and parent-report keys with durable leases", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1", lease_token: "fence-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    await enqueueGrowthReportNotification(
      { execute } as any,
      parentNotification,
      vi.fn().mockResolvedValue({ providerReceiptId: "receipt-1" }),
    );
    const insert = queryText(execute.mock.calls[0][0]);
    expect(insert).toContain("ON CONFLICT DO NOTHING");
    const claim = queryText(execute.mock.calls[1][0]);
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(queryText(execute.mock.calls[2][0])).toContain("INSERT INTO notifications");
    expect(queryText(execute.mock.calls[3][0])).toContain("status = 'DISPATCHING'");
    const delivered = queryText(execute.mock.calls[4][0]);
    expect(delivered).toContain("status = 'DELIVERED'");
    expect(delivered).toContain("provider_receipt_id");
    expect(delivered).toContain("lease_token = ");
  });

  it("retries an explicit known provider rejection but marks uncertain outcomes non-retryable", async () => {
    const knownDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "outbox-1", lease_token: "fence-1" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    await expect(enqueueGrowthReportNotification(
      knownDb as any,
      parentNotification,
      vi.fn().mockRejectedValue(new KnownGrowthReportPushRejection("explicit provider rejection")),
    )).rejects.toBeInstanceOf(KnownGrowthReportPushRejection);
    expect(queryText(knownDb.execute.mock.calls[4][0])).toContain("SET status = ");

    const uncertainDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "outbox-1", lease_token: "fence-1" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await enqueueGrowthReportNotification(
        uncertainDb as any,
        parentNotification,
        vi.fn().mockRejectedValue(new Error("acknowledgement lost")),
      );
      expect(queryParams(uncertainDb.execute.mock.calls[4][0])).toContain("UNCERTAIN");
      const retryExecute = vi.fn().mockResolvedValue({ rows: [] });
      await retryPendingGrowthReportNotifications(
        { execute: retryExecute } as any,
        vi.fn(),
      );
      expect(queryText(retryExecute.mock.calls[0][0])).not.toContain("UNCERTAIN");
      expect(queryText(retryExecute.mock.calls[0][0])).not.toContain("DISPATCHING");
    } finally {
      log.mockRestore();
    }
  });

  it("persists any ticket receipts from a partial ambiguous provider response", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1", lease_token: "fence-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await enqueueGrowthReportNotification(
        { execute } as any,
        parentNotification,
        vi.fn().mockRejectedValue(new UncertainGrowthReportPushError(
          "partial result",
          JSON.stringify(["ticket-1"]),
        )),
      );
      expect(queryParams(execute.mock.calls[4][0])).toContain(JSON.stringify(["ticket-1"]));
      expect(queryParams(execute.mock.calls[4][0])).toContain("UNCERTAIN");
    } finally {
      log.mockRestore();
    }
  });

  it("fences a stale dispatcher before provider invocation", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1", lease_token: "new-token" }] })
      .mockResolvedValueOnce({ rows: [] }) // deterministic notification insert
      .mockResolvedValueOnce({ rows: [] }); // stale lease/token rejected
    const sender = vi.fn();
    await enqueueGrowthReportNotification(
      { execute } as any,
      parentNotification,
      sender,
    );
    expect(sender).not.toHaveBeenCalled();
    expect(queryText(execute.mock.calls[3][0])).toContain("lease_token = ");
  });

  it("recovers a committed PUBLISHED report with no notification intent", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        report_id: "report-1",
        student_id: "student-1",
        pool_id: "pool-1",
        report_period: "2026-09",
        parent_id: "parent-1",
        legacy_notification_exists: false,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // durable intent insert
      .mockResolvedValueOnce({ rows: [{
        id: "grnot_parent_report-1_2026-09_parent-1",
        lease_token: "fence",
      }] })
      .mockResolvedValueOnce({ rows: [] }) // notification feed row
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] }) // dispatch guard
      .mockResolvedValueOnce({ rows: [] }); // delivered state
    const sendPush = vi.fn().mockResolvedValue({ providerReceiptId: "receipt-1" });

    expect(await recoverPublishedGrowthReportNotificationIntents(
      { execute } as any,
      sendPush,
    )).toBe(1);
    expect(queryText(execute.mock.calls[0][0])).toContain("gr.product_status = 'PUBLISHED'");
    expect(queryText(execute.mock.calls[0][0])).toContain("NOT EXISTS");
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(queryText(execute.mock.calls[5][0])).toContain("status = 'DELIVERED'");
  });

  it("records legacy feed notifications as UNCERTAIN instead of blindly pushing again", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        report_id: "report-1",
        student_id: "student-1",
        pool_id: "pool-1",
        report_period: "2026-09",
        parent_id: "parent-1",
        legacy_notification_exists: true,
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const sendPush = vi.fn();

    expect(await recoverPublishedGrowthReportNotificationIntents(
      { execute } as any,
      sendPush,
    )).toBe(1);
    expect(queryText(execute.mock.calls[1][0])).toContain("'UNCERTAIN'");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("reclaims a crash before dispatch only after the CLAIMED lease expires", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // outbox insert
      .mockResolvedValueOnce({ rows: [{ id: "outbox-1", lease_token: "old-fence" }] })
      .mockRejectedValueOnce(new Error("feed insert failed before provider call"))
      .mockResolvedValueOnce({ rows: [] }); // failure update cannot change CLAIMED to UNCERTAIN
    const firstSend = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await enqueueGrowthReportNotification({ execute } as any, parentNotification, firstSend);
      expect(firstSend).not.toHaveBeenCalled();
      expect(queryText(execute.mock.calls[3][0])).toContain("status IN ('CLAIMED', 'DISPATCHING')");

      const retryExecute = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] })
        .mockResolvedValueOnce({ rows: [{ ...parentNotification, id: "outbox-1", lease_token: "new-fence" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "outbox-1" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const retrySend = vi.fn().mockResolvedValue(undefined);
      await retryPendingGrowthReportNotifications({ execute: retryExecute } as any, retrySend);
      expect(queryText(retryExecute.mock.calls[0][0])).toContain("status = 'CLAIMED'");
      expect(queryText(retryExecute.mock.calls[1][0])).toContain("lease_until < NOW()");
      expect(retrySend).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("reconciles stranded DISPATCHING outcomes only with an explicit conclusion", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ id: "outbox-1" }] });
    expect(await reconcileGrowthReportNotification({ execute } as any, {
      outboxId: "outbox-1",
      outcome: "ACCEPTED",
      providerReceiptId: "receipt-1",
    })).toBe(true);
    expect(queryText(execute.mock.calls[0][0])).toContain("status IN ('DISPATCHING', 'UNCERTAIN')");
    expect(queryParams(execute.mock.calls[0][0])).toContain("receipt-1");

    const rejectExecute = vi.fn().mockResolvedValue({ rows: [{ id: "outbox-1" }] });
    expect(await reconcileGrowthReportNotification({ execute: rejectExecute } as any, {
      outboxId: "outbox-1",
      outcome: "DEFINITIVELY_REJECTED",
    })).toBe(true);
    expect(queryText(rejectExecute.mock.calls[0][0])).toContain("SET status = 'PENDING'");
  });

  it("sends monthly admin readiness once per recipient even when ready count is zero", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ user_id: "admin-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-admin", lease_token: "fence" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "outbox-admin" }] })
      .mockResolvedValueOnce({ rows: [] });
    const sendPush = vi.fn().mockResolvedValue(undefined);
    expect(await notifyGrowthReportAdminsReady(
      { execute } as any,
      {
        poolId: "pool-1",
        reportPeriod: "2026-09",
        message: "review opened",
        readiness: { analysis_ready: 0 },
      },
      sendPush,
    )).toBe(1);
    expect(queryParams(execute.mock.calls[1][0])).toContain("GROWTH_REPORT_BATCH_READY");
    expect(queryText(execute.mock.calls[5][0])).toContain("status = 'DELIVERED'");
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});