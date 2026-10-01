import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  KnownGrowthReportPushRejection,
  enqueueMonthlySuperAdminEvent,
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

function makeReadyDb(gateResults: boolean[] = []) {
  let gateCheck = 0;
  let claimCount = 0;
  const execute = vi.fn(async (query: unknown) => {
    const q = queryText(query);
    if (q.includes("FROM growth_report_cycles")) {
      return { rows: [{
        id: "cycle-1",
        eligible_total: 1,
        eligibility_sealed_at: "2026-10-01T00:00:00Z",
      }] };
    }
    if (q.includes("FOR UPDATE OF target, report")) return { rows: [] };
    if (q.includes("FROM growth_report_eligible_targets")) {
      const ready = gateResults[gateCheck++] ?? true;
      if (!ready) {
        return { rows: [{
          student_id: "student-1",
          target_pool_id: "pool-1",
          report_id: "failed-report",
          swimming_pool_id: "pool-1",
          product_status: "FAILED",
          analysis_status: "FAILED",
        }] };
      }
      return { rows: [{
        student_id: "student-1",
        target_pool_id: "pool-1",
        report_id: "report-1",
        swimming_pool_id: "pool-1",
        product_status: "REVIEW_REQUIRED",
        analysis_status: "COMPLETE",
        eligibility_version: 4,
        attendance_count: 3,
        source_event_count: 1,
        report_content: { summary: "stored" },
        report_fact_package: {
          grounding_result: "PASS",
          growth_framing_result: "PASS",
        },
        sns_summary: { value: true },
      }] };
    }
    if (q.includes("SELECT DISTINCT id AS user_id")) return { rows: [{ user_id: "admin-1" }] };
    if (q.includes("INSERT INTO growth_report_notification_outbox")) return { rows: [] };
    if (q.includes("SET status = 'CLAIMED'")) {
      claimCount++;
      return claimCount === 1 ? { rows: [{
        id: "grnot_admin_pool-1_2026-09_admin-1",
        lease_token: "lease-1",
        status: "CLAIMED",
      }] } : { rows: [] };
    }
    if (q.includes("INSERT INTO notifications")) return { rows: [] };
    if (q.includes("SET status = 'DISPATCHING'")) return { rows: [{ id: "outbox-1" }] };
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

describe("monthly admin-ready notification outbox", () => {
  it("only prepares and pushes an idempotent admin intent after the sealed readiness gate", async () => {
    const { db, execute } = makeReadyDb();
    const sender = vi.fn().mockResolvedValue({ providerReceiptId: "ticket-1" });

    expect(await notifyGrowthReportAdminsReady(
      db as any,
      {
        poolId: "pool-1",
        reportPeriod: "2026-09",
        message: "review opened",
        readiness: { eligible_total: 1, ready: true },
      },
      sender,
    )).toBe(1);

    const cycleQueries = execute.mock.calls
      .map(([query]) => queryText(query))
      .filter(query => query.includes("FROM growth_report_cycles"));
    expect(cycleQueries.length).toBeGreaterThanOrEqual(3);
    expect(execute.mock.calls.map(([query]) => queryText(query))
      .some(query => query.includes("FOR UPDATE"))).toBe(true);
    const recipientQuery = execute.mock.calls
      .map(([query]) => queryText(query))
      .find(query => query.includes("SELECT DISTINCT id AS user_id"))!;
    expect(recipientQuery).toContain("role = 'pool_admin'");
    const insertCall = execute.mock.calls.find(([query]) =>
      queryText(query).includes("INSERT INTO growth_report_notification_outbox"),
    )!;
    expect(queryText(insertCall[0])).toContain("GROWTH_REPORT_BATCH_READY");
    expect(queryText(insertCall[0])).toContain("'user'");
    expect(queryParams(insertCall[0])).toEqual(expect.arrayContaining([
      "pool-1", "2026-09", "admin-1",
    ]));
    expect(execute.mock.calls.map(([query]) => queryText(query))
      .some(query => query.includes("INSERT INTO notifications"))).toBe(true);
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: "admin-1",
      recipientType: "user",
      poolId: "pool-1",
      reportPeriod: "2026-09",
    }));

    await notifyGrowthReportAdminsReady(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09", message: "again" },
      sender,
    );
    expect(sender).toHaveBeenCalledOnce();
  });

  it("blocks all notification work for a pre-READY/empty or failed cycle", async () => {
    const { db, execute } = makeReadyDb([false]);
    const sender = vi.fn();

    expect(await notifyGrowthReportAdminsReady(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09", message: "not ready" },
      sender,
    )).toBe(0);
    expect(sender).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([query]) =>
      queryText(query).includes("SELECT DISTINCT id AS user_id"),
    )).toBe(false);
  });

  it("rechecks the gate immediately before provider dispatch", async () => {
    const { db } = makeReadyDb([true, true, false]);
    const sender = vi.fn().mockResolvedValue(undefined);

    await notifyGrowthReportAdminsReady(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09", message: "ready" },
      sender,
    );

    expect(sender).not.toHaveBeenCalled();
  });

  it("returns explicitly rejected sends to PENDING for a later retry", async () => {
    const { db, execute } = makeReadyDb();
    await notifyGrowthReportAdminsReady(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09", message: "ready" },
      vi.fn().mockRejectedValue(new KnownGrowthReportPushRejection("explicit rejection")),
    );

    const lastQuery = queryText(execute.mock.calls.at(-1)![0]);
    expect(lastQuery).toContain("status = 'DISPATCHING'");
    expect(queryParams(execute.mock.calls.at(-1)![0])).toContain("PENDING");
    expect(lastQuery).toContain("next_attempt_at");
  });

  it("marks ambiguous provider outcomes UNCERTAIN and never retries them", async () => {
    const { db, execute } = makeReadyDb();
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
    expect(queryParams(execute.mock.calls.at(-1)![0])).toContain("UNCERTAIN");

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
});

describe("monthly super-admin summary outbox", () => {
  function makeRunDb(params: {
    firstPassFinished?: boolean;
    pausedAt?: boolean;
    pauseEpoch?: number;
    superAdminIds?: string[];
    summaryPayload?: unknown;
  } = {}) {
    const insertedIntentIds = new Set<string>();
    const execute = vi.fn(async (query: unknown) => {
      const q = queryText(query);
      if (q.includes("FROM growth_report_monthly_runs")) {
        return {
          rows: [{
            first_pass_completed_at: params.firstPassFinished ? "2026-10-01T00:00:00Z" : null,
            summary_payload: params.summaryPayload ?? null,
            paused_at: params.pausedAt ? "2026-10-01T00:00:00Z" : null,
            pause_epoch: params.pauseEpoch ?? 0,
          }],
        };
      }
      if (q.includes("FROM users") && q.includes("role = 'super_admin'")) {
        return { rows: (params.superAdminIds ?? ["super-1", "super-2"]).map(user_id => ({ user_id })) };
      }
      if (q.includes("INSERT INTO growth_report_notification_outbox")) {
        const id = String(queryParams(query)[0]);
        if (insertedIntentIds.has(id)) return { rows: [] };
        insertedIntentIds.add(id);
        return { rows: [{ id: "new-intent" }] };
      }
      return { rows: [] };
    });
    return { execute };
  }

  it("gates a failure summary on finished first pass and stores only safe aggregate fields", async () => {
    const persistedSummary = {
      pool_total: 7,
      processed_pool_total: 5,
      eligible_total: 42,
      generated_total: 39,
      insufficient_evidence_total: 1,
      policy_excluded_total: 1,
      unresolved_pool_total: 2,
      unresolved_member_total: 2,
      error_categories: { Provider: 1, UNKNOWN: 1, "parent@example.com": 50 },
      raw_payload: "private student data",
    };
    const db = makeRunDb({ firstPassFinished: true, summaryPayload: persistedSummary });
    const liveSummary = {
      pool_total: 999,
      unresolved_member_total: 999,
      raw_payload: "live recovery counters must not be persisted",
    };

    expect(await enqueueMonthlySuperAdminEvent(db as any, {
      reportPeriod: "2026-09",
      eventType: "FIRST_PASS_FINISHED",
      summary: liveSummary,
    })).toBe(2);

    const calls = db.execute.mock.calls.map(([query]) => queryText(query));
    expect(calls.some(query => query.includes("INSERT INTO super_admin_notifications"))).toBe(true);
    const insert = db.execute.mock.calls.find(([query]) =>
      queryText(query).includes("INSERT INTO growth_report_notification_outbox"),
    )!;
    expect(queryText(insert[0])).toContain("'report_month'");
    expect(queryText(insert[0])).toContain("notification_type");
    expect(queryText(insert[0])).toContain("NULL");
    expect(queryText(insert[0])).toContain("'user'");
    expect(queryParams(insert[0])).toEqual(expect.arrayContaining([
      "GROWTH_REPORT_FIRST_PASS_FINISHED",
      "growth_report_monthly_2026-09_FIRST_PASS_FINISHED",
      "2026-09",
      "super-1",
    ]));
    const insertPayload = queryParams(insert[0]).find(value =>
      typeof value === "string" && value.includes("error_categories"),
    ) as string;
    expect(insertPayload).toContain('"provider":1');
    expect(insertPayload).toContain('"pool_total":7');
    expect(insertPayload).toContain('"processed_pool_total":5');
    expect(insertPayload).toContain('"policy_excluded_total":1');
    expect(insertPayload).toContain('"unresolved_member_total":2');
    expect(insertPayload).not.toContain('"pool_total":999');
    expect(insertPayload).not.toContain("live recovery counters");
    expect(insertPayload).not.toContain("parent@example.com");
    expect(insertPayload).not.toContain("private student data");

    const eventPayload = JSON.parse(insertPayload);
    expect(eventPayload).toMatchObject({
      pool_total: 7,
      processed_pool_total: 5,
      eligible_total: 42,
      generated_total: 39,
      insufficient_evidence_total: 1,
      policy_excluded_total: 1,
      unresolved_pool_total: 2,
      unresolved_member_total: 2,
    });
    expect(eventPayload).not.toHaveProperty("raw_payload");

    const inboxInsert = db.execute.mock.calls.find(([query]) =>
      queryText(query).includes("INSERT INTO super_admin_notifications"),
    )!;
    const inboxParams = queryParams(inboxInsert[0]);
    expect(inboxParams).toContain("growth_report_monthly_2026-09_FIRST_PASS_FINISHED");
    expect(inboxParams.join(" ")).toContain("/super/ai?tab=monthly&report_period=2026-09");

    const intents = db.execute.mock.calls.filter(([query]) =>
      queryText(query).includes("INSERT INTO growth_report_notification_outbox"),
    );
    expect(intents).toHaveLength(2);
    expect(queryParams(intents[0][0])[0]).not.toBe(queryParams(intents[1][0])[0]);
    expect(queryParams(intents[0][0])).toContain("growth_report_monthly_2026-09_FIRST_PASS_FINISHED");
    expect(queryParams(intents[1][0])).toContain("growth_report_monthly_2026-09_FIRST_PASS_FINISHED");

    expect(await enqueueMonthlySuperAdminEvent(db as any, {
      reportPeriod: "2026-09",
      eventType: "FIRST_PASS_FINISHED",
      summary: liveSummary,
    })).toBe(0);
  });

  it("does not enqueue first-pass summaries before the durable barrier", async () => {
    const db = makeRunDb({ firstPassFinished: false });
    expect(await enqueueMonthlySuperAdminEvent(db as any, {
      reportPeriod: "2026-09",
      eventType: "FIRST_PASS_FINISHED",
      summary: { unresolved_member_total: 1 },
    })).toBe(0);
    expect(db.execute.mock.calls).toHaveLength(1);
  });

  it("uses a separate stable pause epoch and requires the run to be paused", async () => {
    const db = makeRunDb({ pausedAt: true, pauseEpoch: 3 });
    expect(await enqueueMonthlySuperAdminEvent(db as any, {
      reportPeriod: "2026-09",
      eventType: "PAUSED",
      pauseEpoch: 3,
    })).toBe(2);

    const rows = db.execute.mock.calls.filter(([query]) =>
      queryText(query).includes("INSERT INTO growth_report_notification_outbox"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBeDefined();
    expect(queryText(rows[0][0])).toContain("notification_type");
    expect(queryText(rows[0][0])).toContain("NULL");
    expect(queryText(rows[0][0])).toContain("'user'");
    expect(queryParams(rows[0][0])).toContain("GROWTH_REPORT_MONTHLY_PAUSED");

    const stale = makeRunDb({ pausedAt: false, pauseEpoch: 3 });
    expect(await enqueueMonthlySuperAdminEvent(stale as any, {
      reportPeriod: "2026-09",
      eventType: "PAUSED",
      pauseEpoch: 3,
    })).toBe(0);
  });
});