import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getGrowthReportAnalysisIdentityHash } from "../growth-report-analysis-identity.js";
import { recoverMonthlyTargets } from "../growth-report-monthly-recovery.js";

const dialect = new PgDialect();
function fixture(statuses: string[]) {
  const rows = statuses.map((status, index) => {
    const request = {
      request_id: `request-${index}`, report_id: `report-${index}`,
      context: { student_id: `student-${index}`, pool_id: "pool", report_period: "2026-09" },
      snapshot: { payload_hash: `hash-${index}` },
    };
    return {
      id: request.report_id, student_id: request.context.student_id,
      product_status: status, analysis_request_id: request.request_id,
      analysis_request_payload: request, snapshot_hash: request.snapshot.payload_hash,
      analysis_identity_hash: getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS"),
      analysis_uncertain_at: null as Date | null, policy_excluded_at: null as Date | null,
      recovery_epoch: 0, recovery_attempt_limit: 3,
    };
  });
  const calls: string[] = [];
  let sealed = true;
  const tx: any = {
    execute: async (query: any) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      calls.push(text);
      if (text.includes("AS schema_ready")) return { rows: [{ schema_ready: true }] };
      if (text.includes("growth_report_monthly_runs")) return { rows: [] };
      if (text.includes("FROM growth_report_cycles")) return {
        rows: [{ id: "cycle", eligible_total: rows.length, eligibility_sealed_at: sealed ? new Date() : null }],
      };
      if (text.includes("FROM growth_report_eligible_targets")) return { rows: rows.map(row => ({ ...row })) };
      if (text.includes("UPDATE growth_reports")) {
        const row = rows.find(item => params.includes(item.id));
        if (row?.product_status !== "FAILED" || row.analysis_uncertain_at) return { rows: [] };
        row.product_status = params[0] as string;
        return { rows: [{ id: row.id }] };
      }
      if (text.includes("UPDATE growth_report_eligible_targets")) {
        const row = rows.find(item => params.includes(item.student_id));
        if (!row) return { rows: [] };
        row.recovery_epoch++;
        return { rows: [{ student_id: row.student_id }] };
      }
      if (text.includes("next_audit_version")) return { rows: [{ v: 1 }] };
      return { rows: [] };
    },
  };
  return {
    rows, calls,
    db: { execute: (query: any) => tx.execute(query), transaction: (fn: any) => fn(tx) },
    unseal: () => { sealed = false; },
  };
}
const scope = { poolId: "pool", reportPeriod: "2026-09", actorId: "operator" };

describe("scoped monthly operator recovery", () => {
  it("reactivates only failed targets, retaining request identity and successes", async () => {
    const f = fixture(["FAILED", "REVIEW_REQUIRED", "PUBLISHED", "EXCLUDED", "OPEN"]);
    const saved = f.rows.map(row => row.analysis_request_id);
    const result = await recoverMonthlyTargets(f.db, scope);
    expect(result.reactivated).toBe(1);
    expect(result.skipped_success).toBe(2);
    expect(result.skipped_initial_excluded).toBe(1);
    expect(f.rows.map(row => row.analysis_request_id)).toEqual(saved);
    expect(f.rows[0].product_status).toBe("READY_FOR_ANALYSIS");
    expect(f.calls.join(" ")).not.toMatch(/UPDATE growth_report_batch_jobs/);
  });
  it("repeating recovery neither resets pending retry budgets nor creates jobs", async () => {
    const f = fixture(["FAILED", "FAILED", "REVIEW_REQUIRED"]);
    expect((await recoverMonthlyTargets(f.db, scope)).reactivated).toBe(2);
    expect((await recoverMonthlyTargets(f.db, scope)).reactivated).toBe(0);
    expect(f.calls.filter(call => call.includes("INSERT INTO growth_reports"))).toHaveLength(0);
  });
  it("bounds legacy recovery epochs independently of the reset retry counter", async () => {
    const f = fixture(["FAILED"]);
    f.rows[0].recovery_attempt_limit = 1;
    expect((await recoverMonthlyTargets(f.db, scope)).reactivated).toBe(1);
    f.rows[0].product_status = "FAILED";
    expect((await recoverMonthlyTargets(f.db, scope)).blocked_recovery_limit).toBe(1);
    expect(f.rows[0].recovery_epoch).toBe(1);
  });
  it("never bypasses ENGINE UNKNOWN or legitimate policy exclusion", async () => {
    const f = fixture(["FAILED", "FAILED"]);
    f.rows[0].analysis_uncertain_at = new Date();
    f.rows[1].policy_excluded_at = new Date();
    const result = await recoverMonthlyTargets(f.db, scope);
    expect(result.reactivated).toBe(0);
    expect(result.blocked_unknown).toBe(1);
    expect(result.skipped_policy_excluded).toBe(1);
  });
  it("blocks missing or corrupt request identity without inventing a new one", async () => {
    const f = fixture(["FAILED"]);
    f.rows[0].analysis_request_payload.request_id = "different";
    const result = await recoverMonthlyTargets(f.db, scope);
    expect(result.reactivated).toBe(0);
    expect(result.blocked_identity).toBe(1);
  });
  it("requires a sealed population and validates the month", async () => {
    const f = fixture(["FAILED"]); f.unseal();
    await expect(recoverMonthlyTargets(f.db, scope)).rejects.toThrow("NOT_SEALED");
    await expect(recoverMonthlyTargets(f.db, { ...scope, reportPeriod: "2026-13" }))
      .rejects.toThrow("INVALID_MONTHLY_RECOVERY_SCOPE");
  });
});