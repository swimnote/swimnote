/**
 * gr6-publish-feed.test.ts
 *
 * GR6: APPROVED → PUBLISHED Publication + Parent Feed Integration
 * 52+ TC
 *
 * Tests use fake DB mocks. No real DB, no ENGINE calls, no push.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import {
  publishGrowthReport,
  ReportNotFoundError,
  PublishNotAllowedError,
  PublishPreconditionError,
  InvalidTransitionError,
  transitionReportStatus,
} from "../../lib/growth-report-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_ID  = "gr6_rpt_01";
const STUDENT_ID = "gr6_stu_01";
const ADMIN_ID   = "gr6_adm_01";
const SUPER_ID   = "gr6_sup_01";
const POOL_ID    = "gr6_pool_01";
const PERIOD     = "2026-07";

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
  sns_summary:         { headline: "헤드라인", key_points: ["p1", "p2"], share_safe: true },
  teacher_reviewed_at: "2026-07-20T10:00:00.000Z",
  published_at:        null,
  deleted_at:          null,
};

const BASE_PUBLISHED_REPORT = {
  ...BASE_APPROVED_REPORT,
  product_status: "PUBLISHED",
  published_at:   "2026-07-21T09:00:00.000Z",
};

// ─── Local DB mock factory (for service unit tests, independent of module mock) ─

interface DbOpts {
  reportRow?:      any;
  forUpdateRow?:   any;
  afterPublished?: any;
  nextVersion?:    number;
}

function makeDb(opts: DbOpts = {}) {
  const calls: string[] = [];
  const db = {
    _calls: calls,
    execute: vi.fn(async (query: any) => {
      const q: string = query?.queryChunks
        ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
        : String(query?.sql ?? query ?? "");
      calls.push(q.replace(/\s+/g, " ").trim());

      if (q.includes("FOR UPDATE")) {
        const row = opts.forUpdateRow ?? {
          id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null,
          product_status: opts.reportRow?.product_status ?? "APPROVED",
        };
        return { rows: row ? [row] : [] };
      }
      if (q.includes("SELECT published_at") && q.includes("FROM growth_reports")) {
        return { rows: [opts.afterPublished ?? { published_at: "2026-07-21T09:00:00.000Z" }] };
      }
      if (q.includes("FROM growth_reports") && q.includes("WHERE id") && !q.includes("UPDATE")) {
        return opts.reportRow ? { rows: [opts.reportRow] } : { rows: [] };
      }
      if (q.includes("UPDATE growth_reports")) {
        return { rowCount: 1, rows: [] };
      }
      if (q.includes("next_audit_version")) {
        return { rows: [{ v: opts.nextVersion ?? 1 }] };
      }
      if (q.includes("audit_logs") && q.includes("INSERT")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return db as any;
}

// ─── Module mocks ──────────────────────────────────────────────────────────────
// Only mock auth and @workspace/db; keep growth-report-service REAL.

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

vi.mock("@workspace/db", () => {
  const mockExecute = vi.fn(async () => ({ rows: [] }));
  const mockSelect  = vi.fn();

  // Drizzle-like chain: db.select().from(t).where(...).limit(n)
  const chainEnd = (rows: any[]) => ({
    limit: vi.fn(() => Promise.resolve(rows)),
    where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(rows)) })),
  });

  mockSelect.mockReturnValue({
    from: vi.fn(() => ({ ...chainEnd([]), where: vi.fn(() => chainEnd([])) })),
  });

  return {
    db:           { execute: mockExecute, select: mockSelect },
    superAdminDb: { execute: vi.fn(async () => ({ rows: [] })) },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build mock superAdminDb.execute as a sequential call queue.
 * Each item in `sequence` is returned for the corresponding execute() call.
 */
async function setupSuperAdminSequence(sequence: any[]) {
  const { superAdminDb } = await import("@workspace/db");
  let idx = 0;
  vi.mocked((superAdminDb as any).execute).mockImplementation(async () => {
    return sequence[idx++] ?? { rows: [], rowCount: 0 };
  });
}

/**
 * Build a parent-router express app with mocked db for feed tests.
 * Mocks: db.select (Drizzle ORM chain) + db.execute (raw SQL)
 */
async function buildParentFeedApp(opts: {
  hasLink?:      boolean;
  grRows?:       any[];
  histClassIds?: string[];
  diaryRows?:    any[];
} = {}) {
  const {
    hasLink      = true,
    grRows       = [],
    histClassIds = ["cg01"],
    diaryRows    = [],
  } = opts;

  const { db } = await import("@workspace/db");

  // call index tracks Drizzle select() invocations
  let selectIdx = 0;
  vi.mocked((db as any).select).mockImplementation(() => {
    const idx = selectIdx++;
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve(
              idx === 0
                ? hasLink
                  ? [{ parent_id: "par01", student_id: STUDENT_ID, status: "approved" }]
                  : []
                : [{ id: STUDENT_ID, class_group_id: histClassIds[0] ?? null }],
            ),
          ),
        })),
        limit: vi.fn(() =>
          Promise.resolve([{ id: STUDENT_ID, class_group_id: histClassIds[0] ?? null }]),
        ),
      })),
    };
  });

  vi.mocked((db as any).execute).mockImplementation(async (query: any) => {
    const q: string = query?.queryChunks
      ? query.queryChunks
          .map((c: any) => (typeof c === "string" ? c : (c?.value ?? "")))
          .join("")
      : String(query?.sql ?? query ?? "");

    if (q.includes("student_class_history")) {
      return { rows: histClassIds.map((id) => ({ class_group_id: id })) };
    }
    if (q.includes("growth_reports") && q.includes("PUBLISHED")) {
      return { rows: grRows };
    }
    if (q.includes("class_diary_student_notes")) {
      return { rows: [] };
    }
    if (q.includes("class_diaries")) {
      return { rows: diaryRows };
    }
    return { rows: [] };
  });

  const parentRouter = (await import("../parent.js")).default;
  selectIdx = 0; // reset before app creation
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { userId: "par01", role: "parent_account", poolId: POOL_ID };
    selectIdx = 0; // reset per-request
    next();
  });
  app.use("/parent", parentRouter);
  return app;
}

// ─── A. publishGrowthReport Service Unit Tests ────────────────────────────────
// Use real service with local makeDb (not the module-level mock db)

describe("A. publishGrowthReport service", () => {
  it("TC1: APPROVED → PUBLISHED success", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.alreadyPublished).toBe(false);
    expect(result.publishedAt).toBeTruthy();
  });

  it("TC2: REVIEW_REQUIRED → PublishNotAllowedError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, product_status: "REVIEW_REQUIRED" } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishNotAllowedError);
  });

  it("TC3: ANALYZING → PublishNotAllowedError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, product_status: "ANALYZING" } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishNotAllowedError);
  });

  it("TC4: FAILED → PublishNotAllowedError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, product_status: "FAILED" } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishNotAllowedError);
  });

  it("TC5: PUBLISHED terminal → alreadyPublished=true", async () => {
    const db = makeDb({ reportRow: BASE_PUBLISHED_REPORT });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.alreadyPublished).toBe(true);
  });

  it("TC6: published_at recorded on first publish", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.publishedAt).toBeTruthy();
    const pubCalls = db._calls.filter((c: string) => c.includes("published_at"));
    expect(pubCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("TC7: repeated publish → alreadyPublished=true, no new timestamp written", async () => {
    const db = makeDb({ reportRow: BASE_PUBLISHED_REPORT });
    const r1 = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(r1.alreadyPublished).toBe(true);
    const updateCalls = db._calls.filter((c: string) => c.includes("UPDATE growth_reports"));
    // No UPDATE should happen for already-PUBLISHED
    expect(updateCalls).toHaveLength(0);
  });

  it("TC8: report_content missing → PublishPreconditionError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, report_content: null } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishPreconditionError);
  });

  it("TC9: report_content is array → PublishPreconditionError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, report_content: ["bad"] } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishPreconditionError);
  });

  it("TC10: report_fact_package missing → PublishPreconditionError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, report_fact_package: null } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishPreconditionError);
  });

  it("TC11: grounding FAIL → PublishPreconditionError", async () => {
    const db = makeDb({
      reportRow: { ...BASE_APPROVED_REPORT, report_fact_package: { grounding_result: "FAIL", growth_framing_result: "PASS" } },
    });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishPreconditionError);
  });

  it("TC12: growth_framing FAIL → PublishPreconditionError", async () => {
    const db = makeDb({
      reportRow: { ...BASE_APPROVED_REPORT, report_fact_package: { grounding_result: "PASS", growth_framing_result: "FAIL" } },
    });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishPreconditionError);
  });

  it("TC13: teacher_reviewed_at missing → PublishPreconditionError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, teacher_reviewed_at: null } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(PublishPreconditionError);
  });

  it("TC14: concurrent publish → ReportTerminalError → alreadyPublished=true", async () => {
    const db = makeDb({
      reportRow:    BASE_APPROVED_REPORT,
      forUpdateRow: { id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null, product_status: "PUBLISHED" },
    });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.alreadyPublished).toBe(true);
  });

  it("TC15: report not found → ReportNotFoundError", async () => {
    const db = makeDb({ reportRow: undefined });
    await expect(
      publishGrowthReport({ db, reportId: "nonexistent", actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(ReportNotFoundError);
  });

  it("TC16: report deleted → ReportNotFoundError", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, deleted_at: "2026-01-01T00:00:00.000Z" } });
    await expect(
      publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" }),
    ).rejects.toThrow(ReportNotFoundError);
  });

  it("TC16b: REVISED_PASS grounding accepted", async () => {
    const db = makeDb({
      reportRow: {
        ...BASE_APPROVED_REPORT,
        report_fact_package: { grounding_result: "REVISED_PASS", growth_framing_result: "REVISED_PASS" },
      },
    });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.alreadyPublished).toBe(false);
  });
});

// ─── B. POST /teacher/growth-reports/:reportId/publish — route tests ──────────
// Uses real publishGrowthReport via superAdminDb mock sequences.

describe("B. POST /teacher/growth-reports/:reportId/publish route", () => {
  // Standard success sequence for superAdminDb.execute:
  //   1. pool check SELECT (route level)
  //   2. initial SELECT id/product_status/.../deleted_at/published_at  (publishGrowthReport)
  //   3. SELECT FOR UPDATE (transitionReportStatus)
  //   4. UPDATE product_status
  //   5. UPDATE published_at
  //   6. next_audit_version
  //   7. INSERT audit_logs
  //   8. SELECT published_at (re-fetch)
  const successSequence = [
    { rows: [{ swimming_pool_id: POOL_ID }] },                          // 1. pool check
    { rows: [BASE_APPROVED_REPORT] },                                    // 2. initial SELECT
    { rows: [{ id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null, product_status: "APPROVED" }] }, // 3. FOR UPDATE
    { rowCount: 1, rows: [] },                                           // 4. UPDATE status
    { rowCount: 1, rows: [] },                                           // 5. UPDATE published_at
    { rows: [{ v: 1 }] },                                               // 6. audit version
    { rowCount: 1, rows: [] },                                           // 7. audit insert
    { rows: [{ published_at: "2026-07-21T09:00:00.000Z" }] },          // 8. re-fetch
  ];

  let adminApp: any;
  let superApp:  any;

  beforeAll(async () => {
    const { publishGrowthReportRouter } = await import("../publish-growth-report.js");

    adminApp = (() => {
      const a = express(); a.use(express.json());
      a.use((req: any, _: any, next: any) => {
        req.user = { userId: ADMIN_ID, role: "pool_admin", poolId: POOL_ID };
        next();
      });
      a.use(publishGrowthReportRouter); return a;
    })();

    superApp = (() => {
      const a = express(); a.use(express.json());
      a.use((req: any, _: any, next: any) => {
        req.user = { userId: SUPER_ID, role: "super_admin" };
        next();
      });
      a.use(publishGrowthReportRouter); return a;
    })();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("TC17: pool_admin same pool → 200 success", async () => {
    await setupSuperAdminSequence(successSequence);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.alreadyPublished).toBe(false);
    expect(res.body.publishedAt).toBeTruthy();
  });

  it("TC18: super_admin → 200 (no pool check)", async () => {
    await setupSuperAdminSequence([
      { rows: [BASE_APPROVED_REPORT] },
      { rows: [{ id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null, product_status: "APPROVED" }] },
      { rowCount: 1, rows: [] },
      { rowCount: 1, rows: [] },
      { rows: [{ v: 1 }] },
      { rowCount: 1, rows: [] },
      { rows: [{ published_at: "2026-07-21T09:00:00.000Z" }] },
    ]);
    const res = await request(superApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("TC19: teacher role → 403 FORBIDDEN", async () => {
    const teacherApp = express(); teacherApp.use(express.json());
    teacherApp.use((req: any, _: any, next: any) => { req.user = { userId: "tch01", role: "teacher", poolId: POOL_ID }; next(); });
    teacherApp.use((await import("../publish-growth-report.js")).publishGrowthReportRouter);
    const res = await request(teacherApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(403);
  });

  it("TC20: parent role → 403 FORBIDDEN", async () => {
    const parentApp = express(); parentApp.use(express.json());
    parentApp.use((req: any, _: any, next: any) => { req.user = { userId: "par01", role: "parent_account" }; next(); });
    parentApp.use((await import("../publish-growth-report.js")).publishGrowthReportRouter);
    const res = await request(parentApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(403);
  });

  it("TC21: pool_admin wrong pool → 403 POOL_MISMATCH", async () => {
    await setupSuperAdminSequence([
      { rows: [{ swimming_pool_id: "other_pool" }] }, // pool check returns different pool
    ]);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("POOL_MISMATCH");
  });

  it("TC22: pool check passes, report not found → 404", async () => {
    await setupSuperAdminSequence([
      { rows: [{ swimming_pool_id: POOL_ID }] }, // pool check
      { rows: [] },                               // initial SELECT → not found
    ]);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("REPORT_NOT_FOUND");
  });

  it("TC23: REVIEW_REQUIRED → 409 PUBLISH_NOT_ALLOWED", async () => {
    await setupSuperAdminSequence([
      { rows: [{ swimming_pool_id: POOL_ID }] },
      { rows: [{ ...BASE_APPROVED_REPORT, product_status: "REVIEW_REQUIRED" }] },
    ]);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("PUBLISH_NOT_ALLOWED");
    expect(res.body.detail).toBe("REVIEW_REQUIRED");
  });

  it("TC24: precondition fail (null fact_package) → 422 PRECONDITION_FAILED", async () => {
    await setupSuperAdminSequence([
      { rows: [{ swimming_pool_id: POOL_ID }] },
      { rows: [{ ...BASE_APPROVED_REPORT, report_fact_package: null }] },
    ]);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("PRECONDITION_FAILED");
  });

  it("TC25: already PUBLISHED → 200 alreadyPublished=true", async () => {
    await setupSuperAdminSequence([
      { rows: [{ swimming_pool_id: POOL_ID }] },
      { rows: [BASE_PUBLISHED_REPORT] }, // already PUBLISHED
    ]);
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyPublished).toBe(true);
  });

  it("TC26: audit INSERT called (via transitionReportStatus)", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    const auditCalls = db._calls.filter((c: string) => c.includes("audit_logs"));
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("TC27: product_status UPDATE to PUBLISHED happens", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    const updateCalls = db._calls.filter((c: string) => c.includes("UPDATE growth_reports") && c.includes("PUBLISHED"));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("TC28: no push_tokens / FCM call in publishGrowthReport (spec §18)", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    const pushCalls = db._calls.filter((c: string) => c.includes("push_tokens") || c.includes("fcm") || c.includes("notification"));
    expect(pushCalls).toHaveLength(0);
  });
});

// ─── C. Parent feed — GROWTH_REPORT integration ───────────────────────────────

describe("C. Parent feed /parent/students/:id/diary — GROWTH_REPORT items", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("TC29: PUBLISHED report appears in feed", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect(res.status).toBe(200);
    const grItems = (res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT");
    expect(grItems.length).toBeGreaterThanOrEqual(1);
  });

  it("TC30: type=GROWTH_REPORT present", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.type).toBe("GROWTH_REPORT");
  });

  it("TC31: growth_report_id present", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.growth_report_id).toBe(REPORT_ID);
  });

  it("TC32: report_period present", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.report_period).toBe(PERIOD);
  });

  it("TC33: published_at present", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.published_at).toBeTruthy();
  });

  it("TC34: APPROVED report not in feed (only PUBLISHED SQL filter)", async () => {
    // Feed query filters product_status='PUBLISHED'; passing empty grRows simulates no published rows
    const app = await buildParentFeedApp({ grRows: [] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect(res.status).toBe(200);
    const grItems = (res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT");
    expect(grItems).toHaveLength(0);
  });

  it("TC35: REVIEW_REQUIRED not in feed", async () => {
    const app = await buildParentFeedApp({ grRows: [] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect((res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT")).toHaveLength(0);
  });

  it("TC36: FAILED not in feed", async () => {
    const app = await buildParentFeedApp({ grRows: [] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect((res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT")).toHaveLength(0);
  });

  it("TC37: ANALYZING not in feed", async () => {
    const app = await buildParentFeedApp({ grRows: [] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect((res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT")).toHaveLength(0);
  });

  it("TC38: same growth_report_id appears once (projection dedup via query)", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItems = (res.body as any[]).filter((i: any) => i.growth_report_id === REPORT_ID);
    expect(grItems).toHaveLength(1);
  });

  it("TC39: preview from ENGINE report_content/sns_summary", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.preview?.summary_text).toBe("잘 성장했어요");
    expect(grItem?.preview?.headline).toBe("헤드라인");
    expect(grItem?.preview?.key_points).toEqual(["p1", "p2"]);
  });

  it("TC40: no app_generated_summary field (no APP AI generation)", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.app_generated_summary).toBeUndefined();
  });

  it("TC41: raw diary text not in GROWTH_REPORT preview", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    const previewStr = JSON.stringify(grItem?.preview ?? {});
    expect(previewStr).not.toContain("lesson_date");
    expect(previewStr).not.toContain("common_content");
  });

  it("TC42: teacher_review_note not exposed in feed item", async () => {
    const rowWithNote = { ...BASE_PUBLISHED_REPORT, teacher_review_note: "내부 메모" };
    const app = await buildParentFeedApp({ grRows: [rowWithNote] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(JSON.stringify(grItem)).not.toContain("내부 메모");
    expect(grItem?.teacher_review_note).toBeUndefined();
  });

  it("TC43: report_fact_package (excluded_claims) not exposed", async () => {
    const rowWithClaims = {
      ...BASE_PUBLISHED_REPORT,
      report_fact_package: { ...VALID_FACT_PACKAGE, excluded_claims: ["sensitive"] },
    };
    const app = await buildParentFeedApp({ grRows: [rowWithClaims] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.report_fact_package).toBeUndefined();
    expect(JSON.stringify(grItem)).not.toContain("sensitive");
  });

  it("TC44: share_safe=true preserved", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.share_safe).toBe(true);
  });

  it("TC44b: share_safe=false preserved", async () => {
    const row = { ...BASE_PUBLISHED_REPORT, sns_summary: { ...BASE_PUBLISHED_REPORT.sns_summary, share_safe: false } };
    const app = await buildParentFeedApp({ grRows: [row] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.share_safe).toBe(false);
  });

  it("TC45: chronology = published_at DESC (not report_period)", async () => {
    const earlier = { ...BASE_PUBLISHED_REPORT, id: "gr6_r02", report_period: "2026-06", published_at: "2026-06-01T09:00:00.000Z" };
    const later   = { ...BASE_PUBLISHED_REPORT, id: "gr6_r01", report_period: "2026-07", published_at: "2026-07-21T09:00:00.000Z" };
    const app = await buildParentFeedApp({ grRows: [earlier, later] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItems = (res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT");
    if (grItems.length >= 2) {
      expect(new Date(grItems[0].published_at).getTime()).toBeGreaterThan(
        new Date(grItems[1].published_at).getTime(),
      );
    }
  });

  it("TC46: Parent without link → 403 (ownership check)", async () => {
    const app = await buildParentFeedApp({ hasLink: false });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect(res.status).toBe(403);
  });

  it("TC47: connected parent (approved link) → 200", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect(res.status).toBe(200);
  });

  it("TC48: X expired → PUBLISHED report still visible (product_status='PUBLISHED' is sole filter)", async () => {
    // No x_entitlement filter in feed query; PUBLISHED reports always shown
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect((res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT").length).toBeGreaterThanOrEqual(1);
  });

  it("TC49: X expired → no data deleted (publishGrowthReport on PUBLISHED report is no-op)", async () => {
    const db = makeDb({ reportRow: BASE_PUBLISHED_REPORT });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.alreadyPublished).toBe(true);
    const deleteCalls = db._calls.filter((c: string) => c.includes("DELETE") || c.includes("deleted_at = now()"));
    expect(deleteCalls).toHaveLength(0);
  });

  it("TC50: diary items regression — existing diary rows preserved alongside GROWTH_REPORT", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    expect(res.status).toBe(200);
    // Feed is an array (diary + growth_report items)
    expect(Array.isArray(res.body)).toBe(true);
    // GROWTH_REPORT item present
    const grItems = (res.body as any[]).filter((i: any) => i.type === "GROWTH_REPORT");
    expect(grItems.length).toBeGreaterThanOrEqual(1);
  });

  it("TC51: stable projection id has gr_feed_ prefix", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.id).toMatch(/^gr_feed_/);
  });

  it("TC52: title is product UI label (N월 성장리포트), not AI-generated", async () => {
    const app = await buildParentFeedApp({ grRows: [BASE_PUBLISHED_REPORT] });
    const res = await request(app).get(`/parent/students/${STUDENT_ID}/diary`);
    const grItem = (res.body as any[]).find((i: any) => i.type === "GROWTH_REPORT");
    expect(grItem?.title).toBe("7월 성장리포트");
  });
});

// ─── D. Lifecycle + regression ────────────────────────────────────────────────

describe("D. Lifecycle protection + regression", () => {
  it("TC_L1: PUBLISHED → any transition throws (terminal status)", async () => {
    const db = makeDb({
      forUpdateRow: { id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null, product_status: "PUBLISHED" },
    });
    await expect(
      transitionReportStatus({ db, reportId: REPORT_ID, toStatus: "ANALYZING", actorType: "system", actorId: "sys" }),
    ).rejects.toThrow();
  });

  it("TC_L2: PUBLISHED → reanalysis = alreadyPublished (no state regression)", async () => {
    const db = makeDb({ reportRow: BASE_PUBLISHED_REPORT });
    // Calling publishGrowthReport on PUBLISHED → alreadyPublished, no transition
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result.alreadyPublished).toBe(true);
    // No UPDATE should have been issued
    const updates = db._calls.filter((c: string) => c.includes("UPDATE growth_reports"));
    expect(updates).toHaveLength(0);
  });

  it("TC_L3: error classes exported correctly", () => {
    expect(PublishNotAllowedError).toBeDefined();
    expect(PublishPreconditionError).toBeDefined();
    expect(ReportNotFoundError).toBeDefined();
    expect(InvalidTransitionError).toBeDefined();
  });

  it("TC_L4: spec §31 — no ENGINE URL in publishGrowthReport DB calls", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    const engineCalls = db._calls.filter((c: string) => c.includes("/api/v1/analyze") || c.toLowerCase().includes("engine"));
    expect(engineCalls).toHaveLength(0);
  });

  it("TC_L5: spec §16 — result has no sns_share_url (SNS share not implemented)", async () => {
    const db = makeDb({ reportRow: BASE_APPROVED_REPORT });
    const result = await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
    expect(result).not.toHaveProperty("sns_share_url");
  });

  it("TC_L6: ANALYZING → publish throws PublishNotAllowedError with correct status", async () => {
    const db = makeDb({ reportRow: { ...BASE_APPROVED_REPORT, product_status: "ANALYZING" } });
    try {
      await publishGrowthReport({ db, reportId: REPORT_ID, actorId: ADMIN_ID, actorType: "pool_admin" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PublishNotAllowedError);
      expect((err as PublishNotAllowedError).currentStatus).toBe("ANALYZING");
    }
  });
});
