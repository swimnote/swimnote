import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  classifyMonthlyReadiness,
  getMonthlyReportReadiness,
} from "../growth-report-monthly-readiness.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;

describe("monthly growth-report admin readiness", () => {
  it("keeps analysis-ready, excluded, data-accumulating, retrying, failed, and published distinct", () => {
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

  it("queries actual latest reports and requires the complete V1 review guard", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { product_status: "REVIEW_REQUIRED", analysis_status: "COMPLETE", readiness_eligible: true },
        { product_status: "FAILED", analysis_status: "FAILED", readiness_eligible: false },
      ],
    });
    const readiness = await getMonthlyReportReadiness(
      { execute } as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
    );
    expect(readiness).toMatchObject({ analysis_ready: 1, terminal_failed: 1, total: 2 });
    const query = queryText(execute.mock.calls[0][0]);
    expect(query).toContain("DISTINCT ON (gr.student_id, gr.cycle_id)");
    expect(query).toContain("latest.eligibility_version >= 4");
    expect(query).toContain("latest.attendance_count >= 3");
    expect(query).toContain("latest.source_event_count >= 1");
    expect(query).toContain("grounding_result");
    expect(query).toContain("growth_framing_result");
    expect(query).toContain("student.status = 'active'");
    expect(query).toContain("history.left_at >= ");
  });

  it("derives ready totals from report rows independently of batch job completion", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { product_status: "REVIEW_REQUIRED", analysis_status: "COMPLETE", readiness_eligible: true },
      ],
    });
    const readiness = await getMonthlyReportReadiness(
      { execute } as any,
      { poolId: "pool-1", reportPeriod: "2026-09" },
    );

    expect(readiness).toMatchObject({ analysis_ready: 1, total: 1 });
    const query = queryText(execute.mock.calls[0][0]);
    expect(query).toContain("FROM growth_reports");
    expect(query).not.toContain("growth_report_batch_jobs");
  });
});