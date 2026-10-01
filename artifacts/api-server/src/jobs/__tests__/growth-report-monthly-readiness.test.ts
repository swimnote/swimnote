import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  classifyMonthlyReadiness,
  getMonthlyReportReadiness,
  reconcileMonthlyCycle,
  summarizeMonthlyTargetRows,
} from "../growth-report-monthly-readiness.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;
const queryParams = (value: any) => dialect.sqlToQuery(value).params;

function generatedReport(studentId: string, poolId = "pool-1") {
  return {
    student_id: studentId,
    target_pool_id: "pool-1",
    report_id: `report-${studentId}`,
    swimming_pool_id: poolId,
    product_status: "REVIEW_REQUIRED",
    analysis_status: "COMPLETE",
    eligibility_version: 4,
    attendance_count: 3,
    source_event_count: 1,
    report_content: { summary: "present" },
    report_fact_package: {
      grounding_result: "PASS",
      growth_framing_result: "REVISED_PASS",
    },
    sns_summary: { present: true },
  };
}

function run(eligibleTotal: number, rows: any[]) {
  return summarizeMonthlyTargetRows(eligibleTotal, rows, true, Date.parse("2026-10-05T00:00:00Z"));
}

describe("sealed monthly growth-report reconciliation", () => {
  it("preserves legacy classification fields", () => {
    expect(classifyMonthlyReadiness([
      { product_status: "READY_TO_SEND", analysis_status: "COMPLETE", readiness_eligible: true },
      { product_status: "EXCLUDED", exclusion_code: "NOT_ELIGIBLE" },
      { product_status: "OPEN", analysis_status: "DATA_ACCUMULATING" },
      { product_status: "ANALYZING", analysis_status: "PROCESSING" },
      { product_status: "FAILED", analysis_status: "FAILED" },
      { product_status: "PUBLISHED" },
      { product_status: "OPEN", analysis_status: "MAX_RETRY_EXCEEDED" },
      { product_status: "OPEN" },
    ])).toEqual({
      analysis_ready: 1,
      excluded: 1,
      data_accumulating: 1,
      retrying: 1,
      terminal_failed: 2,
      pending_analysis: 1,
      published: 1,
      other: 0,
      total: 8,
    });
  });

  it("keeps 119 sealed identities when one has failed (118 generated + 1 failed is NOT READY)", () => {
    const rows = Array.from({ length: 118 }, (_, i) => generatedReport(`s-${i}`));
    rows.push({
      student_id: "s-failed",
      target_pool_id: "pool-1",
      report_id: "failed-report",
      swimming_pool_id: "pool-1",
      product_status: "FAILED",
      analysis_status: "FAILED",
    });

    expect(run(119, rows)).toMatchObject({
      eligible_total: 119,
      generated_total: 118,
      policy_excluded_total: 0,
      resolved_total: 118,
      remaining_count: 1,
      failed: 1,
      ready: false,
    });
  });

  it("accepts a verified post-seal withdrawal but never converts failure into policy exclusion", () => {
    const generated = Array.from({ length: 118 }, (_, i) => generatedReport(`s-${i}`));
    const withdrawnReport = {
      ...generatedReport("s-withdrawn"),
      product_status: "EXCLUDED",
      analysis_status: "PENDING",
      exclusion_code: "POST_ELIGIBILITY_WITHDRAWAL",
      withdrawal_evidence_valid: true,
    };
    expect(run(119, [...generated, withdrawnReport])).toMatchObject({
      eligible_total: 119,
      generated_total: 118,
      policy_excluded_total: 1,
      resolved_total: 119,
      remaining_count: 0,
      ready: true,
    });

    const failed = {
      student_id: "s-failed",
      target_pool_id: "pool-1",
      report_id: "failed-report",
      swimming_pool_id: "pool-1",
      product_status: "FAILED",
      analysis_status: "FAILED",
      withdrawal_evidence_valid: true,
    };
    expect(run(1, [failed])).toMatchObject({
      failed: 1,
      policy_excluded_total: 0,
      ready: false,
    });

    expect(run(1, [{
      student_id: "missing",
      target_pool_id: "pool-1",
      report_id: null,
      withdrawal_evidence_valid: true,
    }])).toMatchObject({
      missing: 1,
      policy_excluded_total: 0,
      ready: false,
    });

    expect(run(1, [{
      ...generatedReport("initially-excluded"),
      product_status: "EXCLUDED",
      exclusion_code: "INITIAL_ELIGIBILITY_EXCLUDED",
      withdrawal_evidence_valid: true,
    }])).toMatchObject({
      excluded: 1,
      policy_excluded_total: 0,
      ready: false,
    });
  });

  it("distinguishes EMPTY_TARGET from READY", () => {
    expect(run(0, [])).toMatchObject({
      eligible_total: 0,
      empty_target: true,
      snapshot_sealed: true,
      ready: false,
    });
    expect(summarizeMonthlyTargetRows(0, [], false)).toMatchObject({
      empty_target: false,
      snapshot_sealed: false,
      ready: false,
    });
  });

  it("reports missing, duplicate, wrong-pool and unresolved unknown identities without latest-row masking", () => {
    const duplicate = generatedReport("duplicate");
    const rows = [
      { student_id: "missing", target_pool_id: "pool-1", report_id: null },
      generatedReport("duplicate"),
      duplicate,
      generatedReport("wrong-pool", "pool-2"),
      generatedReport("good"),
    ];
    expect(run(4, rows)).toMatchObject({
      eligible_total: 4,
      generated_total: 1,
      missing: 1,
      duplicate: 1,
      wrong_pool: 1,
      unknown: 2,
      ready: false,
    });
  });

  it("classifies an uncertain in-flight report as UNKNOWN before PROCESSING", () => {
    expect(run(1, [{
      student_id: "uncertain",
      target_pool_id: "pool-1",
      report_id: "uncertain-report",
      swimming_pool_id: "pool-1",
      product_status: "ANALYZING",
      analysis_status: "PROCESSING",
      analysis_uncertain_at: new Date("2026-10-05T00:00:00Z"),
    }])).toMatchObject({
      unknown: 1,
      processing: 0,
      ready: false,
    });
    expect(run(1, [{
      ...generatedReport("uncertain-qualified"),
      analysis_uncertain_at: new Date("2026-10-05T00:00:00Z"),
    }])).toMatchObject({
      generated_total: 0,
      unknown: 1,
      ready: false,
    });
  });

  it("locks a cycle, reconciles all target/report rows, and conditionally records readiness", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: "cycle-1",
        swimming_pool_id: "pool-1",
        eligible_total: 1,
        eligibility_sealed_at: "2026-10-01T00:00:00Z",
      }] })
      .mockResolvedValueOnce({ rows: [] }) // no post-seal withdrawal candidates
      .mockResolvedValueOnce({ rows: [generatedReport("s-1")] })
      .mockResolvedValueOnce({ rows: [] });
    const tx = { execute };
    const db = {
      transaction: vi.fn(async callback => callback(tx as any)),
    };
    const onReady = vi.fn().mockResolvedValue(undefined);
    const readiness = await getMonthlyReportReadiness(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
      onReady,
    );

    expect(readiness.ready).toBe(true);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(queryText(execute.mock.calls[0][0])).toContain("FOR UPDATE");
    const candidateQuery = queryText(execute.mock.calls[1][0]);
    expect(candidateQuery).toContain("withdrawal.withdrawn_at > target.confirmed_at");
    expect(candidateQuery).toContain("student.withdrawn_at IS NOT NULL");
    expect(candidateQuery).toContain("student.withdrawn_at > target.confirmed_at");
    expect(candidateQuery).toContain("student.withdrawn_at = withdrawal.withdrawn_at");
    expect(candidateQuery).toContain("LOWER(student.status::text) IS DISTINCT FROM 'active'");
    expect(candidateQuery).toContain("OR student.deleted_at IS NOT NULL");
    expect(candidateQuery).not.toContain("student.deleted_at IS NULL");
    expect(candidateQuery).toContain("JOIN growth_reports");
    expect(candidateQuery).toContain("JOIN students");
    expect(candidateQuery).toContain("FOR UPDATE OF target, report, student");
    const targetQuery = queryText(execute.mock.calls[2][0]);
    expect(targetQuery).toContain("LEFT JOIN growth_reports");
    expect(targetQuery).toContain("withdrawn_member_archives");
    expect(targetQuery).toContain("current_student.withdrawn_at IS NOT NULL");
    expect(targetQuery).toContain("current_student.withdrawn_at > target.confirmed_at");
    expect(targetQuery).toContain("current_student.withdrawn_at = withdrawal.withdrawn_at");
    expect(targetQuery).toContain("OR current_student.deleted_at IS NOT NULL");
    expect(targetQuery).not.toContain("DISTINCT ON");
    expect(targetQuery).not.toContain("student.status = 'active'");
    expect(queryText(execute.mock.calls[3][0])).toContain("ready_at = COALESCE");
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("keeps recordReady=false observational with no locks, candidate materialization, or writes", async () => {
    const execute = vi.fn(async (query: unknown) => {
      const q = queryText(query);
      if (q.includes("FROM growth_report_cycles")) {
        return { rows: [{
          id: "cycle-readonly",
          swimming_pool_id: "pool-1",
          eligible_total: 1,
          eligibility_sealed_at: "2026-10-01T00:00:00Z",
        }] };
      }
      if (q.includes("LEFT JOIN growth_reports")) {
        return { rows: [generatedReport("s-readonly")] };
      }
      return { rows: [] };
    });
    const db = {
      transaction: vi.fn(async callback => callback({ execute } as any)),
    };
    const onReady = vi.fn().mockResolvedValue(undefined);

    const readiness = await reconcileMonthlyCycle(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
      onReady,
      { recordReady: false },
    );

    expect(readiness.ready).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    const queries = execute.mock.calls.map(([query]) => queryText(query));
    expect(queries.some(query => query.includes("FOR UPDATE"))).toBe(false);
    expect(queries.some(query => query.includes("FOR UPDATE OF target, report"))).toBe(false);
    expect(queries.some(query => query.includes("UPDATE "))).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("writes a real post-seal withdrawal disposition while preserving the report content", async () => {
    const candidate = {
      ...generatedReport("s-withdrawn"),
      product_status: "OPEN",
      analysis_status: null,
      analysis_retry_count: 0,
      analysis_claim_token: null,
      analysis_lease_until: null,
      analysis_call_started_at: null,
      analysis_uncertain_at: null,
      confirmed_at: new Date("2026-09-01T00:00:00Z"),
      withdrawal_id: "withdrawal-audit-1",
      withdrawn_at: new Date("2026-09-20T00:00:00Z"),
      current_student_withdrawn_at: new Date("2026-09-20T00:00:00Z"),
      current_student_status: "active",
      student_deleted_at: new Date("2026-09-23T00:00:00Z"),
    };
    const completedCandidate = {
      ...generatedReport("s-approved"),
      product_status: "APPROVED",
      analysis_status: "COMPLETE",
      confirmed_at: new Date("2026-09-01T00:00:00Z"),
      withdrawal_id: "withdrawal-audit-2",
      withdrawn_at: new Date("2026-09-22T00:00:00Z"),
      current_student_withdrawn_at: new Date("2026-09-22T00:00:00Z"),
      current_student_status: "withdrawn",
      student_deleted_at: null,
    };
    const candidates = [candidate, completedCandidate];
    const execute = vi.fn(async (query: unknown) => {
      const q = queryText(query);
      if (q.includes("FROM growth_report_cycles") && q.includes("FOR UPDATE")) {
        return { rows: [{
          id: "cycle-1",
          swimming_pool_id: "pool-1",
          eligible_total: 2,
          eligibility_sealed_at: "2026-09-01T00:00:00Z",
        }] };
      }
      if (q.includes("FOR UPDATE OF target, report")) return { rows: candidates };
      if (q.includes("UPDATE growth_reports")) return { rows: [{ id: "updated-report" }] };
      if (q.includes("UPDATE growth_report_eligible_targets")) {
        return { rows: [{ student_id: "updated-target" }] };
      }
      if (q.includes("LEFT JOIN growth_reports")) {
        return { rows: candidates.map(target => ({
          ...target,
          product_status: "EXCLUDED",
          exclusion_code: "POST_ELIGIBILITY_WITHDRAWAL",
          withdrawal_evidence_valid: true,
        })) };
      }
      return { rows: [] };
    });
    const db = {
      transaction: vi.fn(async callback => callback({ execute } as any)),
    };

    const readiness = await getMonthlyReportReadiness(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
    );

    expect(readiness).toMatchObject({
      eligible_total: 2,
      generated_total: 0,
      policy_excluded_total: 2,
      resolved_total: 2,
      ready: true,
    });
    const reportUpdates = execute.mock.calls.filter(([query]) =>
      queryText(query).includes("UPDATE growth_reports"),
    );
    expect(reportUpdates).toHaveLength(2);
    const queueUpdate = reportUpdates.find(([query]) =>
      queryText(query).includes("analysis_claim_token IS NULL"),
    )!;
    const generatedUpdate = reportUpdates.find(([query]) =>
      queryText(query).includes("product_status IN ('REVIEW_REQUIRED', 'READY_TO_SEND', 'APPROVED')"),
    )!;
    const queueUpdateSql = queryText(queueUpdate[0]);
    expect(queueUpdateSql).toContain("analysis_status IS NULL");
    expect(queueUpdateSql).not.toContain("COALESCE(analysis_status");
    expect(queueUpdateSql).not.toContain("'PENDING'");
    expect(queueUpdateSql).not.toContain("'QUEUED'");
    expect(queryText(queueUpdate[0])).toContain("product_status = 'EXCLUDED'");
    expect(queryText(queueUpdate[0])).toContain("exclusion_code = 'POST_ELIGIBILITY_WITHDRAWAL'");
    expect(queryText(queueUpdate[0])).not.toContain("report_content =");
    expect(queryText(generatedUpdate[0])).not.toContain("analysis_claim_token IS NULL");
    const targetUpdates = execute.mock.calls.filter(([query]) =>
      queryText(query).includes("UPDATE growth_report_eligible_targets"),
    );
    expect(targetUpdates).toHaveLength(2);
    expect(queryText(targetUpdates[0][0])).toContain("policy_excluded_at = NOW()");
    expect(queryText(targetUpdates[0][0])).toContain("policy_evidence_ref");
    expect(targetUpdates.some(([query]) => queryParams(query).includes("withdrawal-audit-1"))).toBe(true);
    expect(targetUpdates.some(([query]) => queryParams(query).includes("withdrawal-audit-2"))).toBe(true);
  });

  it("does not exclude a restored-then-suspended student using a stale withdrawal archive", async () => {
    const staleArchiveCandidate = {
      ...generatedReport("restored-suspended"),
      product_status: "OPEN",
      analysis_status: null,
      analysis_retry_count: 0,
      analysis_claim_token: null,
      analysis_lease_until: null,
      analysis_call_started_at: null,
      analysis_uncertain_at: null,
      confirmed_at: new Date("2026-09-01T00:00:00Z"),
      withdrawal_id: "old-withdrawal-archive",
      withdrawn_at: new Date("2026-09-20T00:00:00Z"),
      current_student_status: "suspended",
      current_student_withdrawn_at: null,
      student_deleted_at: null,
    };
    const execute = vi.fn(async (query: unknown) => {
      const q = queryText(query);
      if (q.includes("FROM growth_report_cycles")) {
        return { rows: [{
          id: "cycle-restored",
          swimming_pool_id: "pool-1",
          eligible_total: 1,
          eligibility_sealed_at: "2026-09-01T00:00:00Z",
        }] };
      }
      if (q.includes("FOR UPDATE OF target, report")) {
        return { rows: [staleArchiveCandidate] };
      }
      if (q.includes("LEFT JOIN growth_reports")) {
        return { rows: [{
          ...staleArchiveCandidate,
          withdrawal_evidence_valid: false,
        }] };
      }
      return { rows: [] };
    });
    const db = {
      transaction: vi.fn(async callback => callback({ execute } as any)),
    };

    const readiness = await getMonthlyReportReadiness(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
    );

    const candidateQuery = queryText(execute.mock.calls[1][0]);
    expect(candidateQuery).toContain("student.withdrawn_at IS NOT NULL");
    expect(candidateQuery).toContain("student.withdrawn_at > target.confirmed_at");
    expect(candidateQuery).toContain("student.withdrawn_at = withdrawal.withdrawn_at");
    const evidenceQuery = queryText(execute.mock.calls[2][0]);
    expect(evidenceQuery).toContain("current_student.withdrawn_at IS NOT NULL");
    expect(evidenceQuery).toContain("current_student.withdrawn_at > target.confirmed_at");
    expect(evidenceQuery).toContain("current_student.withdrawn_at = withdrawal.withdrawn_at");
    expect(readiness).toMatchObject({
      policy_excluded_total: 0,
      queued: 1,
      ready: false,
    });
    expect(execute.mock.calls.some(([query]) =>
      queryText(query).includes("UPDATE growth_reports"),
    )).toBe(false);
    expect(execute.mock.calls.some(([query]) =>
      queryText(query).includes("UPDATE growth_report_eligible_targets"),
    )).toBe(false);
  });

  it("leaves FAILED, UNKNOWN, retry-exhausted, missing, and PUBLISHED records untouched", async () => {
    const candidates = [
      {
        student_id: "failed",
        product_status: "FAILED",
        analysis_status: "FAILED",
        analysis_retry_count: 0,
      },
      {
        student_id: "unknown",
        product_status: "OPEN",
        analysis_status: "UNKNOWN",
        analysis_retry_count: 0,
      },
      {
        student_id: "exhausted",
        product_status: "OPEN",
        analysis_status: "MAX_RETRY_EXCEEDED",
        analysis_retry_count: 4,
      },
      {
        student_id: "published",
        product_status: "PUBLISHED",
        analysis_status: "COMPLETE",
        analysis_retry_count: 0,
        eligibility_version: 4,
        attendance_count: 3,
        source_event_count: 1,
        report_content: { present: true },
        report_fact_package: {
          grounding_result: "PASS",
          growth_framing_result: "PASS",
        },
        sns_summary: { present: true },
      },
    ].map(candidate => ({
      ...generatedReport(candidate.student_id),
      ...candidate,
      confirmed_at: new Date("2026-09-01T00:00:00Z"),
      withdrawal_id: `audit-${candidate.student_id}`,
      withdrawn_at: new Date("2026-09-20T00:00:00Z"),
      current_student_status: "withdrawn",
      student_deleted_at: null,
      analysis_claim_token: null,
      analysis_lease_until: null,
      analysis_call_started_at: null,
      analysis_uncertain_at: null,
    }));
    const execute = vi.fn(async (query: unknown) => {
      const q = queryText(query);
      if (q.includes("FROM growth_report_cycles") && q.includes("FOR UPDATE")) {
        return { rows: [{
          id: "cycle-1",
          swimming_pool_id: "pool-1",
          eligible_total: 5,
          eligibility_sealed_at: "2026-09-01T00:00:00Z",
        }] };
      }
      if (q.includes("FOR UPDATE OF target, report")) return { rows: candidates };
      if (q.includes("LEFT JOIN growth_reports")) {
        return {
          rows: [
            ...candidates.map(candidate => ({
              ...candidate,
              withdrawal_evidence_valid: false,
            })),
            { student_id: "missing", target_pool_id: "pool-1", report_id: null },
          ],
        };
      }
      return { rows: [] };
    });
    const db = {
      transaction: vi.fn(async callback => callback({ execute } as any)),
    };

    const readiness = await getMonthlyReportReadiness(
      db as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
    );

    expect(execute.mock.calls.some(([query]) =>
      queryText(query).includes("UPDATE growth_reports"),
    )).toBe(false);
    expect(execute.mock.calls.some(([query]) =>
      queryText(query).includes("UPDATE growth_report_eligible_targets"),
    )).toBe(false);
    expect(readiness).toMatchObject({
      policy_excluded_total: 0,
      failed: 2,
      unknown: 1,
      missing: 1,
      published: 1,
      ready: false,
    });
  });
});