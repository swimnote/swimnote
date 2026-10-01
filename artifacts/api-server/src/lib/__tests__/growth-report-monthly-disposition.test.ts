import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  autoValidateForReadyToSend,
  bulkSendReports,
  getMonthlyReportSummary,
  transitionToReadyToSend,
} from "../growth-report-production-service.js";
import {
  buildInsufficientEvidenceNotice,
  INSUFFICIENT_EVIDENCE_DISPOSITION,
  INSUFFICIENT_EVIDENCE_NOTICE,
  INSUFFICIENT_EVIDENCE_VERSION,
  isMonthlyDispositionRun,
} from "../growth-report-monthly-disposition.js";

vi.mock("../../utils/notify.js", () => ({
  notifyGrowthReportPublished: vi.fn().mockResolvedValue(undefined),
}));

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;

describe("monthly insufficient-evidence disposition", () => {
  it("builds only an APP notice and does not invent AI facts or SNS content", () => {
    const content = buildInsufficientEvidenceNotice("학생");
    expect(content).toEqual({
      student_name: "학생",
      composition_version: "APP_MONTHLY_NOTICE_V1",
      summary_text: INSUFFICIENT_EVIDENCE_NOTICE,
      sections: {},
    });
    expect(content).not.toHaveProperty("grounding_result");
    expect(content).not.toHaveProperty("fact_package");
    expect(content).not.toHaveProperty("sns_summary");
  });

  it("allows only the typed notice through monthly preparation validation", () => {
    expect(autoValidateForReadyToSend({
      report_content: buildInsufficientEvidenceNotice("학생"),
      report_fact_package: null,
      sns_summary: null,
      student_id: "student-1",
      swimming_pool_id: "pool-1",
      analysis_status: "DATA_ACCUMULATING",
      monthly_final_disposition: INSUFFICIENT_EVIDENCE_DISPOSITION,
      monthly_disposition_version: INSUFFICIENT_EVIDENCE_VERSION,
    })).toEqual({ ok: true, issues: [] });

    expect(autoValidateForReadyToSend({
      report_content: buildInsufficientEvidenceNotice("학생"),
      report_fact_package: null,
      sns_summary: null,
      student_id: "student-1",
      swimming_pool_id: "pool-1",
      analysis_status: "DATA_ACCUMULATING",
      monthly_final_disposition: INSUFFICIENT_EVIDENCE_DISPOSITION,
      monthly_disposition_version: 99,
    }).ok).toBe(false);

    expect(autoValidateForReadyToSend({
      report_content: buildInsufficientEvidenceNotice("학생"),
      report_fact_package: null,
      sns_summary: null,
      student_id: "student-1",
      swimming_pool_id: "pool-1",
      analysis_status: "DATA_ACCUMULATING",
    }).ok).toBe(false);
  });

  it("keeps a truthful null-fact/null-SNS notice sendable through the admin bulk publication path", async () => {
    const queries: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const text = queryText(query);
      queries.push(text);
      if (text.includes("SELECT id, student_id, report_period, product_status, deleted_at")) {
        return { rows: [{
          id: "report-insufficient",
          student_id: "student-1",
          report_period: "2026-10",
          product_status: "REVIEW_REQUIRED",
          deleted_at: null,
          analysis_status: "DATA_ACCUMULATING",
          monthly_final_disposition: INSUFFICIENT_EVIDENCE_DISPOSITION,
          monthly_disposition_version: INSUFFICIENT_EVIDENCE_VERSION,
          report_fact_package: null,
          sns_summary: null,
        }] };
      }
      return { rows: [] };
    });

    const result = await bulkSendReports(
      { execute },
      {
        poolId: "pool-1",
        year: 2026,
        month: 11,
        actorId: "admin-1",
        reportIds: ["report-insufficient"],
      },
    );

    expect(result.published_count).toBe(1);
    expect(result.skipped_count).toBe(0);
    const selection = queries.find(query =>
      query.includes("SELECT id, student_id, report_period, product_status, deleted_at"),
    );
    expect(selection).toBeDefined();
    expect(selection).not.toContain("report_fact_package");
    expect(selection).not.toContain("sns_summary");
    expect(selection).not.toContain("grounding_result");
    expect(queries.some(query =>
      query.includes("UPDATE growth_reports") &&
      query.includes("SET product_status = 'PUBLISHED'"),
    )).toBe(true);
  });

  it("keeps legacy admin summary and preparation reads safe before the additive migration", async () => {
    const summaryExecute = vi.fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] });
    await getMonthlyReportSummary(
      { execute: summaryExecute },
      { poolId: "pool-1", year: 2026, month: 11 },
    );
    const summaryQuery = queryText(summaryExecute.mock.calls[0][0]);
    expect(summaryQuery).toContain("to_jsonb(growth_reports)->>'monthly_final_disposition'");
    expect(summaryQuery).not.toContain("growth_reports.monthly_final_disposition");

    const preparationExecute = vi.fn().mockResolvedValueOnce({ rows: [{
      id: "legacy-report",
      product_status: "READY_TO_SEND",
      deleted_at: null,
      monthly_final_disposition: null,
      monthly_disposition_version: null,
    }] });
    await expect(transitionToReadyToSend(
      { execute: preparationExecute },
      "legacy-report",
    )).resolves.toEqual({ success: true });
    const preparationQuery = queryText(preparationExecute.mock.calls[0][0]);
    expect(preparationQuery).toContain("to_jsonb(growth_reports)->>'monthly_disposition_version'");
    expect(preparationQuery).not.toContain("growth_reports.monthly_disposition_version");
  });

  it("enables the nullable-SNS branch only for a registered sealed monthly target", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ schema_ready: true }] })
      .mockResolvedValueOnce({ rows: [{ schema_ready: true }] })
      .mockResolvedValueOnce({ rows: [{ cycle_id: "cycle-1" }] })
      .mockResolvedValueOnce({ rows: [{ schema_ready: true }] })
      .mockResolvedValueOnce({ rows: [{
        report_period: "2026-10",
        paused_at: null,
        first_pass_completed_at: null,
        summary_payload: null,
        is_manifested_pool: true,
      }] });
    const enabled = await isMonthlyDispositionRun(
      { execute },
      "report-1",
      "request-1",
      "hash-1",
    );
    expect(enabled).toBe(true);
    const eligibilityQuery = queryText(execute.mock.calls[2][0]);
    expect(eligibilityQuery).toContain("eligibility_sealed_at IS NOT NULL");
    expect(eligibilityQuery).toContain("target.first_pass_completed_at IS NULL");
    expect(eligibilityQuery).toContain("report.report_content IS NULL");
    expect(eligibilityQuery).toContain("COMPLETE_WITH_PARENT_EVIDENCE");
    expect(eligibilityQuery).toContain("analysis_response_payload->>'request_id'");

    const unregistered = vi.fn()
      .mockResolvedValueOnce({ rows: [{ schema_ready: true }] })
      .mockResolvedValueOnce({ rows: [{ schema_ready: true }] })
      .mockResolvedValueOnce({ rows: [] })
    expect(await isMonthlyDispositionRun(
      { execute: unregistered },
      "report-legacy",
      "request-legacy",
      "hash-legacy",
    )).toBe(false);

    const migrationAbsent = vi.fn()
      .mockResolvedValueOnce({ rows: [{ schema_ready: false }] });
    expect(await isMonthlyDispositionRun(
      { execute: migrationAbsent },
      "report-pre-migration",
      "request-pre-migration",
      "hash-pre-migration",
    )).toBe(false);
    expect(migrationAbsent).toHaveBeenCalledOnce();

    const dispositionColumnsAbsent = vi.fn()
      .mockResolvedValueOnce({ rows: [{ schema_ready: true }] })
      .mockResolvedValueOnce({ rows: [{ schema_ready: false }] });
    expect(await isMonthlyDispositionRun(
      { execute: dispositionColumnsAbsent },
      "report-partial-migration",
      "request-partial-migration",
      "hash-partial-migration",
    )).toBe(false);
    expect(dispositionColumnsAbsent).toHaveBeenCalledTimes(2);
  });
});