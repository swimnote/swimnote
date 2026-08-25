/**
 * p0-gr-eligibility.test.ts
 * Growth Report Eligibility Architecture — TC1–TC13
 *
 * Tests the 3-way eligibility split:
 *   A. isXModeConfigReady (신규 X 가맹점 READY)
 *   B. isFreeGrowthReportEligiblePool (FREE report — TOYKIDS 등 legacy 포함)
 *   C. isPaidGrowthReportEligiblePool (future stub)
 *
 * AI calls:  0
 * DB write:  NO
 * Migration: NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  isFreeGrowthReportEligiblePool,
  isXModeConfigReady,
  FREE_GROWTH_REPORT_ELIGIBLE_SQL,
  isPaidGrowthReportEligiblePool,
  isFreeMonthlyReportEligible,
  isGrowthReportEligiblePool,        // backward-compat alias
  GROWTH_REPORT_ELIGIBLE_SQL,        // backward-compat alias
  type PoolEligibilityFields,
} from "../growth-report-eligibility.js";

const ROOT = join(process.cwd(), "../..");

const schedulerSrc   = readFileSync(join(ROOT, "artifacts/api-server/src/jobs/growth-report-scheduler.ts"),   "utf-8");
const statusRouteSrc = readFileSync(join(ROOT, "artifacts/api-server/src/routes/parent-growth-report.ts"),    "utf-8");
const superRouteSrc  = readFileSync(join(ROOT, "artifacts/api-server/src/routes/super.ts"),                   "utf-8");
const eligSrc        = readFileSync(join(ROOT, "artifacts/api-server/src/lib/growth-report-eligibility.ts"),  "utf-8");
const readinessSrc   = readFileSync(join(ROOT, "artifacts/api-server/src/lib/xmode-readiness.ts"),            "utf-8");

// ── Helper ───────────────────────────────────────────────────────────────────

function pool(overrides: Partial<PoolEligibilityFields> = {}): PoolEligibilityFields {
  return {
    x_paid_entitlement:   false,
    x_manual_entitlement: false,
    x_force_disabled:     false,
    xmode_config_status:  "READY",
    approval_status:      "approved",
    ...overrides,
  };
}

describe("Growth Report Eligibility Architecture (TC1–TC13)", () => {

  // ── TC1: FREE eligibility does NOT require xmode_config_status='READY' ─────
  it("TC1 FREE eligibility — paid X pool with CURRICULUM_PENDING is eligible", () => {
    // TOYKIDS case: x_paid=true, xmode_config_status=CURRICULUM_PENDING
    expect(isFreeGrowthReportEligiblePool(pool({
      x_paid_entitlement:  true,
      xmode_config_status: "CURRICULUM_PENDING",
    }))).toBe(true);

    // Manual pool with NOT_CONFIGURED
    expect(isFreeGrowthReportEligiblePool(pool({
      x_manual_entitlement: true,
      xmode_config_status:  "NOT_CONFIGURED",
    }))).toBe(true);
  });

  // ── TC2: isXModeConfigReady STILL requires READY ──────────────────────────
  it("TC2 isXModeConfigReady strictly requires READY", () => {
    expect(isXModeConfigReady(pool({ x_paid_entitlement: true }))).toBe(true);
    expect(isXModeConfigReady(pool({ x_paid_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" }))).toBe(false);
    expect(isXModeConfigReady(pool({ x_paid_entitlement: true, xmode_config_status: "NOT_CONFIGURED" }))).toBe(false);
    // No entitlement, READY → false
    expect(isXModeConfigReady(pool())).toBe(false);
  });

  // ── TC3: force_disabled respected by FREE gate ────────────────────────────
  it("TC3 force_disabled blocks FREE eligibility regardless of entitlement", () => {
    expect(isFreeGrowthReportEligiblePool(pool({ x_paid_entitlement:   true, x_force_disabled: true }))).toBe(false);
    expect(isFreeGrowthReportEligiblePool(pool({ x_manual_entitlement: true, x_force_disabled: true }))).toBe(false);
    expect(FREE_GROWTH_REPORT_ELIGIBLE_SQL).toContain("x_force_disabled");
  });

  // ── TC4: entitlement required ────────────────────────────────────────────
  it("TC4 no entitlement blocks FREE eligibility", () => {
    expect(isFreeGrowthReportEligiblePool(pool())).toBe(false);
    expect(isFreeGrowthReportEligiblePool(pool({ x_paid_entitlement: false, x_manual_entitlement: false }))).toBe(false);
    // Either paid OR manual is sufficient
    expect(isFreeGrowthReportEligiblePool(pool({ x_paid_entitlement:   true }))).toBe(true);
    expect(isFreeGrowthReportEligiblePool(pool({ x_manual_entitlement: true }))).toBe(true);
  });

  // ── TC5: legacy xmode_entitlement alone does NOT grant eligibility ─────────
  it("TC5 legacy xmode_entitlement alone does NOT grant FREE eligibility", () => {
    // Legacy true but no paid/manual → NOT eligible
    expect(isFreeGrowthReportEligiblePool(pool({
      xmode_entitlement:    true,
      x_paid_entitlement:   false,
      x_manual_entitlement: false,
    }))).toBe(false);
    // Status API no longer uses legacyEntitlement fallback
    expect(statusRouteSrc).not.toContain("legacyEntitlement");
    expect(statusRouteSrc).not.toContain("xmode_entitlement === true");
  });

  // ── TC6: Scheduler uses FREE_GROWTH_REPORT_ELIGIBLE_SQL (not READY) ────────
  it("TC6 Scheduler getXEligiblePools uses FREE_GROWTH_REPORT_ELIGIBLE_SQL — no READY hardcoded", () => {
    expect(schedulerSrc).toContain("FREE_GROWTH_REPORT_ELIGIBLE_SQL");
    expect(schedulerSrc).toContain("getXEligiblePools");
    // getXEligiblePools body uses the shared constant
    const fnStart = schedulerSrc.indexOf("export async function getXEligiblePools");
    const fnEnd   = schedulerSrc.indexOf("\n}", fnStart) + 2;
    const fnBody  = schedulerSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain("FREE_GROWTH_REPORT_ELIGIBLE_SQL");
    expect(fnBody).not.toMatch(/xmode_config_status\s*=\s*'READY'/);
  });

  // ── TC7: Status API uses FREE gate (not READY gate) ──────────────────────
  it("TC7 Status API uses isFreeGrowthReportEligiblePool — not READY gate", () => {
    expect(statusRouteSrc).toContain("isFreeGrowthReportEligiblePool");
    expect(statusRouteSrc).toContain("growth-report-eligibility");
    // Status API comment reflects new contract (READY 불필요)
    expect(statusRouteSrc).toContain("READY");
    expect(statusRouteSrc).toContain("불필요");
    // Should NOT use old isGrowthReportEligiblePool directly (now alias only)
    // The actual call is isFreeGrowthReportEligiblePool
    expect(statusRouteSrc).toContain("isFreeGrowthReportEligiblePool(pr)");
  });

  // ── TC8: validateXModeReadiness stays strict (READY onboarding guard) ──────
  it("TC8 validateXModeReadiness still requires setup submission + curriculum", () => {
    expect(readinessSrc).toContain("x_setup_submissions");
    expect(readinessSrc).toContain("x_setup_files");
    expect(readinessSrc).toContain("NO_SETUP_SUBMISSION");
    expect(readinessSrc).toContain("NO_CURRICULUM_FILE");
  });

  // ── TC9: READY onboarding guard not weakened by FREE change ──────────────
  it("TC9 super.ts READY guard uses validateXModeReadiness — not weakened", () => {
    expect(superRouteSrc).toContain("validateXModeReadiness");
    expect(superRouteSrc).toContain("READY_PREREQUISITES_NOT_MET");
  });

  // ── TC10: FREE SQL has no READY condition ────────────────────────────────
  it("TC10 FREE_GROWTH_REPORT_ELIGIBLE_SQL contains no xmode_config_status check", () => {
    expect(FREE_GROWTH_REPORT_ELIGIBLE_SQL).not.toContain("xmode_config_status");
    expect(FREE_GROWTH_REPORT_ELIGIBLE_SQL).not.toContain("'READY'");
    // But approval still enforced at SQL level
    expect(FREE_GROWTH_REPORT_ELIGIBLE_SQL).toContain("approval_status");
  });

  // ── TC11: Paid extension is NOT_IMPLEMENTED / extension point ────────────
  it("TC11 isPaidGrowthReportEligiblePool throws — extension point documented", () => {
    expect(() => isPaidGrowthReportEligiblePool(pool({ x_paid_entitlement: true }))).toThrow("NOT IMPLEMENTED");
    expect(eligSrc).toContain("Extend this file");
    expect(eligSrc).toContain("isPaidGrowthReportEligiblePool");
  });

  // ── TC12: aliases are correct ────────────────────────────────────────────
  it("TC12 aliases resolve to correct implementations", () => {
    expect(isFreeMonthlyReportEligible).toBe(isFreeGrowthReportEligiblePool);
    expect(isGrowthReportEligiblePool).toBe(isFreeGrowthReportEligiblePool);
    expect(GROWTH_REPORT_ELIGIBLE_SQL).toBe(FREE_GROWTH_REPORT_ELIGIBLE_SQL);
  });

  // ── TC13: super_admin scheduler trigger + no AI ───────────────────────────
  it("TC13 super_admin scheduler trigger endpoint exists + no AI call in trigger", () => {
    expect(superRouteSrc).toContain("/super/growth-report-scheduler/run");
    expect(superRouteSrc).toContain("runGrowthReportScheduler");
    const triggerIdx = superRouteSrc.indexOf("/super/growth-report-scheduler/run");
    const afterTrigger = superRouteSrc.slice(triggerIdx, triggerIdx + 2000);
    expect(afterTrigger).not.toContain("openai");
    expect(afterTrigger).not.toContain("analyzeGrowthReport");
  });

});
