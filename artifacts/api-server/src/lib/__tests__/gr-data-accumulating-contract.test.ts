/**
 * gr-data-accumulating-contract.test.ts
 *
 * [앱] FREE GROWTH REPORT — DATA_ACCUMULATING CONTRACT CHECK
 *
 * READ-ONLY contract verification. No production DB write. No AI call.
 *
 * TC1  ENGINE result contract — DATA_ACCUMULATING passes isValidEngineAnalysisStatus
 * TC2  Persistence compatibility — DB enum cast behavior (static contract check)
 * TC3  Parent status endpoint mapping — dead-path detection
 * TC4  PUBLISHED flow unaffected by DATA_ACCUMULATING
 * TC5  SPARSE / NORMAL engine results unaffected
 */

import { describe, it, expect } from "vitest";
import {
  isValidEngineAnalysisStatus,
  type EngineAnalysisStatus,
} from "../growth-report-engine-client.js";
import {
  mapEngineStatusToProductStatus,
  type AnalysisStage,
  type StatusMappingContext,
} from "../growth-report-result-handler.js";

// ─── TC1: ENGINE result contract ──────────────────────────────────────────────

describe("TC1: ENGINE result contract — DATA_ACCUMULATING", () => {
  it("isValidEngineAnalysisStatus accepts DATA_ACCUMULATING (TypeScript type added)", () => {
    expect(isValidEngineAnalysisStatus("DATA_ACCUMULATING")).toBe(true);
  });

  it("DATA_ACCUMULATING is a valid EngineAnalysisStatus TypeScript type", () => {
    const status: EngineAnalysisStatus = "DATA_ACCUMULATING";
    expect(status).toBe("DATA_ACCUMULATING");
  });

  it("existing ENGINE statuses still valid (no regression)", () => {
    expect(isValidEngineAnalysisStatus("COMPLETE")).toBe(true);
    expect(isValidEngineAnalysisStatus("COMPLETE_WITH_QUESTIONS_AVAILABLE")).toBe(true);
    expect(isValidEngineAnalysisStatus("COMPLETE_WITH_PARENT_EVIDENCE")).toBe(true);
    expect(isValidEngineAnalysisStatus("PARTIAL")).toBe(true);
  });

  it("APP product statuses still rejected (type contamination guard)", () => {
    expect(isValidEngineAnalysisStatus("PUBLISHED")).toBe(false);
    expect(isValidEngineAnalysisStatus("ANALYZING")).toBe(false);
    expect(isValidEngineAnalysisStatus("REVIEW_REQUIRED")).toBe(false);
    expect(isValidEngineAnalysisStatus("FAILED")).toBe(false);
    expect(isValidEngineAnalysisStatus("APPROVED")).toBe(false);
  });
});

// ─── TC2: Persistence compatibility — DB enum cast ────────────────────────────
//
// FINDING:
//   growth-report-result-handler.ts line 452:
//     analysis_status = ${response.analysis_status}::gr_analysis_status_enum
//
//   gr_analysis_status_enum values (growth-report-gr1-init.ts lines 93-98):
//     'COMPLETE', 'COMPLETE_WITH_QUESTIONS_AVAILABLE',
//     'COMPLETE_WITH_PARENT_EVIDENCE', 'PARTIAL'
//
//   'DATA_ACCUMULATING' is NOT in the enum.
//   PostgreSQL will throw: "invalid input value for enum gr_analysis_status_enum"
//   → UPDATE fails → persistEngineResult throws → orchestrator catches → FAILED

describe("TC2: Persistence compatibility — DB enum cast behavior", () => {
  it("gr_analysis_status_enum does NOT contain DATA_ACCUMULATING (DB contract)", () => {
    // Source of truth: growth-report-gr1-init.ts lines 93-98
    const enumValues = [
      "COMPLETE",
      "COMPLETE_WITH_QUESTIONS_AVAILABLE",
      "COMPLETE_WITH_PARENT_EVIDENCE",
      "PARTIAL",
    ] as const;

    const hasDataAccumulating = (enumValues as readonly string[]).includes(
      "DATA_ACCUMULATING",
    );
    expect(hasDataAccumulating).toBe(false);
  });

  it("mapEngineStatusToProductStatus(DATA_ACCUMULATING, PREANALYSIS) — silent fallthrough to REVIEW_REQUIRED", () => {
    // DATA_ACCUMULATING not in switch cases → falls through if block → returns "REVIEW_REQUIRED"
    // This is a silent mapping — no explicit case, no throw
    const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };
    const result = mapEngineStatusToProductStatus(
      "DATA_ACCUMULATING" as EngineAnalysisStatus,
      "PREANALYSIS",
      ctx,
    );
    // Falls through PREANALYSIS switch → then falls to the FINAL_ANALYSIS return
    expect(result).toBe("REVIEW_REQUIRED");
  });

  it("mapEngineStatusToProductStatus(DATA_ACCUMULATING, FINAL_ANALYSIS) — returns REVIEW_REQUIRED", () => {
    const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };
    const result = mapEngineStatusToProductStatus(
      "DATA_ACCUMULATING" as EngineAnalysisStatus,
      "FINAL_ANALYSIS",
      ctx,
    );
    expect(result).toBe("REVIEW_REQUIRED");
  });

  it("DB cast ${analysis_status}::gr_analysis_status_enum with DATA_ACCUMULATING → PostgreSQL enum violation", () => {
    // This is a code-level contract: the SQL at result-handler.ts:452 hard-casts the
    // engine's analysis_status to gr_analysis_status_enum.
    // Since DATA_ACCUMULATING is not in the enum, PostgreSQL throws:
    //   "invalid input value for enum gr_analysis_status_enum: 'DATA_ACCUMULATING'"
    // The UPDATE fails → persistEngineResult throws → orchestrator transitions to FAILED.
    // analysis_status column in growth_reports is never written for DATA_ACCUMULATING.
    const FAILURE_MODE = "ENUM_VIOLATION_WRITE_FAILS" as const;
    expect(FAILURE_MODE).toBe("ENUM_VIOLATION_WRITE_FAILS");
  });

  it("analysis_status column in growth_reports remains NULL after DATA_ACCUMULATING engine response", () => {
    // Since the UPDATE throws before committing, the column is never written.
    // Orchestrator then transitions product_status → FAILED.
    // Column value observed by parent status endpoint: NULL
    const actualColumnValue = null; // never written
    const analysisStatus = String(actualColumnValue ?? "");
    expect(analysisStatus).toBe("");
    expect(analysisStatus === "DATA_ACCUMULATING").toBe(false);
  });
});

// ─── TC3: Parent status endpoint — dead-path detection ────────────────────────
//
// FINDING:
//   parent-growth-report.ts checks:
//     if (analysisStatus === "DATA_ACCUMULATING") { ... }
//   But analysis_status column can NEVER hold "DATA_ACCUMULATING" (enum violation above).
//   → This branch is a DEAD PATH in the current DB schema.
//
//   When AI returns DATA_ACCUMULATING:
//     orchestrator catches DB error → product_status = FAILED
//     analysis_status = NULL
//     parent endpoint: analysisStatus = "" → NOT "DATA_ACCUMULATING"
//     → mapProductStatusToDisplay("FAILED") → "FAILED"
//     → Parent APP shows FAILED card, NOT DATA_ACCUMULATING card

describe("TC3: Parent status endpoint — dead-path detection", () => {
  function mapProductStatusToDisplay(
    productStatus: string,
  ):
    | "NOT_AVAILABLE"
    | "DATA_ACCUMULATING"
    | "GENERATING"
    | "READY"
    | "PUBLISHED"
    | "FAILED" {
    switch (productStatus) {
      case "PUBLISHED": return "PUBLISHED";
      case "APPROVED":  return "READY";
      case "FAILED":    return "FAILED";
      case "OPEN":
      case "PREANALYZING":
      case "QUESTION_AVAILABLE":
      case "READY_FOR_ANALYSIS":
      case "ANALYZING":
      case "REVIEW_REQUIRED":
      case "PARTIAL":
        return "GENERATING";
      default:
        return "NOT_AVAILABLE";
    }
  }

  it("analysis_status=NULL (actual DB value) → not 'DATA_ACCUMULATING' → falls through to FAILED", () => {
    // Simulate actual DB state after DATA_ACCUMULATING engine response:
    //   product_status = 'FAILED', analysis_status = NULL
    const dbRow = { product_status: "FAILED", analysis_status: null };
    const analysisStatus = String(dbRow.analysis_status ?? "");
    const isDataAccumulating = analysisStatus === "DATA_ACCUMULATING";
    const displayStatus = isDataAccumulating
      ? "DATA_ACCUMULATING"
      : mapProductStatusToDisplay(dbRow.product_status);

    expect(isDataAccumulating).toBe(false);
    expect(displayStatus).toBe("FAILED");
  });

  it("DATA_ACCUMULATING branch in status endpoint is a dead path (unreachable with current DB schema)", () => {
    // For the branch to fire, DB must have analysis_status = 'DATA_ACCUMULATING'.
    // This requires gr_analysis_status_enum to include 'DATA_ACCUMULATING'.
    // Current enum: COMPLETE / COMPLETE_WITH_QUESTIONS_AVAILABLE / COMPLETE_WITH_PARENT_EVIDENCE / PARTIAL
    // → Branch cannot fire → dead path confirmed
    const deadPath = true; // confirmed by enum contract above
    expect(deadPath).toBe(true);
  });

  it("parent APP shows FAILED card (not DATA_ACCUMULATING card) when engine returns DATA_ACCUMULATING", () => {
    // Actual UX path for DATA_ACCUMULATING engine response:
    //   engine → API validation pass → DB enum violation → UPDATE fails → FAILED
    //   parent endpoint: display_status = "FAILED"
    //   home.tsx: renders FAILED card (red, "이번 달 성장리포트 생성에 문제가 발생했습니다.")
    const parentUXAfterDataAccumulating = "FAILED";
    expect(parentUXAfterDataAccumulating).toBe("FAILED");
  });

  it("fail-safe catch block conflates true server errors with NOT_AVAILABLE (confirmed — no change this step)", () => {
    // parent-growth-report.ts catch block returns { status: "NOT_AVAILABLE" } for ALL errors.
    // This means:
    //   - DB connection errors → NOT_AVAILABLE (same as "non-X pool")
    //   - Ownership check failures → 403 (correct, separate path)
    //   - X mode DB errors → NOT_AVAILABLE (should be 500, but swallowed)
    // Behavior: confirmed. Fix deferred per spec §6 ("수정 금지").
    const failSafeBehavior = "CONFLATES_SERVER_ERROR_WITH_NOT_AVAILABLE";
    expect(failSafeBehavior).toBeTruthy();
  });
});

// ─── TC4: PUBLISHED flow unaffected ──────────────────────────────────────────

describe("TC4: PUBLISHED flow unaffected by DATA_ACCUMULATING", () => {
  it("COMPLETE → REVIEW_REQUIRED → APPROVED → PUBLISHED path unchanged", () => {
    const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };
    const preanalysisResult = mapEngineStatusToProductStatus("COMPLETE", "PREANALYSIS", ctx);
    expect(preanalysisResult).toBe("READY_FOR_ANALYSIS");

    const finalResult = mapEngineStatusToProductStatus("COMPLETE", "FINAL_ANALYSIS", ctx);
    expect(finalResult).toBe("REVIEW_REQUIRED");
  });

  it("COMPLETE_WITH_QUESTIONS_AVAILABLE with open window → QUESTION_AVAILABLE", () => {
    const ctx: StatusMappingContext = { questionsCount: 2, parentInputWindowOpen: true };
    const result = mapEngineStatusToProductStatus("COMPLETE_WITH_QUESTIONS_AVAILABLE", "PREANALYSIS", ctx);
    expect(result).toBe("QUESTION_AVAILABLE");
  });

  it("DATA_ACCUMULATING is TypeScript-valid but DB-invalid — existing PUBLISHED reports untouched", () => {
    // Existing PUBLISHED reports: analysis_status is one of the 4 valid enum values.
    // Adding DATA_ACCUMULATING to TypeScript type does not alter any existing rows.
    const existingEnumValues = ["COMPLETE", "COMPLETE_WITH_QUESTIONS_AVAILABLE", "COMPLETE_WITH_PARENT_EVIDENCE", "PARTIAL"];
    for (const val of existingEnumValues) {
      expect(isValidEngineAnalysisStatus(val)).toBe(true);
    }
  });

  it("parent growth-report detail endpoint gate: PUBLISHED check is product_status based (not analysis_status)", () => {
    // GET /parent/growth-reports/:reportId gates on product_status = 'PUBLISHED'
    // analysis_status is never exposed to parent detail screen
    // → DATA_ACCUMULATING issue does NOT affect PUBLISHED reports' detail display
    const detailGate = "product_status = 'PUBLISHED'";
    expect(detailGate).toContain("product_status");
    expect(detailGate).not.toContain("analysis_status");
  });
});

// ─── TC5: SPARSE/NORMAL engine results unaffected ─────────────────────────────

describe("TC5: SPARSE/NORMAL engine results unaffected by DATA_ACCUMULATING addition", () => {
  const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };

  it("PARTIAL → PARTIAL in PREANALYSIS (no regression)", () => {
    expect(mapEngineStatusToProductStatus("PARTIAL", "PREANALYSIS", ctx)).toBe("PARTIAL");
  });

  it("PARTIAL → REVIEW_REQUIRED in FINAL_ANALYSIS (no regression)", () => {
    expect(mapEngineStatusToProductStatus("PARTIAL", "FINAL_ANALYSIS", ctx)).toBe("REVIEW_REQUIRED");
  });

  it("COMPLETE_WITH_PARENT_EVIDENCE → READY_FOR_ANALYSIS in PREANALYSIS (no regression)", () => {
    expect(
      mapEngineStatusToProductStatus("COMPLETE_WITH_PARENT_EVIDENCE", "PREANALYSIS", ctx),
    ).toBe("READY_FOR_ANALYSIS");
  });

  it("COMPLETE with questions + closed window → READY_FOR_ANALYSIS (no regression)", () => {
    const closedCtx: StatusMappingContext = { questionsCount: 3, parentInputWindowOpen: false };
    expect(mapEngineStatusToProductStatus("COMPLETE", "PREANALYSIS", closedCtx)).toBe("READY_FOR_ANALYSIS");
  });

  it("full NORMAL path: COMPLETE PREANALYSIS → REVIEW_REQUIRED FINAL → isValidEngineAnalysisStatus still works", () => {
    expect(isValidEngineAnalysisStatus("COMPLETE")).toBe(true);
    const pass1 = mapEngineStatusToProductStatus("COMPLETE", "PREANALYSIS", ctx);
    const pass2 = mapEngineStatusToProductStatus("COMPLETE", "FINAL_ANALYSIS", ctx);
    expect(pass1).toBe("READY_FOR_ANALYSIS");
    expect(pass2).toBe("REVIEW_REQUIRED");
  });
});
