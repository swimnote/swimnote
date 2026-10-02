import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  engine: vi.fn(),
  claim: vi.fn(),
  canDispatch: vi.fn(),
  recordHttpAttempt: vi.fn(),
  getMonthlyRun: vi.fn(),
  buildSnapshot: vi.fn(),
  monthlyOutcome: vi.fn(),
  persistRequest: vi.fn(),
  persistResponse: vi.fn(),
  markCallStarted: vi.fn(),
  persistResult: vi.fn(),
  transition: vi.fn(),
  saveTrace: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ superAdminDb: {} }));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("../../lib/schedulerLock.js", () => ({
  acquireLock: vi.fn(), releaseLock: vi.fn(), recordHeartbeat: vi.fn(),
  refreshLock: vi.fn(),
}));
vi.mock("../../lib/sendOperatorAlert.js", () => ({ sendOperatorAlert: vi.fn() }));
vi.mock("../../lib/growth-report-service.js", () => ({
  transitionReportStatus: mocks.transition,
  InvalidTransitionError: class InvalidTransitionError extends Error {},
}));
vi.mock("../../lib/pg-realtime.js", () => ({ notifyPoolEvent: mocks.notify }));
vi.mock("../../lib/event-logger.js", () => ({ logOperationalError: vi.fn() }));
vi.mock("../../lib/growth-report-snapshot-builder.js", () => ({
  buildAnalysisSnapshot: mocks.buildSnapshot,
  queryDiariesForEligibility: vi.fn(),
  queryAttendanceForEligibility: vi.fn(),
}));
vi.mock("../../lib/growth-report-eligibility.js", () => ({
  evaluateStudentGrowthReportEligibility: vi.fn(),
  getGrowthReportAnalysisPeriod: vi.fn(),
}));
vi.mock("../../lib/growth-report-engine-client.js", async importOriginal => ({
  ...(await importOriginal() as Record<string, unknown>),
  analyzeGrowthReport: mocks.engine,
  isRetryableEngineError: vi.fn(() => false),
}));
vi.mock("../../lib/growth-report-result-handler.js", () => ({
  persistEngineResult: mocks.persistResult,
  auditStaleRejected: vi.fn(),
  StaleEngineResponseError: class StaleEngineResponseError extends Error {},
  GroundingFailError: class GroundingFailError extends Error {},
  EngineResponseValidationError: class EngineResponseValidationError extends Error {},
  persistAnalysisRequest: mocks.persistRequest,
  persistAnalysisResponse: mocks.persistResponse,
  markAnalysisCallStarted: mocks.markCallStarted,
  recordAnalysisUncertain: vi.fn(),
  recordAnalysisAttemptFailure: vi.fn(),
  isGrowthReportParentInputWindowOpen: vi.fn(() => false),
}));
vi.mock("../../lib/growth-report-analysis-claim.js", () => ({
  claimGrowthReportAnalysis: mocks.claim,
  getAnalysisLeaseMs: () => 60_000,
  renewGrowthReportAnalysisClaim: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../lib/ai-trace-service.js", () => ({ saveAiTrace: mocks.saveTrace }));
vi.mock("../../lib/growth-report-monthly-run.js", () => ({
  getMonthlyAutomationRunForCycle: mocks.getMonthlyRun,
  canDispatchMonthlyAnalysis: mocks.canDispatch,
  recordMonthlyFirstPassOutcome: vi.fn(),
  recordMonthlyServiceOutcome: mocks.monthlyOutcome,
  recordMonthlyHttpAttempt: mocks.recordHttpAttempt,
  finishMonthlyFirstPass: vi.fn(),
  isMonthlyAutomationSchemaReady: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../utils/notify.js", () => ({ notifyMonthlySuperAdminEvent: vi.fn() }));

import { analyzeApprovedMonthlyRecoveryReport } from "../growth-report-analysis-worker.js";
import { getGrowthReportAnalysisIdentityHash } from "../../lib/growth-report-analysis-identity.js";

const request = {
  contract_version: "1.0",
  request_id: "request-recovery-1",
  report_id: "report-1",
  context: {
    student_id: "student-1",
    pool_id: "pool-1",
    report_period: "2026-02",
  },
  snapshot: { payload_hash: "snapshot-hash-1" },
};
const finalRequest = {
  ...request,
  request_id: "request-recovery-final",
  snapshot: { payload_hash: "snapshot-hash-final" },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    report_id: "report-1",
    cycle_id: "cycle-1",
    pool_id: "pool-1",
    original_recovery_epoch: 4,
    kind: "FAILED",
    student_id: "student-1",
    report_period: "2026-02",
    report_type: "monthly",
    product_status: "READY_FOR_ANALYSIS",
    analysis_request_id: request.request_id,
    analysis_request_payload: request,
    analysis_identity_hash: getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS"),
    snapshot_hash: "snapshot-hash-1",
    analysis_uncertain_at: null,
    monthly_final_disposition: null,
    exclusion_code: null,
    deleted_at: null,
    first_pass_outcome: "failed",
    recovery_epoch: 5,
    recovery_approved_by: "operator-1",
    recovery_approval_reason: "Approved monthly retry",
    policy_excluded_at: null,
    eligibility_sealed_at: new Date("2026-02-01T00:00:00Z"),
    eligible_total: 1,
    actual_eligible_total: 1,
    preparation_status: "sealed",
    ...overrides,
  };
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    student_id: "student-1",
    swimming_pool_id: "pool-1",
    cycle_id: "cycle-1",
    report_period: "2026-02",
    report_type: "monthly",
    product_status: "READY_FOR_ANALYSIS",
    analysis_request_id: request.request_id,
    analysis_request_payload: request,
    analysis_response_payload: null,
    analysis_identity_hash: getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS"),
    snapshot_hash: "snapshot-hash-1",
    analysis_retry_count: 0,
    analysis_call_started_at: null,
    analysis_uncertain_at: null,
    teacher_reviewed_by: null,
    teacher_reviewed_at: null,
    cycle_db_id: "cycle-1",
    analysis_from: null,
    analysis_cutoff_at: new Date("2026-03-01T00:00:00Z"),
    parent_input_open_at: new Date("2026-02-01T00:00:00Z"),
    parent_input_close_at: new Date("2026-02-28T00:00:00Z"),
    cycle_report_period: "2026-02",
    timezone: "Asia/Seoul",
    ...overrides,
  };
}

function queryText(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(queryText).join("");
  if (Array.isArray(value?.value)) return value.value.join("");
  if (Array.isArray(value?.queryChunks)) return queryText(value.queryChunks);
  return "";
}

function makeDb(options: {
  eligible?: boolean;
  initialStatus?: string;
  storedStage?: "PREANALYSIS" | "FINAL_ANALYSIS";
} = {}) {
  const state = { status: options.initialStatus ?? "READY_FOR_ANALYSIS", claimed: false };
  const storedRequest = {
    ...request,
    request_id: options.storedStage === "PREANALYSIS" ? "request-recovery-pre" : request.request_id,
  };
  const storedIdentityHash = getGrowthReportAnalysisIdentityHash(
    storedRequest,
    options.storedStage ?? "FINAL_ANALYSIS",
  );
  const proof = row(options.eligible === false
    ? {
        recovery_approved_by: "  ",
        analysis_request_id: storedRequest.request_id,
        analysis_request_payload: storedRequest,
        analysis_identity_hash: storedIdentityHash,
      }
    : {
        analysis_request_id: storedRequest.request_id,
        analysis_request_payload: storedRequest,
        analysis_identity_hash: storedIdentityHash,
      });
  let database: any;
  database = {
    state,
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(database),
    execute: vi.fn(async (query: { queryChunks?: unknown[] }) => {
      const text = queryText(query);
      if (text.includes("growth_report_recovery_batch_targets")) {
        return { rows: options.eligible === false ? [] : [proof] };
      }
      if (text.includes("FROM growth_reports gr")) {
        return { rows: [reportRow({
          product_status: state.status,
          analysis_request_id: storedRequest.request_id,
          analysis_request_payload: storedRequest,
          analysis_identity_hash: storedIdentityHash,
        })] };
      }
      if (text.includes("SELECT first_pass_completed_at")) {
        return { rows: [{ first_pass_completed_at: new Date("2026-02-20T00:00:00Z") }] };
      }
      if (text.includes("SELECT product_status FROM growth_reports")) {
        return { rows: [{ product_status: state.status }] };
      }
      return { rows: [{}] };
    }),
  } as any;
  return database;
}

let db: ReturnType<typeof makeDb>;

describe("approved monthly recovery analysis consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("REAL_FETCH_BLOCKED_IN_TEST");
    }));
    db = makeDb();
    mocks.getMonthlyRun.mockResolvedValue({ report_period: "2026-02", paused_at: null });
    mocks.canDispatch.mockResolvedValue(true);
    mocks.recordHttpAttempt.mockResolvedValue(true);
    mocks.monthlyOutcome.mockResolvedValue({ paused: false });
    mocks.buildSnapshot.mockResolvedValue({
      request: finalRequest,
      payloadHash: finalRequest.snapshot.payload_hash,
    });
    mocks.persistRequest.mockResolvedValue(true);
    mocks.persistResponse.mockResolvedValue(true);
    mocks.markCallStarted.mockResolvedValue(true);
    mocks.persistResult.mockImplementation(async () => {
      db.state.status = "REVIEW_REQUIRED";
      return { productStatus: "REVIEW_REQUIRED", questionsCount: 0 };
    });
    mocks.transition.mockResolvedValue(undefined);
    mocks.saveTrace.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue(undefined);
    mocks.claim.mockImplementation(async () => {
      if (db.state.claimed) return null;
      db.state.claimed = true;
      return "analysis-claim-1";
    });
    mocks.engine.mockImplementation(async (_request, hooks) => {
      await hooks.onHttpAttempt();
      return {
        response: {
          request_id: _request.request_id,
          report_id: "report-1",
          analysis_status: "COMPLETE",
        },
        actualCallCount: 1,
        retryCount: 0,
      };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs the sealed approved FAILED target through RECOVERY while auto analysis is off", async () => {
    vi.stubEnv("GROWTH_REPORT_ANALYSIS_AUTO_ENABLED", "false");
    const result = await analyzeApprovedMonthlyRecoveryReport(db, "report-1", {
      cycleId: "cycle-1",
      expectedRecoveryEpoch: 5,
      batchTargetId: "target-1",
      batchClaimToken: "batch-claim-1",
    });
    expect(result.product_status).toBe("REVIEW_REQUIRED");
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.engine).toHaveBeenCalledOnce();
    expect(mocks.canDispatch.mock.calls.map(call => call[1].phase)).toEqual([
      "RECOVERY", "RECOVERY",
    ]);
    expect(mocks.recordHttpAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      phase: "RECOVERY",
    }));
    expect(mocks.recordHttpAttempt.mock.calls.some(call => call[1].phase === "FIRST_PASS")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("fails closed without approval proof or frozen batch membership", async () => {
    const unapprovedDb = makeDb({ eligible: false });
    const result = await analyzeApprovedMonthlyRecoveryReport(unapprovedDb, "report-1", {
      cycleId: "cycle-1",
      expectedRecoveryEpoch: 5,
      batchTargetId: "target-1",
      batchClaimToken: "batch-claim-1",
    });
    expect(result.error_code).toBe("APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE");
    expect(mocks.engine).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();

    const outsideCohortDb = makeDb();
    const outside = await analyzeApprovedMonthlyRecoveryReport(outsideCohortDb, "other-report", {
      cycleId: "cycle-1",
      expectedRecoveryEpoch: 5,
      batchTargetId: "target-1",
      batchClaimToken: "batch-claim-1",
    });
    expect(outside.error_code).toBe("APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE");
    expect(mocks.engine).not.toHaveBeenCalled();
  });

  it("accepts a valid stored PRE identity when the queued report is ready for FINAL", async () => {
    db = makeDb({ storedStage: "PREANALYSIS" });
    const result = await analyzeApprovedMonthlyRecoveryReport(db, "report-1", {
      cycleId: "cycle-1",
      expectedRecoveryEpoch: 5,
      batchTargetId: "target-1",
      batchClaimToken: "batch-claim-1",
    });
    expect(result.product_status).toBe("REVIEW_REQUIRED");
    expect(mocks.buildSnapshot).toHaveBeenCalledOnce();
    expect(mocks.engine).toHaveBeenCalledOnce();
    expect(mocks.recordHttpAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      phase: "RECOVERY",
    }));

    const invalidIdentityDb = makeDb();
    invalidIdentityDb.execute.mockImplementation(async (query: { queryChunks?: unknown[] }) => {
      const text = queryText(query);
      if (text.includes("growth_report_recovery_batch_targets")) {
        return { rows: [row({ analysis_identity_hash: "not-a-valid-stage-identity" })] };
      }
      return { rows: [] };
    });
    const denied = await analyzeApprovedMonthlyRecoveryReport(
      invalidIdentityDb, "report-1", {
        cycleId: "cycle-1",
        expectedRecoveryEpoch: 5,
        batchTargetId: "target-1",
        batchClaimToken: "batch-claim-1",
      },
    );
    expect(denied.error_code).toBe("APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE");
    expect(mocks.engine).toHaveBeenCalledOnce();
  });

  it("shares the atomic report claim with automatic work and avoids duplicate provider calls", async () => {
    db = makeDb();
    const firstDb = db;
    const secondDb = db;
    let claimed = false;
    mocks.claim.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return "analysis-claim-1";
    });
    const context = {
      cycleId: "cycle-1",
      expectedRecoveryEpoch: 5,
      batchTargetId: "target-1",
      batchClaimToken: "batch-claim-1",
    };
    const results = await Promise.all([
      analyzeApprovedMonthlyRecoveryReport(firstDb, "report-1", context),
      analyzeApprovedMonthlyRecoveryReport(secondDb, "report-1", context),
    ]);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.engine).toHaveBeenCalledTimes(1);
    expect(results.filter(result => result.error_code === "STALE_ANALYSIS_CLAIM")).toHaveLength(1);
  });

  it("does not consume a later recovery epoch beyond this batch's single activation", async () => {
    const laterRoundDb = makeDb();
    const later = row({ original_recovery_epoch: 4, recovery_epoch: 6 });
    laterRoundDb.execute.mockImplementation(async (query: { queryChunks?: unknown[] }) => {
      const text = queryText(query);
      if (text.includes("growth_report_recovery_batch_targets")) return { rows: [later] };
      return { rows: [] };
    });
    const result = await analyzeApprovedMonthlyRecoveryReport(laterRoundDb, "report-1", {
      cycleId: "cycle-1",
      expectedRecoveryEpoch: 6,
      batchTargetId: "target-1",
      batchClaimToken: "batch-claim-1",
    });
    expect(result.error_code).toBe("APPROVED_RECOVERY_TARGET_NOT_DISPATCHABLE");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.engine).not.toHaveBeenCalled();
  });
});