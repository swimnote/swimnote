import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  finishMonthlyFirstPass,
  getMonthlyAutomationSummary,
  hasUnknownRecoveryApprovalBoundary,
  listMonthlyAutomationExceptions,
  recordMonthlyFirstPassOutcome,
  registerMonthlyAutomationRun,
  reserveMonthlyUnknownRecoveryAdmission,
  resumeMonthlyAutomationRun,
} from "../growth-report-monthly-run.js";
import { getGrowthReportAnalysisIdentityHash } from "../growth-report-analysis-identity.js";

const dialect = new PgDialect();
const queryText = (query: unknown) => dialect.sqlToQuery(query as any).sql;

function mockDb(handler: (text: string) => unknown[]) {
  const statements: string[] = [];
  return {
    statements,
    execute: async (query: unknown) => {
      const text = queryText(query);
      statements.push(text);
      return { rows: handler(text) };
    },
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      execute: async (query: unknown) => {
        const text = queryText(query);
        statements.push(text);
        return { rows: handler(text) };
      },
    }),
  };
}

describe("monthly automation manifest and first-pass barrier", () => {
  it("requires durable approval proof for historic failed targets", () => {
    expect(hasUnknownRecoveryApprovalBoundary({ first_pass_outcome: null })).toBe(true);
    expect(hasUnknownRecoveryApprovalBoundary({ first_pass_outcome: "unknown" })).toBe(true);
    expect(hasUnknownRecoveryApprovalBoundary({
      first_pass_outcome: "failed",
      recovery_epoch: 1,
      recovery_approved_by: "operator-1",
      recovery_approval_reason: "retry was approved",
    })).toBe(true);
    for (const proof of [
      { recovery_epoch: 0, recovery_approved_by: "operator-1", recovery_approval_reason: "retry" },
      { recovery_epoch: 1, recovery_approved_by: "", recovery_approval_reason: "retry" },
      { recovery_epoch: 1, recovery_approved_by: "operator-1", recovery_approval_reason: "   " },
    ]) {
      expect(hasUnknownRecoveryApprovalBoundary({
        first_pass_outcome: "failed", ...proof,
      })).toBe(false);
    }
  });

  it("admits 17 newly UNKNOWN targets with explicit failed-recovery proof", async () => {
    const reserve = (studentId: string) => {
      const statements: string[] = [];
      const rowFor = (text: string) => {
        statements.push(text);
        if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
        if (text.includes("SELECT run.report_period")) return [{
          report_period: "2026-10",
          paused_at: null,
          pause_reason: null,
          pause_epoch: 0,
          circuit_state: { status: "CLOSED" },
          manifest_cycle_id: "cycle-1",
          preparation_status: "sealed",
          actual_cycle_id: "cycle-1",
        }];
        if (text.includes("SELECT target.first_pass_outcome")) return [{
          first_pass_outcome: "failed",
          recovery_epoch: 1,
          recovery_approved_by: "operator-1",
          recovery_approval_reason: "approved next attempt",
          policy_excluded_at: null,
          product_status: "ANALYZING",
          analysis_uncertain_at: new Date(),
        }];
        if (text.includes("SET recovery_engine_requests = recovery_engine_requests + 1")) {
          return [{ student_id: studentId }];
        }
        return [];
      };
      return {
        statements,
        execute: async (query: unknown) => ({
          rows: rowFor(queryText(query)),
        }),
        transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
          execute: async (query: unknown) => ({
            rows: rowFor(queryText(query)),
          }),
        }),
      };
    };
    const results = await Promise.all(Array.from({ length: 17 }, (_, index) => {
      const studentId = `student-${index + 1}`;
      const db = reserve(studentId);
      return reserveMonthlyUnknownRecoveryAdmission(db as any, {
        cycleId: "cycle-1", studentId,
      }).then(admitted => ({ admitted, db }));
    }));
    expect(results.every(result => result.admitted)).toBe(true);
    for (const { db } of results) {
      const counterFence = db.statements.find(text =>
        text.includes("SET recovery_engine_requests = recovery_engine_requests + 1"));
      expect(counterFence).toContain("recovery_epoch > 0");
      expect(counterFence).toContain("recovery_approved_by");
      expect(counterFence).toContain("recovery_approval_reason");
    }
  });

  it("surfaces a historically failed but approved current UNKNOWN as dispatch-eligible", async () => {
    const request = {
      request_id: "request-1",
      report_id: "report-1",
      context: { student_id: "student-1", pool_id: "pool-1", report_period: "2026-10" },
      snapshot: { payload_hash: "snapshot-hash" },
    };
    const row = {
      report_period: "2026-10",
      swimming_pool_id: "pool-1",
      preparation_status: "sealed",
      cycle_id: "cycle-1",
      eligibility_sealed_at: new Date(),
      eligible_total: 1,
      actual_eligible_total: 1,
      student_id: "student-1",
      first_pass_outcome: "failed",
      recovery_epoch: 1,
      recovery_approved_at: new Date(),
      recovery_approved_by: "operator-1",
      recovery_approval_reason: "approved next attempt",
      policy_excluded_at: null,
      report_id: "report-1",
      analysis_request_id: "request-1",
      analysis_request_payload: request,
      analysis_identity_hash: getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS"),
      snapshot_hash: "snapshot-hash",
      product_status: "ANALYZING",
      analysis_status: null,
      analysis_retry_count: 0,
      analysis_uncertain_at: new Date(),
      monthly_final_disposition: null,
      exclusion_code: null,
    };
    const db = {
      execute: async (query: unknown) => {
        const text = queryText(query);
        if (text.includes("AS schema_ready")) return { rows: [{ schema_ready: true }] };
        if (text.includes("AS ready")) return { rows: [{ ready: true }] };
        if (text.includes("SELECT COUNT(*)::int AS total")) return { rows: [{ total: 1 }] };
        if (text.includes("SELECT DISTINCT ON (report_id)")) return { rows: [] };
        if (text.includes("SELECT member.report_period")) return { rows: [row] };
        return { rows: [] };
      },
    };
    const result = await listMonthlyAutomationExceptions(db as any, {
      reportPeriod: "2026-10", category: "UNKNOWN",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].first_pass_outcome).toBe("failed");
    expect(result.rows[0].unknown_reissue_allowed).toBe(true);
    expect(result.rows[0].unknown_reissue_hold_reason).toBeNull();
  });

  it("pauses visibly when a HALF_OPEN probe lease expired across restart and permits explicit resume", async () => {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    const db: any = {
      execute: async (query: unknown) => {
        const compiled = dialect.sqlToQuery(query as any);
        statements.push({ text: compiled.sql, params: compiled.params });
        if (compiled.sql.includes("AS schema_ready")) return { rows: [{ schema_ready: true }] };
        if (compiled.sql.includes("FROM growth_report_cycles cycle")) {
          return { rows: [{
            report_period: "2026-10",
            paused_at: null,
            circuit_state: {
              status: "HALF_OPEN",
              recentFailures: [],
              probeReservations: [{ key: "cycle-1:old-probe", at: Date.now() - 120_000 }],
              probeSuccesses: 0,
              resumeHistory: [],
              config: {
                failureThreshold: 2, windowMs: 60_000, probeCount: 1,
                cooldownMs: 1_000, probeLeaseMs: 60_000,
              },
            },
            swimming_pool_id: "pool-1",
            manifest_cycle_id: "cycle-1",
            preparation_status: "sealed",
            actual_cycle_id: "cycle-1",
          }] };
        }
        if (compiled.sql.includes("SELECT target.first_pass_outcome")) {
          return { rows: [{
            first_pass_outcome: "unknown",
            policy_excluded_at: null,
            product_status: "ANALYZING",
            analysis_uncertain_at: new Date(),
          }] };
        }
        return { rows: [] };
      },
      transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({ execute: async (query: unknown) => {
          const compiled = dialect.sqlToQuery(query as any);
          statements.push({ text: compiled.sql, params: compiled.params });
          if (compiled.sql.includes("FROM growth_report_cycles cycle")) {
            return { rows: [{
              report_period: "2026-10",
              paused_at: null,
              circuit_state: {
                status: "HALF_OPEN",
                recentFailures: [],
                probeReservations: [{ key: "cycle-1:old-probe", at: Date.now() - 120_000 }],
                probeSuccesses: 0,
                resumeHistory: [],
                config: {
                  failureThreshold: 2, windowMs: 60_000, probeCount: 1,
                  cooldownMs: 1_000, probeLeaseMs: 60_000,
                },
              },
              swimming_pool_id: "pool-1",
              manifest_cycle_id: "cycle-1",
              preparation_status: "sealed",
              actual_cycle_id: "cycle-1",
            }] };
          }
          if (compiled.sql.includes("SELECT target.first_pass_outcome")) {
            return { rows: [{
              first_pass_outcome: "unknown",
              policy_excluded_at: null,
              product_status: "ANALYZING",
              analysis_uncertain_at: new Date(),
            }] };
          }
          return { rows: [] };
        } }),
    };

    const admitted = await reserveMonthlyUnknownRecoveryAdmission(db, {
      cycleId: "cycle-1", studentId: "student-1",
    });
    expect(admitted).toBe(false);
    const expiredPause = statements.find(row =>
      row.text.includes("HALF_OPEN_PROBE_LEASE_EXPIRED"));
    expect(expiredPause?.text).toContain("paused_at = NOW()");
    expect(expiredPause?.text).toContain("pause_epoch = pause_epoch + 1");
    const persistedCircuit = expiredPause?.params.find(value =>
      typeof value === "string" && value.includes('"status":"OPEN"'));
    expect(persistedCircuit).toBeTruthy();
    expect(JSON.parse(String(persistedCircuit)).probeReservations).toEqual([]);

    const resumeDb = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      if (text.includes("SELECT paused_at, pause_epoch")) return [{
        paused_at: new Date(Date.now() - 10_000).toISOString(),
        pause_epoch: 1,
        circuit_state: {
          status: "OPEN",
          recentFailures: [],
          probeReservations: [],
          probeSuccesses: 0,
          resumeHistory: [],
          config: {
            failureThreshold: 2, windowMs: 60_000, probeCount: 1,
            cooldownMs: 1_000, probeLeaseMs: 60_000,
          },
        },
      }];
      return [];
    });
    expect(await resumeMonthlyAutomationRun(resumeDb as any, {
      reportPeriod: "2026-10",
      actorId: "operator-1",
      reason: "review expired probe after restart",
    })).toBe(true);
    expect(resumeDb.statements.some(text => text.includes("SET paused_at = NULL"))).toBe(true);
  });

  it("does not create a missing run after KST day one", async () => {
    const db = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      return [];
    });

    const run = await registerMonthlyAutomationRun(db as any, {
      reportPeriod: "2026-09",
      poolIds: ["pool-a"],
      now: new Date("2026-10-01T15:00:00.000Z"), // Oct 2 in KST
    });

    expect(run).toBeNull();
    expect(db.statements.some(text => text.includes("INSERT INTO growth_report_monthly_runs"))).toBe(false);
  });

  it("returns an existing manifest on a later day without changing its cohort", async () => {
    const db = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      if (text.includes("SELECT report_period, paused_at") && text.includes("FROM growth_report_monthly_runs")) {
        return [{ report_period: "2026-10", paused_at: null, first_pass_completed_at: null, summary_payload: null }];
      }
      return [];
    });

    const run = await registerMonthlyAutomationRun(db as any, {
      reportPeriod: "2026-10",
      poolIds: ["pool-new"],
      now: new Date("2026-10-02T02:00:00.000Z"),
    });

    expect(run?.report_period).toBe("2026-10");
    expect(db.statements.some(text => text.includes("INSERT INTO growth_report_monthly_run_pools"))).toBe(false);
  });

  it("does not finish while any sealed target has not been accounted", async () => {
    const db = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      if (text.includes("SELECT first_pass_completed_at, summary_payload")) {
        return [{ first_pass_completed_at: null, summary_payload: null, paused_at: null }];
      }
      if (text.includes("AS can_finish")) return [{ can_finish: false, has_manifest: true }];
      return [];
    });

    const result = await finishMonthlyFirstPass(db as any, "2026-10");

    expect(result).toBeNull();
    const barrier = db.statements.find(text => text.includes("AS can_finish"));
    expect(barrier).toContain("preparation_status = 'pending'");
    expect(barrier).toContain("first_pass_completed_at IS NULL");
    expect(barrier).toContain("eligible_total <>");
  });

  it("only records outcome labels when matching sealed targets satisfy the durable proof", async () => {
    const db = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      if (text.includes("SELECT target.first_pass_outcome")) return [{ first_pass_outcome: null }];
      if (text.includes("UPDATE growth_report_eligible_targets target")) return [];
      return [];
    });

    const outcome = await recordMonthlyFirstPassOutcome(db as any, {
      cycleId: "cycle-1",
      studentId: "student-1",
      outcome: "generated",
    });

    expect(outcome).toBe("not_found");
    const update = db.statements.find(text => text.includes("UPDATE growth_report_eligible_targets target"));
    expect(update).toContain("report.analysis_status IN");
    expect(update).toContain("report.monthly_final_disposition IS NULL");
    expect(update).toContain("report.analysis_uncertain_at IS NULL");
    const eligibility = db.statements.find(text => text.includes("SELECT target.first_pass_outcome"));
    expect(eligibility).toContain("member.preparation_status = 'sealed'");
  });

  it("keeps the finished first-pass snapshot immutable and serves a separate live summary", async () => {
    const snapshot = {
      report_period: "2026-10",
      pool_total: 1,
      processed_pool_total: 1,
      eligible_total: 1,
      generated_total: 0,
      insufficient_evidence_total: 0,
      policy_excluded_total: 0,
      unresolved_pool_total: 1,
      unresolved_member_total: 1,
      pending_pool_total: 0,
      error_categories: { PROVIDER: 1 },
    };
    const db = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      if (text.includes("SELECT first_pass_completed_at, summary_payload")) {
        return [{ first_pass_completed_at: new Date(), summary_payload: snapshot }];
      }
      if (text.includes("AS generated_total") && text.includes("FILTER (WHERE target.policy_excluded_at")) {
        return [{
          generated_total: 1, insufficient_evidence_total: 0,
          policy_excluded_total: 0, unresolved_member_total: 0,
          target_blocked_pool_total: 0,
        }];
      }
      if (text.includes("AS target_blocked_pool_total") && text.includes("COUNT(target.student_id)")) {
        return [{
          pool_total: 1, processed_pool_total: 1, pending_pool_total: 0,
          eligible_total: 1, generated_total: 0, insufficient_evidence_total: 0,
          policy_excluded_total: 0, unresolved_member_total: 1,
          preparation_failed_pool_total: 0, target_blocked_pool_total: 1,
        }];
      }
      return [];
    });

    const firstPass = await getMonthlyAutomationSummary(db as any, "2026-10");
    const live = await getMonthlyAutomationSummary(db as any, "2026-10", { live: true });

    expect(firstPass?.generated_total).toBe(0);
    expect(live?.generated_total).toBe(1);
    expect(live?.unresolved_member_total).toBe(0);
  });

  it("excludes resolved/policy-excluded reports from current exceptions and returns bounded counters", async () => {
    const db = mockDb(text => {
      if (text.includes("AS schema_ready")) return [{ schema_ready: true }];
      if (text.includes("SELECT COUNT(*)::int AS total")) return [{ total: 1 }];
      if (text.includes("SELECT member.report_period")) {
        return [{
          report_period: "2026-10",
          swimming_pool_id: "pool-1",
          student_id: "student-1",
          first_pass_outcome: "unknown",
          first_pass_engine_requests: 2,
          recovery_engine_requests: 1,
          lookup_requests: 3,
          recovery_epoch: 0,
          analysis_request_payload: { request_id: "must-not-leak" },
        }];
      }
      return [];
    });

    const result = await listMonthlyAutomationExceptions(db as any, { reportPeriod: "2026-10" });

    expect(result.rows[0]).toMatchObject({
      first_pass_engine_requests: 2,
      recovery_engine_requests: 1,
      lookup_requests: 3,
      recovery_epoch: 0,
      recovery_allowed: false,
    });
    expect(result.rows[0]).not.toHaveProperty("analysis_request_payload");
    const query = db.statements.find(text => text.includes("SELECT member.report_period"));
    expect(query).toContain("target.policy_excluded_at IS NULL");
    expect(query).toContain("monthly_final_disposition = 'INSUFFICIENT_EVIDENCE'");
    expect(query).toContain("NOT (");
  });

});