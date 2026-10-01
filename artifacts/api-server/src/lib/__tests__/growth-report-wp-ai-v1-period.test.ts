import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateStudentGrowthReportEligibility,
  getAnalysisMonthForIssueMonth,
  getGrowthReportAnalysisPeriod,
} from "../growth-report-eligibility.js";

const root = process.cwd();
const snapshotBuilder = readFileSync(
  join(root, "src/lib/growth-report-snapshot-builder.ts"),
  "utf8",
);
const analysisWorker = readFileSync(
  join(root, "src/jobs/growth-report-analysis-worker.ts"),
  "utf8",
);

describe("WP-AI-V1.0 monthly FREE growth report eligibility", () => {
  it("maps issue month M to analysis month M-1", () => {
    expect(getAnalysisMonthForIssueMonth("2026-10")).toBe("2026-09");
    expect(getAnalysisMonthForIssueMonth("2026-11")).toBe("2026-10");
    expect(() => getAnalysisMonthForIssueMonth("2026-13")).toThrow();
  });

  it("uses the exact September half-open interval at KST boundaries", () => {
    const period = getGrowthReportAnalysisPeriod("2026-09");
    expect(period).toEqual({
      startDate: "2026-09-01",
      endDateExclusive: "2026-10-01",
      startAt: "2026-08-31T15:00:00.000Z",
      endAt: "2026-09-30T15:00:00.000Z",
    });
    const inside = (timestamp: string) => {
      const time = Date.parse(timestamp);
      return time >= Date.parse(period.startAt) && time < Date.parse(period.endAt);
    };
    expect(inside("2026-08-31T15:00:00.000Z")).toBe(true); // Sep 1 00:00 KST
    expect(inside("2026-09-30T14:59:59.999Z")).toBe(true); // Sep 30 23:59:59.999 KST
    expect(inside("2026-09-30T15:00:00.000Z")).toBe(false); // Oct 1 00:00 KST
  });

  it("contains the mandated September analysis sentence verbatim", () => {
    const issueMonth = "2026-10";
    const analysisMonth = getAnalysisMonthForIssueMonth(issueMonth);
    const period = getGrowthReportAnalysisPeriod(analysisMonth);
    const sentence =
      `2026년 ${Number(issueMonth.slice(5))}월 5일 발급되는 무료 AI 성장리포트는\n` +
      `2026년 ${Number(period.startDate.slice(5, 7))}월 1일 00:00 KST 이상,\n` +
      `2026년 ${Number(period.endDateExclusive.slice(5, 7))}월 1일 00:00 KST 미만의\n` +
      `${Number(analysisMonth.slice(5))}월 수업 데이터를 대상으로 한다.`;
    expect(sentence).toBe(
      "2026년 10월 5일 발급되는 무료 AI 성장리포트는\n" +
      "2026년 9월 1일 00:00 KST 이상,\n" +
      "2026년 10월 1일 00:00 KST 미만의\n" +
      "9월 수업 데이터를 대상으로 한다.",
    );
  });

  it.each([
    ["scheduled 4, absent 0, makeup 0", 4, true],
    ["scheduled 4, absent 1, makeup 0", 3, true],
    ["scheduled 4, absent 1, makeup 1", 4, true],
    ["scheduled 4, absent 2, makeup 0", 2, false],
    ["scheduled 8, absent 2, makeup 0", 6, true],
  ])("%s passes only at 3 recognized classes", (_label, attendanceCount, expected) => {
    const result = evaluateStudentGrowthReportEligibility({
      attendanceCount: Number(attendanceCount),
      sourceEventCount: 1,
      reregistered: true,
    });
    expect(result.eligible).toBe(expected);
    if (!expected) expect(result.exclusion_code).toBe("INSUFFICIENT_ATTENDANCE");
  });

  it("requires one valid student-specific diary and rejects zero", () => {
    expect(evaluateStudentGrowthReportEligibility({
      attendanceCount: 3,
      sourceEventCount: 0,
      reregistered: true,
    }).exclusion_code).toBe("NO_SOURCE_DATA");
    expect(evaluateStudentGrowthReportEligibility({
      attendanceCount: 3,
      sourceEventCount: 1,
      reregistered: true,
    }).eligible).toBe(true);
    expect(snapshotBuilder).toContain("cdn.student_id = ${studentId}");
    expect(snapshotBuilder).toContain("cdn.is_deleted = false");
    expect(snapshotBuilder).toContain("NULLIF(TRIM(cdn.note_content), '') IS NOT NULL");
    expect(snapshotBuilder).toContain("cdn.note_content ~ '[가-힣A-Za-z0-9]'");
  });

  it("requires month history overlap plus active, continued class history on the first", () => {
    expect(analysisWorker).toContain("s.status            = 'active'");
    expect(analysisWorker).toContain("s.deleted_at        IS NULL");
    expect(analysisWorker).toContain("sch.enrolled_at     <  ${cutoffDate}::date");
    expect(analysisWorker).toContain("sch.left_at >= ${periodFrom}::date");
    expect(analysisWorker).toContain("sch.enrolled_at     <= ${reportMonthStart}::date");
    expect(analysisWorker).toContain("sch.left_at >= ${reportMonthStart}::date");
  });

  it("bounds diaries, attendance snapshots, growth events, and completed makeup by KST month", () => {
    expect(snapshotBuilder).toContain("cd.lesson_date <  ${periodEndExclusive}");
    expect(snapshotBuilder).toContain("date::date       >= ${periodStart}::date");
    expect(snapshotBuilder).toContain("date::date       <  ${periodEndExclusive}::date");
    expect(snapshotBuilder).toContain("created_at       >= ${periodStartAt}::timestamptz");
    expect(snapshotBuilder).toContain("created_at       <  ${periodEndAt}::timestamptz");
    expect(snapshotBuilder).toMatch(
      /ms\.completed_at\s*>=\s*\(\s*\$\{periodFrom\}::date::timestamp AT TIME ZONE 'Asia\/Seoul'\s*\)/,
    );
    expect(snapshotBuilder).toMatch(
      /ms\.completed_at\s*<\s*\(\s*\$\{cutoffDate\}::date::timestamp AT TIME ZONE 'Asia\/Seoul'\s*\)/,
    );
    expect(snapshotBuilder).toMatch(/ms\.status\s*=\s*'completed'/);
    expect(snapshotBuilder).toMatch(/a2\.status\s*=\s*'absent'/);
    expect(snapshotBuilder).toContain("UNION");
    expect(snapshotBuilder).toContain("SELECT DISTINCT cg.id AS class_group_id, gs.d::date AS lesson_date");
    expect(snapshotBuilder).toMatch(
      /SELECT makeup_class\.id AS class_group_id,\s*\(ms\.completed_at AT TIME ZONE 'Asia\/Seoul'\)::date AS lesson_date/,
    );
    expect(snapshotBuilder).not.toContain("ms_linked.completed_attendance_id = a.id");
  });
});