import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  waiting: vi.fn(),
  renew: vi.fn(),
  settle: vi.fn(),
  refresh: vi.fn(),
  recover: vi.fn(),
  reissue: vi.fn(),
  sign: vi.fn(),
  admission: vi.fn(),
  serviceOutcome: vi.fn(),
  pauseBatch: vi.fn(),
  batchSchemaReady: vi.fn(),
  monthlySchemaReady: vi.fn(),
  unknownSchemaReady: vi.fn(),
  insertIntents: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("../../lib/growth-report-recovery-batch.js", () => ({
  claimRecoveryBatchTargets: mocks.claim,
  listWaitingRecoveryBatchTargets: mocks.waiting,
  pauseRecoveryBatch: mocks.pauseBatch,
  recoveryBatchSchemaReady: mocks.batchSchemaReady,
  renewRecoveryBatchTarget: mocks.renew,
  settleRecoveryBatchTarget: mocks.settle,
  refreshRecoveryBatchProgress: mocks.refresh,
}));
vi.mock("../../lib/growth-report-monthly-recovery.js", () => ({
  recoverMonthlyTargets: mocks.recover,
}));
vi.mock("../../lib/growth-report-unknown-reissue.js", () => ({
  isUnknownReissueSchemaReady: mocks.unknownSchemaReady,
  reissueUnknownGrowthReports: mocks.reissue,
}));
vi.mock("../../lib/auth.js", () => ({
  signRecoveryBatchOperatorToken: mocks.sign,
}));
vi.mock("../../lib/growth-report-analysis-identity.js", () => ({
  getGrowthReportAnalysisIdentityHash: () => "stage-hash",
}));
vi.mock("../../lib/growth-report-monthly-run.js", () => ({
  isMonthlyAutomationSchemaReady: mocks.monthlySchemaReady,
  reserveMonthlyUnknownRecoveryAdmission: mocks.admission,
  recordMonthlyServiceOutcome: mocks.serviceOutcome,
}));
vi.mock("../../lib/event-logger.js", () => ({
  logOperationalError: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/growth-report-notification-outbox.js", () => ({
  insertGrowthReportAdminReadyIntents: mocks.insertIntents,
}));
vi.mock("../growth-report-monthly-readiness.js", () => ({
  reconcileMonthlyCycle: mocks.reconcile,
}));
vi.mock("../growth-report-auto-publisher.js", () => ({
  freeReportIssueWindow: () => ({
    issueDay: 6, issueHour: 0, reportPeriod: "2026-03",
  }),
}));

import {
  getRecoveryConcurrency,
  processRecoveryBatchTarget,
  runRecoveryBatchWorkerOnce,
} from "../growth-report-recovery-batch-worker.js";
import type { RecoveryBatchTarget } from "../../lib/growth-report-recovery-batch.js";

const target = (
  overrides: Partial<RecoveryBatchTarget> & { original_recovery_epoch?: number } = {},
): RecoveryBatchTarget & { original_recovery_epoch: number } => ({
  id: "target-1",
  batch_id: "batch-1",
  report_id: "report-1",
  pool_id: "pool-1",
  cycle_id: "cycle-1",
  kind: "UNKNOWN",
  original_request_id: "request-1",
  expected_operation_id: null,
  recovery_operation_id: null,
  new_request_id: null,
  original_recovery_epoch: 0,
  claim_token: "claim-1",
  state: "PROCESSING",
  batch: {
    id: "batch-1",
    report_month: "2026-02",
    actor_id: "operator-1",
    actor_role: "super_admin",
    reason: "approved recovery",
    created_at: "2026-02-01T00:00:00.000Z",
  },
  ...overrides,
});

const uncertainReport = (requestId = "request-1") => ({
  id: "report-1",
  cycle_id: "cycle-1",
  swimming_pool_id: "pool-1",
  report_period: "2026-02",
  student_id: "student-1",
  product_status: "ANALYZING",
  analysis_status: null,
  analysis_request_id: requestId,
  analysis_request_payload: {
    request_id: requestId,
    report_id: "report-1",
    context: { student_id: "student-1", pool_id: "pool-1", report_period: "2026-02" },
    snapshot: { payload_hash: "hash-1" },
  },
  analysis_identity_hash: "stage-hash",
  snapshot_hash: "hash-1",
  analysis_uncertain_at: new Date(),
  monthly_final_disposition: null,
  deleted_at: null,
  exclusion_code: null,
  paused_at: null,
  circuit_state: { status: "CLOSED" },
  current_recovery_epoch: 0,
});

const failedReport = (
  requestId: string,
  productStatus: string,
  recoveryEpoch: number,
) => ({
  ...uncertainReport(requestId),
  product_status: productStatus,
  analysis_status: productStatus === "FAILED" ? "FAILED" : "IN_PROGRESS",
  analysis_uncertain_at: null,
  current_recovery_epoch: recoveryEpoch,
});

function unknownDb(
  report: Record<string, any> = uncertainReport(),
  latest: Record<string, any>[] = [],
  trailing: Record<string, any>[] = [],
) {
  const responses = [
    { rows: [report] },
    { rows: latest },
    ...trailing.map(row => ({ rows: [row] })),
  ];
  return {
    execute: vi.fn(async () => responses.shift() ?? { rows: [] }),
  };
}

describe("growth report recovery batch worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockReturnValue("delegated-token");
    mocks.settle.mockResolvedValue(true);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.renew.mockResolvedValue(true);
    mocks.recover.mockResolvedValue({ reactivated: 1 });
    mocks.admission.mockResolvedValue(true);
    mocks.serviceOutcome.mockResolvedValue({ paused: false });
    mocks.pauseBatch.mockResolvedValue(undefined);
    mocks.batchSchemaReady.mockResolvedValue(true);
    mocks.monthlySchemaReady.mockResolvedValue(true);
    mocks.unknownSchemaReady.mockResolvedValue(true);
    mocks.insertIntents.mockResolvedValue(undefined);
    mocks.reconcile.mockResolvedValue(undefined);
  });

  it("uses positive concurrency configuration and ignores invalid values", () => {
    expect(getRecoveryConcurrency({
      GROWTH_REPORT_RECOVERY_CONCURRENCY: "4",
      GROWTH_REPORT_ANALYSIS_CONCURRENCY: "9",
    } as NodeJS.ProcessEnv)).toBe(4);
    expect(getRecoveryConcurrency({
      GROWTH_REPORT_RECOVERY_CONCURRENCY: "0",
      GROWTH_REPORT_ANALYSIS_CONCURRENCY: "invalid",
      GROWTH_REPORT_BATCH_CONCURRENCY: "3",
    } as NodeJS.ProcessEnv)).toBe(3);
  });

  it("honors store-bounded claim slots while processing in parallel", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GROWTH_REPORT_RECOVERY_CONCURRENCY", "2");
    const rows = [
      target({ id: "one", kind: "OTHER" as any }),
      target({ id: "two", kind: "OTHER" as any }),
    ];
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.settle.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return true;
    });
    mocks.waiting.mockResolvedValue([]);
    mocks.claim.mockResolvedValue(rows);
    await runRecoveryBatchWorkerOnce({} as any);
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), 2, 180);
    expect(maxInFlight).toBe(2);
    expect(mocks.settle).toHaveBeenCalledTimes(2);
    expect(mocks.settle.mock.calls.map(call => call[2])).toEqual(["SKIPPED", "SKIPPED"]);
    vi.unstubAllEnvs();
  });

  it("does not recover a failed report while its monthly circuit is paused", async () => {
    const failedTarget = target({ kind: "FAILED" });
    const report = {
      ...uncertainReport("request-1"),
      product_status: "FAILED",
      analysis_uncertain_at: null,
      paused_at: new Date(),
    };
    const db = { execute: vi.fn().mockResolvedValue({ rows: [report] }) };
    await processRecoveryBatchTarget(db, failedTarget);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      db, failedTarget, "PENDING", "MONTHLY_CIRCUIT_PAUSED",
    );
    expect(mocks.pauseBatch).toHaveBeenCalledWith(db, failedTarget.batch_id, "MONTHLY_CIRCUIT_PAUSED");
  });

  it("only activates an unadvanced FAILED target once, then observes WAITING followed by FAILED", async () => {
    const failedTarget = target({ kind: "FAILED", original_recovery_epoch: 0 });
    const initialDb = {
      execute: vi.fn().mockResolvedValue({ rows: [failedReport("request-1", "FAILED", 0)] }),
    };
    await processRecoveryBatchTarget(initialDb, failedTarget);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledWith(initialDb, expect.objectContaining({
      reportIds: ["report-1"],
    }));

    mocks.recover.mockClear();
    mocks.settle.mockClear();
    const waitingDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [failedReport("request-after-recovery", "ANALYZING", 1)],
      }),
    };
    await processRecoveryBatchTarget(waitingDb, failedTarget);
    expect(mocks.settle).toHaveBeenCalledWith(
      waitingDb, failedTarget, "WAITING", "RECOVERY_EPOCH_ALREADY_ADVANCED",
    );

    const failedAgainDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [failedReport("request-after-recovery", "FAILED", 1)],
      }),
    };
    await processRecoveryBatchTarget(failedAgainDb, failedTarget);
    expect(mocks.settle).toHaveBeenLastCalledWith(
      failedAgainDb, failedTarget, "FAILED", "RECOVERY_EPOCH_ALREADY_ADVANCED",
    );
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("observes an epoch increment after restart when the prior activation's settlement was lost", async () => {
    const failedTarget = target({ kind: "FAILED", original_recovery_epoch: 2 });
    const db = {
      execute: vi.fn().mockResolvedValue({
        rows: [failedReport("request-after-recovery", "ANALYZING", 3)],
      }),
    };
    await processRecoveryBatchTarget(db, failedTarget);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      db, failedTarget, "WAITING", "RECOVERY_EPOCH_ALREADY_ADVANCED",
    );
  });

  it("allows a changed request ID only with an epoch advance and observes its success", async () => {
    const failedTarget = target({ kind: "FAILED", original_recovery_epoch: 0 });
    const successDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          rows: [failedReport("request-after-recovery", "REVIEW_REQUIRED", 1)],
        })
        .mockResolvedValueOnce({ rows: [{
          report_period: "2026-02",
          ready_at: null,
          x_paid_entitlement: true,
          x_manual_entitlement: false,
          x_force_disabled: false,
          approval_status: "approved",
        }] }),
    };
    await processRecoveryBatchTarget(successDb, failedTarget);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      successDb, failedTarget, "SUCCESS", "RECOVERY_EPOCH_ALREADY_ADVANCED",
    );
    expect(mocks.reconcile).toHaveBeenCalledWith(
      successDb, { poolId: "pool-1", reportPeriod: "2026-02" },
      expect.anything(), expect.objectContaining({ recordReady: true }),
    );

    const changedWithoutEpochDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [failedReport("request-after-recovery", "REVIEW_REQUIRED", 0)],
      }),
    };
    await processRecoveryBatchTarget(changedWithoutEpochDb, failedTarget);
    expect(mocks.settle).toHaveBeenLastCalledWith(
      changedWithoutEpochDb, failedTarget, "CONFLICT", "REPORT_IDENTITY_REVALIDATION_FAILED",
    );
  });

  it("skips unsupported target kinds without invoking reissue", async () => {
    await processRecoveryBatchTarget({} as any, target({ kind: "OTHER" as any }));
    expect(mocks.reissue).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "SKIPPED", "UNSUPPORTED_TARGET_KIND",
    );
  });

  it("replays a persisted operation after restart instead of advancing its generation", async () => {
    const replayTarget = target({ new_request_id: "new-request-1", expected_operation_id: "old-operation" });
    const report = uncertainReport("new-request-1");
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [report] })
        .mockResolvedValueOnce({ rows: [{
          id: "already-created-operation",
          state: "CREATED",
          engine_confirmed_unknown: false,
          original_request_id: "request-1",
          new_request_id: "new-request-1",
          operator_subject: "operator-1",
        }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mocks.reissue.mockResolvedValue([{
      state: "PROCESSING",
      recovery_operation_id: "already-created-operation",
      new_request_id: "new-request-1",
    }]);
    await processRecoveryBatchTarget(db, replayTarget);
    expect(mocks.admission).toHaveBeenCalledWith(db, {
      cycleId: "cycle-1", studentId: "student-1",
    });
    expect(mocks.reissue).toHaveBeenCalledWith(db, expect.objectContaining({
      reportIds: ["report-1"],
      operatorAuthorization: "Bearer delegated-token",
    }));
    expect(mocks.reissue.mock.calls[0][1].nextGeneration).toBeUndefined();
    expect(mocks.settle).toHaveBeenCalledWith(
      db, replayTarget, "WAITING", undefined,
      { recovery_operation_id: "already-created-operation", new_request_id: "new-request-1" },
    );
  });

  it("allows an explicitly approved next generation with a different approving operator", async () => {
    const approvedTarget = target({
      expected_operation_id: "confirmed-prior-operation",
      batch: {
        id: "batch-1",
        report_month: "2026-02",
        actor_id: "new-operator",
        actor_role: "super_admin",
        reason: "approved next generation",
        created_at: "2026-02-01T00:00:00.000Z",
      },
    });
    const db = unknownDb(uncertainReport("request-1"), [{
      id: "confirmed-prior-operation",
      state: "UNKNOWN",
      engine_confirmed_unknown: true,
      original_request_id: "older-request",
      new_request_id: "request-1",
      operator_subject: "former-operator",
    }], [{}]);
    mocks.reissue.mockResolvedValue([{
      state: "PROCESSING",
      recovery_operation_id: "next-operation",
      new_request_id: "next-request",
    }]);
    await processRecoveryBatchTarget(db, approvedTarget);
    expect(mocks.reissue).toHaveBeenCalledWith(db, expect.objectContaining({
      actorId: "new-operator",
      nextGeneration: true,
      expectedOperationIds: { "report-1": "confirmed-prior-operation" },
    }));
  });

  it("settles an Engine-reported insufficient-evidence result explicitly", async () => {
    const db = unknownDb(uncertainReport(), [], [{}]);
    mocks.reissue.mockResolvedValue([{
      state: "INSUFFICIENT_EVIDENCE",
      recovery_operation_id: "insufficient-op",
      new_request_id: "insufficient-request",
    }]);
    await processRecoveryBatchTarget(db, target());
    expect(mocks.settle).toHaveBeenCalledWith(
      db, expect.anything(), "INSUFFICIENT_EVIDENCE", undefined,
      {
        recovery_operation_id: "insufficient-op",
        new_request_id: "insufficient-request",
      },
    );
  });

  it("isolates a failed UNKNOWN target and never includes the delegated bearer in target lineage", async () => {
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [uncertainReport()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mocks.reissue.mockRejectedValueOnce(new Error("simulated reissue failure"));
    await processRecoveryBatchTarget(db, target());
    expect(mocks.settle).toHaveBeenCalledWith(
      db, expect.anything(), "UNKNOWN", "UNEXPECTED_UNKNOWN_REISSUE_ERROR",
    );
    const settlementPayload = JSON.stringify(mocks.settle.mock.calls);
    expect(settlementPayload).not.toContain("delegated-token");
  });

  it("defers UNKNOWN dispatch when circuit admission is denied", async () => {
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [uncertainReport()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mocks.admission.mockResolvedValueOnce(false);
    await processRecoveryBatchTarget(db, target());
    expect(mocks.reissue).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      db, expect.anything(), "PENDING", "MONTHLY_CIRCUIT_ADMISSION_DENIED",
    );
  });

  it("processes 17 UNKNOWN reports independently and does not re-dispatch terminal UNKNOWN targets", async () => {
    const targets = Array.from({ length: 17 }, (_, index) => {
      const n = index + 1;
      const reportId = `report-${n}`;
      const requestId = `request-${n}`;
      const poolId = `pool-${n}`;
      const cycleId = `cycle-${n}`;
      return {
        target: target({
          id: `target-${n}`, report_id: reportId, pool_id: poolId, cycle_id: cycleId,
          original_request_id: requestId,
        }),
        db: unknownDb({
          ...uncertainReport(requestId),
          id: reportId,
          swimming_pool_id: poolId,
          cycle_id: cycleId,
          analysis_request_payload: {
            ...uncertainReport(requestId).analysis_request_payload,
            report_id: reportId,
            context: { student_id: `student-${n}`, pool_id: poolId, report_period: "2026-02" },
          },
          student_id: `student-${n}`,
        }, [], [{}]),
      };
    });
    mocks.reissue.mockImplementation(async (_db, params) => [{
      state: "UNKNOWN",
      recovery_operation_id: `operation-${params.reportIds[0]}`,
      new_request_id: `new-${params.reportIds[0]}`,
    }]);
    await Promise.all(targets.map(({ target: item, db }) => processRecoveryBatchTarget(db, item)));
    expect(mocks.reissue).toHaveBeenCalledTimes(17);
    expect(mocks.settle.mock.calls.filter(call => call[2] === "UNKNOWN")).toHaveLength(17);

    vi.stubEnv("NODE_ENV", "production");
    mocks.waiting.mockResolvedValue([]);
    mocks.claim.mockResolvedValue([]);
    await runRecoveryBatchWorkerOnce({} as any);
    expect(mocks.reissue).toHaveBeenCalledTimes(17);
    vi.unstubAllEnvs();
  });

  it.each([
    "ENGINE_HTTP_503_AMBIGUOUS",
    "ENGINE_REISSUE_OUTCOME_UNKNOWN",
    "ENGINE_SERVICE_SECRET_NOT_CONFIGURED",
  ])("records persisted %s as a monthly service failure and pauses an OPEN circuit", async (code) => {
    const targetRow = target({ expected_operation_id: "op-1" });
    const db = unknownDb(uncertainReport(), [{
      id: "op-1",
      state: "CREATED",
      error_code: code,
      engine_confirmed_unknown: false,
    }], [
      { error_code: code },
      { paused_at: new Date(), circuit_state: { status: "OPEN" } },
    ]);
    mocks.reissue.mockResolvedValue([{
      state: "UNKNOWN",
      recovery_operation_id: "op-1",
    }]);
    mocks.serviceOutcome.mockResolvedValueOnce({ paused: false });
    await processRecoveryBatchTarget(db, targetRow);
    expect(mocks.serviceOutcome).toHaveBeenCalledWith(db, {
      cycleId: "cycle-1",
      success: false,
      errorCode: code.startsWith("ENGINE_HTTP_503") ? "ENGINE_HTTP_503" : code,
    });
    expect(mocks.pauseBatch).toHaveBeenCalledWith(db, "batch-1", "MONTHLY_CIRCUIT_PAUSED");
    expect(mocks.settle).toHaveBeenCalledWith(
      db, targetRow, "UNKNOWN", code, expect.anything(),
    );
  });

  it("keeps completed and UNKNOWN outcomes isolated and reconciles each pool without publishing", async () => {
    const successTarget = target({
      report_id: "report-success",
      pool_id: "pool-success",
      cycle_id: "cycle-success",
      original_request_id: "request-success",
      new_request_id: "recovered-request",
    });
    const successReport = {
      ...uncertainReport("recovered-request"),
      id: "report-success",
      swimming_pool_id: "pool-success",
      cycle_id: "cycle-success",
      product_status: "REVIEW_REQUIRED",
      analysis_uncertain_at: null,
      analysis_request_payload: {
        ...uncertainReport("recovered-request").analysis_request_payload,
        report_id: "report-success",
        context: {
          student_id: "student-success", pool_id: "pool-success", report_period: "2026-02",
        },
      },
      student_id: "student-success",
      latest_recovery_new_request_id: "recovered-request",
    };
    const successDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          ...successReport,
          analysis_request_id: "request-success",
          analysis_request_payload: {
            ...successReport.analysis_request_payload,
            request_id: "request-success",
          },
          analysis_uncertain_at: new Date(),
          product_status: "ANALYZING",
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [successReport] })
        .mockResolvedValueOnce({ rows: [{
          report_period: "2026-02",
          ready_at: null,
          x_paid_entitlement: true,
          x_manual_entitlement: false,
          x_force_disabled: false,
          approval_status: "approved",
        }] }),
    };
    const unknownTarget = target({
      id: "unknown-target",
      report_id: "report-unknown",
      pool_id: "pool-unknown",
      cycle_id: "cycle-unknown",
      original_request_id: "request-unknown",
    });
    const unknownDbValue = unknownDb({
      ...uncertainReport("request-unknown"),
      id: "report-unknown",
      swimming_pool_id: "pool-unknown",
      cycle_id: "cycle-unknown",
      student_id: "student-unknown",
      analysis_request_payload: {
        ...uncertainReport("request-unknown").analysis_request_payload,
        report_id: "report-unknown",
        context: {
          student_id: "student-unknown", pool_id: "pool-unknown", report_period: "2026-02",
        },
      },
    }, [], [{}]);
    const secondPoolTarget = target({
      id: "second-pool-target",
      report_id: "report-second-success",
      pool_id: "pool-second-success",
      cycle_id: "cycle-second-success",
      original_request_id: "request-second-success",
    });
    const secondPoolReport = {
      ...uncertainReport("request-second-success"),
      id: "report-second-success",
      swimming_pool_id: "pool-second-success",
      cycle_id: "cycle-second-success",
      student_id: "student-second-success",
      product_status: "REVIEW_REQUIRED",
      analysis_uncertain_at: null,
      analysis_request_payload: {
        ...uncertainReport("request-second-success").analysis_request_payload,
        report_id: "report-second-success",
        context: {
          student_id: "student-second-success",
          pool_id: "pool-second-success",
          report_period: "2026-02",
        },
      },
    };
    const secondPoolDb = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [secondPoolReport] })
        .mockResolvedValueOnce({ rows: [{
          report_period: "2026-02",
          ready_at: null,
          x_paid_entitlement: true,
          x_manual_entitlement: false,
          x_force_disabled: false,
          approval_status: "approved",
        }] }),
    };
    mocks.reissue.mockImplementation(async (_db, params) => params.reportIds[0] === "report-success"
      ? [{ state: "COMPLETE", recovery_operation_id: "success-op", new_request_id: "recovered-request" }]
      : [{ state: "UNKNOWN", recovery_operation_id: "unknown-op", new_request_id: "unknown-new" }]);
    mocks.reconcile.mockImplementation(async (_db, _scope, insertReady) => {
      if (insertReady) await insertReady({}, { ready: true });
    });
    await Promise.all([
      processRecoveryBatchTarget(successDb, successTarget),
      processRecoveryBatchTarget(secondPoolDb, secondPoolTarget),
      processRecoveryBatchTarget(unknownDbValue, unknownTarget),
    ]);
    expect(mocks.settle.mock.calls.some(call =>
      call[1].report_id === "report-success" && call[2] === "SUCCESS")).toBe(true);
    expect(mocks.settle.mock.calls.some(call =>
      call[1].report_id === "report-unknown" && call[2] === "UNKNOWN")).toBe(true);
    expect(mocks.reconcile).toHaveBeenCalledWith(
      successDb, { poolId: "pool-success", reportPeriod: "2026-02" },
      expect.any(Function), { recordReady: true },
    );
    expect(mocks.insertIntents).toHaveBeenCalledWith(
      {}, expect.objectContaining({ poolId: "pool-success" }),
    );
    expect(mocks.insertIntents.mock.calls.map(call => call[1].poolId).sort()).toEqual([
      "pool-second-success", "pool-success",
    ]);
    expect(mocks.reissue).toHaveBeenCalledTimes(2);
  });
});