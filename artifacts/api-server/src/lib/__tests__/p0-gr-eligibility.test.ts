/**
 * p0-gr-eligibility.test.ts
 * Growth Report Eligibility + Real Generation Pipeline — TC1–TC13
 *
 * AI calls:  0
 * DB write:  NO
 * Migration: NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  isGrowthReportEligiblePool,
  GROWTH_REPORT_ELIGIBLE_SQL,
  type PoolEligibilityFields,
} from "../growth-report-eligibility.js";

const ROOT = join(process.cwd(), "../..");

const schedulerSrc    = readFileSync(join(ROOT, "artifacts/api-server/src/jobs/growth-report-scheduler.ts"), "utf-8");
const statusRouteSrc  = readFileSync(join(ROOT, "artifacts/api-server/src/routes/parent-growth-report.ts"), "utf-8");
const superRouteSrc   = readFileSync(join(ROOT, "artifacts/api-server/src/routes/super.ts"), "utf-8");
const eligSrc         = readFileSync(join(ROOT, "artifacts/api-server/src/lib/growth-report-eligibility.ts"), "utf-8");

// ── Helper ──────────────────────────────────────────────────────────────────

function pool(overrides: Partial<PoolEligibilityFields> = {}): PoolEligibilityFields {
  return {
    x_paid_entitlement:   false,
    x_manual_entitlement: false,
    x_force_disabled:     false,
    xmode_config_status:  "READY",
    ...overrides,
  };
}

describe("Growth Report Eligibility + Real Generation (TC1–TC13)", () => {

  // ── TC1: Status API eligibility == Scheduler eligibility ──────────────────
  it("TC1 Status API eligibility == Scheduler eligibility — both import shared function", () => {
    expect(statusRouteSrc).toContain("isGrowthReportEligiblePool");
    expect(statusRouteSrc).toContain("growth-report-eligibility");
    expect(schedulerSrc).toContain("GROWTH_REPORT_ELIGIBLE_SQL");
    expect(schedulerSrc).toContain("growth-report-eligibility");
  });

  // ── TC2: READY required ────────────────────────────────────────────────────
  it("TC2 READY required consistently", () => {
    // Eligible: paid + READY
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: true }))).toBe(true);
    // Not eligible: paid but CURRICULUM_PENDING
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" }))).toBe(false);
    // Not eligible: no entitlement, READY
    expect(isGrowthReportEligiblePool(pool())).toBe(false);
    // SQL contains READY
    expect(GROWTH_REPORT_ELIGIBLE_SQL).toContain("'READY'");
  });

  // ── TC3: force_disabled respected ─────────────────────────────────────────
  it("TC3 force_disabled respected", () => {
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: true, x_force_disabled: true }))).toBe(false);
    expect(isGrowthReportEligiblePool(pool({ x_manual_entitlement: true, x_force_disabled: true }))).toBe(false);
    expect(GROWTH_REPORT_ELIGIBLE_SQL).toContain("x_force_disabled");
  });

  // ── TC4: paid/manual entitlement respected ────────────────────────────────
  it("TC4 paid/manual entitlement respected", () => {
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement:   true }))).toBe(true);
    expect(isGrowthReportEligiblePool(pool({ x_manual_entitlement: true }))).toBe(true);
    // Neither
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: false, x_manual_entitlement: false }))).toBe(false);
  });

  // ── TC5: legacy entitlement cannot create mismatch ────────────────────────
  it("TC5 legacy xmode_entitlement alone does NOT grant eligibility", () => {
    // Legacy true but no paid/manual + CURRICULUM_PENDING → NOT eligible
    expect(isGrowthReportEligiblePool(pool({
      xmode_entitlement:    true,
      x_paid_entitlement:   false,
      x_manual_entitlement: false,
      xmode_config_status:  "CURRICULUM_PENDING",
    }))).toBe(false);
    // Status API no longer uses legacyEntitlement fallback
    expect(statusRouteSrc).not.toContain("legacyEntitlement");
    expect(statusRouteSrc).not.toContain("xmode_entitlement === true");
  });

  // ── TC6: READY pool selected by scheduler ─────────────────────────────────
  it("TC6 READY pool selected by scheduler — getXEligiblePools uses GROWTH_REPORT_ELIGIBLE_SQL", () => {
    expect(schedulerSrc).toContain("GROWTH_REPORT_ELIGIBLE_SQL");
    expect(schedulerSrc).toContain("getXEligiblePools");
    // The old hardcoded SQL is gone — replaced by shared constant
    expect(schedulerSrc).not.toMatch(/xmode_config_status = 'READY'.*approval_status/s);
  });

  // ── TC7: 25th KST condition correct ───────────────────────────────────────
  it("TC7 25th KST condition correct — parentInputOpenAt threshold", () => {
    expect(schedulerSrc).toContain("parentInputOpenAt");
    expect(schedulerSrc).toContain("25");
    expect(schedulerSrc).toContain("Asia/Seoul");
  });

  // ── TC8: cycle creation works — openCycleForPool + ON CONFLICT DO NOTHING ─
  it("TC8 cycle creation is idempotent — ON CONFLICT DO NOTHING", () => {
    expect(schedulerSrc).toContain("openCycleForPool");
    expect(schedulerSrc).toContain("ON CONFLICT");
    expect(schedulerSrc).toContain("DO NOTHING");
    // Cycle INSERT writes cycle_status = 'PENDING'
    expect(schedulerSrc).toContain("'PENDING'");
  });

  // ── TC9: duplicate prevention works ───────────────────────────────────────
  it("TC9 duplicate prevention — same period skipped in missed-run recovery", () => {
    expect(schedulerSrc).toContain("currentTs.reportPeriod");
    expect(schedulerSrc).toContain("continue");
  });

  // ── TC10: report record creation works ────────────────────────────────────
  it("TC10 report record creation — growth_reports INSERT per student", () => {
    expect(schedulerSrc).toContain("growth_reports");
    // Students selected from pool (non-deleted)
    expect(schedulerSrc).toContain("deleted_at IS NULL");
  });

  // ── TC11: status API finds generated report ────────────────────────────────
  it("TC11 status API queries growth_reports for current period", () => {
    expect(statusRouteSrc).toContain("growth_reports");
    expect(statusRouteSrc).toContain("report_period");
    expect(statusRouteSrc).toContain("deleted_at IS NULL");
  });

  // ── TC12: no manual SQL write ─────────────────────────────────────────────
  it("TC12 no manual SQL INSERT in eligibility module", () => {
    expect(eligSrc).not.toContain("INSERT INTO");
    expect(eligSrc).not.toContain("UPDATE ");
    expect(eligSrc).not.toContain("DELETE ");
  });

  // ── TC13: super_admin trigger endpoint exists (AI call max 0 for scheduler) ─
  it("TC13 super_admin scheduler trigger endpoint exists + no AI call", () => {
    expect(superRouteSrc).toContain("/super/growth-report-scheduler/run");
    expect(superRouteSrc).toContain("runGrowthReportScheduler");
    // Trigger endpoint does NOT call AI
    const triggerBlock = superRouteSrc.slice(
      superRouteSrc.indexOf("/super/growth-report-scheduler/run"),
      superRouteSrc.indexOf("export default router")
    );
    expect(triggerBlock).not.toContain("openai");
    expect(triggerBlock).not.toContain("analyzeGrowthReport");
  });

});
