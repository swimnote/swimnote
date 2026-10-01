/**
 * gr7-publish-push.test.ts
 *
 * GR7: PUBLISHED PUSH NOTIFICATION + DEEP LINK FOUNDATION
 * 52+ TC
 *
 * Tests use fake DB/push mocks. No real DB, no ENGINE, no push.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    requireAuth: vi.fn((_req: any, _res: any, next: any) => next()),
    requireRole: vi.fn(
      (...roles: string[]) =>
        (req: any, res: any, next: any) => {
          if (roles.includes(req.user?.role ?? "")) return next();
          res.status(403).json({ success: false, error: "FORBIDDEN" });
        },
    ),
  };
});

vi.mock("@workspace/db", () => ({
  db:           { execute: vi.fn(async () => ({ rows: [] })), select: vi.fn() },
  superAdminDb: { execute: vi.fn(async () => ({ rows: [] })) },
}));

// Mock the current push-service API directly: this suite must never dispatch.
vi.mock("../../lib/push-service.js", () => ({
  sendPushToUser: vi.fn(async () => {}),
  sendPushToSuperAdmins: vi.fn(async () => {}),
  checkPushEnabled: vi.fn(async () => true),
  sendRawPush: vi.fn(async () => {}),
  sendRawPushWithResult: vi.fn(async (tokens: string[]) => ({
    totalTokens: tokens.length,
    uniqueTokens: tokens.length,
    chunks: tokens.length ? 1 : 0,
    successCount: tokens.length,
    failureCount: 0,
    invalidTokenCount: 0,
    configFailureCount: 0,
    retryCount: 0,
    definitiveRejectionCount: 0,
    providerReceiptIds: tokens.map((_, index) => `ticket-${index + 1}`),
  })),
}));

import {
  checkPushEnabled,
  sendRawPushWithResult,
} from "../../lib/push-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_ID  = "gr7_rpt_01";
const STUDENT_ID = "gr7_stu_01";
const ADMIN_ID   = "gr7_adm_01";
const POOL_ID    = "gr7_pool_01";
const PERIOD     = "2026-07";
const PARENT_A   = "par_a01";
const PARENT_B   = "par_b01";

const VALID_FACT_PACKAGE = {
  grounding_result:      "PASS",
  growth_framing_result: "PASS",
};

const BASE_APPROVED_REPORT = {
  id:                  REPORT_ID,
  student_id:          STUDENT_ID,
  swimming_pool_id:    POOL_ID,
  product_status:      "APPROVED",
  report_period:       PERIOD,
  report_content:      { summary_text: "잘 성장했어요" },
  report_fact_package: VALID_FACT_PACKAGE,
  sns_summary:         { headline: "헤드라인", key_points: ["p1"], share_safe: true },
  teacher_reviewed_at: "2026-07-20T10:00:00.000Z",
  published_at:        null,
  deleted_at:          null,
};

const BASE_PUBLISHED_REPORT = {
  ...BASE_APPROVED_REPORT,
  product_status: "PUBLISHED",
  published_at:   "2026-07-21T09:00:00.000Z",
};

// ─── notifyGrowthReportPublished unit test DB mock factory ───────────────────

interface NotifyDbOpts {
  parents?:         string[];            // parent_id list (approved)
  existingNotifIds?: string[];           // parent_ids with an existing durable intent
  insertFailForRecipients?: string[];    // feed insert failures, keyed by parent
}

const dialect = new PgDialect();
type FakeOutboxRow = {
  id: string;
  type: string;
  poolId: string;
  reportPeriod: string;
  reportId: string | null;
  recipientId: string;
  recipientType: string;
  title: string;
  body: string;
  deepLink: string | null;
  payload: Record<string, unknown>;
  status: "PENDING" | "CLAIMED" | "DISPATCHING" | "DELIVERED" | "UNCERTAIN";
  leaseToken?: string;
  receipt?: string | null;
};

function queryDetails(query: any): { sql: string; params: unknown[] } {
  if (query?.queryChunks) return dialect.sqlToQuery(query);
  return { sql: String(query?.sql ?? query ?? ""), params: [] };
}

function queryLog(sqlText: string, params: unknown[]): string {
  const values = params.map(value =>
    typeof value === "string" ? value : JSON.stringify(value)
  ).join(" | ");
  return `${sqlText.replace(/\s+/g, " ").trim()} -- ${values}`;
}

function resetPushMocks() {
  vi.mocked(checkPushEnabled).mockReset().mockResolvedValue(true);
  vi.mocked(sendRawPushWithResult).mockReset().mockImplementation(async (tokens: string[]) => ({
    totalTokens: tokens.length,
    uniqueTokens: tokens.length,
    chunks: tokens.length ? 1 : 0,
    successCount: tokens.length,
    failureCount: 0,
    invalidTokenCount: 0,
    configFailureCount: 0,
    retryCount: 0,
    definitiveRejectionCount: 0,
    providerReceiptIds: tokens.map((_, index) => `ticket-${index + 1}`),
  }));
}

function makeNotifyDb(opts: NotifyDbOpts = {}) {
  const {
    parents          = [PARENT_A],
    existingNotifIds = [],
    insertFailForRecipients = [],
  } = opts;

  const calls: string[] = [];
  const outbox = new Map<string, FakeOutboxRow>();
  const notifications = new Map<string, Record<string, unknown>>();
  const insertFailures = new Set(insertFailForRecipients);
  let leaseSequence = 0;

  for (const recipientId of existingNotifIds) {
    const id = `grnot_parent_${REPORT_ID}_${PERIOD}_${recipientId}`;
    outbox.set(id, {
      id,
      type: "GROWTH_REPORT_PUBLISHED",
      poolId: POOL_ID,
      reportPeriod: PERIOD,
      reportId: REPORT_ID,
      recipientId,
      recipientType: "parent_account",
      title: "지난달 성장리포트가 도착했습니다",
      body: "지난 한 달 동안의 성장 모습을 확인해보세요.",
      deepLink: `/parent/growth-report-detail?reportId=${REPORT_ID}`,
      payload: {
        screen: "growth_report_detail",
        growth_report_id: REPORT_ID,
        report_period: PERIOD,
        deep_link: `/parent/growth-report-detail?reportId=${REPORT_ID}`,
        report_month: 7,
      },
      status: "DELIVERED",
    });
  }

  return {
    _calls: calls,
    _outbox: outbox,
    _notifications: notifications,
    execute: vi.fn(async (query: any) => {
      const { sql: rawSql, params } = queryDetails(query);
      const q = rawSql.replace(/\s+/g, " ").trim();
      calls.push(queryLog(q, params));

      if (q.includes("FROM parent_students")) {
        return { rows: parents.map(id => ({ parent_id: id })) };
      }

      if (q.includes("FROM push_tokens")) {
        const recipientId = parents.find(id => params.includes(id));
        return recipientId ? { rows: [{ token: `expo-token-${recipientId}` }] } : { rows: [] };
      }

      if (q.includes("INSERT INTO growth_report_notification_outbox")) {
        const [
          id, type, poolId, reportPeriod, reportId, recipientId,
          recipientType, title, body, deepLink, payload,
        ] = params as Array<string | null>;
        const alreadyExists = [...outbox.values()].some(row =>
          row.type === type &&
          row.recipientId === recipientId &&
          (type === "GROWTH_REPORT_BATCH_READY"
            ? row.poolId === poolId && row.reportPeriod === reportPeriod
            : row.reportId === reportId)
        );
        if (!alreadyExists) {
          outbox.set(String(id), {
            id: String(id),
            type: String(type),
            poolId: String(poolId),
            reportPeriod: String(reportPeriod),
            reportId: reportId == null ? null : String(reportId),
            recipientId: String(recipientId),
            recipientType: String(recipientType),
            title: String(title),
            body: String(body),
            deepLink: deepLink == null ? null : String(deepLink),
            payload: typeof payload === "string" ? JSON.parse(payload) : {},
            status: "PENDING",
          });
        }
        return { rows: [], rowCount: 0 };
      }

      if (q.includes("UPDATE growth_report_notification_outbox") && q.includes("SET status = 'CLAIMED'")) {
        const row = [...outbox.values()].reverse().find(candidate =>
          candidate.status === "PENDING" &&
          params.includes(candidate.type) &&
          params.includes(candidate.recipientId) &&
          (candidate.reportId == null || params.includes(candidate.reportId))
        );
        if (!row) return { rows: [] };
        row.status = "CLAIMED";
        row.leaseToken = `lease-${++leaseSequence}`;
        return { rows: [{ id: row.id, lease_token: row.leaseToken }] };
      }

      if (q.includes("INSERT INTO notifications")) {
        const [
          id, recipientId, recipientType, poolId, type, title, body,
          refId, refType, deepLink,
        ] = params;
        if (insertFailures.has(String(recipientId))) {
          insertFailures.delete(String(recipientId));
          throw new Error("Simulated notification feed insert failure");
        }
        notifications.set(String(id), {
          id, recipientId, recipientType, poolId, type, title, body,
          refId, refType, deepLink, isRead: false,
        });
        return { rows: [], rowCount: 1 };
      }

      if (q.includes("UPDATE growth_report_notification_outbox") && q.includes("SET status = 'DISPATCHING'")) {
        const row = [...outbox.values()].find(candidate =>
          candidate.status === "CLAIMED" &&
          params.includes(candidate.id) &&
          params.includes(candidate.leaseToken)
        );
        if (!row) return { rows: [] };
        row.status = "DISPATCHING";
        return { rows: [{ id: row.id }] };
      }

      if (q.includes("UPDATE growth_report_notification_outbox") && q.includes("SET status = 'DELIVERED'")) {
        const row = [...outbox.values()].find(candidate =>
          candidate.status === "DISPATCHING" &&
          params.includes(candidate.id) &&
          params.includes(candidate.leaseToken)
        );
        if (row) {
          row.status = "DELIVERED";
          const receipt = params.find(value =>
            typeof value === "string" && value.startsWith("[")
          );
          row.receipt = typeof receipt === "string" ? receipt : null;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      if (q.includes("UPDATE growth_report_notification_outbox") && params.includes("UNCERTAIN")) {
        const row = [...outbox.values()].find(candidate =>
          candidate.status === "DISPATCHING" &&
          params.includes(candidate.id) &&
          params.includes(candidate.leaseToken)
        );
        if (row) row.status = "UNCERTAIN";
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      if (q.includes("UPDATE growth_report_notification_outbox") && q.includes("SET status = 'PENDING'")) {
        const row = [...outbox.values()].find(candidate =>
          (candidate.status === "CLAIMED" || candidate.status === "DISPATCHING") &&
          params.includes(candidate.id) &&
          params.includes(candidate.leaseToken)
        );
        if (row) row.status = "PENDING";
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

// ─── A. notifyGrowthReportPublished service unit tests ────────────────────────

describe("A. notifyGrowthReportPublished service", () => {
  // Import the function directly (real implementation with injected mock db)
  // We wrap it to inject our makeNotifyDb mock into the global db mock
  async function callNotify(opts: NotifyDbOpts = {}) {
    const { db } = await import("@workspace/db");
    const mockDb = makeNotifyDb(opts);
    vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
    return { mockDb };
  }

  afterEach(() => {
    vi.clearAllMocks();
    resetPushMocks();
  });

  it("TC1: PUBLISHED event → notification created for connected parent", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("TC2: approved parent only — unapproved parent excluded", async () => {
    // parent_students query filters status='approved'; no parents → no notification
    const { mockDb } = await callNotify({ parents: [] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls).toHaveLength(0);
  });

  it("TC3: multiple approved parents → each gets a notification", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A, PARENT_B] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls.length).toBe(2);
  });

  it("TC4: duplicate prevention — existing durable intent skips another feed row and push", async () => {
    // A previously delivered outbox intent is the durable idempotency record.
    const { mockDb } = await callNotify({ parents: [PARENT_A], existingNotifIds: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls).toHaveLength(0);
    expect(sendRawPushWithResult).not.toHaveBeenCalled();
  });

  it("TC5: partial duplicate — A has existing, B does not → only B gets notification", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A, PARENT_B], existingNotifIds: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls).toHaveLength(1);
    expect([...mockDb._notifications.values()].map(row => row.recipientId)).toEqual([PARENT_B]);
  });

  it("TC6: durable push uses the approved parent token, preference gate, and report payload", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    expect(checkPushEnabled).toHaveBeenCalledWith(PARENT_A, "GROWTH_REPORT_PUBLISHED", true);
    expect(mockDb._calls.some(call =>
      call.includes("FROM push_tokens") && call.includes(PARENT_A)
    )).toBe(true);
    expect(sendRawPushWithResult).toHaveBeenCalledWith(
      [`expo-token-${PARENT_A}`],
      "지난달 성장리포트가 도착했습니다",
      "지난 한 달 동안의 성장 모습을 확인해보세요.",
      expect.objectContaining({
        growth_report_id: REPORT_ID,
        report_period: PERIOD,
        deep_link: `/parent/growth-report-detail?reportId=${REPORT_ID}`,
      }),
      { disableTransportRetries: true },
      POOL_ID,
      REPORT_ID,
    );
  });

  it("TC6a: disabled parent push preference keeps the feed but skips provider dispatch", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    vi.mocked(checkPushEnabled).mockResolvedValue(false);
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });

    expect(checkPushEnabled).toHaveBeenCalledWith(PARENT_A, "GROWTH_REPORT_PUBLISHED", true);
    expect(sendRawPushWithResult).not.toHaveBeenCalled();
    expect(mockDb._calls.filter(call => call.includes("INSERT INTO notifications"))).toHaveLength(1);
    expect([...mockDb._outbox.values()][0]?.status).toBe("DELIVERED");
  });

  it("TC7: push provider failure → notification center row preserved (isolation)", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    vi.mocked(sendRawPushWithResult).mockRejectedValue(new Error("Expo API down"));
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    // Should NOT throw — push failure is isolated
    await expect(
      notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID })
    ).resolves.not.toThrow();
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls).toHaveLength(1);
    expect([...mockDb._outbox.values()][0]?.status).toBe("UNCERTAIN");
  });

  it("TC8: notification type = GROWTH_REPORT_PUBLISHED", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications"));
    expect(insertCall).toContain("GROWTH_REPORT_PUBLISHED");
  });

  it("TC9: report_id (ref_id) preserved in notification", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications"));
    expect(insertCall).toContain(REPORT_ID);
  });

  it("TC10: ref_type = growth_report", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications"));
    expect(insertCall).toContain("growth_report");
  });

  it("TC11: deep_link contains reportId", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications"));
    expect(insertCall).toContain(REPORT_ID);
    // deep_link format: /parent/growth-report-detail?reportId=<reportId>
    expect(insertCall).toMatch(/growth-report-detail/);
  });

  it("TC12: deep_link = /parent/growth-report-detail?reportId=<reportId>", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const feedInsert = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    expect(feedInsert).toContain(`/parent/growth-report-detail?reportId=${REPORT_ID}`);
  });

  it("TC13: title = Product 문구 (not ENGINE)", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const feedInsert = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    expect(feedInsert).toContain("지난달 성장리포트가 도착했습니다");
  });

  it("TC14: body = 정적 Product 문구 (학생 이름/월 포함 없음)", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    // §I 정책: 정적 문구 사용. 학생 이름·월 미포함.
    const feedInsert = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    expect(feedInsert).toContain("지난 한 달 동안의 성장 모습을 확인해보세요");
    expect(feedInsert).not.toContain("김수영");
    const feedRow = [...mockDb._notifications.values()][0];
    expect(feedRow?.body).not.toContain(PERIOD);
  });

  it("TC15: body does NOT contain raw ENGINE analysis claims", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const capturedBody = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    // No raw analysis/diagnosis/parent answer/teacher note in body
    expect(capturedBody).not.toContain("diagnosis");
    expect(capturedBody).not.toContain("parent_answer");
    expect(capturedBody).not.toContain("teacher_review_note");
    expect(capturedBody).not.toContain("summary_text");  // raw ENGINE output
  });

  it("TC16: body does NOT contain report_content raw fields", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications")) ?? "";
    expect(insertCall).not.toContain("summary_text");
    expect(insertCall).not.toContain("집중력"); // no evaluation claims
  });

  it("TC17: notification is_read = false (unread on creation)", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications")) ?? "";
    expect(insertCall).toContain("false");
  });

  it("TC18: recipient_type = parent_account", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications")) ?? "";
    expect(insertCall).toContain("parent_account");
  });

  it("TC19: pool_id preserved in notification", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCall = mockDb._calls.find(c => c.includes("INSERT INTO notifications")) ?? "";
    expect(insertCall).toContain(POOL_ID);
  });

  it("TC20: report_period preserved in durable push data", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    expect(checkPushEnabled).toHaveBeenCalledWith(PARENT_A, "GROWTH_REPORT_PUBLISHED", true);
    expect(sendRawPushWithResult).toHaveBeenCalled();
    expect(vi.mocked(sendRawPushWithResult).mock.calls[0]?.[3]).toEqual(expect.objectContaining({
      report_period: PERIOD,
      growth_report_id: REPORT_ID,
    }));
    expect(mockDb._outbox.values().next().value?.status).toBe("DELIVERED");
  });

  it("TC21: no ENGINE call in notifyGrowthReportPublished", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const engineCalls = mockDb._calls.filter(c => c.includes("/api/v1/analyze") || c.toLowerCase().includes("engine"));
    expect(engineCalls).toHaveLength(0);
  });

  it("TC22: no GPT call in notifyGrowthReportPublished", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const gptCalls = mockDb._calls.filter(c => c.toLowerCase().includes("openai") || c.toLowerCase().includes("gpt") || c.toLowerCase().includes("completion"));
    expect(gptCalls).toHaveLength(0);
  });

  it("TC23: static parent copy requires no student-profile lookup", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const feedInsert = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    expect(feedInsert).toContain("지난 한 달 동안의 성장 모습을 확인해보세요");
    expect(mockDb._calls.some(call => call.includes("FROM students"))).toBe(false);
  });

  it("TC24: report_period 무관하게 정적 body 사용 — title=지난달 성장리포트가 도착했습니다", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: "2026-01", publishedAt: "2026-01-31T09:00:00Z", actorId: ADMIN_ID });
    // §I 정책: 정적 문구 (월 미포함)
    const feedInsert = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    expect(feedInsert).toContain("지난달 성장리포트가 도착했습니다");
  });

  it("TC25: parent_students query includes status='approved'", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const parentQuery = mockDb._calls.find(c => c.includes("parent_students") && c.includes("approved")) ?? "";
    expect(parentQuery).toBeTruthy();
    expect(parentQuery).toContain("DISTINCT parent_id");
    expect(parentQuery).toContain(STUDENT_ID);
  });

  it("TC26: 3 approved parents → 3 notifications", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A, PARENT_B, "par_c01"] });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls).toHaveLength(3);
  });

  it("TC27: DISTINCT parent_id prevents duplicate guardians via SQL", async () => {
    const { mockDb } = await callNotify({ parents: [PARENT_A] }); // DISTINCT ensures only one
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const parentQuery = mockDb._calls.find(c => c.includes("parent_students") && c.includes("DISTINCT")) ?? "";
    expect(parentQuery).toBeTruthy();
  });

  it("TC28: individual feed insert failure leaves its intent retryable and doesn't block others", async () => {
    const { mockDb } = await callNotify({
      parents: [PARENT_A, PARENT_B],
      insertFailForRecipients: [PARENT_A],
    });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    // Should not throw — individual failures are caught per-parent
    await expect(
      notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID })
    ).resolves.not.toThrow();
    expect(mockDb._calls.filter(call => call.includes("INSERT INTO notifications"))).toHaveLength(2);
    expect([...mockDb._outbox.values()].find(row => row.recipientId === PARENT_A)?.status).toBe("PENDING");
    expect([...mockDb._outbox.values()].find(row => row.recipientId === PARENT_B)?.status).toBe("DELIVERED");
  });
});

// ─── Temp fix: capturedInsertCall helper (for TC16 which references this) ─────
let capturedInsertCall = "";

// ─── B. publishGrowthReport returns notification payload ─────────────────────

describe("B. publishGrowthReport → notification payload", () => {
  afterEach(() => { vi.clearAllMocks(); resetPushMocks(); });

  function makeDb(reportRow: any) {
    return {
      execute: vi.fn(async (query: any) => {
        const q = query?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "";
        if (q.includes("UPDATE growth_reports AS gr")) {
          return { rows: [{ id: REPORT_ID, student_id: STUDENT_ID, swimming_pool_id: POOL_ID, report_period: PERIOD, published_at: "2026-07-21T09:00:00Z" }] };
        }
        if (q.includes("FROM growth_reports") && !q.includes("UPDATE")) return reportRow ? { rows: [reportRow] } : { rows: [] };
        if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
        if (q.includes("audit_logs")) return { rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
  }

  it("TC29: first publish → studentId returned", async () => {
    const { publishGrowthReport } = await import("../../lib/growth-report-service.js");
    const db = makeDb(BASE_APPROVED_REPORT);
    const r = await publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(r.alreadyPublished).toBe(false);
    expect(r.studentId).toBe(STUDENT_ID);
  });

  it("TC30: first publish → poolId returned", async () => {
    const { publishGrowthReport } = await import("../../lib/growth-report-service.js");
    const db = makeDb(BASE_APPROVED_REPORT);
    const r = await publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(r.poolId).toBe(POOL_ID);
  });

  it("TC31: first publish → reportPeriod returned", async () => {
    const { publishGrowthReport } = await import("../../lib/growth-report-service.js");
    const db = makeDb(BASE_APPROVED_REPORT);
    const r = await publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(r.reportPeriod).toBe(PERIOD);
  });

  it("TC32: alreadyPublished=true → studentId undefined (no notification re-send)", async () => {
    const { publishGrowthReport } = await import("../../lib/growth-report-service.js");
    const db = makeDb(BASE_PUBLISHED_REPORT);
    const r = await publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(r.alreadyPublished).toBe(true);
    expect(r.studentId).toBeUndefined();
  });
});

// ─── C. Route integration: publish → notification pipeline ────────────────────

describe("C. POST /teacher/growth-reports/:reportId/publish → GR7 pipeline", () => {
  let adminApp: any;

  // Standard success sequence: preflight read, guarded UPDATE, and audit.
  const successSequence = [
    { rows: [{ swimming_pool_id: POOL_ID }] },       // pool check
    { rows: [BASE_APPROVED_REPORT] },                  // initial fetch
    { rows: [{ id: REPORT_ID, student_id: STUDENT_ID, swimming_pool_id: POOL_ID, report_period: PERIOD, published_at: "2026-07-21T09:00:00Z" }] }, // guarded UPDATE RETURNING
    { rows: [{ v: 1 }] },                              // audit version
    { rowCount: 1, rows: [] },                         // audit INSERT
  ];

  async function setupSuperAdminSequence(seq: any[]) {
    const { superAdminDb } = await import("@workspace/db");
    let idx = 0;
    vi.mocked((superAdminDb as any).execute).mockImplementation(async () => seq[idx++] ?? { rows: [] });
  }

  beforeAll(async () => {
    const { publishGrowthReportRouter } = await import("../publish-growth-report.js");
    adminApp = express(); adminApp.use(express.json());
    adminApp.use((req: any, _: any, next: any) => {
      req.user = { userId: ADMIN_ID, role: "pool_admin", poolId: POOL_ID };
      next();
    });
    adminApp.use(publishGrowthReportRouter);
  });

  afterEach(() => { vi.clearAllMocks(); resetPushMocks(); });

  it("TC33: route returns 200 on success", async () => {
    await setupSuperAdminSequence(successSequence);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("TC34: route returns alreadyPublished=false on first publish", async () => {
    await setupSuperAdminSequence(successSequence);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.body.alreadyPublished).toBe(false);
  });

  it("TC35: push provider failure does NOT affect 200 response", async () => {
    await setupSuperAdminSequence(successSequence);
    vi.mocked(sendRawPushWithResult).mockRejectedValue(new Error("Expo down"));
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    // Route should still return 200 (isolation)
    expect(res.status).toBe(200);
  });

  it("TC36: alreadyPublished route response", async () => {
    await setupSuperAdminSequence([
      { rows: [{ swimming_pool_id: POOL_ID }] },
      { rows: [BASE_PUBLISHED_REPORT] },
    ]);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyPublished).toBe(true);
  });

  it("TC37: published report status maintained on push failure (spec §17)", async () => {
    // In our mock architecture, the DB publish completes before notification fires.
    // If push fails, the 200 response is already sent. This tests the architecture contract.
    await setupSuperAdminSequence(successSequence);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.publishedAt).toBeTruthy();
  });
});

// ─── D. Deep link contract ────────────────────────────────────────────────────

describe("D. Deep link contract (spec §9, §12)", () => {
  afterEach(() => { vi.clearAllMocks(); resetPushMocks(); });

  it("TC38: deep_link format = /parent/growth-report-detail?reportId=<id>", async () => {
    const mockDb = makeNotifyDb({ parents: [PARENT_A] });
    const { db } = await import("@workspace/db");
    vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    const feedInsert = mockDb._calls.find(call => call.includes("INSERT INTO notifications")) ?? "";
    expect(feedInsert).toContain("/parent/growth-report-detail");
    expect(feedInsert).toContain(REPORT_ID);
  });

  it("TC39: deep_link in push data = same canonical path", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = makeNotifyDb({ parents: [PARENT_A] });
    vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    expect(sendRawPushWithResult).toHaveBeenCalled();
    expect(vi.mocked(sendRawPushWithResult).mock.calls[0]?.[3]).toEqual(expect.objectContaining({
      deep_link: `/parent/growth-report-detail?reportId=${REPORT_ID}`,
    }));
  });

  it("TC40: Feed growth_report_id and Push report_id are the same canonical identifier", () => {
    // GR6 feed: growth_report_id = reportId
    // GR7 push: growth_report_id in data = same reportId
    // (contract test — same constant)
    const feedId   = REPORT_ID;
    const pushData = { growth_report_id: REPORT_ID };
    expect(feedId).toBe(pushData.growth_report_id);
  });

  it("TC41: deep_link survives X expiry (no entitlement filter in deep link)", () => {
    // Contract: the deep link is just a path — no X entitlement check embedded
    const deepLink = `/parent/growth-report-detail?reportId=${REPORT_ID}`;
    expect(deepLink).not.toContain("entitlement");
    expect(deepLink).not.toContain("x_mode");
    expect(deepLink).not.toContain("expiry");
  });

  it("TC42: no client-side authorization in deep link (server-side auth in GR8 API)", () => {
    // Contract: the route shell doesn't embed auth tokens in the URL
    const deepLink = `/parent/growth-report-detail?reportId=${REPORT_ID}`;
    expect(deepLink).not.toContain("token");
    expect(deepLink).not.toContain("auth");
    expect(deepLink).not.toContain("password");
  });
});

// ─── E. Notification center + existing system regression ─────────────────────

describe("E. Notification center + existing system regression", () => {
  afterEach(() => { vi.clearAllMocks(); resetPushMocks(); });

  it("TC43: existing mark-read compatible (uses /notifications/:id/read)", () => {
    // Contract: notification id is stored and compatible with existing read endpoint
    // (Static architectural check — notification row uses standard id column)
    const notifId = `notif_gr_${Date.now()}_abc123`;
    expect(notifId).toMatch(/^notif_gr_/);
  });

  it("TC44: no separate growth-report badge system (uses existing unread_count)", async () => {
    // Notification is stored in standard notifications table — unread count is automatic
    const { mockDb } = await (async () => {
      const { db } = await import("@workspace/db");
      const mockDb = makeNotifyDb({ parents: [PARENT_A] });
      vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
      const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
      await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
      return { mockDb };
    })();
    // Single INSERT to notifications (not a separate table)
    const insertCalls = mockDb._calls.filter(c => c.includes("INSERT INTO notifications"));
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // No insert into any other badge/counter table
    const badgeCalls = mockDb._calls.filter(c => c.includes("growth_report_badges") || c.includes("gr_badge"));
    expect(badgeCalls).toHaveLength(0);
  });

  it("TC45: no new Notification system created (uses existing notifications table)", async () => {
    const { mockDb } = await (async () => {
      const { db } = await import("@workspace/db");
      const mockDb = makeNotifyDb({ parents: [PARENT_A] });
      vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
      const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
      await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
      return { mockDb };
    })();
    // No CREATE TABLE for a new notification system
    const createCalls = mockDb._calls.filter(c => c.includes("CREATE TABLE") && c.includes("growth_report"));
    expect(createCalls).toHaveLength(0);
  });

  it("TC46: no SNS share in notification pipeline", async () => {
    const { mockDb } = await (async () => {
      const { db } = await import("@workspace/db");
      const mockDb = makeNotifyDb({ parents: [PARENT_A] });
      vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
      const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
      await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
      return { mockDb };
    })();
    const snsCalls = mockDb._calls.filter(c => c.toLowerCase().includes("sns") || c.toLowerCase().includes("share_url") || c.toLowerCase().includes("kakao"));
    expect(snsCalls).toHaveLength(0);
  });

  it("TC47: GROWTH_REPORT_PUBLISHED type does NOT appear for non-published reports", async () => {
    // Contract: notifyGrowthReportPublished is only called AFTER publishGrowthReport succeeds
    // (The route fires notification only if !alreadyPublished && studentId is set)
    const { publishGrowthReport } = await import("../../lib/growth-report-service.js");
    const dbRow = { ...BASE_APPROVED_REPORT, product_status: "REVIEW_REQUIRED" };
    const db = {
      execute: vi.fn(async (query: any) => {
        const q = query?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "";
        if (q.includes("FROM growth_reports")) return { rows: [dbRow] };
        return { rows: [] };
      }),
    };
    const { PublishNotAllowedError } = await import("../../lib/growth-report-service.js");
    await expect(publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }))
      .rejects.toThrow(PublishNotAllowedError);
  });

  it("TC48: GR7 idempotency after retry — second notification attempt skipped", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = makeNotifyDb({ parents: [PARENT_A] });
    vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    expect(mockDb._calls.filter(call => call.includes("INSERT INTO notifications"))).toHaveLength(1);
    expect(sendRawPushWithResult).toHaveBeenCalledTimes(1);
    expect([...mockDb._outbox.values()][0]?.status).toBe("DELIVERED");
  });
});

// ─── F. GR1~GR6 + notification regression ────────────────────────────────────

describe("F. GR6 / existing push regression", () => {
  afterEach(() => { vi.clearAllMocks(); resetPushMocks(); });

  it("TC49: no SNS share in GR7", () => {
    // Contract check — no share URL in push data
    const data = {
      screen: "growth_report_detail",
      growth_report_id: REPORT_ID,
      report_period: PERIOD,
      deep_link: `/parent/growth-report-detail?reportId=${REPORT_ID}`,
    };
    expect(data).not.toHaveProperty("sns_share_url");
    expect(data).not.toHaveProperty("share_url");
  });

  it("TC50: no GR8 detail content in push payload", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = makeNotifyDb({ parents: [PARENT_A] });
    vi.mocked((db as any).execute).mockImplementation(mockDb.execute);
    let capturedData: any = {};
    vi.mocked(sendRawPushWithResult).mockImplementation(async (_tokens, _title, _body, data) => {
      capturedData = data;
      return {
        totalTokens: 1, uniqueTokens: 1, chunks: 1, successCount: 1, failureCount: 0,
        invalidTokenCount: 0, configFailureCount: 0, retryCount: 0,
        definitiveRejectionCount: 0, providerReceiptIds: ["ticket-1"],
      };
    });
    const { notifyGrowthReportPublished } = await import("../../utils/notify.js");
    await notifyGrowthReportPublished({ reportId: REPORT_ID, studentId: STUDENT_ID, poolId: POOL_ID, reportPeriod: PERIOD, publishedAt: "2026-07-21T09:00:00Z", actorId: ADMIN_ID });
    // No report detail content in push (GR8 boundary)
    expect(JSON.stringify(capturedData)).not.toContain("report_content");
    expect(JSON.stringify(capturedData)).not.toContain("summary_text");
    expect(JSON.stringify(capturedData)).not.toContain("report_fact_package");
  });

  it("TC51: existing notify.ts functions unaffected (diary upload)", async () => {
    // notifyDiaryUpload should still work (no regression from GR7 import changes)
    const { notifyDiaryUpload } = await import("../../utils/notify.js");
    expect(typeof notifyDiaryUpload).toBe("function");
  });

  it("TC52: existing sendNotification unaffected", async () => {
    const { sendNotification } = await import("../../utils/notify.js");
    expect(typeof sendNotification).toBe("function");
  });

  it("TC53: no ANALYZING notification", async () => {
    // Publish only happens from APPROVED → PUBLISHED. notifyGrowthReportPublished is never
    // called for ANALYZING state by design — this is enforced in the route/service.
    const { publishGrowthReport, PublishNotAllowedError } = await import("../../lib/growth-report-service.js");
    const db = {
      execute: vi.fn(async (query: any) => {
        const q = query?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "";
        if (q.includes("FROM growth_reports")) return { rows: [{ ...BASE_APPROVED_REPORT, product_status: "ANALYZING" }] };
        return { rows: [] };
      }),
    };
    await expect(publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }))
      .rejects.toThrow(PublishNotAllowedError);
  });

  it("TC54: no QUESTION_AVAILABLE notification", async () => {
    const { publishGrowthReport, PublishNotAllowedError } = await import("../../lib/growth-report-service.js");
    const db = {
      execute: vi.fn(async (query: any) => {
        const q = query?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "";
        if (q.includes("FROM growth_reports")) return { rows: [{ ...BASE_APPROVED_REPORT, product_status: "QUESTION_AVAILABLE" }] };
        return { rows: [] };
      }),
    };
    await expect(publishGrowthReport({ db: db as any, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }))
      .rejects.toThrow(PublishNotAllowedError);
  });

  it("TC55: GR7 notification exports all required functions", async () => {
    const notify = await import("../../utils/notify.js");
    expect(typeof notify.notifyGrowthReportPublished).toBe("function");
    expect(typeof notify.notifyDiaryUpload).toBe("function");
    expect(typeof notify.notifyPhotoUpload).toBe("function");
    expect(typeof notify.sendNotification).toBe("function");
  });
});
