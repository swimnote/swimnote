import { describe, expect, it } from "vitest";
import { withdrawStudent } from "../withdraw-student-service.js";
import { publishGrowthReport } from "../growth-report-service.js";

function sqlText(query: any): string {
  const chunks: unknown[] = query?.queryChunks ?? [];
  return chunks
    .filter((chunk): chunk is { value: string[] } =>
      chunk != null && typeof chunk === "object" && Array.isArray((chunk as any).value))
    .flatMap((chunk) => chunk.value)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("withdrawStudent growth report preservation", () => {
  it("rejects parent publication of a policy-excluded report before any write", async () => {
    let reads = 0;
    await expect(publishGrowthReport({
      db:{execute:async () => { reads++; return {rows:[{id:"policy",product_status:"EXCLUDED"}]};}},
      reportId:"policy",actorId:"admin",actorType:"admin",
    } as any)).rejects.toThrow();
    expect(reads).toBe(1);
  });
  it("preserves published and sealed monthly identities while retaining ordinary withdrawal deletions", async () => {
    const executed: string[] = [];
    let initialStudentLookup = true;
    let reportDelete: string | undefined;

    const execute = async (query: any) => {
      const text = sqlText(query);
      executed.push(text);

      if (text.includes("delete from growth_reports")) reportDelete = text;
      if (text.includes("select id, name, status, swimming_pool_id")) {
        if (!initialStudentLookup) return { rows: [] };
        initialStudentLookup = false;
        return {
          rows: [{
            id: "student-1",
            name: "Test student",
            status: "active",
            swimming_pool_id: "pool-1",
            class_group_id: null,
          }],
        };
      }
      if (text.includes("select id from students")) return { rows: [{ id: "student-1" }] };
      if (text.includes("from students s")) {
        return { rows: [{ name: "Test student", birth_year: null, parent_phone: null, withdrawn_at: null, class_name: null }] };
      }
      if (text.includes("select distinct class_group_id")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    };

    const db = {
      execute,
      transaction: async (callback: (tx: any) => Promise<void>) => callback({ execute }),
    };

    await withdrawStudent(db, "student-1", "pool-1", { userId: "admin-1", role: "pool_admin" });

    expect(reportDelete).toBeDefined();
    expect(reportDelete).toContain("delete from growth_reports gr where gr.student_id =");
    expect(reportDelete).toMatch(
      /and not \( gr.report_type = 'monthly' and gr.product_status = 'published' \)/,
    );
    expect(reportDelete).toContain("from growth_report_eligible_targets target");
    expect(reportDelete).toContain("target.cycle_id = gr.cycle_id");
    expect(reportDelete).toContain("target.student_id = gr.student_id");
    expect(reportDelete).toContain("cycle.swimming_pool_id = gr.swimming_pool_id");
    expect(reportDelete).toContain("cycle.report_period = gr.report_period");
    expect(reportDelete).toContain("cycle.eligibility_sealed_at is not null");
    expect(executed.some(query => query.includes("delete from growth_report_eligible_targets"))).toBe(false);
    expect(executed.some((query) => query.includes("delete from growth_events where student_id ="))).toBe(true);
    expect(executed.some((query) => query.includes("delete from parent_students where student_id ="))).toBe(true);
  });
});