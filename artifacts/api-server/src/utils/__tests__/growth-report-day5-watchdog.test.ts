import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const { reconcile } = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("../../jobs/growth-report-monthly-readiness.js", () => ({
  getMonthlyReportReadiness: reconcile,
}));
import {
  enqueueDay5DeadlineBlocked, day5DeadlineReached,
} from "../growth-report-day5-watchdog.js";
import { retryPendingGrowthReportNotifications } from "../growth-report-notification-outbox.js";

const dialect = new PgDialect();
const deadline = new Date("2026-10-04T17:00:00Z");
const summary = (ready = false) => ({
  eligible_total: 119, resolved_total: ready ? 119 : 117,
  remaining_count: ready ? 0 : 2, generated_total: 114,
  insufficient_evidence_total: 3, policy_excluded_total: ready ? 2 : 0,
  unknown: ready ? 0 : 2, queued: 0, processing: 0, retry_pending: 0,
  failed: 0, missing: 0, duplicate: 0, wrong_pool: 0,
  ready, snapshot_sealed: true, empty_target: false,
  student_name: "PRIVATE STUDENT", analysis_response_payload: "PRIVATE AI TEXT",
});

function fakeDb() {
  const events = new Map<string, any>();
  const inbox = new Set<string>();
  const statements: string[] = [];
  const execute = vi.fn(async (q: any) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    statements.push(text);
    if (text.includes("FROM growth_report_cycles")) {
      return { rows: [{ id: "cycle", eligible_total: 119 }] };
    }
    if (text.includes("FROM users")) return { rows: [{ user_id: "super-1" }] };
    if (text.includes("INSERT INTO super_admin_notifications")) {
      inbox.add(params[0]); return { rows: [] };
    }
    if (text.includes("INSERT INTO growth_report_notification_outbox")) {
      const [id, eventKey, poolId, period, recipient, title, body, deepLink, payload] = params;
      if (events.has(id)) return { rows: [] };
      events.set(id, {
        id, event_key: eventKey, swimming_pool_id: poolId, report_period: period,
        recipient_id: recipient, title, body, deep_link: deepLink,
        notification_type: "GROWTH_REPORT_DAY5_DEADLINE_BLOCKED",
        payload: JSON.parse(payload), status: "PENDING",
      });
      return { rows: [{ id }] };
    }
    if (text.includes("SELECT id") && text.includes("FROM growth_report_notification_outbox")) {
      return { rows: [...events.values()].filter(e => e.status === "PENDING" && !e.suppressed) };
    }
    if (text.includes("SET status = 'CLAIMED'")) {
      const row = events.get(params[0]);
      if (row?.status !== "PENDING" || row.suppressed) return { rows: [] };
      row.status = "CLAIMED"; row.lease_token = "lease";
      return { rows: [{ ...row }] };
    }
    if (text.includes("SET status = 'DISPATCHING'")) {
      events.get(params[0]).status = "DISPATCHING";
      return { rows: [{ id: params[0] }] };
    }
    if (text.includes("'infinity'")) {
      const row = events.get(params[0]); row.status = "PENDING"; row.suppressed = true;
    }
    if (text.includes("SET status = 'DELIVERED'")) events.get(params[1]).status = "DELIVERED";
    return { rows: [] };
  });
  const db = { execute, transaction: async (fn: any) => fn({ execute }) };
  return { db: db as any, events, inbox, statements };
}

describe("Day-5 final watchdog", () => {
  beforeEach(() => {
    reconcile.mockReset().mockResolvedValue(summary());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(deadline);
  });
  afterEach(() => vi.useRealTimers());

  it("uses the exact KST deadline including December rollover", () => {
    expect(day5DeadlineReached("2026-09", new Date(deadline.getTime() - 1))).toBe(false);
    expect(day5DeadlineReached("2026-09", deadline)).toBe(true);
    expect(day5DeadlineReached("2026-12", new Date("2027-01-04T17:00:00Z"))).toBe(true);
    expect(day5DeadlineReached("2026-13", deadline)).toBe(false);
  });
  it("117/119 produces one independent aggregate-only super-admin event and PUSH", async () => {
    const { db, events, inbox, statements } = fakeDb();
    const params = { poolId: "pool-1", reportPeriod: "2026-09" };
    expect(await enqueueDay5DeadlineBlocked(db, params)).toBe(1);
    expect(await enqueueDay5DeadlineBlocked(db, params)).toBe(0);
    const sender = vi.fn().mockResolvedValue({ providerReceiptId: "accepted" });
    await retryPendingGrowthReportNotifications(db, sender);
    await retryPendingGrowthReportNotifications(db, sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0].recipientId).toBe("super-1");
    const event = [...events.values()][0];
    expect(event.status).toBe("DELIVERED");
    expect(event.payload).toMatchObject({ eligible_total: 119, resolved_total: 117,
      remaining: 2, unknown: 2, pool_id: "pool-1", event_type: "DAY5_DEADLINE_BLOCKED" });
    expect(JSON.stringify(event)).not.toMatch(/PRIVATE STUDENT|PRIVATE AI TEXT/);
    expect(inbox.size).toBe(1);
    expect(statements.join("\n")).not.toMatch(/growth_report_incidents|UPDATE growth_reports|INSERT INTO notifications/);
  });
  it("119/119 or before day 5 produces no blocked event", async () => {
    const { db, events } = fakeDb();
    reconcile.mockResolvedValue(summary(true));
    expect(await enqueueDay5DeadlineBlocked(db, { poolId: "p", reportPeriod: "2026-09" })).toBe(0);
    reconcile.mockResolvedValue(summary());
    expect(await enqueueDay5DeadlineBlocked(db, {
      poolId: "p", reportPeriod: "2026-09", now: new Date(deadline.getTime() - 1),
    })).toBe(0);
    expect(events.size).toBe(0);
  });
  it("suppresses an existing pending blocked PUSH after recovery", async () => {
    const { db, events } = fakeDb();
    await enqueueDay5DeadlineBlocked(db, { poolId: "p", reportPeriod: "2026-09" });
    reconcile.mockResolvedValue(summary(true));
    const sender = vi.fn();
    await retryPendingGrowthReportNotifications(db, sender);
    await retryPendingGrowthReportNotifications(db, sender);
    expect(sender).not.toHaveBeenCalled();
    expect([...events.values()][0].suppressed).toBe(true);
  });
  it("rechecks recovery immediately before dispatch", async () => {
    const { db } = fakeDb();
    await enqueueDay5DeadlineBlocked(db, { poolId: "p", reportPeriod: "2026-09" });
    reconcile.mockResolvedValueOnce(summary()).mockResolvedValueOnce(summary(true));
    const sender = vi.fn();
    await retryPendingGrowthReportNotifications(db, sender);
    expect(sender).not.toHaveBeenCalled();
  });
  it("records a reconciliation failure without copying its error or losing the alarm", async () => {
    const { db, events, statements } = fakeDb();
    reconcile.mockRejectedValue(new Error("PRIVATE STUDENT / PRIVATE AI TEXT"));
    await enqueueDay5DeadlineBlocked(db, { poolId: "p", reportPeriod: "2026-09" });
    expect(statements.join("\n")).toContain("ROLLBACK TO SAVEPOINT");
    const event = [...events.values()][0];
    expect(event.payload).toMatchObject({ unknown: 119, counters_available: false,
      readiness_error: "RECONCILIATION_UNAVAILABLE" });
    expect(JSON.stringify(event)).not.toContain("PRIVATE");
    const sender = vi.fn().mockResolvedValue({ providerReceiptId: "accepted" });
    await retryPendingGrowthReportNotifications(db, sender);
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("does not let one failed provider call stop another pool", async () => {
    const { db } = fakeDb();
    for (const poolId of ["p1", "p2"]) {
      await enqueueDay5DeadlineBlocked(db, { poolId, reportPeriod: "2026-09" });
    }
    const sender = vi.fn().mockRejectedValueOnce(new Error("ambiguous provider failure"))
      .mockResolvedValueOnce({ providerReceiptId: "second" });
    await retryPendingGrowthReportNotifications(db, sender);
    expect(sender).toHaveBeenCalledTimes(2);
  });
});
