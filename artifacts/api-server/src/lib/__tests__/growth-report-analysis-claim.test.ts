import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  claimGrowthReportAnalysis,
  renewGrowthReportAnalysisClaim,
} from "../growth-report-analysis-claim.js";
import {
  persistAnalysisResponse,
  recordAnalysisUncertain,
} from "../growth-report-result-handler.js";

function sqlText(query: any): string {
  return (query?.queryChunks ?? []).map((chunk: any) =>
    typeof chunk === "string" ? chunk : (chunk?.value ?? ""),
  ).join("");
}

describe("growth report atomic analysis claim", () => {
  it("keeps restart candidates on the sealed target queue and commits cached replies without ENGINE", () => {
    const source = readFileSync(
      new URL("../../jobs/growth-report-analysis-worker.ts", import.meta.url),
      "utf8",
    );
    const pendingSelector = source.match(
      /async function fetchPendingReports[\s\S]*?const rows = await db\.execute\(sql`([\s\S]*?)`\);/,
    )?.[1];
    expect(pendingSelector).toContain("analysis_uncertain_at IS NULL");
    expect(pendingSelector).toContain("analysis_next_attempt_at <= now()");
    expect(pendingSelector).toContain("growth_report_eligible_targets");
    expect(pendingSelector).toContain("eligibility_sealed_at IS NOT NULL");
    expect(pendingSelector).toContain(
      "sealed_cycle.swimming_pool_id = gr.swimming_pool_id",
    );
    expect(pendingSelector).toContain(
      "sealed_cycle.report_period = gr.report_period",
    );

    const cachedBranch = source.slice(
      source.indexOf("if (hasCachedResponse)"),
      source.indexOf("const callStarted = await markAnalysisCallStarted"),
    );
    expect(cachedBranch).toContain("replaying saved ENGINE response");
    expect(cachedBranch).not.toContain("analyzeGrowthReport(request)");
    expect(source).toContain("isGrowthReportRequestIdentityForStage");
  });

  it("allows only one concurrent owner to claim a persistent report", async () => {
    const state: { token: string | null } = { token: null };
    const db: any = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        expect(text).toContain("analysis_claim_token =");
        expect(text).toContain("analysis_lease_until <= now()");
        expect(text).toContain("analysis_uncertain_at IS NULL");
        if (state.token) return { rows: [] };
        state.token = "owner-token";
        return { rows: [{ analysis_claim_token: state.token }] };
      }),
    };

    const [first, second] = await Promise.all([
      claimGrowthReportAnalysis(db, {
        reportId: "report-1",
        expectedStatus: "OPEN",
        leaseMs: 60_000,
        requireSealedMonthlyTarget: true,
      }),
      claimGrowthReportAnalysis(db, {
        reportId: "report-1",
        expectedStatus: "OPEN",
        leaseMs: 60_000,
        requireSealedMonthlyTarget: true,
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(sqlText(db.execute.mock.calls[0][0])).toContain("growth_report_eligible_targets");
    expect(sqlText(db.execute.mock.calls[0][0])).toContain("eligibility_sealed_at IS NOT NULL");
    expect(sqlText(db.execute.mock.calls[0][0])).toContain("policy_excluded_at IS NULL");
    expect(sqlText(db.execute.mock.calls[0][0])).toContain(
      "sealed_cycle.swimming_pool_id = gr.swimming_pool_id",
    );
    expect(sqlText(db.execute.mock.calls[0][0])).toContain(
      "sealed_cycle.report_period = gr.report_period",
    );
  });

  it("renews only a live lease owned by the same token", async () => {
    const db: any = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        expect(text).toContain("analysis_claim_token =");
        expect(text).toContain("analysis_lease_until > now()");
        return { rows: [{ id: "report-1" }] };
      }),
    };
    await expect(renewGrowthReportAnalysisClaim(db, {
      reportId: "report-1",
      claimToken: "owner-token",
      leaseMs: 60_000,
    })).resolves.toBe(true);
  });

  it("rejects a cached response write by an old claim token", async () => {
    const db: any = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        if (text.includes("analysis_response_payload =")) {
          expect(text).toContain("analysis_request_id =");
          expect(text).toContain("analysis_claim_token =");
          expect(text).toContain("analysis_lease_until > now()");
          return { rows: [] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (operation: (tx: any) => Promise<unknown>) => operation(db)),
    };

    await expect(persistAnalysisResponse({
      db,
      reportId: "report-1",
      requestId: "persisted-request",
      response: {} as any,
      stage: "PREANALYSIS",
      claimToken: "stale-owner",
    })).resolves.toBe(false);
  });

  it("records UNKNOWN without scheduling automatic retry and fences the owner", async () => {
    const db: any = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        expect(text).toContain("analysis_uncertain_at = COALESCE");
        expect(text).toContain("analysis_next_attempt_at = NULL");
        expect(text).toContain("analysis_claim_token = NULL");
        expect(text).toContain("analysis_request_id =");
        expect(text).toContain("analysis_claim_token =");
        expect(text).toContain("product_status =");
        return { rows: [{ id: "report-1" }] };
      }),
    };
    await expect(recordAnalysisUncertain({
      db,
      reportId: "report-1",
      requestId: "stable-request",
      stage: "PREANALYSIS",
      claimToken: "current-owner",
    })).resolves.toBe(true);
  });
});
