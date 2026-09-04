/**
 * gr5-teacher-growth-report-review.test.ts
 *
 * GR5: Teacher Review + Approval Workflow
 * 50 TC
 *
 * Tests use fake DB mocks and fake auth. No real DB, no ENGINE calls.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  transitionReportStatus,
  ALLOWED_TRANSITIONS,
  ALL_PRODUCT_STATUSES,
} from "../../lib/growth-report-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_ID   = "gr_rev_01";
const STUDENT_ID  = "stu_rev01";
const TEACHER_ID  = "usr_tch01";
const ADMIN_ID    = "usr_adm01";
const OTHER_TEACHER = "usr_tch_other";
const POOL_ID     = "pool_rev01";
const CLASS_ID    = "cls_rev01";

const BASE_REPORT = {
  id:                      REPORT_ID,
  student_id:              STUDENT_ID,
  swimming_pool_id:        POOL_ID,
  product_status:          "REVIEW_REQUIRED",
  analysis_status:         "COMPLETE",
  report_period:           "2026-07",
  report_content:          { summary: "AI-generated content" },
  sns_summary:             { headline: "성장 요약" },
  selected_metrics:        ["F001", "F002"],
  positive_growth_signals: ["수영 자신감 향상"],
  success_conditions:      null,
  support_levers:          null,
  next_growth_targets:     null,
  next_observation_targets: null,
  report_fact_package:     null,
  teacher_reviewed_by:     null,
  teacher_reviewed_at:     null,
  teacher_review_action:   null,
  teacher_review_reason_code: null,
  teacher_review_note:     null,
  teacher_reanalysis_count: 0,
  parent_input_open_at:    "2026-07-24T15:00:00.000Z",
  parent_input_close_at:   "2026-08-04T15:00:00.000Z",
};

const BASE_STUDENT = { id: STUDENT_ID, name: "김민수" };

// ─── DB mock factory ──────────────────────────────────────────────────────────

interface DbOptions {
  reportRow?:       any;
  studentRow?:      any;
  teacherOwns?:     boolean;
  historyOwns?:     boolean;
  forUpdateReport?: any;
  nextVersion?:     number;
}

function makeDb(opts: DbOptions = {}) {
  const calls: string[] = [];
  const db = {
    _calls: calls,
    execute: vi.fn(async (query: any) => {
      const q: string = query?.queryChunks
        ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
        : String(query?.sql ?? query ?? "");
      calls.push(q.replace(/\s+/g, " ").trim());

      // FOR UPDATE
      if (q.includes("FOR UPDATE")) {
        const row = opts.forUpdateReport ?? {
          id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null,
          product_status: opts.reportRow?.product_status ?? "REVIEW_REQUIRED",
        };
        return { rows: [row] };
      }
      // growth_reports + growth_report_cycles join
      if (q.includes("growth_reports") && q.includes("growth_report_cycles") && !q.includes("UPDATE")) {
        return opts.reportRow ? { rows: [opts.reportRow] } : { rows: [] };
      }
      // growth_reports simple SELECT (for POST)
      if (q.includes("FROM growth_reports") && !q.includes("growth_report_cycles") && !q.includes("UPDATE")) {
        return opts.reportRow ? { rows: [opts.reportRow] } : { rows: [] };
      }
      // students
      if (q.includes("FROM students") && q.includes("WHERE id")) {
        return { rows: [opts.studentRow ?? BASE_STUDENT] };
      }
      // teacher ownership — class_groups + students
      if (q.includes("class_groups") && q.includes("JOIN students")) {
        return opts.teacherOwns !== false ? { rows: [{ "1": 1 }] } : { rows: [] };
      }
      // teacher ownership — student_class_history fallback
      if (q.includes("class_groups") && q.includes("student_class_history")) {
        return opts.historyOwns ? { rows: [{ "1": 1 }] } : { rows: [] };
      }
      // UPDATE growth_reports (review metadata + status)
      if (q.includes("UPDATE growth_reports")) {
        return { rowCount: 1, rows: [] };
      }
      // audit
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

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    requireAuth: vi.fn((_req: any, _res: any, next: any) => next()),
    requireRole: vi.fn(
      (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
    ),
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return { ...orig, superAdminDb: { execute: vi.fn() } };
});

vi.mock("../../lib/xmode-report-guard.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    requireReportXAccess: vi.fn((req: any, _res: any, next: any) => {
      req.resolvedReportPoolId  = POOL_ID;
      req.resolvedReportXAccess = { allowed: true };
      next();
    }),
  };
});

vi.mock("../../lib/growth-report-service.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    transitionReportStatus:  vi.fn(real.transitionReportStatus),
    updateParentInputStatus: vi.fn(real.updateParentInputStatus),
  };
});

vi.mock("../../jobs/growth-report-analysis-worker.js", () => ({
  runGrowthReportAnalysisWorker: vi.fn(async () => {}),
}));

import { superAdminDb } from "@workspace/db";

function setupDb(opts: DbOptions = {}) {
  const db = makeDb(opts);
  vi.mocked(superAdminDb).execute = db.execute;
  return db;
}

// ─── Express test app ─────────────────────────────────────────────────────────

import teacherGrowthReportReviewRouter from "../../routes/teacher-growth-report-review.js";
import express from "express";
import request from "supertest";

function buildApp(userId = TEACHER_ID, role = "teacher") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { userId, role, poolId: POOL_ID };
    next();
  });
  app.use(teacherGrowthReportReviewRouter);
  return app;
}

const app        = buildApp(TEACHER_ID, "teacher");
const adminApp   = buildApp(ADMIN_ID, "pool_admin");
const superApp   = buildApp("super_01", "super_admin");

// ─── A. GET Review Access ────────────────────────────────────────────────────

describe("A. GET review access", () => {
  it("TC1: teacher assigned → 200 + review data", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report_id).toBe(REPORT_ID);
    expect(res.body.product_status).toBe("REVIEW_REQUIRED");
  });

  it("TC2: teacher not assigned → 403 TEACHER_NOT_ASSIGNED", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: false, historyOwns: false });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("TEACHER_NOT_ASSIGNED");
  });

  it("TC3: pool_admin same pool → 200", async () => {
    setupDb({ reportRow: BASE_REPORT });
    const res = await request(adminApp).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(200);
  });

  it("TC4: super_admin → 200 regardless", async () => {
    setupDb({ reportRow: BASE_REPORT });
    const res = await request(superApp).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(200);
  });

  it("TC5: report not found → 404", async () => {
    setupDb({ reportRow: undefined });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("REPORT_NOT_FOUND");
  });

  it("TC6: pool_admin wrong pool → 403 POOL_MISMATCH", async () => {
    // Override requireReportXAccess to inject a different pool (mismatch)
    const { requireReportXAccess } = await import("../../lib/xmode-report-guard.js");
    vi.mocked(requireReportXAccess).mockImplementationOnce((req: any, _res: any, next: any) => {
      req.resolvedReportPoolId  = "pool_other";
      req.resolvedReportXAccess = { allowed: true };
      next();
    });
    setupDb({ reportRow: { ...BASE_REPORT, swimming_pool_id: POOL_ID } });
    const res = await request(adminApp).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("POOL_MISMATCH");
  });

  it("TC7: teacher history fallback — class_groups+history → 200", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: false, historyOwns: true });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.status).toBe(200);
  });

  it("TC8: response includes student info", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.body.student).toBeDefined();
    expect(res.body.student.id).toBe(STUDENT_ID);
  });

  it("TC9: response includes report_content (opaque — not re-interpreted)", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(res.body.report_content).toBeDefined();
    // APP does not add analysis_score or rating fields
    expect(res.body.agreement_score).toBeUndefined();
    expect(res.body.f001_judgment).toBeUndefined();
  });

  it("TC10: response includes max_reanalysis field", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).get(`/teacher/growth-reports/${REPORT_ID}/review`);
    expect(typeof res.body.max_reanalysis).toBe("number");
    expect(res.body.max_reanalysis).toBeGreaterThan(0);
  });
});

// ─── B. APPROVE action ────────────────────────────────────────────────────────

describe("B. APPROVE action", () => {
  it("TC11: APPROVE → 200 product_status=APPROVED", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app)
      .post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.product_status).toBe("APPROVED");
    expect(res.body.review_action).toBe("APPROVE");
  });

  it("TC12: APPROVE stores teacher_reviewed_by/at (UPDATE SQL called)", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app)
      .post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "APPROVE" });
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) => q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "");
    const updateCall = calls.find((s: string) => s.includes("UPDATE growth_reports") && s.includes("teacher_reviewed_by"));
    expect(updateCall).toBeDefined();
  });

  it("TC13: APPROVE calls transitionReportStatus → APPROVED", async () => {
    vi.mocked(transitionReportStatus).mockClear();
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`).send({ action: "APPROVE" });
    expect(vi.mocked(transitionReportStatus)).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "APPROVED" }),
    );
  });

  it("TC14: APPROVE with note → note stored", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app)
      .post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "APPROVE", note: "문제 없음" });
    expect(res.status).toBe(200);
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) => q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "");
    const noteCall = calls.find((s: string) => s.includes("teacher_review_note") && s.includes("문제 없음"));
    expect(noteCall).toBeDefined();
  });

  it("TC15: APPROVE does NOT fire GR3 worker", async () => {
    const { runGrowthReportAnalysisWorker } = await import("../../jobs/growth-report-analysis-worker.js");
    vi.mocked(runGrowthReportAnalysisWorker).mockClear();
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`).send({ action: "APPROVE" });
    // Give setImmediate a chance to run (it should NOT be called for APPROVE)
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(runGrowthReportAnalysisWorker)).not.toHaveBeenCalled();
  });

  it("TC16: pool_admin can APPROVE", async () => {
    setupDb({
      reportRow: BASE_REPORT,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(adminApp).post(`/teacher/growth-reports/${REPORT_ID}/review`).send({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(res.body.product_status).toBe("APPROVED");
  });

  it("TC17: super_admin can APPROVE", async () => {
    setupDb({
      reportRow: BASE_REPORT,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(superApp).post(`/teacher/growth-reports/${REPORT_ID}/review`).send({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(res.body.product_status).toBe("APPROVED");
  });

  it("TC18: APPROVE audit event TEACHER_REVIEW_APPROVED written", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`).send({ action: "APPROVE" });
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) => q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "");
    const auditCall = calls.find((s: string) => s.includes("TEACHER_REVIEW_APPROVED"));
    expect(auditCall).toBeDefined();
  });
});

// ─── C. REQUEST_REANALYSIS action ─────────────────────────────────────────────

describe("C. REQUEST_REANALYSIS action", () => {
  it("TC19: REQUEST_REANALYSIS → 200 product_status=ANALYZING", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app)
      .post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "WRONG_CONTEXT" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.product_status).toBe("ANALYZING");
    expect(res.body.review_action).toBe("REQUEST_REANALYSIS");
  });

  it("TC20: REQUEST_REANALYSIS transitions REVIEW_REQUIRED → ANALYZING", async () => {
    vi.mocked(transitionReportStatus).mockClear();
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "INSUFFICIENT_CONTEXT" });
    expect(vi.mocked(transitionReportStatus)).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "ANALYZING" }),
    );
  });

  it("TC21: REQUEST_REANALYSIS generates new analysis_request_id", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    expect(res.body.analysis_request_id).toBeDefined();
    expect(res.body.analysis_request_id).toMatch(/^grre_/);
  });

  it("TC22: REQUEST_REANALYSIS fires GR3 worker (setImmediate)", async () => {
    const { runGrowthReportAnalysisWorker } = await import("../../jobs/growth-report-analysis-worker.js");
    vi.mocked(runGrowthReportAnalysisWorker).mockClear();
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(runGrowthReportAnalysisWorker)).toHaveBeenCalled();
  });

  it("TC23: REQUEST_REANALYSIS increments teacher_reanalysis_count in response", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, teacher_reanalysis_count: 1 }, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    expect(res.body.teacher_reanalysis_count).toBe(2);
  });

  it("TC24: REQUEST_REANALYSIS resets analysis_retry_count=0 in UPDATE SQL", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) => q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "");
    const updateCall = calls.find((s: string) =>
      s.includes("UPDATE growth_reports") && s.includes("analysis_retry_count") && s.includes("0"),
    );
    expect(updateCall).toBeDefined();
  });

  it("TC25: REQUEST_REANALYSIS does NOT delete existing report_content", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) => q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "");
    const deletesContent = calls.some((s: string) =>
      s.includes("report_content") && s.includes("NULL"),
    );
    expect(deletesContent).toBe(false);
  });

  it("TC26: REQUEST_REANALYSIS audit TEACHER_REVIEW_REANALYSIS_REQUESTED written", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "WRONG_CONTEXT" });
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) => q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "");
    const auditCall = calls.find((s: string) => s.includes("TEACHER_REVIEW_REANALYSIS_REQUESTED"));
    expect(auditCall).toBeDefined();
  });

  it("TC27: REQUEST_REANALYSIS reason_code stored in response", async () => {
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "PARENT_VISIBILITY_CONCERN" });
    expect(res.body.teacher_review_reason_code).toBe("PARENT_VISIBILITY_CONCERN");
  });
});

// ─── D. Validation ────────────────────────────────────────────────────────────

describe("D. Validation", () => {
  it("TC28: missing action → 400 INVALID_ACTION", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ACTION");
  });

  it("TC29: unknown action → 400 INVALID_ACTION", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "DELETE_REPORT" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ACTION");
  });

  it("TC30: invalid reason_code → 400 INVALID_REASON_CODE", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "MADE_UP_CODE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_REASON_CODE");
  });

  it("TC31: report not found (POST) → 404", async () => {
    setupDb({ reportRow: undefined });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "APPROVE" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("REPORT_NOT_FOUND");
  });

  it("TC32: teacher not assigned (POST) → 403 TEACHER_NOT_ASSIGNED", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: false, historyOwns: false });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "APPROVE" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("TEACHER_NOT_ASSIGNED");
  });

  it("TC33: REQUEST_REANALYSIS missing reason_code → accepted (reason optional)", async () => {
    // spec §8 says reason_code 'recommended' not strictly required
    setupDb({
      reportRow: BASE_REPORT, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS" });
    expect(res.status).toBe(200);
  });
});

// ─── E. Review eligibility ────────────────────────────────────────────────────

describe("E. Review eligibility", () => {
  const INELIGIBLE_STATUSES = [
    "NOT_OPEN", "OPEN", "PREANALYZING", "QUESTION_AVAILABLE",
    "READY_FOR_ANALYSIS", "ANALYZING", "APPROVED", "PUBLISHED",
  ] as const;

  for (const status of INELIGIBLE_STATUSES) {
    it(`TC-eligibility: ${status} → 409 REVIEW_NOT_ELIGIBLE`, async () => {
      setupDb({
        reportRow: { ...BASE_REPORT, product_status: status },
        teacherOwns: true,
      });
      const res = await request(app)
        .post(`/teacher/growth-reports/${REPORT_ID}/review`)
        .send({ action: "APPROVE" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("REVIEW_NOT_ELIGIBLE");
    });
  }
});

// ─── F. Loop protection ───────────────────────────────────────────────────────

describe("F. Loop protection", () => {
  it("TC41: reanalysis_count < max → allowed", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, teacher_reanalysis_count: 2 }, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    expect(res.status).toBe(200);
  });

  it("TC42: reanalysis_count = max → 429 REANALYSIS_LIMIT_EXCEEDED", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, teacher_reanalysis_count: 3 }, teacherOwns: true,
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("REANALYSIS_LIMIT_EXCEEDED");
  });

  it("TC43: APPROVE is never subject to reanalysis loop protection", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, teacher_reanalysis_count: 99 }, teacherOwns: true,
      forUpdateReport: { id: REPORT_ID, product_status: "REVIEW_REQUIRED", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(res.body.product_status).toBe("APPROVED");
  });

  it("TC44: 429 response includes teacher_reanalysis_count and max_reanalysis", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, teacher_reanalysis_count: 3 }, teacherOwns: true,
    });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "REQUEST_REANALYSIS", reason_code: "OTHER" });
    expect(res.body.teacher_reanalysis_count).toBe(3);
    expect(res.body.max_reanalysis).toBeGreaterThan(0);
  });
});

// ─── G. Content editing forbidden ────────────────────────────────────────────

describe("G. Content editing forbidden (spec §10)", () => {
  it("TC45: no route for direct content PATCH", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).patch(`/teacher/growth-reports/${REPORT_ID}/content`).send({ summary_text: "hack" });
    expect(res.status).toBe(404);
  });

  it("TC46: POST review body is APPROVE|REQUEST_REANALYSIS only (no edit_content action)", async () => {
    setupDb({ reportRow: BASE_REPORT, teacherOwns: true });
    const res = await request(app).post(`/teacher/growth-reports/${REPORT_ID}/review`)
      .send({ action: "EDIT_CONTENT", summary_text: "overwritten" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ACTION");
  });
});

// ─── H. Teacher Expo UI checks ────────────────────────────────────────────────

describe("H. Teacher Expo UI structural checks", () => {
  let uiSrc: string;

  beforeAll(async () => {
    const { readFileSync } = await import("node:fs");
    uiSrc = readFileSync(
      "/home/runner/workspace/artifacts/swim-app/app/(teacher)/growth-report-review.tsx",
      "utf-8",
    );
  });

  it("TC47: UI has APPROVE action button", () => {
    expect(uiSrc).toContain("APPROVE");
  });

  it("TC48: UI has REQUEST_REANALYSIS action button", () => {
    expect(uiSrc).toContain("REQUEST_REANALYSIS");
  });

  it("TC49: UI shows reason_code selection for REQUEST_REANALYSIS", () => {
    expect(uiSrc).toContain("reasonCode");
    expect(uiSrc).toContain("WRONG_CONTEXT");
    expect(uiSrc).toContain("PARENT_VISIBILITY_CONCERN");
  });

  it("TC50: UI has no free-text content editing (no summary_text input)", () => {
    expect(uiSrc).not.toContain("summary_text");
    expect(uiSrc).not.toContain("EDIT_CONTENT");
    expect(uiSrc).not.toContain("editContent");
  });
});

// ─── I. Regression ────────────────────────────────────────────────────────────

describe("I. Regression", () => {
  it("REVIEW_REQUIRED → APPROVED is in ALLOWED_TRANSITIONS", () => {
    expect(ALLOWED_TRANSITIONS.REVIEW_REQUIRED).toContain("APPROVED");
  });

  it("REVIEW_REQUIRED → ANALYZING is in ALLOWED_TRANSITIONS", () => {
    expect(ALLOWED_TRANSITIONS.REVIEW_REQUIRED).toContain("ANALYZING");
  });

  it("GR4 regression — parentGrowthReportRouter still importable", async () => {
    const mod = await import("../../routes/parent-growth-report.js");
    expect(mod.default).toBeDefined();
  });

  it("GR3 regression — runGrowthReportAnalysisWorker export intact", async () => {
    const { runGrowthReportAnalysisWorker } = await import("../../jobs/growth-report-analysis-worker.js");
    expect(typeof runGrowthReportAnalysisWorker).toBe("function");
  });

  it("GR1 regression — ALL_PRODUCT_STATUSES intact", () => {
    expect(ALL_PRODUCT_STATUSES.has("REVIEW_REQUIRED")).toBe(true);
    expect(ALL_PRODUCT_STATUSES.has("APPROVED")).toBe(true);
    expect(ALL_PRODUCT_STATUSES.size).toBeGreaterThanOrEqual(10);
  });
});
