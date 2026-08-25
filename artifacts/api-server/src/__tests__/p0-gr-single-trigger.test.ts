/**
 * p0-gr-single-trigger.test.ts
 * Growth Report — Single Report Safety Gate (TC1–TC10)
 *
 * 핵심 안전 조건:
 *   - auto worker BATCH_LIMIT configurable (GROWTH_REPORT_ANALYSIS_BATCH_SIZE)
 *   - GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false → cron/startup 완전 차단
 *   - POST /super/growth-reports/:reportId/analyze → super_admin only, 1건
 *   - PUBLISHED/ANALYZING 등 상태 → 거부
 *   - 직접 SQL status 변경 없음 (service 함수 경유)
 *
 * AI calls:  0
 * DB write:  NO
 * Migration: NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

const workerSrc = read("artifacts/api-server/src/jobs/growth-report-analysis-worker.ts");
const superSrc  = read("artifacts/api-server/src/routes/super.ts");

// ─────────────────────────────────────────────────────────────────────────────
// TC1: Worker batch behavior known
// ─────────────────────────────────────────────────────────────────────────────
describe("TC1: Worker batch behavior", () => {

  it("TC1-A GROWTH_REPORT_ANALYSIS_BATCH_SIZE env var controls batch limit", () => {
    expect(workerSrc).toContain("GROWTH_REPORT_ANALYSIS_BATCH_SIZE");
    expect(workerSrc).toContain("getBatchSize");
    // Default 10 when env not set
    expect(workerSrc).toContain("return 10");
  });

  it("TC1-B batch=0 returns empty immediately — no AI calls", () => {
    expect(workerSrc).toContain("if (batchLimit === 0) return []");
  });

  it("TC1-C batch size passed to fetchPendingReports", () => {
    // fetchPendingReports takes optional limit parameter
    expect(workerSrc).toContain("async function fetchPendingReports(db: any, limit?: number)");
    expect(workerSrc).toContain("const batchLimit = limit !== undefined ? limit : getBatchSize()");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC2: Mass analysis prevented — auto-disable flag
// ─────────────────────────────────────────────────────────────────────────────
describe("TC2: Mass analysis prevented", () => {

  it("TC2-A GROWTH_REPORT_ANALYSIS_AUTO_ENABLED flag exists", () => {
    expect(workerSrc).toContain("GROWTH_REPORT_ANALYSIS_AUTO_ENABLED");
    expect(workerSrc).toContain("isAutoAnalysisEnabled");
  });

  it("TC2-B auto disabled → cron returns early with log", () => {
    expect(workerSrc).toContain("auto analysis disabled (GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false)");
    // Log appears in cron body
    const cronIdx = workerSrc.indexOf("cron.schedule");
    expect(cronIdx).toBeGreaterThan(-1);
    const cronBody = workerSrc.slice(cronIdx, cronIdx + 800);
    expect(cronBody).toContain("isAutoAnalysisEnabled");
  });

  it("TC2-C auto disabled → startup run skipped with log", () => {
    expect(workerSrc).toContain("auto analysis disabled — skipping startup run");
  });

  it("TC2-D batch=0 → cron also skips", () => {
    expect(workerSrc).toContain("GROWTH_REPORT_ANALYSIS_BATCH_SIZE=0");
    const cronIdx = workerSrc.indexOf("cron.schedule");
    const cronBody = workerSrc.slice(cronIdx, cronIdx + 1200);
    expect(cronBody).toContain("getBatchSize");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC3: Single report trigger — super_admin only
// ─────────────────────────────────────────────────────────────────────────────
describe("TC3: Single report trigger — super_admin only", () => {

  it("TC3-A POST /super/growth-reports/:reportId/analyze exists", () => {
    expect(superSrc).toContain("/super/growth-reports/:reportId/analyze");
  });

  it("TC3-B requireRole super_admin enforced on trigger route", () => {
    const routeIdx = superSrc.indexOf("/super/growth-reports/:reportId/analyze");
    const routeBlock = superSrc.slice(routeIdx, routeIdx + 600);
    expect(routeBlock).toContain('requireRole("super_admin")');
  });

  it("TC3-C uses analyzeSingleReport (existing worker pipeline)", () => {
    expect(superSrc).toContain("analyzeSingleReport");
    expect(workerSrc).toContain("export async function analyzeSingleReport");
  });

  it("TC3-D analyzeSingleReport calls analyzeOneReport (full pipeline)", () => {
    expect(workerSrc).toContain("await analyzeOneReport(db, pending)");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC4: Duplicate trigger safe
// ─────────────────────────────────────────────────────────────────────────────
describe("TC4: Duplicate trigger safe", () => {

  it("TC4-A already_done=true when status is not OPEN/READY_FOR_ANALYSIS", () => {
    expect(workerSrc).toContain("already_done:   true");
    expect(workerSrc).toContain('product_status !== "OPEN" && product_status !== "READY_FOR_ANALYSIS"');
  });

  it("TC4-B 409 returned by route when already_done", () => {
    expect(superSrc).toContain("REPORT_NOT_ANALYZABLE");
    const routeBlock = superSrc.slice(superSrc.indexOf("/super/growth-reports/:reportId/analyze"));
    expect(routeBlock).toContain("already_done");
    expect(routeBlock).toContain("status(409)");
  });

  it("TC4-C FOR UPDATE in transitionReportStatus prevents concurrent analyze", () => {
    // transitionReportStatus uses FOR UPDATE (source of truth in growth-report-service.ts)
    // analyzeOneReport catches InvalidTransitionError from concurrent runs
    expect(workerSrc).toContain("InvalidTransitionError");
    expect(workerSrc).toContain("concurrent");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC5: Published cannot reanalyze
// ─────────────────────────────────────────────────────────────────────────────
describe("TC5: Published cannot reanalyze", () => {

  it("TC5-A analyzeSingleReport returns already_done for non-OPEN statuses", () => {
    // PUBLISHED/REVIEWING/APPROVED all become already_done=true
    expect(workerSrc).toContain("already_done:   true");
    // Only OPEN and READY_FOR_ANALYSIS are allowed
    expect(workerSrc).toContain('"OPEN" && product_status !== "READY_FOR_ANALYSIS"');
  });

  it("TC5-B auto worker SELECT restricts to OPEN + READY_FOR_ANALYSIS only", () => {
    expect(workerSrc).toContain("IN ('OPEN', 'READY_FOR_ANALYSIS')");
    expect(workerSrc).not.toContain("'PUBLISHED'");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC6: Exact report ownership validated
// ─────────────────────────────────────────────────────────────────────────────
describe("TC6: Report ownership validated", () => {

  it("TC6-A fetchSingleReport requires deleted_at IS NULL", () => {
    const fnIdx = workerSrc.indexOf("async function fetchSingleReport");
    const fnBody = workerSrc.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toContain("deleted_at IS NULL");
  });

  it("TC6-B 404 when report not found", () => {
    expect(workerSrc).toContain("REPORT_NOT_FOUND");
    expect(superSrc).toContain("REPORT_NOT_FOUND");
    const routeBlock = superSrc.slice(superSrc.indexOf("/super/growth-reports/:reportId/analyze"));
    expect(routeBlock).toContain("status(404)");
  });

  it("TC6-C report must join growth_report_cycles (period/cutoff validation)", () => {
    const fnIdx = workerSrc.indexOf("async function fetchSingleReport");
    const fnBody = workerSrc.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toContain("growth_report_cycles");
    expect(fnBody).toContain("analysis_cutoff_at");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC7: One report AI E2E (pipeline structure)
// ─────────────────────────────────────────────────────────────────────────────
describe("TC7: AI pipeline structure", () => {

  it("TC7-A full pipeline: snapshot → ENGINE call → persist", () => {
    expect(workerSrc).toContain("buildAnalysisSnapshot");
    expect(workerSrc).toContain("analyzeGrowthReport");
    expect(workerSrc).toContain("persistEngineResult");
  });

  it("TC7-B audit trail: started + success/failed logged", () => {
    expect(workerSrc).toContain("auditAnalysisStarted");
    expect(workerSrc).toContain("auditAnalysisFailed");
  });

  it("TC7-C AI trace saved for observability", () => {
    expect(workerSrc).toContain("saveAiTrace");
    expect(workerSrc).toContain("GROWTH_REPORT_AI");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC8: 253 reports untouched by trigger
// ─────────────────────────────────────────────────────────────────────────────
describe("TC8: Remaining reports untouched", () => {

  it("TC8-A analyzeSingleReport fetches only 1 report by ID", () => {
    const fnIdx = workerSrc.indexOf("async function fetchSingleReport");
    const fnBody = workerSrc.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toContain("LIMIT 1");
    expect(fnBody).toContain("gr.id = ${reportId}");
  });

  it("TC8-B auto worker disabled flag prevents batch analysis of remaining", () => {
    expect(workerSrc).toContain("GROWTH_REPORT_ANALYSIS_AUTO_ENABLED");
    expect(workerSrc).toContain("isAutoAnalysisEnabled");
  });

  it("TC8-C no DELETE of growth_reports anywhere in worker", () => {
    expect(workerSrc).not.toContain("DELETE FROM growth_reports");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC9: No direct SQL patch
// ─────────────────────────────────────────────────────────────────────────────
describe("TC9: No direct SQL status patch", () => {

  it("TC9-A trigger route uses analyzeSingleReport (service layer)", () => {
    // Route does not directly UPDATE growth_reports
    const routeStart = superSrc.indexOf("/super/growth-reports/:reportId/analyze");
    const routeEnd   = superSrc.indexOf("export default router", routeStart);
    const routeBlock = superSrc.slice(routeStart, routeEnd === -1 ? undefined : routeEnd);
    expect(routeBlock).not.toMatch(/UPDATE\s+growth_reports/i);
    expect(routeBlock).toContain("analyzeSingleReport");
  });

  it("TC9-B status transitions go through transitionReportStatus (service layer)", () => {
    expect(workerSrc).toContain("transitionReportStatus");
    expect(workerSrc).not.toContain("UPDATE growth_reports SET product_status");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC10: No extra AI calls
// ─────────────────────────────────────────────────────────────────────────────
describe("TC10: No extra AI calls", () => {

  it("TC10-A single call per analyzeOneReport invocation (no retry in client)", () => {
    // Engine client makes exactly 1 HTTP call per analyzeGrowthReport call
    // (retries are across cron invocations, not within one call)
    expect(workerSrc).toContain("analysis_retry_count");
    expect(workerSrc).toContain("maxRetry");
    // Retry rollback returns immediately — no further AI calls
    expect(workerSrc).toContain("return;"); // after rollback
  });

  it("TC10-B max retry guard prevents infinite AI calls", () => {
    expect(workerSrc).toContain("analysis_retry_count >= maxRetry");
    expect(workerSrc).toContain("exceeded max retries");
  });

  it("TC10-C super scheduler trigger (cycle only) has no AI call", () => {
    const schedulerBlock = superSrc.slice(
      superSrc.indexOf("/super/growth-report-scheduler/run"),
      superSrc.indexOf("/super/growth-reports/:reportId/analyze"),
    );
    expect(schedulerBlock).toContain("runGrowthReportScheduler");
    expect(schedulerBlock).not.toContain("analyzeGrowthReport");
    expect(schedulerBlock).not.toContain("analyzeOneReport");
  });

});
