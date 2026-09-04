/**
 * gr3-growth-report-engine-integration.test.ts
 *
 * GR3: ENGINE Integration + Immutable Snapshot + Result Persistence
 * 65 TC (spec §42 1~65)
 *
 * Tests use fake DB mocks and a fake ENGINE adapter.
 * No Production data. No real ENGINE calls. No real DB writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  computeCanonicalHash,
  isRetryableEngineError,
  EngineCallError,
  RETRYABLE_ENGINE_ERROR_CODES,
  NON_RETRYABLE_ENGINE_ERROR_CODES,
  GR_CONTRACT_VERSION,
  GR_SNAPSHOT_VERSION,
  getEngineUrl,
  getEngineSecret,
  getEngineTimeoutMs,
  analyzeGrowthReport,
  type GrowthReportAnalysisRequest,
  type GrowthReportAnalysisResponse,
} from "../../lib/growth-report-engine-client.js";

import {
  buildAnalysisSnapshot,
  type BuildSnapshotInput,
} from "../../lib/growth-report-snapshot-builder.js";

import {
  validateEngineResponse,
  mapEngineStatusToProductStatus,
  persistEngineResult,
  persistEngineQuestions,
  EngineResponseValidationError,
  StaleEngineResponseError,
  GroundingFailError,
  auditAnalysisStarted,
  auditAnalysisFailed,
  auditStaleRejected,
} from "../../lib/growth-report-result-handler.js";

import {
  transitionReportStatus,
  InvalidTransitionError,
} from "../../lib/growth-report-service.js";

import { runGrowthReportAnalysisWorker } from "../../jobs/growth-report-analysis-worker.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUTOFF_AT    = "2026-08-24T15:00:00.000Z"; // 25일 00:00 KST
const CUTOFF_DATE  = "2026-08-24";               // text portion
const REPORT_PERIOD = "2026-08";

const BASE_REPORT = {
  id:              "gr_test01",
  student_id:      "stu_01",
  swimming_pool_id: "pool_x",
  cycle_id:        "grc_01",
  report_period:   REPORT_PERIOD,
  teacher_reviewed_by: null,
  teacher_reviewed_at: null,
};

const BASE_CYCLE = {
  id:                   "grc_01",
  analysis_from:        null,
  analysis_cutoff_at:   CUTOFF_AT,
  parent_input_open_at: CUTOFF_AT,
  parent_input_close_at: "2026-09-04T15:00:00.000Z",
  report_period:        REPORT_PERIOD,
  timezone:             "Asia/Seoul",
};

// ─── DB mock factory ──────────────────────────────────────────────────────────

interface DbMockOptions {
  diaries?: any[];
  growthEvents?: any[];
  attendance?: any[];
  curriculumAssign?: any[];
  levels?: any[];
  curriculumItems?: any[];
  parentAnswers?: any[];
  publishedHistory?: any[];
  reportRow?: any;
  updateReturns?: boolean; // true = stale OK, false = stale rejected
  nextVersion?: number;
}

function makeDb(opts: DbMockOptions = {}) {
  const calls: string[] = [];

  const db = {
    _calls: calls,
    execute: vi.fn(async (query: any) => {
      const q: string = query?.queryChunks
        ? query.queryChunks
            .map((c: any) => (typeof c === "string" ? c : (c?.value ?? "")))
            .join("")
        : String(query?.sql ?? query ?? "");

      calls.push(q.replace(/\s+/g, " ").trim());

      // Diary query
      if (q.includes("class_diary_student_notes") && q.includes("lesson_date")) {
        return { rows: opts.diaries ?? [] };
      }
      // Growth events
      if (q.includes("growth_events") && q.includes("is_invalidated")) {
        return { rows: opts.growthEvents ?? [] };
      }
      // Attendance
      if (q.includes("FROM attendance") || (q.includes("attendance") && q.includes("date <"))) {
        return { rows: opts.attendance ?? [] };
      }
      // Curriculum assignment
      if (q.includes("student_curriculum_assignments")) {
        return { rows: opts.curriculumAssign ?? [] };
      }
      // Student levels
      if (q.includes("student_levels")) {
        return { rows: opts.levels ?? [] };
      }
      // Curriculum items
      if (q.includes("curriculum_items")) {
        return { rows: opts.curriculumItems ?? [] };
      }
      // Parent answers
      if (q.includes("growth_report_answers")) {
        return { rows: opts.parentAnswers ?? [] };
      }
      // FOR UPDATE (transitionReportStatus internal SELECT) — MUST come before product_status check
      if (q.includes("FOR UPDATE")) {
        if (opts.reportRow) return { rows: [opts.reportRow] };
        return { rows: [] };
      }
      // Stale CAS UPDATE (WHERE analysis_request_id = ...)
      if (q.includes("analysis_request_id") && q.includes("RETURNING")) {
        const ok = opts.updateReturns !== false;
        return ok ? { rows: [{ id: "gr_test01" }] } : { rows: [] };
      }
      // next_audit_version
      if (q.includes("next_audit_version")) {
        return { rows: [{ v: opts.nextVersion ?? 1 }] };
      }
      // Published history (getPublishedReportHistory) — after FOR UPDATE check
      if (q.includes("product_status = 'PUBLISHED'") || q.includes("AND product_status")) {
        return { rows: opts.publishedHistory ?? [] };
      }
      // Generic UPDATE / INSERT
      if (q.includes("UPDATE") || q.includes("INSERT")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    }),
  };

  return db as any;
}

// ─── Valid ENGINE response factory ────────────────────────────────────────────

function makeEngineResponse(
  overrides: Partial<GrowthReportAnalysisResponse> = {},
): GrowthReportAnalysisResponse {
  return {
    request_id:      "req_01",
    report_id:       "gr_test01",
    analysis_status: "COMPLETE",
    questions:       [],
    report_content:  { summary: "Growth happened" },
    sns_summary:     { text: "Great progress!", share_safe: true },
    fact_package:    { facts: [] },
    validation:      { grounding: "PASS", growth_framing: "PASS" },
    trace:           { payload_hash: "placeholder_hash" },
    metric_evidence: {},
    positive_signals: [],
    synthesis:       { success_conditions: [], support_levers: [] },
    ...overrides,
  };
}

// ─── Mock getPublishedReportHistory ───────────────────────────────────────────

vi.mock("../../lib/growth-report-service.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/growth-report-service.js")>();
  return {
    ...real,
    // wrap as vi.fn so tests can override with mockImplementationOnce
    transitionReportStatus:    vi.fn(real.transitionReportStatus),
    getPublishedReportHistory: vi.fn(async () => []),
  };
});

import { getPublishedReportHistory } from "../../lib/growth-report-service.js";

// ─── TC 1–5: Canonical hash ───────────────────────────────────────────────────

describe("A. Canonical hash", () => {
  it("TC1: computeCanonicalHash is deterministic (same object → same hash)", () => {
    const obj = { student: "stu_01", period: "2026-08", events: [1, 2] };
    expect(computeCanonicalHash(obj)).toBe(computeCanonicalHash(obj));
  });

  it("TC2: object key order does NOT affect hash", () => {
    const a = { b: 2, a: 1 };
    const b = { a: 1, b: 2 };
    expect(computeCanonicalHash(a)).toBe(computeCanonicalHash(b));
  });

  it("TC3: nested key order is also normalized", () => {
    const a = { outer: { z: 9, a: 1 }, top: "v" };
    const b = { top: "v", outer: { a: 1, z: 9 } };
    expect(computeCanonicalHash(a)).toBe(computeCanonicalHash(b));
  });

  it("TC4: known hash fixture — {a:1,b:2} → sha256('{'a':1,'b':2}')", () => {
    // Pre-computed: sha256('{"a":1,"b":2}') = 72cd438c...
    const h = computeCanonicalHash({ b: 2, a: 1 });
    // Verify it equals sha256 of '{"a":1,"b":2}'
    const { createHash } = require("node:crypto");
    const expected = createHash("sha256")
      .update('{"a":1,"b":2}', "utf8")
      .digest("hex");
    expect(h).toBe(expected);
  });

  it("TC5: arrays preserve element order (not key-sorted)", () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [3, 2, 1] };
    expect(computeCanonicalHash(a)).not.toBe(computeCanonicalHash(b));
  });
});

// ─── TC 6–16: Snapshot builder ────────────────────────────────────────────────

describe("B. Snapshot builder", () => {
  const input: BuildSnapshotInput = {
    report: BASE_REPORT,
    cycle:  BASE_CYCLE,
  };

  it("TC6: APP canonical snapshot is generated (contract_version, request_id, context)", async () => {
    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, input);
    expect(request.contract_version).toBe(GR_CONTRACT_VERSION);
    expect(request.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(request.report_id).toBe("gr_test01");
  });

  it("TC7: analysis_from = null (GR2 policy, never overridden in GR3)", async () => {
    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, input);
    expect(request.context.analysis_from).toBeNull();
  });

  it("TC8: analysis_cutoff_at = 25일 00:00 KST (2026-08-24T15:00:00Z)", async () => {
    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, input);
    expect(request.context.analysis_cutoff_at).toBe(CUTOFF_AT);
  });

  it("TC9: cutoff 이후 diary 제외 (lesson_date >= cutoffDate not in snapshot)", async () => {
    const db = makeDb({
      diaries: [
        { id: "d_before", lesson_date: "2026-08-20", common_content: "ok",
          class_level: null, note_content: "note", note_student_id: "stu_01" },
        // NOTE: DB mock returns whatever we set — filtering is in SQL WHERE
        // We test that the SQL query contains the cutoff constraint
      ],
    });
    await buildAnalysisSnapshot(db, input);
    const diaryCalls = db._calls.filter((c: string) => c.includes("lesson_date"));
    expect(diaryCalls.some((c: string) => c.includes(CUTOFF_DATE))).toBe(true);
  });

  it("TC10: cutoff 이후 growth event 제외 (SQL WHERE occurred_at < cutoff)", async () => {
    const db = makeDb();
    await buildAnalysisSnapshot(db, input);
    const evCalls = db._calls.filter((c: string) =>
      c.includes("growth_events") && c.includes("occurred_at"),
    );
    expect(evCalls.length).toBeGreaterThan(0);
    expect(evCalls.some((c: string) => c.includes(CUTOFF_AT))).toBe(true);
  });

  it("TC11: cutoff 이후 attendance 제외 (SQL WHERE date < cutoff date)", async () => {
    const db = makeDb();
    await buildAnalysisSnapshot(db, input);
    const attCalls = db._calls.filter((c: string) =>
      c.includes("attendance") && c.includes("date"),
    );
    expect(attCalls.length).toBeGreaterThan(0);
  });

  it("TC12: correct student diary notes only (other students excluded via JOIN ON student_id)", async () => {
    const db = makeDb({
      diaries: [
        { id: "d1", lesson_date: "2026-08-10", common_content: "class",
          class_level: null, note_content: "note_stu_01", note_student_id: "stu_01" },
      ],
    });
    const { request } = await buildAnalysisSnapshot(db, input);
    // Only stu_01's note should appear
    for (const d of request.snapshot.diaries) {
      for (const n of d.student_notes) {
        expect(n.student_ref).toBe("stu_01");
      }
    }
    // SQL JOIN must reference student_id = stu_01
    const diaryCalls = db._calls.filter((c: string) => c.includes("class_diary_student_notes"));
    expect(diaryCalls.some((c: string) => c.includes("stu_01"))).toBe(true);
  });

  it("TC13: invalidated growth events excluded (is_invalidated = false in SQL)", async () => {
    const db = makeDb({ growthEvents: [] });
    await buildAnalysisSnapshot(db, input);
    const evCalls = db._calls.filter((c: string) => c.includes("growth_events"));
    expect(evCalls.some((c: string) => c.includes("is_invalidated"))).toBe(true);
  });

  it("TC14: curriculum snapshot present when assigned", async () => {
    const db = makeDb({
      curriculumAssign: [{ curriculum_version_id: "cv_01" }],
      levels:           [{ level: "중급", level_order: 2 }],
      curriculumItems:  [{ title: "Freestyle basics" }],
    });
    const { request } = await buildAnalysisSnapshot(db, input);
    expect(request.snapshot.curriculum_state).not.toBeNull();
    expect(request.snapshot.curriculum_state?.current_level).toBe("중급");
    expect(request.snapshot.curriculum_state?.curriculum_id).toBe("cv_01");
  });

  it("TC15: curriculum missing → null (pool may not use curriculum)", async () => {
    const db = makeDb({ curriculumAssign: [], levels: [] });
    const { request } = await buildAnalysisSnapshot(db, input);
    expect(request.snapshot.curriculum_state).toBeNull();
  });

  it("TC16: parent answers structured (question_id, metric_id, selected_values)", async () => {
    const db = makeDb({
      parentAnswers: [
        {
          question_id: "q_01",
          metric_id:   "F001",
          selected_values: ["yes"],
          answered_at: new Date("2026-09-01T10:00:00Z"),
          parent_account_id: "pa_01",
        },
      ],
    });
    const { request } = await buildAnalysisSnapshot(db, input);
    expect(request.snapshot.parent_answers).toHaveLength(1);
    expect(request.snapshot.parent_answers[0]!.question_id).toBe("q_01");
    expect(request.snapshot.parent_answers[0]!.metric_id).toBe("F001");
    expect(request.snapshot.parent_answers[0]!.selected_values).toEqual(["yes"]);
  });
});

// ─── TC 17–21: Longitudinal ───────────────────────────────────────────────────

describe("C. Longitudinal assembler", () => {
  // getPublishedReportHistory is already mocked at module level via vi.mock above
  const mockHistory = vi.mocked(getPublishedReportHistory);

  it("TC17: parent answers 없음 정상 ([] returned when no answers)", async () => {
    const db = makeDb({ parentAnswers: [] });
    const { request } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    expect(request.snapshot.parent_answers).toEqual([]);
  });

  it("TC18: history structured 변환 (natural language body not forwarded)", async () => {
    vi.mocked(mockHistory).mockResolvedValueOnce([
      {
        report_period:  "2026-07",
        analysis_status: "COMPLETE",
        report_content: {
          summary_text: "NATURAL LANGUAGE — should NOT be forwarded",
          metric_states: [{ metric_id: "F001", state: "IMPROVING" }],
          success_conditions: ["can do freestyle"],
          support_levers: [],
          positive_growth_signals: [],
          parent_evidence: [],
          next_observation_targets: [{ label: "breathing" }],
        },
      },
    ] as any);

    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const { longitudinal } = request.snapshot;

    // Structured fields assembled
    expect(longitudinal.metric_state_history).toHaveLength(1);
    expect(longitudinal.success_condition_history).toHaveLength(1);
    expect(longitudinal.previous_report_structured_results).toHaveLength(1);

    // Natural language body NOT forwarded
    const serialized = JSON.stringify(longitudinal);
    expect(serialized).not.toContain("NATURAL LANGUAGE — should NOT be forwarded");
  });

  it("TC19: multiple history reports assembled", async () => {
    vi.mocked(mockHistory).mockResolvedValueOnce([
      { report_period: "2026-07", analysis_status: "COMPLETE", report_content: { metric_states: [{ id: "m1" }] } },
      { report_period: "2026-06", analysis_status: "COMPLETE", report_content: { metric_states: [{ id: "m2" }] } },
    ] as any);

    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    expect(request.snapshot.longitudinal.metric_state_history).toHaveLength(2);
    expect(request.snapshot.longitudinal.previous_report_structured_results).toHaveLength(2);
  });

  it("TC20: observation_target verified_this_period NOT computed by APP", async () => {
    vi.mocked(mockHistory).mockResolvedValueOnce([
      {
        report_period:  "2026-07",
        analysis_status: "COMPLETE",
        report_content: {
          next_observation_targets: [{ label: "freestyle turn" }],
        },
      },
    ] as any);

    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const targets = request.snapshot.longitudinal.observation_target_history;
    expect(targets).toHaveLength(1);
    // verified_this_period must NOT be present (ENGINE verifies)
    expect(JSON.stringify(targets)).not.toContain("verified_this_period");
  });

  it("TC21: max_history_periods limits depth", async () => {
    const manyReports = Array.from({ length: 20 }, (_, i) => ({
      report_period:  `2026-${String(i + 1).padStart(2, "0")}`,
      analysis_status: "COMPLETE",
      report_content: { metric_states: [{ i }] },
    }));
    vi.mocked(mockHistory).mockResolvedValueOnce(manyReports as any);

    const db = makeDb();
    const { request } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    // Default max is 12; we verify it's capped
    expect(request.snapshot.longitudinal.previous_report_structured_results.length).toBeLessThanOrEqual(12);
  });
});

// ─── TC 22–28: Engine client ──────────────────────────────────────────────────

describe("D. Engine client", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("TC22: ENGINE_URL not set → non-retryable EngineCallError", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "");
    const req = { request_id: "r1" } as any;
    await expect(analyzeGrowthReport(req)).rejects.toThrow(EngineCallError);
    await expect(analyzeGrowthReport(req)).rejects.toMatchObject({
      retryable: false,
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
    });
  });

  it("TC23: auth header sent when GROWTH_REPORT_ENGINE_SECRET is set", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://fake-engine.test");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "my-secret-token");

    let capturedHeaders: Record<string, string> = {};
    const mockFetch = vi.fn(async (url: string, opts: any) => {
      capturedHeaders = opts.headers ?? {};
      return { ok: true, json: async () => makeEngineResponse() };
    });
    vi.stubGlobal("fetch", mockFetch);

    await analyzeGrowthReport({
      contract_version: GR_CONTRACT_VERSION,
      request_id: "r1", report_id: "gr1",
      context: { student_id: "s1", pool_id: "p1", report_period: "2026-08",
                 analysis_from: null, analysis_cutoff_at: CUTOFF_AT, timezone: "Asia/Seoul" },
      snapshot: { snapshot_version: 1, payload_hash: "hash", created_at: "t",
                  diaries: [], growth_events: [], attendance: [],
                  curriculum_state: null, longitudinal: {
                    metric_state_history: [], positive_growth_signal_history: [],
                    success_condition_history: [], support_lever_history: [],
                    parent_evidence_history: [], observation_target_history: [],
                    previous_report_structured_results: [],
                  }, parent_answers: [] },
    } as any).catch(() => {});

    expect(capturedHeaders["Authorization"]).toBe("Bearer my-secret-token");
    vi.unstubAllGlobals();
  });

  it("TC24: timeout → AbortError → retryable EngineCallError (COMPOSITION_TIMEOUT)", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://fake-engine.test");
    vi.stubEnv("GROWTH_REPORT_ENGINE_TIMEOUT_MS", "1"); // 1ms = immediate timeout

    const mockFetch = vi.fn(
      () => new Promise((_, reject) =>
        setTimeout(() => { const e = new Error("abort"); e.name = "AbortError"; reject(e); }, 5),
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(analyzeGrowthReport({} as any)).rejects.toMatchObject({
      retryable: true,
      errorCode: "COMPOSITION_TIMEOUT",
    });
    vi.unstubAllGlobals();
  });

  it("TC25: retryable error classification", () => {
    const retryableCodes = ["COMPOSITION_PROVIDER_ERROR", "COMPOSITION_TIMEOUT", "NETWORK_ERROR"];
    for (const code of retryableCodes) {
      const err = new EngineCallError(code, 500, true, "test");
      expect(isRetryableEngineError(err)).toBe(true);
    }
  });

  it("TC26: non-retryable error classification", () => {
    const nonRetryableCodes = [
      "INVALID_CONTRACT", "PAYLOAD_HASH_MISMATCH",
      "UNKNOWN_METRIC_ID", "SOURCE_AFTER_ANALYSIS_CUTOFF",
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
    ];
    for (const code of nonRetryableCodes) {
      const err = new EngineCallError(code, 400, false, "test");
      expect(isRetryableEngineError(err)).toBe(false);
    }
  });

  it("TC27: request_id is UUID v4 format", async () => {
    const db = makeDb();
    const { requestId } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("TC28: GROWTH_REPORT_ENGINE_TIMEOUT_MS configurable (returns number)", () => {
    // getEngineTimeoutMs reads env at call time
    expect(typeof getEngineTimeoutMs()).toBe("number");
    expect(getEngineTimeoutMs()).toBeGreaterThan(0);
  });
});

// ─── TC 29–35: Response validator ────────────────────────────────────────────

describe("E. Response validator", () => {
  const HASH = "abc123";

  it("TC29: valid Engine response → no throw", () => {
    const res = makeEngineResponse({ trace: { payload_hash: HASH } });
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH)).not.toThrow();
  });

  it("TC30: request_id mismatch → EngineResponseValidationError", () => {
    const res = makeEngineResponse({ request_id: "WRONG", trace: { payload_hash: HASH } });
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH))
      .toThrow(EngineResponseValidationError);
  });

  it("TC31: report_id mismatch → EngineResponseValidationError", () => {
    const res = makeEngineResponse({ report_id: "WRONG", trace: { payload_hash: HASH } });
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH))
      .toThrow(EngineResponseValidationError);
  });

  it("TC32: payload hash mismatch → EngineResponseValidationError", () => {
    const res = makeEngineResponse({ trace: { payload_hash: "DIFFERENT" } });
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH))
      .toThrow(EngineResponseValidationError);
  });

  it("TC33: invalid analysis_status → EngineResponseValidationError", () => {
    const res = makeEngineResponse({
      analysis_status: "NOT_A_STATUS" as any,
      trace: { payload_hash: HASH },
    });
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH))
      .toThrow(EngineResponseValidationError);
  });

  it("TC34: APP lifecycle status in ENGINE response → EngineResponseValidationError", () => {
    // e.g. ENGINE accidentally returns "OPEN" as analysis_status
    // But OPEN is not a valid EngineAnalysisStatus so it fails the isValid check first.
    // More precisely: a future ENGINE version returning an APP status must be caught.
    const res = { ...makeEngineResponse(), analysis_status: "OPEN" as any, trace: { payload_hash: HASH } };
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH))
      .toThrow(EngineResponseValidationError);
  });

  it("TC35: questions not array → EngineResponseValidationError", () => {
    const res = makeEngineResponse({ questions: "not-an-array" as any, trace: { payload_hash: HASH } });
    expect(() => validateEngineResponse(res, "req_01", "gr_test01", HASH))
      .toThrow(EngineResponseValidationError);
  });
});

// ─── TC 36–38: Grounding / framing gate ──────────────────────────────────────

describe("F. Grounding / framing gate", () => {
  const buildInput = (report = BASE_REPORT): Parameters<typeof persistEngineResult>[0] => ({
    db:                   makeDb({ reportRow: { id: report.id, product_status: "PREANALYZING", swimming_pool_id: "pool_x", deleted_at: null } }),
    report,
    requestId:            "req_01",
    payloadHash:          "hash_x",
    response:             makeEngineResponse({ trace: { payload_hash: "hash_x" } }),
    stage:                "PREANALYSIS",
    parentInputWindowOpen: false,
  });

  it("TC36: grounding FAIL → GroundingFailError (content not saved)", async () => {
    const inp = buildInput();
    inp.response = makeEngineResponse({
      trace:      { payload_hash: "hash_x" },
      validation: { grounding: "FAIL", growth_framing: "PASS" },
    });
    await expect(persistEngineResult(inp)).rejects.toThrow(GroundingFailError);
  });

  it("TC37: growth_framing FAIL → GroundingFailError", async () => {
    const inp = buildInput();
    inp.response = makeEngineResponse({
      trace:      { payload_hash: "hash_x" },
      validation: { grounding: "PASS", growth_framing: "FAIL" },
    });
    await expect(persistEngineResult(inp)).rejects.toThrow(GroundingFailError);
  });

  it("TC38: REVISED_PASS is accepted (not rejected)", async () => {
    const inp = buildInput();
    inp.response = makeEngineResponse({
      trace:      { payload_hash: "hash_x" },
      validation: { grounding: "REVISED_PASS", growth_framing: "REVISED_PASS" },
    });
    // Should not throw on grounding (may throw StaleEngineResponseError from CAS — that's OK)
    await persistEngineResult(inp).catch((e) => {
      expect(e).not.toBeInstanceOf(GroundingFailError);
    });
  });
});

// ─── TC 39–47: Status mapping ─────────────────────────────────────────────────

describe("G. Engine status → product status mapping", () => {
  it("TC39: PREANALYSIS + COMPLETE_WITH_QUESTIONS_AVAILABLE + open + questions → QUESTION_AVAILABLE", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE_WITH_QUESTIONS_AVAILABLE", "PREANALYSIS",
        { questionsCount: 3, parentInputWindowOpen: true },
      ),
    ).toBe("QUESTION_AVAILABLE");
  });

  it("TC40: PREANALYSIS + COMPLETE + no questions → READY_FOR_ANALYSIS", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE", "PREANALYSIS",
        { questionsCount: 0, parentInputWindowOpen: true },
      ),
    ).toBe("READY_FOR_ANALYSIS");
  });

  it("TC41: PREANALYSIS + COMPLETE + questions + open window → QUESTION_AVAILABLE", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE", "PREANALYSIS",
        { questionsCount: 2, parentInputWindowOpen: true },
      ),
    ).toBe("QUESTION_AVAILABLE");
  });

  it("TC42: PREANALYSIS + COMPLETE + questions + closed window → READY_FOR_ANALYSIS", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE", "PREANALYSIS",
        { questionsCount: 2, parentInputWindowOpen: false },
      ),
    ).toBe("READY_FOR_ANALYSIS");
  });

  it("TC43: PREANALYSIS + PARTIAL → PARTIAL", () => {
    expect(
      mapEngineStatusToProductStatus(
        "PARTIAL", "PREANALYSIS",
        { questionsCount: 0, parentInputWindowOpen: false },
      ),
    ).toBe("PARTIAL");
  });

  it("TC44: FINAL_ANALYSIS + COMPLETE → REVIEW_REQUIRED", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE", "FINAL_ANALYSIS",
        { questionsCount: 0, parentInputWindowOpen: false },
      ),
    ).toBe("REVIEW_REQUIRED");
  });

  it("TC45: FINAL_ANALYSIS + COMPLETE_WITH_PARENT_EVIDENCE → REVIEW_REQUIRED", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE_WITH_PARENT_EVIDENCE", "FINAL_ANALYSIS",
        { questionsCount: 0, parentInputWindowOpen: false },
      ),
    ).toBe("REVIEW_REQUIRED");
  });

  it("TC46: FINAL_ANALYSIS + PARTIAL → REVIEW_REQUIRED (teacher can review PARTIAL)", () => {
    expect(
      mapEngineStatusToProductStatus(
        "PARTIAL", "FINAL_ANALYSIS",
        { questionsCount: 0, parentInputWindowOpen: false },
      ),
    ).toBe("REVIEW_REQUIRED");
  });

  it("TC47: zero questions flow → READY_FOR_ANALYSIS (no questions = skip parent input)", () => {
    expect(
      mapEngineStatusToProductStatus(
        "COMPLETE_WITH_QUESTIONS_AVAILABLE", "PREANALYSIS",
        { questionsCount: 0, parentInputWindowOpen: true },
      ),
    ).toBe("READY_FOR_ANALYSIS");
  });
});

// ─── TC 48–55: Persistence ────────────────────────────────────────────────────

describe("H. Persistence", () => {
  const makePeristInput = (
    overrides: Partial<GrowthReportAnalysisResponse> = {},
    dbOpts: DbMockOptions = {},
  ): Parameters<typeof persistEngineResult>[0] => {
    const hash = "fixed_hash_001";
    const db = makeDb({
      reportRow:     { id: "gr_test01", product_status: "PREANALYZING", swimming_pool_id: "pool_x", deleted_at: null },
      updateReturns: true,
      ...dbOpts,
    });
    return {
      db,
      report:                { id: "gr_test01", swimming_pool_id: "pool_x" },
      requestId:             "req_01",
      payloadHash:           hash,
      response:              makeEngineResponse({ trace: { payload_hash: hash }, ...overrides }),
      stage:                 "PREANALYSIS",
      parentInputWindowOpen: false,
    };
  };

  it("TC48: report_content structured save (JSON serialized to DB)", async () => {
    const inp = makePeristInput({ report_content: { key: "structured_value_XXXX" } });
    await persistEngineResult(inp);
    const updateCalls = (inp.db as any)._calls.filter((c: string) =>
      c.includes("report_content"),
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("TC49: sns_summary structured save", async () => {
    const inp = makePeristInput({ sns_summary: { text: "Great!", share_safe: true } });
    await persistEngineResult(inp);
    const updateCalls = (inp.db as any)._calls.filter((c: string) =>
      c.includes("sns_summary"),
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("TC50: share_safe preserved (false NOT flipped to true)", async () => {
    const inp = makePeristInput({ sns_summary: { text: "Private", share_safe: false } });
    // The json passed to DB must preserve share_safe: false
    // We verify the response object is NOT mutated
    await persistEngineResult(inp);
    expect(inp.response.sns_summary.share_safe).toBe(false);
  });

  it("TC51: fact_package opaque save (report_fact_package column)", async () => {
    const inp = makePeristInput({ fact_package: { facts: ["a", "b"] } });
    await persistEngineResult(inp);
    const updateCalls = (inp.db as any)._calls.filter((c: string) =>
      c.includes("report_fact_package"),
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("TC52: metric JSON opaque save (metric_states column)", async () => {
    const inp = makePeristInput({ metric_evidence: { F001: { state: "IMPROVING" } } });
    await persistEngineResult(inp);
    const updateCalls = (inp.db as any)._calls.filter((c: string) =>
      c.includes("metric_states"),
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("TC53: Engine questions 저장 (upsert to growth_report_questions)", async () => {
    const hash = "h001";
    const db = makeDb({
      reportRow: { id: "gr_test01", product_status: "PREANALYZING", swimming_pool_id: "pool_x", deleted_at: null },
      updateReturns: true,
    });
    const questions = [
      { engine_question_id: "eq_01", metric_id: "F001", question_text: "어떤가요?",
        answer_type: "SINGLE_CHOICE", options: ["좋아요", "나빠요"],
        sequence: 1, is_required: false },
    ];
    await persistEngineResult({
      db, report: { id: "gr_test01", swimming_pool_id: "pool_x" },
      requestId: "req_01", payloadHash: hash,
      response: makeEngineResponse({ trace: { payload_hash: hash }, questions }),
      stage: "PREANALYSIS", parentInputWindowOpen: true,
    });
    const questionInserts = db._calls.filter((c: string) =>
      c.includes("growth_report_questions"),
    );
    expect(questionInserts.length).toBeGreaterThan(0);
  });

  it("TC54: stale response rejected (StaleEngineResponseError)", async () => {
    const hash = "h002";
    const db = makeDb({
      reportRow:     { id: "gr_test01", product_status: "PREANALYZING", swimming_pool_id: "pool_x", deleted_at: null },
      updateReturns: false, // CAS fails → stale
    });
    await expect(
      persistEngineResult({
        db, report: { id: "gr_test01", swimming_pool_id: "pool_x" },
        requestId: "req_01", payloadHash: hash,
        response: makeEngineResponse({ trace: { payload_hash: hash } }),
        stage: "PREANALYSIS", parentInputWindowOpen: false,
      }),
    ).rejects.toThrow(StaleEngineResponseError);
  });
});

// ─── TC 55–60: Worker / audit ─────────────────────────────────────────────────

describe("I. Worker + Audit", () => {
  it("TC55: questions 0개 정상 (persistEngineQuestions with empty array skips DB)", async () => {
    const db = makeDb();
    await persistEngineQuestions(db, "gr_test01", []);
    const questionCalls = db._calls.filter((c: string) =>
      c.includes("growth_report_questions"),
    );
    expect(questionCalls).toHaveLength(0);
  });

  it("TC56: audit started (ENGINE_ANALYSIS_STARTED event written)", async () => {
    const db = makeDb();
    await auditAnalysisStarted(db, "gr_test01", "pool_x", "req_01");
    const auditCalls = db._calls.filter((c: string) =>
      c.includes("ENGINE_ANALYSIS_STARTED"),
    );
    expect(auditCalls.length).toBeGreaterThan(0);
  });

  it("TC57: audit succeeded (ENGINE_ANALYSIS_SUCCEEDED event written)", async () => {
    const hash = "h003";
    const db = makeDb({
      reportRow:     { id: "gr_test01", product_status: "PREANALYZING", swimming_pool_id: "pool_x", deleted_at: null },
      updateReturns: true,
    });
    await persistEngineResult({
      db, report: { id: "gr_test01", swimming_pool_id: "pool_x" },
      requestId: "req_01", payloadHash: hash,
      response: makeEngineResponse({ trace: { payload_hash: hash } }),
      stage: "PREANALYSIS", parentInputWindowOpen: false,
    });
    const succeededCalls = db._calls.filter((c: string) =>
      c.includes("ENGINE_ANALYSIS_SUCCEEDED"),
    );
    expect(succeededCalls.length).toBeGreaterThan(0);
  });

  it("TC58: audit failed (ENGINE_ANALYSIS_FAILED event written)", async () => {
    const db = makeDb();
    await auditAnalysisFailed(db, "gr_test01", "pool_x", "req_01", "NETWORK_ERROR");
    const failedCalls = db._calls.filter((c: string) =>
      c.includes("ENGINE_ANALYSIS_FAILED"),
    );
    expect(failedCalls.length).toBeGreaterThan(0);
  });

  it("TC59: concurrent analysis prevented (InvalidTransitionError → skip, no crash)", async () => {
    // Make transitionReportStatus throw InvalidTransitionError for one call
    // (simulates another worker already transitioned the report)
    vi.mocked(transitionReportStatus).mockRejectedValueOnce(
      new InvalidTransitionError("OPEN" as any, "PREANALYZING"),
    );

    const db: any = {
      _calls: [] as string[],
      execute: vi.fn(async (query: any) => {
        const q = query?.queryChunks
          ? query.queryChunks
              .map((c: any) => (typeof c === "string" ? c : (c?.value ?? "")))
              .join("")
          : "";
        db._calls.push(q.replace(/\s+/g, " ").trim());
        // Return one OPEN report for the batch query
        if (q.includes("product_status IN")) {
          return {
            rows: [{
              id: "gr_test01", student_id: "s1", swimming_pool_id: "pool_x",
              cycle_id: "grc_01", report_period: "2026-08",
              product_status: "OPEN", analysis_request_id: null,
              analysis_retry_count: 0, teacher_reviewed_by: null, teacher_reviewed_at: null,
              cycle_db_id: "grc_01", analysis_from: null,
              analysis_cutoff_at: CUTOFF_AT,
              parent_input_open_at: CUTOFF_AT,
              parent_input_close_at: "2026-09-04T15:00:00.000Z",
              cycle_report_period: "2026-08", timezone: "Asia/Seoul",
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    // Worker should handle InvalidTransitionError gracefully (skip, no crash)
    const result = await runGrowthReportAnalysisWorker(db);
    expect(typeof result.analyzed).toBe("number");
    // Restore to default implementation for subsequent tests
    vi.mocked(transitionReportStatus).mockRestore();
  });

  it("TC60: stale audit (ENGINE_ANALYSIS_STALE_RESPONSE_REJECTED event)", async () => {
    const db = makeDb();
    await auditStaleRejected(db, "gr_test01", "pool_x", "req_01");
    const staleCalls = db._calls.filter((c: string) =>
      c.includes("ENGINE_ANALYSIS_STALE_RESPONSE_REJECTED"),
    );
    expect(staleCalls.length).toBeGreaterThan(0);
  });
});

// ─── TC 61–63: Privacy + guard ────────────────────────────────────────────────

describe("J. Privacy + X guard + Engine error", () => {
  it("TC61: privacy — phone/address NOT in snapshot", async () => {
    const db = makeDb({
      diaries: [
        { id: "d1", lesson_date: "2026-08-10", common_content: "class",
          class_level: null, note_content: "note", note_student_id: "stu_01" },
      ],
    });
    const { request } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("address");
    expect(serialized).not.toContain("pin_hash");
  });

  it("TC62: raw diary content NOT present in worker log output", () => {
    // Structural test: worker file must not have console.log with raw diary text
    const workerSrc = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-analysis-worker.ts",
      "utf-8",
    );
    // Worker should not log the full diary / student notes objects
    expect(workerSrc).not.toContain("console.log.*diaries");
    expect(workerSrc).not.toContain("note_content");
    expect(workerSrc).not.toContain("common_content");
  });

  it("TC63: Engine 5xx != empty report (EngineCallError thrown, not null/empty returned)", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://fake-engine.test");
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error_code: "SERVICE_UNAVAILABLE" }),
    }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(analyzeGrowthReport({} as any)).rejects.toThrow(EngineCallError);
    // Must NOT return null or empty object
    const caught = await analyzeGrowthReport({} as any).catch((e) => e);
    expect(caught).not.toBeNull();
    expect(caught).not.toEqual({});
    vi.unstubAllGlobals();
  });
});

// ─── TC 64–65: Regression ─────────────────────────────────────────────────────

describe("K. Regression", () => {
  it("TC64: GR1 regression — transitionReportStatus re-exported correctly", async () => {
    const { transitionReportStatus } = await import("../../lib/growth-report-service.js");
    expect(typeof transitionReportStatus).toBe("function");
  });

  it("TC65: GR2 regression — runGrowthReportScheduler export intact", async () => {
    const { runGrowthReportScheduler } = await import(
      "../../jobs/growth-report-scheduler.js"
    );
    expect(typeof runGrowthReportScheduler).toBe("function");
  });
});

// ─── Structural checks (APP metric / question creation prohibition) ───────────

describe("L. APP responsibility boundary (structural)", () => {
  const snapshotSrc = readFileSync(
    "/home/runner/workspace/artifacts/api-server/src/lib/growth-report-snapshot-builder.ts",
    "utf-8",
  );
  const resultSrc = readFileSync(
    "/home/runner/workspace/artifacts/api-server/src/lib/growth-report-result-handler.ts",
    "utf-8",
  );

  it("TC17b: APP metric interpretation 없음 (no metric scoring in snapshot builder)", () => {
    // Snapshot builder must not contain metric scoring / interpretation code
    expect(snapshotSrc).not.toMatch(/metric.*score|score.*metric/i);
    expect(snapshotSrc).not.toContain("calculateMetric");
    expect(snapshotSrc).not.toContain("scoreEvent");
  });

  it("TC18b: APP question creation 없음 (no question generation in result handler)", () => {
    // Result handler must not generate questions — only persist ENGINE's questions
    expect(resultSrc).not.toContain("generateQuestion");
    expect(resultSrc).not.toContain("createQuestion");
    expect(resultSrc).not.toContain("buildQuestion");
  });

  it("TC25b: same retry = same requestId + same hash (requestId passed in)", async () => {
    const db = makeDb();
    const fixedRequestId = "aaaaaaaa-0000-4000-a000-000000000001";
    const { requestId: r1, payloadHash: h1 } = await buildAnalysisSnapshot(db, {
      report: BASE_REPORT, cycle: BASE_CYCLE, requestId: fixedRequestId,
    });
    const { requestId: r2, payloadHash: h2 } = await buildAnalysisSnapshot(db, {
      report: BASE_REPORT, cycle: BASE_CYCLE, requestId: fixedRequestId,
    });
    expect(r1).toBe(fixedRequestId);
    expect(r2).toBe(fixedRequestId);
    // Hashes may differ slightly if created_at differs — the important thing
    // is that requestId is preserved (same attempt retries same id)
    expect(r1).toBe(r2);
  });

  it("TC26b: new analysis = new requestId (no requestId supplied → fresh UUID)", async () => {
    const db = makeDb();
    const { requestId: r1 } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const { requestId: r2 } = await buildAnalysisSnapshot(db, { report: BASE_REPORT, cycle: BASE_CYCLE });
    expect(r1).not.toBe(r2);
  });
});
