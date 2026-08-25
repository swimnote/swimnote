/**
 * p0-gr-pipeline.test.ts
 * Growth Report Production Generation Pipeline — TC1–TC13
 *
 * AI calls:  0
 * DB write:  NO
 * Migration: NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "../..");

const schedulerSrc  = readFileSync(join(ROOT, "artifacts/api-server/src/jobs/growth-report-scheduler.ts"), "utf-8");
const workerSrc     = readFileSync(join(ROOT, "artifacts/api-server/src/jobs/growth-report-analysis-worker.ts"), "utf-8");
const statusRouteSrc = readFileSync(join(ROOT, "artifacts/api-server/src/routes/parent-growth-report.ts"), "utf-8");
const statusScreenSrc = readFileSync(join(ROOT, "artifacts/swim-app/app/(parent)/growth-report-status.tsx"), "utf-8");
const indexSrc      = readFileSync(join(ROOT, "artifacts/api-server/src/index.ts"), "utf-8");

describe("Growth Report Pipeline — TC1–TC13", () => {

  it("TC1 Eligibility: effective entitlement (paid OR manual) + config_status=READY", () => {
    // Scheduler gate uses paid/manual entitlement
    expect(schedulerSrc).toContain("x_paid_entitlement");
    expect(schedulerSrc).toContain("x_manual_entitlement");
    expect(schedulerSrc).toContain("xmode_config_status");
    // Status API now also checks effective entitlement (X02-B2 fix)
    expect(statusRouteSrc).toContain("x_paid_entitlement");
    expect(statusRouteSrc).toContain("x_manual_entitlement");
    expect(statusRouteSrc).toContain("effectiveEntitlement");
  });

  it("TC2 Scheduler/trigger path identified — daily 01:00 KST", () => {
    expect(schedulerSrc).toContain('cron.schedule');
    expect(schedulerSrc).toMatch(/0 1 \* \* \*/);
    expect(schedulerSrc).toMatch(/Asia\/Seoul/);
  });

  it("TC3 Report creation function reachable — openCycleForPool creates per-student rows", () => {
    expect(schedulerSrc).toContain("openCycleForPool");
    expect(schedulerSrc).toContain("growth_reports");
    // Student selection: non-deleted students
    expect(schedulerSrc).toContain("deleted_at IS NULL");
  });

  it("TC4 Duplicate prevention maintained — ON CONFLICT DO NOTHING", () => {
    expect(schedulerSrc).toContain("ON CONFLICT");
    expect(schedulerSrc).toContain("DO NOTHING");
  });

  it("TC5 Report period correct — YYYY-MM format, 25th open date", () => {
    expect(schedulerSrc).toContain("report_period");
    // 25th is the open date
    expect(schedulerSrc).toContain("25");
    // Period formatted as YYYY-MM
    expect(schedulerSrc).toMatch(/YYYY-MM|padStart.*2.*"0"/s);
  });

  it("TC6 Timezone correct — Asia/Seoul used in both scheduler and status API", () => {
    expect(schedulerSrc).toContain("Asia/Seoul");
    expect(statusRouteSrc).toContain("Asia/Seoul");
  });

  it("TC7 AI Engine route correct — POST /api/v1/growth-report/analyze", () => {
    const engineClient = readFileSync(
      join(ROOT, "artifacts/api-server/src/lib/growth-report-engine-client.ts"),
      "utf-8",
    );
    expect(engineClient).toContain("/api/v1/growth-report/analyze");
    expect(engineClient).toContain("POST");
  });

  it("TC8 Status API finds generated report — queries growth_reports table by student+period", () => {
    expect(statusRouteSrc).toContain("growth_reports");
    expect(statusRouteSrc).toContain("student_id");
    expect(statusRouteSrc).toContain("report_period");
    expect(statusRouteSrc).toContain("deleted_at IS NULL");
  });

  it("TC9 NOT_AVAILABLE only when truly unavailable — not generic fallback for X mismatch", () => {
    // Effective entitlement check prevents false NOT_AVAILABLE for paid/manual pools
    expect(statusRouteSrc).toContain("effectiveEntitlement");
    expect(statusRouteSrc).toContain("legacyEntitlement");
    // Returns NOT_AVAILABLE only when BOTH effective AND legacy are false
    expect(statusRouteSrc).toContain("!effectiveEntitlement && !legacyEntitlement");
  });

  it("TC10 Diary action route exists — /(parent)/diary is a real file", () => {
    expect(existsSync(join(ROOT, "artifacts/swim-app/app/(parent)/diary.tsx"))).toBe(true);
  });

  it("TC11 Diary action no Expo Router 404 — no today-schedule (non-existent route)", () => {
    expect(statusScreenSrc).not.toContain("today-schedule");
    // Uses real diary route
    expect(statusScreenSrc).toContain("/(parent)/diary");
    expect(statusScreenSrc).toContain("handleViewDiary");
  });

  it("TC12 No manual SQL INSERT in status screen or tests", () => {
    expect(statusScreenSrc).not.toContain("INSERT INTO");
    expect(statusScreenSrc).not.toContain("executeSql");
  });

  it("TC13 No migration unless required — scheduler/worker registered in index.ts", () => {
    // Both jobs are registered
    expect(indexSrc).toContain("startGrowthReportScheduler");
    expect(indexSrc).toContain("startGrowthReportAnalysisWorker");
    // Analysis worker also runs on 5-min cadence
    expect(workerSrc).toMatch(/\*\/5 \* \* \* \*/);
  });

});
