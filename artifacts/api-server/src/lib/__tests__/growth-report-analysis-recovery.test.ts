import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  getGrowthReportAnalysisIdentityHash,
  getGrowthReportRetryDelayMs,
  resolveGrowthReportAnalysisIdentity,
  retryDisposition,
} from "../growth-report-analysis-identity.js";
import {
  persistAnalysisRequest,
  persistAnalysisResponse,
  persistEngineResult,
  recordAnalysisAttemptFailure,
  StaleEngineResponseError,
  isGrowthReportParentInputWindowOpen,
  mapEngineStatusToProductStatus,
} from "../growth-report-result-handler.js";
import {
  recoverLegacyFreeMonthlyQuestionWaiters,
  restoreUndispatchedMonthlyClaim,
  resetStuckReports,
} from "../../jobs/growth-report-analysis-worker.js";
import type { GrowthReportAnalysisResponse } from "../growth-report-engine-client.js";

vi.mock("../growth-report-service.js", () => ({
  transitionReportStatus: vi.fn(async ({ db, reportId, toStatus }: any) => {
    await db.execute({ mockProductStatus: toStatus, mockReportId: reportId });
    return { updated: true, previousStatus: "ANALYZING", newStatus: toStatus };
  }),
}));

vi.mock("@workspace/db", () => {
  const adapter: any = {
    execute: vi.fn(async () => ({ rows: [] })),
  };
  adapter.transaction = vi.fn(async (operation: (tx: any) => Promise<unknown>) =>
    operation(adapter),
  );
  return { superAdminDb: adapter, db: adapter };
});

interface FakeState {
  status: string;
  retryCount: number;
  requestId: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  identityHash: string | null;
  payloadHash: string | null;
  questions: unknown[];
  audits: string[];
  content: unknown;
  failCas: boolean;
  failAudit: boolean;
}

function fakeDb(initialStatus = "PREANALYZING") {
  const state: FakeState = {
    status: initialStatus,
    retryCount: 0,
    requestId: null,
    requestPayload: null,
    responsePayload: null,
    identityHash: null,
    payloadHash: null,
    questions: [],
    audits: [],
    content: null,
    failCas: false,
    failAudit: false,
  };
  const db: any = {
    state,
    execute: vi.fn(async (query: any) => {
      if (query?.mockProductStatus) {
        state.status = query.mockProductStatus;
        return { rows: [] };
      }
      const text = query?.queryChunks
        ? query.queryChunks.map((chunk: any) =>
            typeof chunk === "string" ? chunk : (chunk?.value ?? ""),
          ).join("")
        : "";

      if (text.includes("SELECT next_audit_version")) return { rows: [{ v: 1 }] };
      if (text.includes("SELECT product_status, COALESCE(analysis_retry_count")) {
        return state.status === "PREANALYZING" || state.status === "ANALYZING"
          ? { rows: [{ product_status: state.status, retry_count: state.retryCount }] }
          : { rows: [] };
      }
      if (text.includes("analysis_request_payload =")) {
        if (state.failCas) return { rows: [] };
        const values = (query.queryChunks ?? []).flatMap((chunk: any) =>
          chunk && typeof chunk === "object" && "value" in chunk
            ? (Array.isArray(chunk.value) ? chunk.value : [chunk.value])
            : [],
        );
        const savedRequest = db.expectedRequest ?? values
          .filter((value: unknown) => typeof value === "string")
          .map((value: string) => {
            try { return JSON.parse(value); } catch { return null; }
          })
          .find((value: any) => value?.request_id) as Record<string, any> | undefined;
        state.requestPayload = savedRequest ?? null;
        state.requestId = savedRequest?.request_id ?? "request-1";
        state.payloadHash = savedRequest?.snapshot?.payload_hash ?? "payload-1";
        state.identityHash = db.expectedIdentityHash ?? values.find((value: unknown) =>
          typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
        ) as string ?? "identity-1";
        return { rows: [{ id: "report-1" }] };
      }
      if (text.includes("analysis_response_payload =")) {
        if (state.failCas) return { rows: [] };
        if (db.expectedResponse) {
          state.responsePayload = db.expectedResponse;
          return { rows: [{ id: "report-1" }] };
        }
        const values = (query.queryChunks ?? []).flatMap((chunk: any) =>
          chunk && typeof chunk === "object" && "value" in chunk
            ? (Array.isArray(chunk.value) ? chunk.value : [chunk.value])
            : [],
        );
        state.responsePayload = values
          .filter((value: unknown) => typeof value === "string")
          .map((value: string) => {
            try { return JSON.parse(value); } catch { return null; }
          })
          .find((value: any) => value?.request_id) ?? null;
        return { rows: [{ id: "report-1" }] };
      }
      if (text.includes("analysis_retry_count = COALESCE")) {
        state.retryCount += 1;
        return { rows: [{ retry_count: state.retryCount }] };
      }
      if (text.includes("SET product_status =") && text.includes("analysis_request_id")) {
        state.status = state.status === "PREANALYZING" ? "OPEN" : "READY_FOR_ANALYSIS";
        return { rows: [{ id: "report-1" }] };
      }
      if (text.includes("report_content") && text.includes("RETURNING id")) {
        if (state.failCas) return { rows: [] };
        state.content = { summary: "saved" };
        return { rows: [{ id: "report-1" }] };
      }
      if (text.includes("INSERT INTO growth_report_questions")) {
        state.questions.push("question");
        return { rows: [] };
      }
      if (text.includes("INSERT INTO audit_logs")) {
        if (state.failAudit) throw new Error("mock audit write failure");
        state.audits.push(text);
        return { rows: [] };
      }
      return { rows: [] };
    }),
    transaction: vi.fn(async (operation: (tx: any) => Promise<unknown>) => {
      const before = structuredClone(state);
      try {
        return await operation(db);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    }),
  };
  return db;
}

const logicalRequest = (requestId: string, createdAt: string, note = "same") => ({
  contract_version: "1.0",
  request_id: requestId,
  report_id: "report-1",
  context: { report_period: "2026-08", timezone: "Asia/Seoul" },
  snapshot: {
    snapshot_version: "1.0",
    created_at: createdAt,
    payload_hash: `volatile-${requestId}`,
    diaries: [{ student_notes: [{ content: note }] }],
  },
});

const response = (overrides: Record<string, unknown> = {}): GrowthReportAnalysisResponse => ({
  request_id: "request-1",
  report_id: "report-1",
  analysis_status: "COMPLETE",
  questions: [{
    engine_question_id: "q-1",
    metric_id: "F001",
    question_text: "How was practice?",
    answer_type: "SINGLE_CHOICE",
    options: ["Good"],
    sequence: 1,
    is_required: false,
  }],
  report_content: { summary: "saved" },
  sns_summary: { text: "safe", share_safe: false },
  fact_package: { facts: [] },
  validation: { grounding: "PASS", growth_framing: "PASS" },
  trace: { payload_hash: "payload-1" },
  ...overrides,
} as GrowthReportAnalysisResponse);

const claimToken = "claim-token-1";

describe("growth report analysis durable identity", () => {
  it("ignores volatile created_at/request identifiers and detects logical input changes", () => {
    const first = logicalRequest("request-a", "2026-08-01T00:00:00Z");
    const replay = logicalRequest("request-b", "2026-08-02T00:00:00Z");
    const changed = logicalRequest("request-c", "2026-08-02T00:00:00Z", "changed");

    expect(getGrowthReportAnalysisIdentityHash(first, "PREANALYSIS"))
      .toBe(getGrowthReportAnalysisIdentityHash(replay, "PREANALYSIS"));
    expect(getGrowthReportAnalysisIdentityHash(first, "PREANALYSIS"))
      .not.toBe(getGrowthReportAnalysisIdentityHash(changed, "PREANALYSIS"));
    expect(getGrowthReportAnalysisIdentityHash(first, "PREANALYSIS"))
      .not.toBe(getGrowthReportAnalysisIdentityHash(first, "FINAL_ANALYSIS"));
  });

  it("pins the complete persisted request even when fresh inputs have changed", () => {
    const original = logicalRequest("request-a", "2026-08-01T00:00:00Z");
    const fingerprint = getGrowthReportAnalysisIdentityHash(original, "PREANALYSIS");
    const persisted = {
      ...original,
      snapshot: { ...original.snapshot, payload_hash: "payload-original" },
    };
    const replay = resolveGrowthReportAnalysisIdentity({
      freshRequest: logicalRequest("request-b", "2026-08-03T00:00:00Z"),
      freshPayloadHash: "payload-fresh",
      stage: "PREANALYSIS",
      persistedRequest: persisted,
      persistedRequestId: "request-a",
      persistedPayloadHash: "payload-original",
      persistedIdentityHash: fingerprint,
    });
    expect(replay.reused).toBe(true);
    expect(replay.requestId).toBe("request-a");
    expect(replay.payloadHash).toBe("payload-original");
    expect(replay.request).toBe(persisted);

    const changed = resolveGrowthReportAnalysisIdentity({
      freshRequest: logicalRequest("request-new", "2026-08-03T00:00:00Z", "different"),
      freshPayloadHash: "payload-new",
      stage: "PREANALYSIS",
      persistedRequest: persisted,
      persistedRequestId: "request-a",
      persistedPayloadHash: "payload-original",
      persistedIdentityHash: fingerprint,
    });
    expect(changed.reused).toBe(true);
    expect(changed.requestId).toBe("request-a");
    expect(changed.payloadHash).toBe("payload-original");

    const nextStage = resolveGrowthReportAnalysisIdentity({
      freshRequest: logicalRequest("request-final", "2026-08-04T00:00:00Z"),
      freshPayloadHash: "payload-final",
      stage: "FINAL_ANALYSIS",
      persistedRequest: persisted,
      persistedRequestId: "request-a",
      persistedPayloadHash: "payload-original",
      persistedIdentityHash: fingerprint,
    });
    expect(nextStage.reused).toBe(false);
    expect(nextStage.replacePreviousStageRequest).toBe(true);
    expect(nextStage.requestId).toBe("request-final");
  });

  it("makes retry 3 terminal and permits retries 1 and 2", () => {
    expect(retryDisposition(0, 3)).toEqual({ nextRetryCount: 1, terminal: false });
    expect(retryDisposition(1, 3)).toEqual({ nextRetryCount: 2, terminal: false });
    expect(retryDisposition(2, 3)).toEqual({ nextRetryCount: 3, terminal: true });
  });

  it("uses configurable bounded exponential retry delay with jitter", () => {
    vi.stubEnv("GROWTH_REPORT_RETRY_BASE_MS", "30000");
    vi.stubEnv("GROWTH_REPORT_RETRY_MAX_MS", "120000");
    try {
      expect(getGrowthReportRetryDelayMs(1, () => 0)).toBe(24_000);
      expect(getGrowthReportRetryDelayMs(3, () => 1)).toBe(120_000);
      expect(getGrowthReportRetryDelayMs(5, () => 0.5)).toBe(120_000);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("free monthly parent-input policy", () => {
  const now = new Date("2026-08-02T00:00:00Z");
  const closesLater = "2026-08-04T00:00:00Z";

  it("keeps free monthly questions optional and advances a complete PRE result", () => {
    const parentInputOpen = isGrowthReportParentInputWindowOpen(
      "monthly",
      closesLater,
      now,
    );
    expect(parentInputOpen).toBe(false);
    expect(mapEngineStatusToProductStatus(
      "COMPLETE_WITH_QUESTIONS_AVAILABLE",
      "PREANALYSIS",
      { questionsCount: 2, parentInputWindowOpen: parentInputOpen },
    )).toBe("READY_FOR_ANALYSIS");
  });

  it("preserves the parent-input window for non-monthly reports", () => {
    expect(isGrowthReportParentInputWindowOpen("quarterly", closesLater, now)).toBe(true);
    expect(isGrowthReportParentInputWindowOpen(null, closesLater, now)).toBe(false);
  });
});

describe("eligibility status race protection", () => {
  it("CAS-restricts EXCLUDED writes to the selected status and request identity", () => {
    const workerSource = readFileSync(
      new URL("../../jobs/growth-report-analysis-worker.ts", import.meta.url),
      "utf8",
    );
    const excludedUpdate = workerSource.match(
      /const excluded = await db\.execute\(sql`([\s\S]*?)`\);/,
    )?.[1];
    expect(excludedUpdate).toBeDefined();
    expect(excludedUpdate).toContain("product_status   = ${report.product_status}");
    expect(excludedUpdate).toContain(
      "analysis_request_id IS NOT DISTINCT FROM ${report.analysis_request_id}",
    );
    expect(excludedUpdate).toContain("deleted_at IS NULL");
    expect(excludedUpdate).toContain("RETURNING id");
    expect(excludedUpdate).not.toContain("product_status   != 'EXCLUDED'");
  });
});

describe("monthly claimed-attempt exception accounting", () => {
  it("fences terminal failures and retains cached ENGINE responses for reconciliation", () => {
    const workerSource = readFileSync(
      new URL("../../jobs/growth-report-analysis-worker.ts", import.meta.url),
      "utf8",
    );
    expect(workerSource).toContain('const failureCode = "ANALYSIS_WORKER_EXCEPTION"');
    expect(workerSource).toContain("analysis_claim_token = ${claimToken}");
    expect(workerSource).toContain("analysis_response_payload IS NULL");
    expect(workerSource).toContain("analysis_uncertain_at IS NULL");
    expect(workerSource).toContain("product_status = 'FAILED'::gr_product_status_enum");
    expect(workerSource).toContain("RESULT_PERSISTENCE_RETRY");
    expect(workerSource).toContain("first_pass_error_code = 'RESULT_PERSISTENCE_RETRY'");
    expect(workerSource).toContain("response retained for cached reconciliation");
    expect(workerSource).toContain("restoreUndispatchedMonthlyClaim");
    expect(workerSource).toContain("analysis_call_started_at = NULL");
    expect(workerSource).toContain("product_status = ${params.originalStatus}");
    expect(workerSource).toContain("AND analysis_request_id = ${params.requestId}");
  });

  it("limits each manifested first-pass or recovery claim to one APP attempt", () => {
    const workerSource = readFileSync(
      new URL("../../jobs/growth-report-analysis-worker.ts", import.meta.url),
      "utf8",
    );
    expect(workerSource).toContain("const attemptRetryLimit = monthlyTracked");
    expect(workerSource).toContain("report.analysis_retry_count + 1");
  });
});

describe("consumed recovery watchdog crash reconciliation", () => {
  const dialect = new PgDialect();
  const expiredReport = (responsePayload: unknown = null) => ({
    id: "report-1",
    cycle_id: "cycle-1",
    student_id: "student-1",
    swimming_pool_id: "pool-1",
    report_period: "2026-10",
    product_status: "ANALYZING",
    analysis_request_id: "request-1",
    analysis_response_payload: responsePayload,
    analysis_request_payload: {
      request_id: "request-1",
      report_id: "report-1",
      context: { student_id: "student-1", pool_id: "pool-1", report_period: "2026-10" },
      snapshot: { payload_hash: "hash-1" },
    },
    analysis_identity_hash: "identity-1",
    snapshot_hash: "hash-1",
    analysis_call_started_at: new Date(),
    analysis_claim_token: "claim-1",
  });

  function watchdogDb(report: any) {
    const statements: string[] = [];
    const execute = async (query: unknown) => {
      const text = dialect.sqlToQuery(query as any).sql;
      statements.push(text);
      if (text.includes("AS schema_ready")) return { rows: [{ schema_ready: true }] };
      if (text.includes("SELECT id, cycle_id, student_id, swimming_pool_id")) {
        return { rows: [report] };
      }
      if (text.includes("FROM growth_report_eligible_targets target")) {
        return {
          rows: [{
            first_pass_completed_at: new Date(),
            recovery_approved_at: null,
            recovery_engine_requests: 1,
          }],
        };
      }
      if (text.includes("UPDATE growth_reports")) return { rows: [{ id: report.id }] };
      return { rows: [] };
    };
    const tx = { execute };
    return {
      statements,
      execute,
      transaction: async (callback: (transaction: any) => Promise<unknown>) => callback(tx),
    };
  }

  it("marks a consumed recovery with no response UNKNOWN under the same request fence", async () => {
    const db = watchdogDb(expiredReport());
    expect(await resetStuckReports(db)).toBe(1);
    const unknown = db.statements.find(text => text.includes("analysis_uncertain_at = COALESCE"));
    expect(unknown).toBeDefined();
    expect(unknown).toContain("analysis_request_id =");
    expect(unknown).toContain("analysis_claim_token =");
    expect(unknown).toContain("analysis_response_payload IS NULL");
  });

  it("releases a matching cached response for replay without marking it UNKNOWN", async () => {
    const db = watchdogDb(expiredReport({ request_id: "request-1", report_id: "report-1" }));
    expect(await resetStuckReports(db)).toBe(1);
    expect(db.statements.some(text => text.includes("analysis_uncertain_at = COALESCE"))).toBe(false);
    expect(db.statements.some(text => text.includes("analysis_call_started_at = CASE"))).toBe(true);
  });

  it("refunds the same durably admitted recovery round when marking HTTP start fails", async () => {
    const state = {
      report: {
        status: "ANALYZING",
        requestId: "request-1",
        claimToken: "claim-1" as string | null,
        response: null as unknown,
        uncertainAt: null as Date | null,
        callStartedAt: null as Date | null,
      },
      target: {
        firstPassCompletedAt: new Date(),
        firstPassRequests: 0,
        recoveryRequests: 2,
        approvedAt: null as Date | null,
        approvedBy: "operator-1",
        approvalReason: "retry after service recovery",
        epoch: 2,
        limit: 3,
      },
    };
    const statements: string[] = [];
    const db = {
      transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
        execute: async (query: unknown) => {
          const text = dialect.sqlToQuery(query as any).sql;
          statements.push(text);
          if (text.includes("SELECT id") && text.includes("FROM growth_reports")) {
            return { rows: [{ id: "report-1" }] };
          }
          if (text.includes("SELECT first_pass_completed_at")) {
            return { rows: [{
              first_pass_completed_at: state.target.firstPassCompletedAt,
              first_pass_engine_requests: state.target.firstPassRequests,
              recovery_engine_requests: state.target.recoveryRequests,
              recovery_approved_at: state.target.approvedAt,
              recovery_approved_by: state.target.approvedBy,
              recovery_approval_reason: state.target.approvalReason,
              recovery_epoch: state.target.epoch,
              recovery_attempt_limit: state.target.limit,
            }] };
          }
          if (text.includes("SET recovery_engine_requests = recovery_engine_requests - 1")) {
            state.target.recoveryRequests--;
            state.target.approvedAt = new Date();
            return { rows: [{ student_id: "student-1" }] };
          }
          if (text.includes("SET product_status =")) {
            state.report.status = "READY_FOR_ANALYSIS";
            state.report.claimToken = null;
            state.report.callStartedAt = null;
            return { rows: [{ id: "report-1" }] };
          }
          return { rows: [] };
        },
      }),
    };

    expect(await restoreUndispatchedMonthlyClaim(db, {
      reportId: "report-1",
      cycleId: "cycle-1",
      studentId: "student-1",
      originalStatus: "READY_FOR_ANALYSIS",
      requestId: "request-1",
      claimToken: "claim-1",
      stage: "FINAL_ANALYSIS",
      monthlyTracked: true,
      monthlyPhase: "RECOVERY",
      admissionRecorded: true,
    })).toBe(true);

    expect(state.report).toMatchObject({
      status: "READY_FOR_ANALYSIS",
      requestId: "request-1",
      claimToken: null,
      response: null,
      uncertainAt: null,
    });
    expect(state.target).toMatchObject({
      recoveryRequests: 1,
      approvedBy: "operator-1",
      approvalReason: "retry after service recovery",
      epoch: 2,
      limit: 3,
    });
    expect(state.target.approvedAt).toBeInstanceOf(Date);
    expect(statements.join(" ")).toContain("AND analysis_request_id =");
    expect(statements.join(" ")).toContain("AND analysis_claim_token =");

    const workerSource = readFileSync(
      new URL("../../jobs/growth-report-analysis-worker.ts", import.meta.url),
      "utf8",
    );
    expect(workerSource.indexOf("monthlyAttemptAdmitted = true")).toBeLessThan(
      workerSource.indexOf("const callStarted = await markAnalysisCallStarted"),
    );
    expect(workerSource).toContain("admissionRecorded: monthlyAttemptAdmitted");
  });
});

describe("legacy free-monthly question waiter recovery", () => {
  it("advances only complete valid monthly rows and leaves other states untouched", async () => {
    const reports = [
      {
        id: "legacy-monthly",
        status: "QUESTION_AVAILABLE",
        report_type: "monthly",
        analysis_status: "COMPLETE_WITH_QUESTIONS_AVAILABLE",
        analysis_request_id: "request-monthly",
        snapshot_hash: "hash-monthly",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: null,
      },
      {
        id: "legacy-null-type",
        status: "QUESTION_AVAILABLE",
        report_type: null,
        analysis_status: "COMPLETE",
        analysis_request_id: "request-null",
        snapshot_hash: "hash-null",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: null,
      },
      {
        id: "quarterly",
        status: "QUESTION_AVAILABLE",
        report_type: "quarterly",
        analysis_status: "COMPLETE",
        analysis_request_id: "request-quarterly",
        snapshot_hash: "hash-quarterly",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: null,
      },
      ...["PUBLISHED", "EXCLUDED", "DISCARDED", "FAILED", "REVIEW_REQUIRED"].map((status) => ({
        id: `terminal-${status.toLowerCase()}`,
        status,
        report_type: "monthly",
        analysis_status: "COMPLETE",
        analysis_request_id: "request-terminal",
        snapshot_hash: "hash-terminal",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: null,
      })),
      {
        id: "incomplete-pre",
        status: "QUESTION_AVAILABLE",
        report_type: "monthly",
        analysis_status: "PARTIAL",
        analysis_request_id: "request-partial",
        snapshot_hash: "hash-partial",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: null,
      },
      {
        id: "missing-content",
        status: "QUESTION_AVAILABLE",
        report_type: "monthly",
        analysis_status: "COMPLETE",
        analysis_request_id: "request-missing",
        snapshot_hash: "hash-missing",
        report_content: null,
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: null,
      },
      {
        id: "stale-response",
        status: "QUESTION_AVAILABLE",
        report_type: "monthly",
        analysis_status: "COMPLETE",
        analysis_request_id: "request-stale",
        snapshot_hash: "hash-stale",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: {
          request_id: "older-request",
          report_id: "stale-response",
          trace: { payload_hash: "hash-stale" },
        },
        deleted_at: null,
      },
      {
        id: "deleted-monthly",
        status: "QUESTION_AVAILABLE",
        report_type: "monthly",
        analysis_status: "COMPLETE",
        analysis_request_id: "request-deleted",
        snapshot_hash: "hash-deleted",
        report_content: {},
        report_fact_package: {},
        sns_summary: {},
        response: null,
        deleted_at: new Date(),
      },
    ];
    const db: any = {
      reports,
      execute: vi.fn(async (query: any) => {
        if (query?.mockProductStatus) {
          const row = reports.find((candidate) => candidate.id === query.mockReportId);
          if (!row || row.status !== "QUESTION_AVAILABLE") return { rows: [] };
          row.status = query.mockProductStatus;
          return { rows: [{ id: row.id }] };
        }
        const text = (query?.queryChunks ?? []).map((chunk: any) =>
          typeof chunk === "string" ? chunk : (chunk?.value ?? ""),
        ).join("");
        if (text.includes("SELECT gr.id") && text.includes("FOR UPDATE SKIP LOCKED")) {
          expect(text).toContain("gr.product_status = 'QUESTION_AVAILABLE'");
          expect(text).toContain("(gr.report_type = 'monthly' OR gr.report_type IS NULL)");
          expect(text).toContain("gr.deleted_at IS NULL");
          expect(text).toContain("gr.analysis_request_id IS NOT NULL");
          expect(text).toContain("gr.snapshot_hash IS NOT NULL");
          expect(text).toContain("jsonb_typeof(gr.report_content) = 'object'");
          expect(text).toContain("jsonb_typeof(gr.report_fact_package) = 'object'");
          expect(text).toContain("jsonb_typeof(gr.sns_summary) = 'object'");
          expect(text).toContain("analysis_response_payload->>'request_id' = gr.analysis_request_id");
          expect(text).toContain("analysis_response_payload->'trace'->>'payload_hash' = gr.snapshot_hash");
          const selected = reports.filter((row) =>
            row.status === "QUESTION_AVAILABLE" &&
            (row.report_type === "monthly" || row.report_type === null) &&
            row.deleted_at === null &&
            ["COMPLETE", "COMPLETE_WITH_QUESTIONS_AVAILABLE", "COMPLETE_WITH_PARENT_EVIDENCE"]
              .includes(row.analysis_status) &&
            typeof row.analysis_request_id === "string" &&
            typeof row.snapshot_hash === "string" &&
            row.report_content !== null &&
            row.report_fact_package !== null &&
            row.sns_summary !== null &&
            (!row.response || (
              row.response.request_id === row.analysis_request_id &&
              row.response.report_id === row.id &&
              row.response.trace.payload_hash === row.snapshot_hash
            )),
          );
          return { rows: selected.map(({ id }) => ({ id })) };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (operation: (tx: any) => Promise<unknown>) =>
        operation(db),
      ),
    };

    expect(await recoverLegacyFreeMonthlyQuestionWaiters(db)).toBe(2);
    expect(reports.find(({ id }) => id === "legacy-monthly")?.status)
      .toBe("READY_FOR_ANALYSIS");
    expect(reports.find(({ id }) => id === "legacy-null-type")?.status)
      .toBe("READY_FOR_ANALYSIS");
    for (const id of [
      "quarterly",
      "terminal-published",
      "terminal-excluded",
      "terminal-discarded",
      "terminal-failed",
      "terminal-review_required",
      "incomplete-pre",
      "missing-content",
      "stale-response",
      "deleted-monthly",
    ]) {
      expect(reports.find((row) => row.id === id)?.status)
        .toBe(id === "terminal-published" ? "PUBLISHED" :
          id === "terminal-excluded" ? "EXCLUDED" :
          id === "terminal-discarded" ? "DISCARDED" :
          id === "terminal-failed" ? "FAILED" :
          id === "terminal-review_required" ? "REVIEW_REQUIRED" :
          "QUESTION_AVAILABLE");
    }

    // The READY transition cannot be recovered again after the final pass succeeds.
    expect(await recoverLegacyFreeMonthlyQuestionWaiters(db)).toBe(0);
    expect(reports.find(({ id }) => id === "legacy-monthly")?.status)
      .toBe("READY_FOR_ANALYSIS");
  });

  it("runs recovery before queue selection and hashes PRE/FINAL stages separately", () => {
    const workerSource = readFileSync(
      new URL("../../jobs/growth-report-analysis-worker.ts", import.meta.url),
      "utf8",
    );
    expect(workerSource.indexOf("await recoverLegacyFreeMonthlyQuestionWaiters(db)"))
      .toBeLessThan(workerSource.indexOf("const pending = await fetchPendingReports(db)"));
    expect(getGrowthReportAnalysisIdentityHash(
      logicalRequest("same-id", "2026-08-01T00:00:00Z"),
      "PREANALYSIS",
    )).not.toBe(getGrowthReportAnalysisIdentityHash(
      logicalRequest("same-id", "2026-08-01T00:00:00Z"),
      "FINAL_ANALYSIS",
    ));
  });
});

describe("growth report analysis mock-DB recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists request before work and retains the same request through retry recovery", async () => {
    const db = fakeDb("PREANALYZING");
    const first = {
      ...logicalRequest("request-1", "2026-08-01T00:00:00Z"),
      snapshot: {
        ...logicalRequest("request-1", "2026-08-01T00:00:00Z").snapshot,
        payload_hash: "payload-1",
      },
    };
    const identityHash = getGrowthReportAnalysisIdentityHash(first, "PREANALYSIS");
    db.expectedRequest = first;
    db.expectedIdentityHash = identityHash;
    const saved = await persistAnalysisRequest({
      db,
      reportId: "report-1",
      poolId: "pool-1",
      requestId: "request-1",
      payloadHash: "payload-1",
      identityHash,
      request: first,
      stage: "PREANALYSIS",
      claimToken,
    });
    expect(saved).toBe(true);
    expect(db.state.requestId).toBe("request-1");
    expect(db.state.audits).toHaveLength(1);
    const auditSql = db.state.audits[0];
    expect(auditSql).toContain("entity_version");
    expect(auditSql).toContain("action");
    expect(auditSql).toContain("before_data");
    expect(auditSql).toContain("after_data");
    expect(auditSql).toContain("request_id");
    expect(auditSql).not.toContain("event_type");
    expect(auditSql).not.toContain("metadata");
    expect(auditSql).not.toMatch(/\bversion\b/);
    expect(auditSql).toContain("'update', 'system'");

    const replay = resolveGrowthReportAnalysisIdentity({
      freshRequest: logicalRequest("new-uuid", "2026-08-02T00:00:00Z"),
      freshPayloadHash: "new-volatile-hash",
      stage: "PREANALYSIS",
      persistedRequest: db.state.requestPayload,
      persistedRequestId: "request-1",
      persistedPayloadHash: "payload-1",
      persistedIdentityHash: db.state.identityHash,
    });
    expect(replay.reused).toBe(true);
    expect(replay.requestId).toBe("request-1");
    expect(replay.request).toEqual(first);

    const failure = await recordAnalysisAttemptFailure({
      db,
      reportId: "report-1",
      poolId: "pool-1",
      requestId: "request-1",
      stage: "PREANALYSIS",
      retryable: true,
      maxRetryCount: 3,
      errorCode: "TIMEOUT",
      claimToken,
      retryDelayMs: 1000,
    });
    expect(failure).toEqual({ updated: true, terminal: false, retryCount: 1 });
    expect(db.state.status).toBe("OPEN");
    expect(db.state.requestId).toBe("request-1");
    expect(db.state.requestPayload).toEqual(first);
  });

  it("moves the third retryable failure to terminal FAILED", async () => {
    const db = fakeDb("PREANALYZING");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      db.state.status = "PREANALYZING";
      const failure = await recordAnalysisAttemptFailure({
        db,
        reportId: "report-1",
        poolId: "pool-1",
        requestId: "request-1",
        stage: "PREANALYSIS",
        retryable: true,
        maxRetryCount: 3,
        errorCode: "TIMEOUT",
        claimToken,
        retryDelayMs: 1000,
      });
      expect(failure.retryCount).toBe(attempt);
      expect(failure.terminal).toBe(attempt === 3);
    }
    expect(db.state.status).toBe("FAILED");
  });

  it("rejects a zero-row result CAS without questions, status, or audit changes", async () => {
    const db = fakeDb("PREANALYZING");
    db.state.failCas = true;
    await expect(persistEngineResult({
      db,
      report: { id: "report-1", swimming_pool_id: "pool-1" },
      requestId: "request-1",
      payloadHash: "payload-1",
      response: response(),
      stage: "PREANALYSIS",
      parentInputWindowOpen: false,
      claimToken,
    })).rejects.toBeInstanceOf(StaleEngineResponseError);
    expect(db.state.questions).toHaveLength(0);
    expect(db.state.audits).toHaveLength(0);
    expect(db.state.status).toBe("PREANALYZING");
  });

  it("rejects a zero-row DATA_ACCUMULATING CAS without changing status", async () => {
    const db = fakeDb("ANALYZING");
    db.state.failCas = true;
    await expect(persistEngineResult({
      db,
      report: { id: "report-1", swimming_pool_id: "pool-1" },
      requestId: "request-1",
      payloadHash: "payload-1",
      response: response({ analysis_status: "DATA_ACCUMULATING", questions: [] }),
      stage: "FINAL_ANALYSIS",
      parentInputWindowOpen: false,
      claimToken,
    })).rejects.toBeInstanceOf(StaleEngineResponseError);
    expect(db.state.status).toBe("ANALYZING");
    expect(db.state.audits).toHaveLength(0);
  });

  it("rolls back report, questions, status and audit together on an audit failure", async () => {
    const db = fakeDb("PREANALYZING");
    db.state.failAudit = true;
    await expect(persistEngineResult({
      db,
      report: { id: "report-1", swimming_pool_id: "pool-1" },
      requestId: "request-1",
      payloadHash: "payload-1",
      response: response(),
      stage: "PREANALYSIS",
      parentInputWindowOpen: false,
      claimToken,
    })).rejects.toThrow("mock audit write failure");
    expect(db.state.content).toBeNull();
    expect(db.state.questions).toHaveLength(0);
    expect(db.state.status).toBe("PREANALYZING");
    expect(db.state.audits).toHaveLength(0);
  });

  it("keeps the durably cached ENGINE response when the atomic result transaction fails", async () => {
    const db = fakeDb("PREANALYZING");
    const input = logicalRequest("request-1", "2026-08-01T00:00:00Z");
    await persistAnalysisRequest({
      db,
      reportId: "report-1",
      poolId: "pool-1",
      requestId: "request-1",
      payloadHash: "payload-1",
      identityHash: getGrowthReportAnalysisIdentityHash(input, "PREANALYSIS"),
      request: {
        ...input,
        snapshot: { ...input.snapshot, payload_hash: "payload-1" },
      },
      stage: "PREANALYSIS",
      claimToken,
    });

    const engineResponse = response();
    db.expectedResponse = engineResponse;
    expect(await persistAnalysisResponse({
      db,
      reportId: "report-1",
      requestId: "request-1",
      response: engineResponse,
      stage: "PREANALYSIS",
      claimToken,
    })).toBe(true);
    expect(db.state.responsePayload).toEqual(engineResponse);

    db.state.failAudit = true;
    await expect(persistEngineResult({
      db,
      report: { id: "report-1", swimming_pool_id: "pool-1" },
      requestId: "request-1",
      payloadHash: "payload-1",
      response: engineResponse,
      stage: "PREANALYSIS",
      parentInputWindowOpen: false,
      claimToken,
    })).rejects.toThrow("mock audit write failure");

    expect(db.state.content).toBeNull();
    expect(db.state.questions).toHaveLength(0);
    expect(db.state.status).toBe("PREANALYZING");
    expect(db.state.responsePayload).toEqual(engineResponse);
  });
});
