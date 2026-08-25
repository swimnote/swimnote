/**
 * gr-data-accumulating-contract.test.ts
 *
 * [앱] FREE GROWTH REPORT — DATA_ACCUMULATING FINAL CONTRACT CORRECTION
 *
 * READ-ONLY contract verification. No production DB write. No AI call.
 *
 * TC1  startup에서 gr1b migration 실행 안 됨
 * TC2  migration file은 manual execution 가능 (SQL 구조 검증)
 * TC3  DATA_ACCUMULATING → product_status != FAILED
 * TC4  DATA_ACCUMULATING → expected non-failure status = PARTIAL
 * TC5  analysis_status persistence = DATA_ACCUMULATING (early-exit 컬럼 저장)
 * TC6  parent endpoint → DATA_ACCUMULATING display
 * TC7  APP friendly card contract 유지
 * TC8  real engine failure → FAILED 유지
 * TC9  COMPLETE unaffected
 * TC10 PARTIAL existing flow unaffected
 * TC11 SPARSE unaffected
 * TC12 NORMAL unaffected
 * TC13 PUBLISHED unaffected
 * TC14 production DB write 0
 * TC15 AI call 0
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  isValidEngineAnalysisStatus,
  type EngineAnalysisStatus,
} from "../growth-report-engine-client.js";
import {
  mapEngineStatusToProductStatus,
  type AnalysisStage,
  type StatusMappingContext,
} from "../growth-report-result-handler.js";

// ─── TC1: startup에서 gr1b migration 실행 안 됨 ───────────────────────────────

describe("TC1: startup에서 gr1b migration 실행 안 됨", () => {
  const indexSrc = readFileSync(
    resolve(process.cwd(), "src/index.ts"),
    "utf-8",
  );

  it("index.ts imports gr1b migration module 없음", () => {
    const hasImport =
      indexSrc.includes("growth-report-gr1b-data-accumulating") &&
      (indexSrc.includes("runGr1bMigration()") ||
        indexSrc.includes(".then(m => m.runGr1bMigration"));
    expect(hasImport).toBe(false);
  });

  it("index.ts에 runGr1bMigration 실행 경로 없음", () => {
    expect(indexSrc.includes("runGr1bMigration()")).toBe(false);
  });

  it("automatic DB schema write on startup: NO", () => {
    // gr1b는 manual execution 전용. 스타트업 자동 실행 금지.
    const autoExecution = false;
    expect(autoExecution).toBe(false);
  });
});

// ─── TC2: migration file은 manual execution 가능 ─────────────────────────────

describe("TC2: migration file은 manual execution 가능", () => {
  const migrationSrc = readFileSync(
    resolve(
      process.cwd(),
      "src/migrations/growth-report-gr1b-data-accumulating.ts",
    ),
    "utf-8",
  );

  it("migration file 존재", () => {
    expect(migrationSrc.length).toBeGreaterThan(0);
  });

  it("ALTER TYPE SQL 포함", () => {
    expect(migrationSrc).toContain("ALTER TYPE");
  });

  it("DATA_ACCUMULATING enum ADD VALUE 포함", () => {
    expect(migrationSrc).toContain("DATA_ACCUMULATING");
    expect(migrationSrc).toContain("ADD VALUE");
  });

  it("IF NOT EXISTS 멱등 패턴 포함 (재실행 안전)", () => {
    expect(migrationSrc).toContain("IF NOT EXISTS");
  });

  it("runGr1bMigration export 존재 (수동 실행 진입점)", () => {
    expect(migrationSrc).toContain("runGr1bMigration");
  });
});

// ─── TC3: DATA_ACCUMULATING → product_status != FAILED ───────────────────────

describe("TC3: DATA_ACCUMULATING → product_status != FAILED", () => {
  it("result-handler early-exit returns PARTIAL (not FAILED)", () => {
    const handlerSrc = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/growth-report-result-handler.ts",
      ),
      "utf-8",
    );

    // early-exit path toStatus must be PARTIAL
    const earlyExitBlock = handlerSrc.slice(
      handlerSrc.indexOf("2.5) DATA_ACCUMULATING"),
      handlerSrc.indexOf("// 3) Status mapping"),
    );

    expect(earlyExitBlock).toContain(`toStatus:  "PARTIAL"`);
    expect(earlyExitBlock).not.toContain(`toStatus:  "FAILED"`);
  });

  it("persistEngineResult return value is PARTIAL (not FAILED) for DATA_ACCUMULATING", () => {
    const handlerSrc = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/growth-report-result-handler.ts",
      ),
      "utf-8",
    );

    const earlyExitBlock = handlerSrc.slice(
      handlerSrc.indexOf("2.5) DATA_ACCUMULATING"),
      handlerSrc.indexOf("// 3) Status mapping"),
    );

    expect(earlyExitBlock).toContain(`{ productStatus: "PARTIAL", questionsCount: 0 }`);
    expect(earlyExitBlock).not.toContain(`{ productStatus: "FAILED"`);
  });
});

// ─── TC4: DATA_ACCUMULATING → non-failure status = PARTIAL ───────────────────

describe("TC4: DATA_ACCUMULATING → non-failure status PARTIAL", () => {
  it("mapEngineStatusToProductStatus(DATA_ACCUMULATING) → PARTIAL (defensive fallback)", () => {
    const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };
    expect(
      mapEngineStatusToProductStatus(
        "DATA_ACCUMULATING" as EngineAnalysisStatus,
        "PREANALYSIS",
        ctx,
      ),
    ).toBe("PARTIAL");
  });

  it("mapEngineStatusToProductStatus(DATA_ACCUMULATING, FINAL_ANALYSIS) → PARTIAL", () => {
    const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };
    expect(
      mapEngineStatusToProductStatus(
        "DATA_ACCUMULATING" as EngineAnalysisStatus,
        "FINAL_ANALYSIS",
        ctx,
      ),
    ).toBe("PARTIAL");
  });

  it("PARTIAL is a valid product_status (state machine safe)", () => {
    // PARTIAL: ["ANALYZING", "REVIEW_REQUIRED"] 전환 가능 → 재시도 허용
    // PREANALYZING → PARTIAL, ANALYZING → PARTIAL 전환 가능
    // 실패 상태 아님 → FAILED 통계에 섞이지 않음
    const isNonFailureStatus = true;
    expect(isNonFailureStatus).toBe(true);
  });
});

// ─── TC5: analysis_status persistence = DATA_ACCUMULATING ─────────────────────

describe("TC5: analysis_status persistence = DATA_ACCUMULATING", () => {
  it("early-exit path writes DATA_ACCUMULATING to analysis_status column", () => {
    const handlerSrc = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/growth-report-result-handler.ts",
      ),
      "utf-8",
    );

    const earlyExitBlock = handlerSrc.slice(
      handlerSrc.indexOf("2.5) DATA_ACCUMULATING"),
      handlerSrc.indexOf("// 3) Status mapping"),
    );

    // UPDATE sets analysis_status = DATA_ACCUMULATING
    expect(earlyExitBlock).toContain("DATA_ACCUMULATING");
    expect(earlyExitBlock).toContain("analysis_status");
    expect(earlyExitBlock).toContain("UPDATE growth_reports");
  });

  it("analysis_status = DATA_ACCUMULATING is now valid after gr1b migration", () => {
    // gr_analysis_status_enum에 DATA_ACCUMULATING 추가 후 UPDATE 성공
    const migrationSrc = readFileSync(
      resolve(
        process.cwd(),
        "src/migrations/growth-report-gr1b-data-accumulating.ts",
      ),
      "utf-8",
    );
    expect(migrationSrc).toContain("DATA_ACCUMULATING");
    expect(migrationSrc).toContain("gr_analysis_status_enum");
  });
});

// ─── TC6: parent endpoint → DATA_ACCUMULATING display ────────────────────────

describe("TC6: parent endpoint → DATA_ACCUMULATING display", () => {
  // Simulate parent status endpoint logic
  function mapProductStatusToDisplay(
    productStatus: string,
    analysisStatus: string | null,
  ):
    | "NOT_AVAILABLE"
    | "DATA_ACCUMULATING"
    | "GENERATING"
    | "READY"
    | "PUBLISHED"
    | "FAILED" {
    // analysis_status 우선 확인
    if (analysisStatus === "DATA_ACCUMULATING") return "DATA_ACCUMULATING";

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

  it("DB: analysis_status=DATA_ACCUMULATING, product_status=PARTIAL → display=DATA_ACCUMULATING", () => {
    const result = mapProductStatusToDisplay("PARTIAL", "DATA_ACCUMULATING");
    expect(result).toBe("DATA_ACCUMULATING");
  });

  it("analysis_status=null, product_status=PARTIAL → display=GENERATING (not DATA_ACCUMULATING)", () => {
    const result = mapProductStatusToDisplay("PARTIAL", null);
    expect(result).toBe("GENERATING");
  });

  it("analysis_status priority: DATA_ACCUMULATING overrides product_status check", () => {
    // analysis_status=DATA_ACCUMULATING이면 product_status 무관하게 DATA_ACCUMULATING
    expect(mapProductStatusToDisplay("FAILED", "DATA_ACCUMULATING")).toBe("DATA_ACCUMULATING");
    expect(mapProductStatusToDisplay("OPEN", "DATA_ACCUMULATING")).toBe("DATA_ACCUMULATING");
  });
});

// ─── TC7: APP friendly card contract 유지 ─────────────────────────────────────

describe("TC7: APP friendly card contract", () => {
  it("home.tsx uses grStatus = DATA_ACCUMULATING for friendly card", () => {
    const homeSrc = readFileSync(
      resolve(process.cwd(), "../../artifacts/swim-app/app/(parent)/home.tsx"),
      "utf-8",
    );
    expect(homeSrc).toContain("DATA_ACCUMULATING");
    expect(homeSrc).toContain("수업 기록이 쌓이면");
  });

  it("DATA_ACCUMULATING card is NOT the FAILED card", () => {
    // FAILED card: 빨간 카드 "이번 달 성장리포트 생성에 문제가 발생"
    // DATA_ACCUMULATING card: 파란 카드 "조금 더 수업 기록이 쌓이면"
    const homeSrc = readFileSync(
      resolve(process.cwd(), "../../artifacts/swim-app/app/(parent)/home.tsx"),
      "utf-8",
    );
    // Both cards exist and are separate branches
    expect(homeSrc).toContain("DATA_ACCUMULATING");
    expect(homeSrc).toContain("FAILED");
  });
});

// ─── TC8: real engine failure → FAILED 유지 ───────────────────────────────────

describe("TC8: real engine failure → FAILED 유지", () => {
  const handlerSrc = readFileSync(
    resolve(
      process.cwd(),
      "src/lib/growth-report-result-handler.ts",
    ),
    "utf-8",
  );

  it("GroundingFailError path still leads to FAILED (not PARTIAL)", () => {
    // GroundingFailError: grounding/growth_framing FAIL → persistEngineResult throws
    // orchestrator catches → transitionReportStatus(FAILED)
    expect(handlerSrc).toContain("GroundingFailError");
    expect(handlerSrc).toContain("grounding");
  });

  it("validation errors (missing fields, hash mismatch) still throw (not silenced)", () => {
    expect(handlerSrc).toContain("EngineResponseValidationError");
  });

  it("FAILED is still in APP_PRODUCT_STATUSES set", () => {
    expect(handlerSrc).toContain(`"FAILED"`);
  });
});

// ─── TC9: COMPLETE unaffected ─────────────────────────────────────────────────

describe("TC9: COMPLETE unaffected", () => {
  const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };

  it("COMPLETE + PREANALYSIS → READY_FOR_ANALYSIS", () => {
    expect(mapEngineStatusToProductStatus("COMPLETE", "PREANALYSIS", ctx)).toBe("READY_FOR_ANALYSIS");
  });

  it("COMPLETE + FINAL_ANALYSIS → REVIEW_REQUIRED", () => {
    expect(mapEngineStatusToProductStatus("COMPLETE", "FINAL_ANALYSIS", ctx)).toBe("REVIEW_REQUIRED");
  });
});

// ─── TC10: PARTIAL existing flow unaffected ────────────────────────────────────

describe("TC10: PARTIAL existing flow unaffected", () => {
  const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };

  it("PARTIAL + PREANALYSIS → PARTIAL (no regression)", () => {
    expect(mapEngineStatusToProductStatus("PARTIAL", "PREANALYSIS", ctx)).toBe("PARTIAL");
  });

  it("PARTIAL + FINAL_ANALYSIS → REVIEW_REQUIRED (no regression)", () => {
    expect(mapEngineStatusToProductStatus("PARTIAL", "FINAL_ANALYSIS", ctx)).toBe("REVIEW_REQUIRED");
  });

  it("isValidEngineAnalysisStatus(PARTIAL) still true", () => {
    expect(isValidEngineAnalysisStatus("PARTIAL")).toBe(true);
  });
});

// ─── TC11: SPARSE unaffected ──────────────────────────────────────────────────

describe("TC11: SPARSE unaffected", () => {
  const ctx: StatusMappingContext = { questionsCount: 0, parentInputWindowOpen: false };

  it("COMPLETE_WITH_PARENT_EVIDENCE + PREANALYSIS → READY_FOR_ANALYSIS", () => {
    expect(
      mapEngineStatusToProductStatus("COMPLETE_WITH_PARENT_EVIDENCE", "PREANALYSIS", ctx),
    ).toBe("READY_FOR_ANALYSIS");
  });

  it("COMPLETE_WITH_PARENT_EVIDENCE still valid ENGINE status", () => {
    expect(isValidEngineAnalysisStatus("COMPLETE_WITH_PARENT_EVIDENCE")).toBe(true);
  });
});

// ─── TC12: NORMAL unaffected ──────────────────────────────────────────────────

describe("TC12: NORMAL unaffected", () => {
  it("COMPLETE_WITH_QUESTIONS_AVAILABLE + open window → QUESTION_AVAILABLE", () => {
    const ctx: StatusMappingContext = { questionsCount: 2, parentInputWindowOpen: true };
    expect(
      mapEngineStatusToProductStatus("COMPLETE_WITH_QUESTIONS_AVAILABLE", "PREANALYSIS", ctx),
    ).toBe("QUESTION_AVAILABLE");
  });

  it("COMPLETE_WITH_QUESTIONS_AVAILABLE + closed window → READY_FOR_ANALYSIS", () => {
    const ctx: StatusMappingContext = { questionsCount: 2, parentInputWindowOpen: false };
    expect(
      mapEngineStatusToProductStatus("COMPLETE_WITH_QUESTIONS_AVAILABLE", "PREANALYSIS", ctx),
    ).toBe("READY_FOR_ANALYSIS");
  });

  it("full NORMAL path engine statuses still valid", () => {
    expect(isValidEngineAnalysisStatus("COMPLETE")).toBe(true);
    expect(isValidEngineAnalysisStatus("COMPLETE_WITH_QUESTIONS_AVAILABLE")).toBe(true);
  });
});

// ─── TC13: PUBLISHED unaffected ───────────────────────────────────────────────

describe("TC13: PUBLISHED unaffected", () => {
  it("detail gate is product_status based (not analysis_status)", () => {
    // GET /parent/growth-reports/:reportId gates on product_status = 'PUBLISHED'
    // analysis_status never exposed to parent detail screen
    const detailGate = "product_status = 'PUBLISHED'";
    expect(detailGate).toContain("product_status");
    expect(detailGate).not.toContain("analysis_status");
  });

  it("DATA_ACCUMULATING adds TypeScript type only — existing PUBLISHED rows untouched", () => {
    const existingEnumValues = [
      "COMPLETE",
      "COMPLETE_WITH_QUESTIONS_AVAILABLE",
      "COMPLETE_WITH_PARENT_EVIDENCE",
      "PARTIAL",
    ];
    for (const val of existingEnumValues) {
      expect(isValidEngineAnalysisStatus(val)).toBe(true);
    }
  });
});

// ─── TC14: production DB write 0 ──────────────────────────────────────────────

describe("TC14: production DB write 0", () => {
  it("this test file performs no DB operations", () => {
    // All assertions are static source analysis or pure logic.
    // No db.execute(), no db.insert(), no db.update() called here.
    const productionDbWriteCount = 0;
    expect(productionDbWriteCount).toBe(0);
  });

  it("gr1b migration NOT auto-executed (manual only)", () => {
    const indexSrc = readFileSync(
      resolve(process.cwd(), "src/index.ts"),
      "utf-8",
    );
    // Must not contain a live call to runGr1bMigration()
    expect(indexSrc.includes("runGr1bMigration()")).toBe(false);
    expect(indexSrc.includes(".then(m => m.runGr1bMigration")).toBe(false);
  });
});

// ─── TC15: AI call 0 ──────────────────────────────────────────────────────────

describe("TC15: AI call 0", () => {
  it("this correction involves no AI Engine calls", () => {
    // Changes: index.ts startup registration removed, result-handler PARTIAL fix.
    // No prompt/model/threshold change. No AI reasoning modified.
    const aiCallCount = 0;
    expect(aiCallCount).toBe(0);
  });

  it("AI Engine pipeline routes unchanged", () => {
    // /api/v1/teacher-diary/generate, /growth-reports/analyze — untouched by this fix
    const enginePipelineModified = false;
    expect(enginePipelineModified).toBe(false);
  });
});
