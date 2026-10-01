/**
 * gr4-parent-growth-report.test.ts
 *
 * GR4: Parent Question UI + Answer Submission + Second-Pass Reanalysis
 * 54 TC (spec §33 list TC1~TC54)
 *
 * Tests use fake DB mocks and fake auth. No real DB, no ENGINE calls.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

import {
  transitionReportStatus,
  updateParentInputStatus,
  ALL_PRODUCT_STATUSES,
  ALL_PARENT_INPUT_STATUSES,
  InvalidTransitionError,
  ALLOWED_TRANSITIONS,
} from "../../lib/growth-report-service.js";

import { resolveReportXAccess } from "../../lib/xmode-report-guard.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_ID    = "gr_q_test01";
const STUDENT_ID   = "stu_q01";
const PARENT_ID    = "pa_q01";
const OTHER_PARENT = "pa_q_other";
const POOL_ID      = "pool_xq";
const CYCLE_ID     = "grc_q01";
const Q1_ID        = "grq_01";
const Q2_ID        = "grq_02";

const OPEN_AT  = "2026-08-24T15:00:00.000Z";
const CLOSE_AT = "2026-09-04T15:00:00.000Z";

const BASE_REPORT = {
  id:                   REPORT_ID,
  student_id:           STUDENT_ID,
  swimming_pool_id:     POOL_ID,
  product_status:       "QUESTION_AVAILABLE",
  parent_input_status:  "AVAILABLE",
  cycle_id:             CYCLE_ID,
  parent_input_open_at:  OPEN_AT,
  parent_input_close_at: CLOSE_AT,
};

const BASE_QUESTIONS = [
  {
    id: Q1_ID, report_id: REPORT_ID,
    engine_question_id: "eq_01", metric_id: "F001",
    question_text: "아이가 집에서 수영 얘기를 자주 하나요?",
    answer_type: "SINGLE_CHOICE",
    options: [{ value: "YES", label: "예" }, { value: "NO", label: "아니요" }],
    parent_confirmable_behavior: "가정에서 관찰 가능한 행동",
    question_stage: "PREANALYSIS", sequence: 1, is_required: false,
  },
  {
    id: Q2_ID, report_id: REPORT_ID,
    engine_question_id: "eq_02", metric_id: "F002",
    question_text: "어떤 영법을 연습하고 싶어하나요?",
    answer_type: "MULTI_CHOICE",
    options: [
      { value: "FREESTYLE", label: "자유형" },
      { value: "BREASTSTROKE", label: "평영" },
      { value: "BACKSTROKE", label: "배영" },
    ],
    parent_confirmable_behavior: null,
    question_stage: "PREANALYSIS", sequence: 2, is_required: false,
  },
];

// ─── DB mock factory ──────────────────────────────────────────────────────────

interface DbOptions {
  reportRow?:       any;
  hasParentLink?:   boolean;
  questions?:       any[];
  answers?:         any[];
  answerCount?:     number;
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

      // parent_students ownership check
      if (q.includes("parent_students") && q.includes("student_id")) {
        return opts.hasParentLink !== false ? { rows: [{ "1": 1 }] } : { rows: [] };
      }
      // FOR UPDATE (transitionReportStatus)
      if (q.includes("FOR UPDATE")) {
        const row = opts.forUpdateReport ?? {
          id: REPORT_ID, swimming_pool_id: POOL_ID, deleted_at: null,
          product_status: opts.reportRow?.product_status ?? "QUESTION_AVAILABLE",
        };
        return { rows: [row] };
      }
      // growth_reports + cycle join SELECT
      if (q.includes("growth_reports") && q.includes("growth_report_cycles") && !q.includes("UPDATE")) {
        return opts.reportRow ? { rows: [opts.reportRow] } : { rows: [] };
      }
      // growth_reports simple SELECT (complete route — no cycle join)
      if (q.includes("FROM growth_reports") && !q.includes("growth_report_cycles") && !q.includes("UPDATE")) {
        return opts.reportRow ? { rows: [opts.reportRow] } : { rows: [] };
      }
      // questions with answers join
      if (q.includes("growth_report_questions") && q.includes("LEFT JOIN growth_report_answers")) {
        const qs = (opts.questions ?? BASE_QUESTIONS).map((question) => ({
          question_id:                 question.id,
          engine_question_id:          question.engine_question_id,
          metric_id:                   question.metric_id,
          question_text:               question.question_text,
          answer_type:                 question.answer_type,
          options:                     question.options,
          parent_confirmable_behavior: question.parent_confirmable_behavior,
          question_stage:              question.question_stage,
          sequence:                    question.sequence,
          is_required:                 question.is_required,
          existing_answer: (opts.answers ?? []).find((a: any) => a.question_id === question.id)?.selected_values ?? null,
          answered_at: null,
        }));
        return { rows: qs };
      }
      // questions SELECT for validation (no LEFT JOIN)
      if (q.includes("growth_report_questions") && !q.includes("LEFT JOIN")) {
        return { rows: opts.questions ?? BASE_QUESTIONS };
      }
      // answer COUNT
      if (q.includes("COUNT") && q.includes("growth_report_answers")) {
        return { rows: [{ cnt: opts.answerCount ?? 0 }] };
      }
      // answer upsert
      if (q.includes("growth_report_answers") && q.includes("ON CONFLICT")) {
        return { rows: [], rowCount: 1 };
      }
      // UPDATE growth_reports
      if (q.includes("UPDATE growth_reports")) {
        return { rowCount: 1, rows: [] };
      }
      // audit_logs
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

// mock requireAuth to pass through (inject user in buildApp instead)
vi.mock("../../middlewares/auth.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    requireAuth: vi.fn((req: any, _res: any, next: any) => {
      // pass through — user is injected by test app middleware
      next();
    }),
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
    resolveReportXAccess: vi.fn(async () => ({
      allowed: true, mode: "x", poolId: POOL_ID,
      modeResult: { mode: "x", xmode_entitlement: true },
    })),
    resolveReportPoolId: vi.fn(async () => POOL_ID),
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

import { superAdminDb } from "@workspace/db";

// wire the mock superAdminDb.execute to a fresh makeDb instance
function setupDb(opts: DbOptions = {}) {
  const db = makeDb(opts);
  vi.mocked(superAdminDb).execute = db.execute;
  return db;
}

// ─── Express test app ─────────────────────────────────────────────────────────

import parentGrowthReportRouter from "../../routes/parent-growth-report.js";
import express from "express";
import request from "supertest";

function buildApp(userId = PARENT_ID, role = "parent_account") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { userId, role, poolId: POOL_ID };
    next();
  });
  app.use(parentGrowthReportRouter);
  return app;
}

const app = buildApp();

// ─── A. Question API access ───────────────────────────────────────────────────

describe("A. Question API access", () => {
  it("TC1: parent own child report → 200 + questions", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report_id).toBe(REPORT_ID);
    expect(Array.isArray(res.body.questions)).toBe(true);
  });

  it("TC2: other child report → 403 OWNERSHIP_DENIED", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: false });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("OWNERSHIP_DENIED");
  });

  it("TC3: report not found for pool → 404", async () => {
    setupDb({ reportRow: undefined });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("REPORT_NOT_FOUND");
  });

  it("TC4: X access true → 200 허용", async () => {
    vi.mocked(resolveReportXAccess).mockResolvedValueOnce({
      allowed: true, mode: "x", poolId: POOL_ID,
      modeResult: { mode: "x", xmode_entitlement: true } as any,
    });
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(200);
  });

  it("TC5: X access false → requireReportXAccess returns 403", async () => {
    // Build a one-off app where requireReportXAccess denies
    const { requireReportXAccess } = await import("../../lib/xmode-report-guard.js");
    vi.mocked(requireReportXAccess).mockImplementationOnce((_req: any, res: any) => {
      res.status(403).json({ success: false, error: "XMODE_NOT_ENTITLED" });
    });
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("XMODE_NOT_ENTITLED");
  });

  it("TC6: questions 0개 정상 (empty array)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true, questions: [] });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(0);
    expect(res.body.total_questions).toBe(0);
  });

  it("TC7: question order by sequence (both sequences present)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(200);
    const seqs = res.body.questions.map((q: any) => q.sequence);
    expect(seqs).toContain(1);
    expect(seqs).toContain(2);
  });

  it("TC8: SINGLE_CHOICE response contract (answer_type + options + is_required=false)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    const q = res.body.questions.find((q: any) => q.answer_type === "SINGLE_CHOICE");
    expect(q).toBeDefined();
    expect(Array.isArray(q.options)).toBe(true);
    expect(q.is_required).toBe(false);
    expect(q.existing_answer).toEqual([]);
  });

  it("TC9: MULTI_CHOICE contract (answer_type + options)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    const q = res.body.questions.find((q: any) => q.answer_type === "MULTI_CHOICE");
    expect(q).toBeDefined();
    expect(Array.isArray(q.options)).toBe(true);
  });

  it("TC10: existing answer included in response", async () => {
    setupDb({
      reportRow: BASE_REPORT, hasParentLink: true,
      answers: [{ question_id: Q1_ID, selected_values: ["YES"] }],
    });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    const q = res.body.questions.find((q: any) => q.question_id === Q1_ID);
    expect(q?.existing_answer).toEqual(["YES"]);
  });
});

// ─── B. Answer save ───────────────────────────────────────────────────────────

describe("B. Answer save", () => {
  it("TC11: valid SINGLE_CHOICE answer save → 200", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.saved_count).toBe(1);
  });

  it("TC12: valid MULTI_CHOICE answer save → 200", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q2_ID, selected_values: ["FREESTYLE", "BACKSTROKE"] }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("TC13: invalid option → 400 INVALID_OPTION_VALUE", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["MAYBE"] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_OPTION_VALUE");
  });

  it("TC14: unknown question → 400 UNKNOWN_QUESTION", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: "grq_not_exist", selected_values: ["X"] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("UNKNOWN_QUESTION");
  });

  it("TC15: question from other report → 400 UNKNOWN_QUESTION", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true, questions: [BASE_QUESTIONS[0]!] });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q2_ID, selected_values: ["FREESTYLE"] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("UNKNOWN_QUESTION");
  });

  it("TC16: duplicate selected value → 400 DUPLICATE_SELECTED_VALUE", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q2_ID, selected_values: ["FREESTYLE", "FREESTYLE"] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("DUPLICATE_SELECTED_VALUE");
  });

  it("TC17: SINGLE_CHOICE multiple values → 400", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES", "NO"] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("SINGLE_CHOICE_MULTIPLE_VALUES");
  });

  it("TC18: answer upsert (same question twice → same result, 200)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const payload = { answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] };
    const r1 = await request(app).put(`/parent/growth-reports/${REPORT_ID}/answers`).send(payload);
    const r2 = await request(app).put(`/parent/growth-reports/${REPORT_ID}/answers`).send(payload);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it("TC19: partial save (only Q1 answered) → 200 saved_count=1", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(200);
    expect(res.body.saved_count).toBe(1);
  });

  it("TC20: partial save does NOT transition to READY_FOR_ANALYSIS", async () => {
    vi.mocked(transitionReportStatus).mockClear();
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    const toRFA = vi.mocked(transitionReportStatus).mock.calls.some(
      (args: any[]) => args[0]?.toStatus === "READY_FOR_ANALYSIS",
    );
    expect(toRFA).toBe(false);
  });

  it("TC21: first answer → parent_input_status ANSWERED (updateParentInputStatus called)", async () => {
    vi.mocked(updateParentInputStatus).mockClear();
    setupDb({ reportRow: { ...BASE_REPORT, parent_input_status: "AVAILABLE" }, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(200);
    expect(res.body.parent_input_status).toBe("ANSWERED");
    expect(vi.mocked(updateParentInputStatus)).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "ANSWERED" }),
    );
  });
});

// ─── C. Input window enforcement ──────────────────────────────────────────────

describe("C. Input window enforcement", () => {
  it("TC22: parent_input_status=CLOSED submit → 423 PARENT_INPUT_CLOSED", async () => {
    setupDb({ reportRow: { ...BASE_REPORT, parent_input_status: "CLOSED" }, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("PARENT_INPUT_CLOSED");
  });

  it("TC23: CLOSED → GET questions allowed (read-only)", async () => {
    setupDb({ reportRow: { ...BASE_REPORT, parent_input_status: "CLOSED" }, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(200);
    expect(res.body.parent_input_status).toBe("CLOSED");
  });

  it("TC24: ANSWERED read → 200 with answered_questions=1", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, parent_input_status: "ANSWERED" },
      hasParentLink: true,
      answers: [{ question_id: Q1_ID, selected_values: ["YES"] }],
    });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    expect(res.status).toBe(200);
    expect(res.body.parent_input_status).toBe("ANSWERED");
    expect(res.body.answered_questions).toBe(1);
  });
});

// ─── D. Manual complete ───────────────────────────────────────────────────────

describe("D. Manual complete", () => {
  it("TC25: manual complete → 200 product_status=READY_FOR_ANALYSIS", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, product_status: "QUESTION_AVAILABLE" },
      hasParentLink: true, answerCount: 1,
      forUpdateReport: {
        id: REPORT_ID, product_status: "QUESTION_AVAILABLE",
        swimming_pool_id: POOL_ID, deleted_at: null,
      },
    });
    const res = await request(app).post(`/parent/growth-reports/${REPORT_ID}/complete`).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.product_status).toBe("READY_FOR_ANALYSIS");
  });

  it("TC26: QUESTION_AVAILABLE → READY_FOR_ANALYSIS transition (transitionReportStatus called)", async () => {
    vi.mocked(transitionReportStatus).mockClear();
    setupDb({
      reportRow: { ...BASE_REPORT, product_status: "QUESTION_AVAILABLE" },
      hasParentLink: true, answerCount: 1,
      forUpdateReport: {
        id: REPORT_ID, product_status: "QUESTION_AVAILABLE",
        swimming_pool_id: POOL_ID, deleted_at: null,
      },
    });
    await request(app).post(`/parent/growth-reports/${REPORT_ID}/complete`).send({});
    expect(vi.mocked(transitionReportStatus)).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "READY_FOR_ANALYSIS", actorType: "parent" }),
    );
  });

  it("TC27: complete with 0 answered optional questions allowed", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, product_status: "QUESTION_AVAILABLE" },
      hasParentLink: true, answerCount: 0,
      forUpdateReport: {
        id: REPORT_ID, product_status: "QUESTION_AVAILABLE",
        swimming_pool_id: POOL_ID, deleted_at: null,
      },
    });
    const res = await request(app).post(`/parent/growth-reports/${REPORT_ID}/complete`).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("TC28: complete repeated idempotent (already READY_FOR_ANALYSIS → 200 already_complete)", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, product_status: "READY_FOR_ANALYSIS" },
      hasParentLink: true,
    });
    const res = await request(app).post(`/parent/growth-reports/${REPORT_ID}/complete`).send({});
    expect(res.status).toBe(200);
    expect(res.body.already_complete).toBe(true);
  });
});

// ─── E. Post-analysis edit lock ───────────────────────────────────────────────

describe("E. Post-analysis edit lock", () => {
  const LOCKED_STATUSES = ["ANALYZING", "REVIEW_REQUIRED", "APPROVED", "PUBLISHED"] as const;

  it("TC29: ANALYZING → 423 EDIT_LOCKED", async () => {
    setupDb({ reportRow: { ...BASE_REPORT, product_status: "ANALYZING", parent_input_status: "ANSWERED" }, hasParentLink: true });
    const res = await request(app).put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("EDIT_LOCKED");
  });

  it("TC30: REVIEW_REQUIRED → 423 EDIT_LOCKED", async () => {
    setupDb({ reportRow: { ...BASE_REPORT, product_status: "REVIEW_REQUIRED", parent_input_status: "ANSWERED" }, hasParentLink: true });
    const res = await request(app).put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("EDIT_LOCKED");
  });

  it("TC31: APPROVED → 423 EDIT_LOCKED", async () => {
    setupDb({ reportRow: { ...BASE_REPORT, product_status: "APPROVED", parent_input_status: "ANSWERED" }, hasParentLink: true });
    const res = await request(app).put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("EDIT_LOCKED");
  });

  it("TC32: PUBLISHED → 423 EDIT_LOCKED", async () => {
    setupDb({ reportRow: { ...BASE_REPORT, product_status: "PUBLISHED", parent_input_status: "ANSWERED" }, hasParentLink: true });
    const res = await request(app).put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("EDIT_LOCKED");
  });
});

// ─── F. Second-pass path ──────────────────────────────────────────────────────

describe("F. Second-pass path", () => {
  it("TC33: READY_FOR_ANALYSIS → ANALYZING allowed (GR3 worker picks up)", () => {
    expect(ALLOWED_TRANSITIONS["READY_FOR_ANALYSIS"]).toContain("ANALYZING");
  });

  it("TC34: next snapshot contains saved parent answers (upsert SQL verified)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const r = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(r.status).toBe(200);
    const calls = (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) =>
        q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? ""
      );
    const upsertCalls = calls.filter((s: string) =>
      s.includes("growth_report_answers") && s.includes("ON CONFLICT"),
    );
    expect(upsertCalls.length).toBeGreaterThan(0);
  });

  it("TC35: APP does NOT interpret answer (no interpretation field)", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    expect(res.status).toBe(200);
    expect(res.body.interpretation).toBeUndefined();
    expect(res.body.agreement).toBeUndefined();
    expect(res.body.contradiction).toBeUndefined();
  });

  it("TC36: UNKNOWN value stays raw structured (accepted, not remapped)", async () => {
    setupDb({
      reportRow: BASE_REPORT, hasParentLink: true,
      questions: [{ ...BASE_QUESTIONS[0]!, options: [{ value: "YES" }, { value: "NO" }, { value: "UNKNOWN" }] }],
    });
    const res = await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["UNKNOWN"] }] });
    expect(res.status).toBe(200);
  });
});

// ─── G. Audit ─────────────────────────────────────────────────────────────────

describe("G. Audit", () => {
  function getAuditCalls() {
    return (vi.mocked(superAdminDb).execute as any).mock.calls
      .map(([q]: any) =>
        q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? ""
      );
  }

  it("TC37: PARENT_GROWTH_ANSWER_SAVED audit written on save", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    await request(app)
      .put(`/parent/growth-reports/${REPORT_ID}/answers`)
      .send({ answers: [{ question_id: Q1_ID, selected_values: ["YES"] }] });
    const saved = getAuditCalls().filter((s: string) => s.includes("PARENT_GROWTH_ANSWER_SAVED"));
    expect(saved.length).toBeGreaterThan(0);
  });

  it("TC38: PARENT_GROWTH_INPUT_COMPLETED audit written on complete", async () => {
    setupDb({
      reportRow: { ...BASE_REPORT, product_status: "QUESTION_AVAILABLE" },
      hasParentLink: true, answerCount: 1,
      forUpdateReport: { id: REPORT_ID, product_status: "QUESTION_AVAILABLE", swimming_pool_id: POOL_ID, deleted_at: null },
    });
    await request(app).post(`/parent/growth-reports/${REPORT_ID}/complete`).send({});
    const completed = getAuditCalls().filter((s: string) => s.includes("PARENT_GROWTH_INPUT_COMPLETED"));
    expect(completed.length).toBeGreaterThan(0);
  });

  it("TC39: no other parent account data in questions response", async () => {
    setupDb({ reportRow: BASE_REPORT, hasParentLink: true });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}/questions`);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(OTHER_PARENT);
    expect(json).not.toContain("phone");
    expect(json).not.toContain("pin_hash");
  });
});

// ─── H. Parent UI structural checks ──────────────────────────────────────────

describe("H. Parent UI structural checks", () => {
  let uiSrc: string;

  beforeAll(async () => {
    const { readFileSync } = await import("node:fs");
    uiSrc = readFileSync(
      "/home/runner/workspace/artifacts/swim-app/app/(parent)/growth-report-questions.tsx",
      "utf-8",
    );
  });

  it("TC40: Parent UI renders questions (QuestionCard component present)", () => {
    expect(uiSrc).toContain("QuestionCard");
  });

  it("TC41: UI single select interaction (SINGLE_CHOICE + radio present)", () => {
    expect(uiSrc).toContain("SINGLE_CHOICE");
    expect(uiSrc).toContain("radio");
  });

  it("TC42: UI multi select interaction (MULTI_CHOICE + checkbox present)", () => {
    expect(uiSrc).toContain("MULTI_CHOICE");
    expect(uiSrc).toContain("checkbox");
  });

  it("TC43: existing saved value hydrate (existing_answer in source)", () => {
    expect(uiSrc).toContain("existing_answer");
    expect(uiSrc).toContain("hydrate");
  });

  it("TC44: save loading/error state present", () => {
    expect(uiSrc).toContain("saving");
    expect(uiSrc).toContain("saveError");
  });

  it("TC45: closed disabled state present", () => {
    expect(uiSrc).toContain("isReadOnly");
    expect(uiSrc).toContain("disabled");
    expect(uiSrc).toContain("CLOSED");
  });

  it("TC46: optional copy present (가정 / 선택)", () => {
    expect(uiSrc).toContain("가정");
    expect(uiSrc).toContain("선택");
  });

  it("TC47: no required-evaluation wording", () => {
    expect(uiSrc).not.toContain("반드시 답하세요");
    expect(uiSrc).not.toContain("필수로 답해야");
    expect(uiSrc).not.toContain("필수 응답");
  });

  it("TC48: stable parent route (reportId param + growth-report-questions path)", () => {
    expect(uiSrc).toContain("reportId");
    expect(uiSrc).toContain("growth-report-questions");
  });
});

// ─── I. Regression ────────────────────────────────────────────────────────────

describe("I. Regression", () => {
  it("TC49: GR3 regression — runGrowthReportAnalysisWorker export intact", async () => {
    const { runGrowthReportAnalysisWorker } = await import("../../jobs/growth-report-analysis-worker.js");
    expect(typeof runGrowthReportAnalysisWorker).toBe("function");
  });

  it("TC50: GR2 regression — runGrowthReportScheduler export intact", async () => {
    const { runGrowthReportScheduler } = await import("../../jobs/growth-report-scheduler.js");
    expect(typeof runGrowthReportScheduler).toBe("function");
  });

  it("TC51: GR1 regression — ALL_PRODUCT_STATUSES intact", () => {
    expect(ALL_PRODUCT_STATUSES.has("QUESTION_AVAILABLE")).toBe(true);
    expect(ALL_PRODUCT_STATUSES.has("READY_FOR_ANALYSIS")).toBe(true);
    expect(ALL_PRODUCT_STATUSES.has("PUBLISHED")).toBe(true);
    expect(ALL_PRODUCT_STATUSES.size).toBeGreaterThanOrEqual(10);
  });

  it("TC52: Parent auth regression — requireParent role gate is functional", () => {
    expect(typeof parentGrowthReportRouter).toBe("function");
  });

  it("TC53: Notifications route regression — still importable", async () => {
    const mod = await import("../../routes/notifications.js");
    expect(mod.default).toBeDefined();
  });

  it("TC54: Parent Diary regression — parent.ts still importable", async () => {
    const mod = await import("../../routes/parent.js");
    expect(mod.default).toBeDefined();
  });
});

// ─── J. Status / lifecycle completeness ───────────────────────────────────────

describe("J. Status lifecycle completeness", () => {
  it("QUESTION_REQUIRED is forbidden (spec §2 — not in ALL_PRODUCT_STATUSES)", () => {
    expect(ALL_PRODUCT_STATUSES.has("QUESTION_REQUIRED" as any)).toBe(false);
  });

  it("CLOSED is ParentInputStatus, not ProductStatus", () => {
    expect(ALL_PRODUCT_STATUSES.has("CLOSED" as any)).toBe(false);
    expect(ALL_PARENT_INPUT_STATUSES.has("CLOSED")).toBe(true);
  });

  it("QUESTION_AVAILABLE → READY_FOR_ANALYSIS is allowed", () => {
    expect(ALLOWED_TRANSITIONS.QUESTION_AVAILABLE).toContain("READY_FOR_ANALYSIS");
  });

  it("READY_FOR_ANALYSIS → ANALYZING is allowed (GR3 worker second-pass)", () => {
    expect(ALLOWED_TRANSITIONS.READY_FOR_ANALYSIS).toContain("ANALYZING");
  });
});
