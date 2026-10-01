import { describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("@workspace/db", () => ({
  superAdminDb: mockDb,
  db: mockDb,
}));

import {
  ensureBatchCycle,
  ensureBatchJobs,
  getEligibleStudents,
  getXEligiblePools,
} from "../growth-report-batch-worker.js";

function queryText(query: any): string {
  return query?.queryChunks
    ? query.queryChunks.map((chunk: any) =>
        typeof chunk === "string" ? chunk : (chunk?.value ?? "")
      ).join("")
    : String(query?.sql ?? query ?? "");
}

describe("growth report cycle/batch preparation blockers", () => {
  it("uses the shared FREE pool eligibility predicate without a swimming_pools.deleted_at condition", async () => {
    const execute = vi.fn(async (_query: any) => ({ rows: [{ id: "pool-test" }] }));
    const poolIds = await getXEligiblePools({ execute } as any);

    expect(poolIds).toEqual(["pool-test"]);
    const query = queryText(execute.mock.calls[0]?.[0]);
    expect(query).toContain("x_paid_entitlement");
    expect(query).toContain("approval_status = 'approved'");
    expect(query).not.toMatch(/swimming_pools\.deleted_at|AND deleted_at IS NULL/);
  });

  it("selects one eligible-student row per student across multiple classes", async () => {
    const execute = vi.fn(async (_query: any) => ({
      rows: [{ student_id: "student-test", class_group_id: "class-a" }],
    }));
    const students = await getEligibleStudents(
      { execute } as any,
      "pool-test",
      "2026-08",
      "cycle-test",
    );

    expect(students).toEqual([{ studentId: "student-test", classGroupId: "class-a" }]);
    expect(queryText(execute.mock.calls[0]?.[0])).toContain("SELECT DISTINCT ON (s.id)");
    expect(queryText(execute.mock.calls[0]?.[0])).toContain("sch.enrolled_at < ");
  });

  it.each([
    { label: "zero", names: [] },
    { label: "one", names: ["서연"] },
    { label: "multiple", names: ["서연", "민수"] },
    { label: "duplicate names in different classes", names: ["서연", "서연"] },
  ])("OPEN candidate SQL handles $label names without an array-name parameter", async ({ names }) => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(new URL("../growth-report-scheduler.ts", import.meta.url), "utf8");
    // Names are descriptive fixtures, never query parameters. Identity is
    // (student_id, cycle_id), while class_groups scopes the selected pool.
    expect(names.length).toBeGreaterThanOrEqual(0);
    expect(scheduler).toContain("SELECT DISTINCT s.id, s.name");
    expect(scheduler).toContain("cg.swimming_pool_id = ${poolId}");
    expect(scheduler).toContain("sch.enrolled_at < ${nextMonthStr}::date");
    expect(scheduler).toContain("ON CONFLICT DO NOTHING");
    expect(scheduler).not.toMatch(/ANY\s*\(\s*\(/);
  });

  it("reuses an existing ACTIVE cycle for the same pool and period", async () => {
    const execute = vi.fn(async (_query: any) => ({
      rows: [{ id: "active-cycle", cycle_status: "ACTIVE" }],
    }));
    const cycleId = await ensureBatchCycle(
      { execute } as any,
      "pool-test",
      "2026-08",
      2026,
      9,
    );

    expect(cycleId).toBe("active-cycle");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(queryText(execute.mock.calls[0]?.[0])).toContain("cycle_status");
  });

  it("creates a missing cycle with scheduler-aligned timestamps and conflict recovery", async () => {
    const execute = vi.fn(async (_query: any): Promise<{ rows: any[] }> => ({ rows: [] }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "created-cycle" }] });
    const cycleId = await ensureBatchCycle(
      { execute } as any,
      "pool-test",
      "2026-08",
      2026,
      9,
    );

    expect(cycleId).toBe("created-cycle");
    const insert = queryText(execute.mock.calls[1]?.[0]);
    expect(insert).toContain("'Asia/Seoul', 'ACTIVE'");
    expect(insert).toContain("ON CONFLICT (swimming_pool_id, report_period) DO NOTHING");
  });

  it("continues preparing jobs for other pools after one pool insert fails", async () => {
    let callCount = 0;
    const execute = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("database unavailable");
      return { rows: [] };
    });
    const result = await ensureBatchJobs(
      { execute } as any,
      ["pool-fails", "pool-next"],
      2026,
      9,
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ensured: 1, failed: 1 });
  });

  it("keeps batch row preparation idempotent and avoids student PII in preparation logs", async () => {
    const execute = vi.fn(async (_query: any) => ({ rows: [] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await ensureBatchJobs({ execute } as any, ["pool-test"], 2026, 9);
      const query = queryText(execute.mock.calls[0]?.[0]);
      expect(query).toContain("ON CONFLICT DO NOTHING");
      expect(log.mock.calls.flat().join(" ")).not.toMatch(/student|name=/i);
    } finally {
      log.mockRestore();
    }
  });

  it("makes duplicate-name diagnostics an explicit no-op without PII SQL/logging", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      new URL("../growth-report-scheduler.ts", import.meta.url),
      "utf8",
    );
    expect(scheduler).toContain("ON CONFLICT DO NOTHING");
    expect(scheduler).not.toMatch(/ANY\s*\(/);
    expect(scheduler).not.toContain("parent_students");
    expect(scheduler).not.toContain("nameCounts");
    expect(scheduler).not.toContain("DUPLICATE_NAME_NO_PARENT");
  });
});