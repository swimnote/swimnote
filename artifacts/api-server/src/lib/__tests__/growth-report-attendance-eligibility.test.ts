import { describe, expect, it, vi } from "vitest";
import { queryAttendanceForEligibility } from "../growth-report-snapshot-builder.js";

function sqlText(query: any): string {
  const pieces: string[] = [];
  const visit = (chunk: any): void => {
    if (typeof chunk === "string") pieces.push(chunk);
    else if (Array.isArray(chunk?.queryChunks)) chunk.queryChunks.forEach(visit);
    else if (Array.isArray(chunk?.value)) chunk.value.forEach(visit);
    else if (typeof chunk?.value === "string") pieces.push(chunk.value);
  };
  query?.queryChunks?.forEach(visit);
  return pieces.join("");
}

describe("recognized attendance SQL (no DB)", () => {
  it("unions regular and completed makeup events by class/date and excludes holidays or invalid classes", async () => {
    const db = {
      execute: vi.fn(async (_query: any) => ({ rows: [{ cnt: 4 }] })),
    };

    const count = await queryAttendanceForEligibility(
      db,
      "student-1",
      "pool-1",
      "2026-08-01",
      "2026-09-01",
    );

    expect(count).toBe(4);
    const query = sqlText(db.execute.mock.calls[0][0]);
    expect(query).toContain("UNION");
    expect(query).toContain("assigned_class_group_id");
    expect(query).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(query).toContain("makeup_holiday.holiday_date::date");
    expect(query).toContain("makeup_class.is_deleted = false");
    expect(query).toContain("makeup_class.is_one_time IS NULL OR makeup_class.is_one_time = false");
    expect(query).toContain("ph.holiday_date::date = gs.d::date");
    expect(query).toContain("a2.status = 'absent'");
    expect(query).toContain("COUNT(*)::int");
  });
});