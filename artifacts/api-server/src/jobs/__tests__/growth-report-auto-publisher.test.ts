import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  freeReportIssueWindow,
  runMonthlyFreeAutoPublication,
  SEPTEMBER_2026_FREE_REPORT_PERIOD,
} from "../growth-report-auto-publisher.js";

const dialect = new PgDialect();
const queryText = (value: any) => dialect.sqlToQuery(value).sql;
const report = {
  id: "report-1",
  student_id: "student-1",
  swimming_pool_id: "pool-1",
  report_period: "2026-09",
};
const issuedAt = new Date("2026-10-04T17:00:00.000Z"); // October 5, 02:00 KST

describe("monthly FREE automatic growth-report publication", () => {
  it("maps issuance to the previous analysis month with the required KST contract", () => {
    expect(freeReportIssueWindow(issuedAt)).toMatchObject({
      reportPeriod: "2026-09",
      analysisStart: "2026-09-01",
      issueMonthStart: "2026-10-01",
    });
    expect(freeReportIssueWindow(new Date("2026-11-04T17:00:00Z")).reportPeriod).toBe("2026-10");
    expect(SEPTEMBER_2026_FREE_REPORT_PERIOD).toBe(
      "2026년 10월 5일 발급되는 무료 AI 성장리포트는 2026년 9월 1일 00:00 KST 이상, 2026년 10월 1일 00:00 KST 미만의 9월 수업 데이터를 대상으로 한다.",
    );
  });

  it("does not publish or notify before the 5th-day 02:00 KST window", async () => {
    const execute = vi.fn();
    const notify = vi.fn();
    const result = await runMonthlyFreeAutoPublication(
      { execute } as any, new Date("2026-10-04T16:59:59Z"), notify,
    );
    expect(result).toEqual({ published: 0, notificationCandidates: 0 });
    expect(execute).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("only claims validated monthly reports for active students and continued class membership", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await runMonthlyFreeAutoPublication({ execute } as any, issuedAt, vi.fn());
    const update = queryText(execute.mock.calls[0][0]);
    expect(update).toContain("UPDATE growth_reports AS gr");
    expect(update).toContain("gr.report_type = 'monthly'");
    expect(update).toContain("gr.product_status IN ('REVIEW_REQUIRED', 'READY_TO_SEND', 'APPROVED')");
    expect(update).toContain("gr.analysis_status IN (");
    expect(update).toContain("gr.eligibility_version >= 4");
    expect(update).toContain("gr.exclusion_code IS NULL");
    expect(update).toContain("gr.attendance_count >= 3");
    expect(update).toContain("gr.source_event_count >= 1");
    expect(update).toContain("jsonb_typeof(gr.report_content) = 'object'");
    expect(update).toContain("gr.report_fact_package->>'grounding_result' IN ('PASS', 'REVISED_PASS')");
    expect(update).toContain("student.status = 'active'");
    expect(update).toContain("student.deleted_at IS NULL");
    expect(update).toContain("history.enrolled_at < ");
    expect(update).toContain("history.left_at >= ");
    expect(update).toContain("class_group.swimming_pool_id = pool.id");
    expect(update).toContain("RETURNING gr.id");
    expect(queryText(execute.mock.calls[1][0])).toContain("NOT EXISTS");
  });

  it("keeps publication after push failure and never re-publishes or pushes on rerun", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [report] }) // first atomic publish
      .mockResolvedValueOnce({ rows: [report] }) // notification still pending
      .mockResolvedValueOnce({ rows: [] })       // rerun: already published
      .mockResolvedValueOnce({ rows: [] });      // unique notification claimed
    const notify = vi.fn().mockRejectedValueOnce(new Error("push offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runMonthlyFreeAutoPublication({ execute } as any, issuedAt, notify))
        .toEqual({ published: 1, notificationCandidates: 1 });
      expect(await runMonthlyFreeAutoPublication({ execute } as any, issuedAt, notify))
        .toEqual({ published: 0, notificationCandidates: 0 });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith({
        reportId: "report-1",
        studentId: "student-1",
        poolId: "pool-1",
        reportPeriod: "2026-09",
      });
    } finally {
      log.mockRestore();
    }
  });
});