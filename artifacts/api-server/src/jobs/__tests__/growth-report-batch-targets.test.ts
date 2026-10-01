import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { mockDb } = vi.hoisted(() => ({
  mockDb: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("@workspace/db", () => ({
  superAdminDb: mockDb,
  db: mockDb,
}));

import { getEligibleStudents } from "../growth-report-batch-worker.js";

function queryText(query: any): string {
  return query?.queryChunks
    ? query.queryChunks.map((chunk: any) =>
        typeof chunk === "string" ? chunk : (chunk?.value ?? "")
      ).join("")
    : String(query?.sql ?? query ?? "");
}

describe("monthly batch uses the sealed target roster", () => {
  it("reads only identities in the sealed cycle manifest", async () => {
    const calls: string[] = [];
    const db: any = {
      execute: vi.fn(async (query: any) => {
        const text = queryText(query);
        calls.push(text);
        if (text.includes("FROM growth_report_cycles")) {
          return { rows: [{ id: "cycle-a" }] };
        }
        if (text.includes("FROM growth_report_eligible_targets")) {
          return { rows: [{ student_id: "sealed-student" }] };
        }
        return { rows: [] };
      }),
    };

    await expect(getEligibleStudents(db, "pool-a", "2026-08", "cycle-a"))
      .resolves.toEqual([{ studentId: "sealed-student", classGroupId: null }]);
    expect(calls[0]).toContain("eligibility_sealed_at IS NOT NULL");
    expect(calls[1]).toContain("growth_report_eligible_targets");
    expect(calls.join("\n")).not.toContain("FROM students");
  });

  it("fences job progress, heartbeat, completion, and report writes by worker_id", () => {
    const source = readFileSync(
      new URL("../growth-report-batch-worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("SET locked_at = NOW(), updated_at = NOW()");
    expect(source).toContain("AND worker_id = ${workerId}");
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain("BATCH_WORKER_FENCE_LOST");
    expect(source).toContain("sealMonthlyTargets");
    expect(source).toContain("next_attempt_at = CASE");
    expect(source).toContain("job.attempts <= 1");
    expect(source).toContain("target_count = ${students.length}");
    expect(source).toContain("target.eligibility_version");
    expect(source).toContain("target.eligibility_evidence->>'attendance_count'");
    expect(source).toContain("target.eligibility_evidence->>'source_event_count'");
    expect(source).toContain("registerMonthlyAutomationRun");
    expect(source).toContain("recordMonthlyPoolPreparation");
    expect(source).toContain("recordMonthlyFirstPassOutcome");
  });
});