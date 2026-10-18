import { describe, expect, it } from "vitest";
import {
  COURSE_ATTENDANCE_SQL,
  historicalContractAttendanceSql,
  POST_REFERENCE_ATTENDANCE_SQL,
} from "../office-finance-sql.js";

describe("OFFICE finance canonical attendance SQL contract", () => {
  const cases = [
    { name: "course usage", sql: COURSE_ATTENDANCE_SQL, comparison: "a.date<=$2::text", count: 2 },
    { name: "hold/cancel history", sql: historicalContractAttendanceSql(false), comparison: "a.date>=$3::text", count: 4 },
    { name: "shortened expiry history", sql: historicalContractAttendanceSql(true), comparison: "a.date>$3::text", count: 4 },
    { name: "post-reference import guard", sql: POST_REFERENCE_ATTENDANCE_SQL, comparison: "date>$2::text", count: 2 },
  ];

  it.each(cases)("$name uses bound text dates without casting legacy rows", ({ sql, comparison, count }) => {
    expect(sql).toContain(comparison);
    expect(sql).not.toMatch(/::date\b/i);
    expect(sql).not.toMatch(/(?:a\.)?date\s*::\s*(?:date|timestamp)\b/i);
    const parameters = [...new Set(sql.match(/\$\d+/g))].sort();
    expect(parameters).toEqual(Array.from({ length: count }, (_, index) => `$${index + 1}`));
    expect(sql).toMatch(/(?:a\.)?swimming_pool_id=\$1/);
  });

  it.each([false, true])("history guard retains member/contract/class and status scope: shortening=%s", shortening => {
    const sql = historicalContractAttendanceSql(shortening);
    expect(sql).toContain("a.student_id=$2");
    expect(sql).toContain("a.status IN ('present','late')");
    expect(sql).toContain("en.pool_id=$1");
    expect(sql).toContain("en.resource='enrollments'");
    expect(sql).toContain("en.data->>'contractId'=$4");
    expect(sql).toContain("en.data->>'classId'=a.class_group_id");
    expect(sql).toContain("LIMIT 1");
  });

  it("keeps makeup attribution and cancelled-makeup exclusion", () => {
    expect(COURSE_ATTENDANCE_SQL).toContain("ms.completed_attendance_id=a.id");
    expect(COURSE_ATTENDANCE_SQL).toContain("ms.swimming_pool_id=a.swimming_pool_id");
    expect(COURSE_ATTENDANCE_SQL).toContain("ms.cancelled_at IS NULL");
    expect(COURSE_ATTENDANCE_SQL).toContain("COALESCE(ms.original_class_group_id,a.class_group_id)");
    expect(COURSE_ATTENDANCE_SQL).toContain("COALESCE(ms.absence_date,a.date::text)");
  });

  it("keeps import protection strictly after, not on, the reference date", () => {
    expect(POST_REFERENCE_ATTENDANCE_SQL).toContain("SELECT DISTINCT student_id");
    expect(POST_REFERENCE_ATTENDANCE_SQL).toContain("date>$2::text");
    expect(POST_REFERENCE_ATTENDANCE_SQL).not.toContain(">=");
  });
});
