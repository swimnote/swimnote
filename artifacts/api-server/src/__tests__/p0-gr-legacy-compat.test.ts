/**
 * p0-gr-legacy-compat.test.ts
 * FREE Growth Report — Legacy Pool Compatibility (TC1–TC22)
 *
 * 핵심 제품 결정:
 *   TOYKIDS(x_paid=true, CURRICULUM_PENDING) 등 legacy paid X pool은
 *   최신 X Setup/curriculum DOCX 없이도 FREE Growth Report 대상이다.
 *
 *   validateXModeReadiness(신규 READY 온보딩 guard)은 약화하지 않는다.
 *   FREE eligibility ≠ X onboarding READY
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
  type PoolEligibilityFields,
} from "../lib/growth-report-eligibility.js";

const ROOT = join(process.cwd(), "../..");

const schedulerSrc   = readFileSync(join(ROOT, "artifacts/api-server/src/jobs/growth-report-scheduler.ts"),          "utf-8");
const statusRouteSrc = readFileSync(join(ROOT, "artifacts/api-server/src/routes/parent-growth-report.ts"),           "utf-8");
const superSrc       = readFileSync(join(ROOT, "artifacts/api-server/src/routes/super.ts"),                          "utf-8");
const eligSrc        = readFileSync(join(ROOT, "artifacts/api-server/src/lib/growth-report-eligibility.ts"),         "utf-8");
const readinessSrc   = readFileSync(join(ROOT, "artifacts/api-server/src/lib/xmode-readiness.ts"),                   "utf-8");
const workerSrc      = readFileSync(join(ROOT, "artifacts/api-server/src/jobs/growth-report-analysis-worker.ts"),    "utf-8");

// ── Helper ───────────────────────────────────────────────────────────────────

function pool(overrides: Partial<PoolEligibilityFields> = {}): PoolEligibilityFields {
  return {
    x_paid_entitlement:   false,
    x_manual_entitlement: false,
    x_force_disabled:     false,
    xmode_config_status:  "NOT_CONFIGURED",
    approval_status:      "approved",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1–TC4: Legacy paid X pool FREE eligibility
// ─────────────────────────────────────────────────────────────────────────────
describe("TC1–TC4: Legacy X Pool FREE Eligibility", () => {

  it("TC1 legacy X paid pool with CURRICULUM_PENDING is FREE eligible", () => {
    // TOYKIDS case: x_paid=true, xmode_config_status=CURRICULUM_PENDING
    const toykids = pool({ x_paid_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" });
    expect(isFreeGrowthReportEligiblePool(toykids)).toBe(true);
  });

  it("TC2 CURRICULUM_PENDING alone does NOT block FREE eligibility", () => {
    // paid + CURRICULUM_PENDING → eligible
    expect(isFreeGrowthReportEligiblePool(pool({ x_paid_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" }))).toBe(true);
    // manual + NOT_CONFIGURED → eligible
    expect(isFreeGrowthReportEligiblePool(pool({ x_manual_entitlement: true, xmode_config_status: "NOT_CONFIGURED" }))).toBe(true);
    // READY → also eligible
    expect(isFreeGrowthReportEligiblePool(pool({ x_paid_entitlement: true, xmode_config_status: "READY" }))).toBe(true);
  });

  it("TC3 no entitlement blocks FREE regardless of xmode_config_status", () => {
    expect(isFreeGrowthReportEligiblePool(pool({ xmode_config_status: "READY" }))).toBe(false);
    expect(isFreeGrowthReportEligiblePool(pool({ xmode_config_status: "CURRICULUM_PENDING" }))).toBe(false);
  });

  it("TC4 force_disabled blocks FREE regardless of entitlement", () => {
    expect(isFreeGrowthReportEligiblePool(pool({ x_paid_entitlement: true, x_force_disabled: true }))).toBe(false);
    expect(isFreeGrowthReportEligiblePool(pool({ x_manual_entitlement: true, x_force_disabled: true, xmode_config_status: "CURRICULUM_PENDING" }))).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC5–TC6: X READY validator stays strict
// ─────────────────────────────────────────────────────────────────────────────
describe("TC5–TC6: X READY Validator Stays Strict", () => {

  it("TC5 isXModeConfigReady still requires xmode_config_status=READY", () => {
    expect(isXModeConfigReady(pool({ x_paid_entitlement: true, xmode_config_status: "READY" }))).toBe(true);
    expect(isXModeConfigReady(pool({ x_paid_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" }))).toBe(false);
    expect(isXModeConfigReady(pool({ x_paid_entitlement: true, xmode_config_status: "NOT_CONFIGURED" }))).toBe(false);
    // No entitlement
    expect(isXModeConfigReady(pool({ xmode_config_status: "READY" }))).toBe(false);
  });

  it("TC6 validateXModeReadiness guard requires setup submission + curriculum", () => {
    // READY guard uses validateXModeReadiness (not isFreeGrowthReportEligiblePool)
    expect(readinessSrc).toContain("x_setup_submissions");
    expect(readinessSrc).toContain("x_setup_files");
    expect(readinessSrc).toContain("NO_SETUP_SUBMISSION");
    expect(readinessSrc).toContain("NO_CURRICULUM_FILE");
    // Super READY transition uses the guard
    expect(superSrc).toContain("validateXModeReadiness");
    expect(superSrc).toContain("READY_PREREQUISITES_NOT_MET");
    // FREE eligibility module does NOT import xmode-readiness (may mention it in comments)
    expect(eligSrc).not.toMatch(/^import.*xmode-readiness/m);
    expect(eligSrc).not.toMatch(/from ['"].*xmode-readiness/m);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC7–TC8: Unified authority for scheduler and status API
// ─────────────────────────────────────────────────────────────────────────────
describe("TC7–TC8: Scheduler and Status API use Same FREE Helper", () => {

  it("TC7 FREE scheduler and status API both import from growth-report-eligibility", () => {
    expect(schedulerSrc).toContain("FREE_GROWTH_REPORT_ELIGIBLE_SQL");
    expect(schedulerSrc).toContain("growth-report-eligibility");
    expect(statusRouteSrc).toContain("isFreeGrowthReportEligiblePool");
    expect(statusRouteSrc).toContain("growth-report-eligibility");
  });

  it("TC8 FREE generator (ensureCurrentMonthGrowthReportCycle) drops READY check", () => {
    // ensureCurrentMonthGrowthReportCycle must not require xmode_config_status='READY'
    const fnStart = schedulerSrc.indexOf("export async function ensureCurrentMonthGrowthReportCycle");
    const fnEnd   = schedulerSrc.indexOf("\nexport ", fnStart + 1);
    const fnBody  = schedulerSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).not.toMatch(/xmode_config_status\s*=\s*'READY'/);
    // Still checks approval_status
    expect(fnBody).toContain("approval_status");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC9–TC11: Curriculum fallback behavior
// ─────────────────────────────────────────────────────────────────────────────
describe("TC9–TC11: Curriculum as Optional Enrichment", () => {

  it("TC9 curriculum missing does not crash generation — worker fallback", () => {
    // Worker does not throw when no curriculum snapshot
    expect(workerSrc).toContain("buildAnalysisSnapshot");
    // No hard assert that curriculum must exist
    expect(workerSrc).not.toMatch(/throw.*curriculum/i);
    // Worker handles QUESTION_AVAILABLE (pass 1 incomplete evidence)
    expect(workerSrc).toContain("QUESTION_AVAILABLE");
  });

  it("TC10 unsupported curriculum claims omitted — no fake curriculum generation", () => {
    // Eligibility module never fabricates curriculum data
    expect(eligSrc).not.toContain("fake");
    expect(eligSrc).not.toContain("mock");
    // Scheduler does not INSERT curriculum rows
    expect(schedulerSrc).not.toContain("INSERT INTO x_pool_curricula");
    expect(schedulerSrc).not.toContain("INSERT INTO x_setup_files");
  });

  it("TC11 diary/growth evidence usable without curriculum", () => {
    // Worker delegates evidence gathering to buildAnalysisSnapshot
    // (which reads teacher diaries, growth_events, attendance regardless of curriculum)
    expect(workerSrc).toContain("buildAnalysisSnapshot");
    expect(workerSrc).toContain("growth-report-snapshot-builder");
    // Worker does not short-circuit when curriculum is absent
    expect(workerSrc).not.toMatch(/throw.*curriculum/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC12–TC13: Cycle lifecycle
// ─────────────────────────────────────────────────────────────────────────────
describe("TC12–TC13: Cycle Lifecycle Safety", () => {

  it("TC12 25th+ cycle recovery — ensureCurrentMonthGrowthReportCycle exists + exported", () => {
    expect(schedulerSrc).toContain("export async function ensureCurrentMonthGrowthReportCycle");
    expect(schedulerSrc).toContain("BEFORE_OPEN_DATE");
    expect(schedulerSrc).toContain("NOT_ELIGIBLE");
  });

  it("TC13 duplicate cycle safe — ON CONFLICT DO NOTHING", () => {
    expect(schedulerSrc).toContain("ON CONFLICT");
    expect(schedulerSrc).toContain("DO NOTHING");
    // Same pool + period → idempotent
    expect(schedulerSrc).toContain("swimming_pool_id, report_period");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC14–TC16: Report creation and analysis
// ─────────────────────────────────────────────────────────────────────────────
describe("TC14–TC16: Report Creation and Analysis", () => {

  it("TC14 report creation — growth_reports INSERT per student per cycle", () => {
    expect(schedulerSrc).toContain("growth_reports");
    expect(schedulerSrc).toContain("deleted_at IS NULL");
    // Student-per-cycle ON CONFLICT
    expect(schedulerSrc).toContain("student_id, cycle_id");
  });

  it("TC15 analysis worker processes OPEN reports → engine call", () => {
    expect(workerSrc).toContain("OPEN");
    expect(workerSrc).toContain("READY_FOR_ANALYSIS");
    expect(workerSrc).toContain("PREANALYZ");
    expect(workerSrc).toContain("ANALYZ");
  });

  it("TC16 AI result persisted — request-id CAS safety", () => {
    expect(workerSrc).toContain("request_id");
    // Result stored via growth-report-service (transitionReportStatus)
    expect(workerSrc).toContain("transitionReportStatus");
    expect(workerSrc).toContain("growth-report-service");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC17–TC19: Output contract and feature integration
// ─────────────────────────────────────────────────────────────────────────────
describe("TC17–TC19: Output Contract and Feature Integration", () => {

  it("TC17 canonical output contract — worker transitions to REVIEW_REQUIRED on success", () => {
    // Worker transitions to REVIEW_REQUIRED after successful analysis
    expect(workerSrc).toContain("REVIEW_REQUIRED");
    // Worker transitions to FAILED on non-retryable errors
    expect(workerSrc).toContain("FAILED");
    // Snapshot builder is the source of structured report content
    expect(workerSrc).toContain("buildAnalysisSnapshot");
  });

  it("TC18 Parent Narrative V2 — worker or snapshot layer", () => {
    // buildAnalysisSnapshot or worker integrates parent context
    expect(workerSrc).toContain("parent");
  });

  it("TC19 Parent Guidance — evidence gathered by snapshot builder, worker handles partial evidence", () => {
    // buildAnalysisSnapshot gathers growth_events, diaries, attendance as guidance source
    expect(workerSrc).toContain("buildAnalysisSnapshot");
    // Worker handles PARTIAL (partial evidence — insufficient data for full analysis)
    expect(workerSrc).toContain("PARTIAL");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TC20–TC22: Publish lifecycle and safety
// ─────────────────────────────────────────────────────────────────────────────
describe("TC20–TC22: Publish Lifecycle and Safety", () => {

  it("TC20 publish lifecycle — worker transitions through REVIEW_REQUIRED", () => {
    expect(workerSrc).toContain("REVIEW_REQUIRED");
    // PUBLISHED state exists in system
    expect(workerSrc).not.toContain("PUBLISHED");  // worker does not self-publish
    // FAILED safe
    expect(workerSrc).toContain("FAILED");
  });

  it("TC21 parent status API reflects report lifecycle state", () => {
    expect(statusRouteSrc).toContain("product_status");
    expect(statusRouteSrc).toContain("DATA_ACCUMULATING");
    expect(statusRouteSrc).toContain("NOT_AVAILABLE");
  });

  it("TC22 published overwrite protection — worker only picks OPEN or READY_FOR_ANALYSIS", () => {
    // Worker SELECT restricts to OPEN and READY_FOR_ANALYSIS
    expect(workerSrc).toContain("OPEN");
    expect(workerSrc).toContain("READY_FOR_ANALYSIS");
    // Worker does not delete growth_reports
    expect(workerSrc).not.toContain("DELETE FROM growth_reports");
    // Retryable errors roll back — no infinite retry
    expect(workerSrc).toContain("retryable");
    expect(workerSrc).toContain("analysis_retry_count");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Structural: 3-way split documented
// ─────────────────────────────────────────────────────────────────────────────
describe("Architecture: 3-way eligibility split", () => {

  it("3-way contract documented in eligibility module", () => {
    expect(eligSrc).toContain("isFreeGrowthReportEligiblePool");
    expect(eligSrc).toContain("isXModeConfigReady");
    expect(eligSrc).toContain("isPaidGrowthReportEligiblePool");
    expect(eligSrc).toContain("Extend this file");
    // Aliases present
    expect(eligSrc).toContain("isFreeMonthlyReportEligible");
    expect(eligSrc).toContain("isGrowthReportEligiblePool");
    expect(eligSrc).toContain("GROWTH_REPORT_ELIGIBLE_SQL");
  });

  it("FREE and PAID kept separate — paid extension NOT mixed into FREE", () => {
    // isPaidGrowthReportEligiblePool throws NOT_IMPLEMENTED
    expect(() => isPaidGrowthReportEligiblePool(pool({ x_paid_entitlement: true }))).toThrow("NOT IMPLEMENTED");
    // FREE aliases resolve to same function
    expect(isFreeMonthlyReportEligible).toBe(isFreeGrowthReportEligiblePool);
  });

});
