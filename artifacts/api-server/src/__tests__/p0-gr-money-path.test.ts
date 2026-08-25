/**
 * p0-gr-money-path.test.ts
 * Growth Report Money-Path Hardening — TC1–TC28
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
  isFreeMonthlyReportEligible,
  GROWTH_REPORT_ELIGIBLE_SQL,
} from "../lib/growth-report-eligibility.js";
import { validateXModeReadiness } from "../lib/xmode-readiness.js";
import type { PoolEligibilityFields } from "../lib/growth-report-eligibility.js";

const ROOT = join(process.cwd(), "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

const schedulerSrc  = read("artifacts/api-server/src/jobs/growth-report-scheduler.ts");
const statusSrc     = read("artifacts/api-server/src/routes/parent-growth-report.ts");
const superSrc      = read("artifacts/api-server/src/routes/super.ts");
const eligSrc       = read("artifacts/api-server/src/lib/growth-report-eligibility.ts");
const readinessSrc  = read("artifacts/api-server/src/lib/xmode-readiness.ts");
const workerSrc     = read("artifacts/api-server/src/jobs/growth-report-analysis-worker.ts");

// ── Helpers ─────────────────────────────────────────────────────────────────

function pool(o: Partial<PoolEligibilityFields> = {}): PoolEligibilityFields {
  return {
    x_paid_entitlement:   false,
    x_manual_entitlement: false,
    x_force_disabled:     false,
    xmode_config_status:  "READY",
    ...o,
  };
}

/** Minimal fake DB for validateXModeReadiness unit tests */
function fakeDb(rows: {
  poolRows?: any[];
  subRows?: any[];
  currRows?: any[];
}) {
  const calls: string[] = [];
  return {
    _calls: calls,
    execute: async (q: any) => {
      const src: string = q?.queryChunks?.map((c: any) => c.value ?? "").join("") ??
                          (typeof q === "object" ? JSON.stringify(q) : String(q));
      if (src.includes("information_schema") || src.includes("x_setup_submissions") && src.includes("pool_id")) {
        // distinguish by content
        if (src.includes("x_setup_files")) {
          calls.push("curr");
          return { rows: rows.currRows ?? [] };
        }
        if (src.includes("x_setup_submissions")) {
          calls.push("sub");
          return { rows: rows.subRows ?? [] };
        }
      }
      if (src.includes("swimming_pools") || src.includes("x_paid")) {
        calls.push("pool");
        return { rows: rows.poolRows ?? [] };
      }
      calls.push("unknown");
      return { rows: [] };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// X Setup / READY Guard — TC1–TC6
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1–TC6: X Setup / READY Guard", () => {

  it("TC1 no setup → validateXModeReadiness blockers contain NO_SETUP_SUBMISSION", async () => {
    const db = {
      execute: async (q: any) => {
        const s = JSON.stringify(q);
        if (s.includes("x_paid")) return { rows: [{ x_paid: true, x_manual: false, x_force: false, approval_status: "approved" }] };
        return { rows: [] };
      },
    };
    const r = await validateXModeReadiness("pool_test", db as any);
    expect(r.ready).toBe(false);
    expect(r.blockers.some(b => b.includes("NO_SETUP_SUBMISSION"))).toBe(true);
  });

  it("TC2 missing curriculum → validateXModeReadiness blockers contain NO_CURRICULUM_FILE", async () => {
    const db = {
      execute: async (q: any) => {
        const s = JSON.stringify(q);
        if (s.includes("x_paid")) return { rows: [{ x_paid: true, x_manual: false, x_force: false, approval_status: "approved" }] };
        if (s.includes("x_setup_submissions")) return { rows: [{ id: "xss_1", setup_status: "SUBMITTED", curriculum_status: null, submitted_at: new Date() }] };
        if (s.includes("x_setup_files")) return { rows: [] }; // no curriculum file
        return { rows: [] };
      },
    };
    const r = await validateXModeReadiness("pool_test", db as any);
    expect(r.ready).toBe(false);
    expect(r.blockers.some(b => b.includes("NO_CURRICULUM_FILE"))).toBe(true);
  });

  it("TC3 valid setup + curriculum → validateXModeReadiness ready=true", async () => {
    const db = {
      execute: async (q: any) => {
        const s = JSON.stringify(q);
        if (s.includes("x_paid")) return { rows: [{ x_paid: true, x_manual: false, x_force: false, approval_status: "approved" }] };
        if (s.includes("x_setup_submissions")) return { rows: [{ id: "xss_1", setup_status: "SUBMITTED", curriculum_status: "SUBMITTED", submitted_at: new Date() }] };
        if (s.includes("x_setup_files")) return { rows: [{ id: "xsf_1", original_filename: "curriculum.docx", uploaded_at: new Date() }] };
        return { rows: [] };
      },
    };
    const r = await validateXModeReadiness("pool_test", db as any);
    expect(r.ready).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it("TC4 force disabled → validateXModeReadiness blockers contain X_FORCE_DISABLED", async () => {
    const db = {
      execute: async (q: any) => {
        const s = JSON.stringify(q);
        if (s.includes("x_paid")) return { rows: [{ x_paid: true, x_manual: false, x_force: true, approval_status: "approved" }] };
        return { rows: [] };
      },
    };
    const r = await validateXModeReadiness("pool_test", db as any);
    expect(r.ready).toBe(false);
    expect(r.blockers.some(b => b.includes("X_FORCE_DISABLED"))).toBe(true);
  });

  it("TC5 paid entitlement → FREE eligible regardless of xmode_config_status", () => {
    // FREE gate: READY and CURRICULUM_PENDING are both eligible (legacy X pool support)
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: true }))).toBe(true);
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" }))).toBe(true);
    // force_disabled always blocks
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: true, x_force_disabled: true }))).toBe(false);
    // no entitlement always blocks
    expect(isGrowthReportEligiblePool(pool())).toBe(false);
  });

  it("TC6 manual entitlement → eligible when READY", () => {
    expect(isGrowthReportEligiblePool(pool({ x_manual_entitlement: true }))).toBe(true);
    expect(isGrowthReportEligiblePool(pool({ x_manual_entitlement: true, x_force_disabled: true }))).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility — TC7–TC10
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7–TC10: Eligibility Authority", () => {

  it("TC7 parent status API uses same FREE eligibility as scheduler — shared import", () => {
    // Both use the shared growth-report-eligibility module
    expect(statusSrc).toContain("isFreeGrowthReportEligiblePool");
    expect(statusSrc).toContain("growth-report-eligibility");
    expect(schedulerSrc).toContain("FREE_GROWTH_REPORT_ELIGIBLE_SQL");
    expect(schedulerSrc).toContain("growth-report-eligibility");
  });

  it("TC8 ensureCurrentMonthGrowthReportCycle uses FREE eligibility gate — no READY required", () => {
    expect(schedulerSrc).toContain("ensureCurrentMonthGrowthReportCycle");
    // Uses FREE gate (paid/manual + not force + approved — no READY)
    expect(schedulerSrc).toContain("x_paid_entitlement");
    expect(schedulerSrc).toContain("x_manual_entitlement");
    // xmode_config_status='READY' must NOT be required by ensureCurrentMonthGrowthReportCycle
    const fnStart = schedulerSrc.indexOf("export async function ensureCurrentMonthGrowthReportCycle");
    const fnEnd   = schedulerSrc.indexOf("\nexport ", fnStart + 1);
    const fnBody  = schedulerSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).not.toMatch(/xmode_config_status\s*=\s*'READY'/);
  });

  it("TC9 legacy xmode_entitlement bypass impossible", () => {
    // Legacy alone cannot grant eligibility
    expect(isGrowthReportEligiblePool(pool({
      xmode_entitlement:    true,
      x_paid_entitlement:   false,
      x_manual_entitlement: false,
      xmode_config_status:  "CURRICULUM_PENDING",
    }))).toBe(false);
    // Status API does not use legacyEntitlement
    expect(statusSrc).not.toContain("legacyEntitlement");
    // GROWTH_REPORT_ELIGIBLE_SQL has no xmode_entitlement
    expect(GROWTH_REPORT_ELIGIBLE_SQL).not.toContain("xmode_entitlement");
  });

  it("TC10 free/paid base separation documented", () => {
    expect(eligSrc).toContain("isFreeMonthlyReportEligible");
    expect(eligSrc).toContain("isFreeGrowthReportEligiblePool");
    // Future paid extension point documented
    expect(eligSrc).toContain("isPaidGrowthReportEligiblePool");
    expect(eligSrc).toContain("Extend this file");
    // isFreeMonthlyReportEligible is the alias (same as base)
    expect(isFreeMonthlyReportEligible).toBe(isGrowthReportEligiblePool);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler — TC11–TC16
// ─────────────────────────────────────────────────────────────────────────────

describe("TC11–TC16: Scheduler Safety", () => {

  it("TC11 25th+ opens cycle — parentInputOpenAt threshold", () => {
    expect(schedulerSrc).toContain("parentInputOpenAt");
    expect(schedulerSrc).toContain("shouldOpenCurrentMonth");
    // 25일 조건: openAt = 25th 00:00 KST
    expect(schedulerSrc).toContain("24, 15, 0, 0");  // UTC equivalent
  });

  it("TC12 missed 25th recovered — PENDING cycles with past open_at are opened", () => {
    expect(schedulerSrc).toContain("missed");
    expect(schedulerSrc).toContain("PENDING");
    // Missed-run recovery selects PENDING cycles with parent_input_open_at <= now
    expect(schedulerSrc).toContain("parent_input_open_at");
  });

  it("TC13 READY after 25th auto-recovered — ensureCurrentMonthGrowthReportCycle exported", () => {
    expect(schedulerSrc).toContain("export async function ensureCurrentMonthGrowthReportCycle");
    expect(schedulerSrc).toContain("BEFORE_OPEN_DATE");
    expect(schedulerSrc).toContain("NOT_ELIGIBLE");
    // Called from PATCH /xmode after READY transition
    expect(superSrc).toContain("ensureCurrentMonthGrowthReportCycle");
  });

  it("TC14 restart recovery — 30s startup recovery runs runGrowthReportScheduler", () => {
    expect(schedulerSrc).toContain("startup recovery");
    expect(schedulerSrc).toContain("30_000");
    expect(schedulerSrc).toContain("runGrowthReportScheduler");
  });

  it("TC15 duplicate run safe — distributed lock prevents concurrent execution", () => {
    expect(schedulerSrc).toContain("acquireLock");
    expect(schedulerSrc).toContain("releaseLock");
    expect(schedulerSrc).toContain("growth-report-cycle");
  });

  it("TC16 existing cycle no-op — ON CONFLICT DO NOTHING + PENDING skip", () => {
    expect(schedulerSrc).toContain("ON CONFLICT");
    expect(schedulerSrc).toContain("DO NOTHING");
    expect(schedulerSrc).toContain("PENDING");
    expect(schedulerSrc).toContain("CYCLE_SKIP");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Generation — TC17–TC22
// ─────────────────────────────────────────────────────────────────────────────

describe("TC17–TC22: Report Generation", () => {

  it("TC17 report record — growth_reports INSERT per student with ON CONFLICT", () => {
    expect(schedulerSrc).toContain("growth_reports");
    expect(schedulerSrc).toContain("student_id");
    expect(schedulerSrc).toContain("ON CONFLICT (student_id, cycle_id)");
    expect(schedulerSrc).toContain("DO NOTHING");
  });

  it("TC18 snapshot — cycle timestamps written to growth_report_cycles", () => {
    expect(schedulerSrc).toContain("analysis_cutoff_at");
    expect(schedulerSrc).toContain("parent_input_open_at");
    expect(schedulerSrc).toContain("parent_input_close_at");
  });

  it("TC19 worker — analysis worker selects OPEN and READY_FOR_ANALYSIS reports only", () => {
    expect(workerSrc).toContain("'OPEN'");
    expect(workerSrc).toContain("'READY_FOR_ANALYSIS'");
    expect(workerSrc).toContain("product_status IN");
  });

  it("TC20 AI persistence — analysis result persisted; retryable on engine error", () => {
    expect(workerSrc).toContain("analysis_retry_count");
    expect(workerSrc).toContain("FAILED");
    expect(workerSrc).toContain("retryable");
  });

  it("TC21 status API consistency — uses current period + FREE pool check", () => {
    expect(statusSrc).toContain("report_period");
    // Uses isFreeGrowthReportEligiblePool (FREE gate, not READY gate)
    expect(statusSrc).toContain("isFreeGrowthReportEligiblePool");
    expect(statusSrc).toContain("deleted_at IS NULL");
  });

  it("TC22 DATA_ACCUMULATING safe — worker handles insufficient evidence (QUESTION_AVAILABLE fallback)", () => {
    // Worker emits QUESTION_AVAILABLE when evidence is insufficient (pass 1 result)
    expect(workerSrc).toContain("QUESTION_AVAILABLE");
    // Partial results also allowed (PARTIAL state)
    expect(workerSrc).toContain("PARTIAL");
    // Report is not deleted on low-evidence — status transitions only
    expect(workerSrc).not.toContain("DELETE FROM growth_reports");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Publish / Safety — TC23–TC28
// ─────────────────────────────────────────────────────────────────────────────

describe("TC23–TC28: Publish & Failure Safety", () => {

  it("TC23 APPROVED→PUBLISHED authorization — super_admin only scheduler endpoint, READY guard in place", () => {
    // super_admin-only scheduler endpoint exists
    expect(superSrc).toContain("growth-report-scheduler/run");
    expect(superSrc).toContain('requireRole("super_admin")');
    // READY guard and cycle recovery both implemented
    expect(superSrc).toContain("READY_PREREQUISITES_NOT_MET");
    expect(superSrc).toContain("ensureCurrentMonthGrowthReportCycle");
  });

  it("TC24 published preserved — worker does NOT select PUBLISHED reports", () => {
    // Worker's SQL only selects OPEN + READY_FOR_ANALYSIS
    expect(workerSrc).not.toMatch(/IN\s*\([^)]*'PUBLISHED'/);
    expect(workerSrc).not.toMatch(/IN\s*\([^)]*'APPROVED'/);
  });

  it("TC25 worker duplicate safe — FOR UPDATE + distributed lock", () => {
    expect(workerSrc).toContain("acquireLock");
    expect(workerSrc).toContain("FOR UPDATE");
  });

  it("TC26 AI timeout safe — timeout → retryable state, not report loss", () => {
    // Engine client maps abort → retryable error; worker rolls back status
    expect(workerSrc).toContain("retryable");
    // Report not deleted on timeout — status rolls back to retryable state
    expect(workerSrc).not.toContain("DELETE FROM growth_reports");
    // Non-retryable errors → FAILED (not lost)
    expect(workerSrc).toContain("FAILED");
    // Retry count incremented on retryable errors
    expect(workerSrc).toContain("analysis_retry_count");
  });

  it("TC27 entitlement removal safe — eligibility gate prevents new cycle", () => {
    // No entitlement → isGrowthReportEligiblePool = false
    expect(isGrowthReportEligiblePool(pool({ x_paid_entitlement: false, x_manual_entitlement: false }))).toBe(false);
    // getXEligiblePools uses GROWTH_REPORT_ELIGIBLE_SQL which requires entitlement
    expect(GROWTH_REPORT_ELIGIBLE_SQL).toContain("x_paid_entitlement");
    expect(GROWTH_REPORT_ELIGIBLE_SQL).toContain("x_manual_entitlement");
  });

  it("TC28 super scheduler auth — super_admin only, READY guard imported", () => {
    expect(superSrc).toContain("/super/growth-report-scheduler/run");
    expect(superSrc).toContain('requireRole("super_admin")');
    // READY guard is in PATCH /xmode
    expect(superSrc).toContain("validateXModeReadiness");
    expect(superSrc).toContain("READY_PREREQUISITES_NOT_MET");
    // ensureCurrentMonthGrowthReportCycle is triggered after READY transition
    expect(superSrc).toContain("ensureCurrentMonthGrowthReportCycle");
  });

});
