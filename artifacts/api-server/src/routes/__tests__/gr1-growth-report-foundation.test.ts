/**
 * GR1 — Growth Report Foundation Tests (41 TC)
 *
 * DB mock 방식: in-memory execute stub (실제 DB 호출 없음).
 *
 * TC 목록:
 *   A.  Repository guard: SWIMNOTE APP 구조 확인 (Expo, Express, X Mode)
 *   B.  Cycle create (idempotent)
 *   C.  Cycle UNIQUE pool/report_period
 *   D.  analysis_from null 허용
 *   E.  Asia/Seoul timezone 기본값
 *   F.  Report create (concurrency-safe)
 *   G.  Unique student/cycle (ON CONFLICT DO NOTHING)
 *   H.  ProductStatus 모든 canonical value
 *   I.  QUESTION_REQUIRED → ForbiddenStatusError
 *   J.  CLOSED → ForbiddenStatusError
 *   K.  ParentInputStatus 4종 유효값
 *   L.  CycleStatus 4종 유효값
 *   M.  Valid lifecycle transition (OPEN → PREANALYZING)
 *   N.  Invalid transition reject
 *   O.  PUBLISHED terminal
 *   P.  QUESTION_AVAILABLE → READY_FOR_ANALYSIS
 *   Q.  FAILED → ANALYZING retry
 *   R.  PARTIAL → ANALYZING
 *   S.  analysis_status와 product_status 분리
 *   T.  Questions 0개 허용
 *   U.  is_required=false 저장
 *   V.  question options structured JSONB array
 *   W.  duplicate engine question 방지 (UNIQUE constraint)
 *   X.  structured selected_values answer
 *   Y.  answer upsert (ON CONFLICT DO NOTHING)
 *   Z.  Parent 미응답이 report를 막지 않음
 *   AA. report_content structured JSON
 *   AB. sns_summary structured JSON
 *   AC. Fact Package opaque storage
 *   AD. APP이 metric_id 의미 해석하지 않음
 *   AE. longitudinal structured history 조회 가능
 *   AF. multiple previous reports 조회 가능 (N개 배열)
 *   AG. X entitlement true → allowed
 *   AH. X entitlement false → XMODE_NOT_ENTITLED
 *   AI. Published data 삭제 없음 (PUBLISHED terminal)
 *   AJ. audit transition 기록
 *   AK. concurrent duplicate report 방어 (ON CONFLICT)
 *   AL. migration additive (기존 컬럼 보존)
 *   AM. Existing Diary regression (불필요한 import 없음)
 *   AN. Growth Event regression (불필요한 import 없음)
 *   AO. notifications/routes import regression
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  transitionReportStatus,
  createReportCycle,
  createGrowthReport,
  getPublishedReportHistory,
  updateParentInputStatus,
  isAllowedTransition,
  isValidProductStatus,
  assertNotForbiddenStatus,
  ALL_PRODUCT_STATUSES,
  ALL_PARENT_INPUT_STATUSES,
  ALL_CYCLE_STATUSES,
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  ForbiddenStatusError,
  ReportTerminalError,
  type ProductStatus,
} from "../../lib/growth-report-service.js";

import {
  resolveReportXAccess,
  checkPublishedReportXPolicy,
  resolveReportPoolId,
} from "../../lib/xmode-report-guard.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB factory
// ─────────────────────────────────────────────────────────────────────────────

function makeDb(options: {
  reportRow?: Record<string, any> | null;
  insertReturnsId?: string | null;
  existingId?: string | null;
  historyRows?: Record<string, any>[];
} = {}) {
  const {
    reportRow = {
      id: "gr_test001",
      product_status: "OPEN",
      swimming_pool_id: "pool_test",
      deleted_at: null,
    },
    insertReturnsId = "gr_test001",
    existingId = "gr_test001",
    historyRows = [],
  } = options;

  let callCount = 0;

  const executeMock = vi.fn(async (query: any) => {
    callCount++;
    const q: string = query?.queryChunks
      ? query.queryChunks.map((c: any) =>
          typeof c === "string" ? c : (c?.value ?? "")
        ).join("")
      : String(query?.sql ?? query ?? "");

    // FOR UPDATE select
    if (q.includes("FOR UPDATE")) {
      return { rows: reportRow ? [reportRow] : [] };
    }

    // next_audit_version
    if (q.includes("next_audit_version")) {
      return { rows: [{ v: 1 }] };
    }

    // getPublishedReportHistory SELECT
    if (q.includes("product_status = 'PUBLISHED'") || historyRows.length > 0) {
      if (q.includes("SELECT") && !q.includes("FOR UPDATE") && !q.includes("next_audit_version")) {
        return { rows: historyRows };
      }
    }

    // cycle/report INSERT ... ON CONFLICT ... RETURNING
    if (q.includes("INSERT") && q.includes("RETURNING")) {
      if (insertReturnsId) {
        return { rows: [{ id: insertReturnsId }] };
      }
      return { rows: [] };
    }

    // cycle/report SELECT after conflict
    if (q.includes("SELECT") && !q.includes("FOR UPDATE")) {
      return { rows: existingId ? [{ id: existingId }] : [] };
    }

    // UPDATE
    if (q.includes("UPDATE")) {
      return { rowCount: 1, rows: [] };
    }

    // INSERT audit
    if (q.includes("INSERT")) {
      return { rowCount: 1, rows: [] };
    }

    return { rows: [] };
  });

  return { execute: executeMock, _mock: executeMock, _callCount: () => callCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Repository Guard
// ─────────────────────────────────────────────────────────────────────────────

describe("A. Repository Guard", () => {
  it("A-1: Expo / React Native APP이 존재한다", async () => {
    const { existsSync } = await import("node:fs");
    const result =
      existsSync("/home/runner/workspace/artifacts/swim-app") ||
      existsSync("/home/runner/workspace/artifacts/swim-app/app.json");
    expect(result).toBe(true);
  });

  it("A-2: Express API 서버가 존재한다", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("/home/runner/workspace/artifacts/api-server/src/app.ts")).toBe(true);
  });

  it("A-3: X Mode 서비스가 존재한다 (xmode.ts)", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("/home/runner/workspace/artifacts/api-server/src/lib/xmode.ts")).toBe(true);
  });

  it("A-4: Parent / Teacher / Admin 도메인이 존재한다", async () => {
    const { existsSync } = await import("node:fs");
    const hasRoutes =
      existsSync("/home/runner/workspace/artifacts/api-server/src/routes") &&
      existsSync("/home/runner/workspace/artifacts/api-server/src/middlewares/auth.ts");
    expect(hasRoutes).toBe(true);
  });

  it("A-5: GR1 migration 파일이 존재한다", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B–E. Cycle
// ─────────────────────────────────────────────────────────────────────────────

describe("B–E. Report Cycle", () => {
  it("B: cycle create → { cycleId, created: true }", async () => {
    const db = makeDb({ insertReturnsId: "grc_001" }) as any;
    const result = await createReportCycle({
      db,
      poolId: "pool_test",
      reportPeriod: "2026-08",
      analysisCutoffAt: new Date("2026-08-25T00:00:00Z"),
      parentInputOpenAt: new Date("2026-08-25T00:00:00Z"),
      parentInputCloseAt: new Date("2026-09-05T23:59:59Z"),
    });
    expect(result.created).toBe(true);
    expect(result.cycleId).toBe("grc_001");
  });

  it("C: 이미 존재하는 pool/period → created: false, 기존 ID 반환", async () => {
    // INSERT ON CONFLICT returns empty → SELECT returns existing
    const db = makeDb({ insertReturnsId: null, existingId: "grc_existing" }) as any;
    const result = await createReportCycle({
      db,
      poolId: "pool_test",
      reportPeriod: "2026-08",
      analysisCutoffAt: new Date("2026-08-25T00:00:00Z"),
      parentInputOpenAt: new Date("2026-08-25T00:00:00Z"),
      parentInputCloseAt: new Date("2026-09-05T23:59:59Z"),
    });
    expect(result.created).toBe(false);
    expect(result.cycleId).toBe("grc_existing");
  });

  it("D: analysis_from null 허용 (nullable 유지)", async () => {
    const db = makeDb({ insertReturnsId: "grc_002" }) as any;
    const result = await createReportCycle({
      db,
      poolId: "pool_test",
      reportPeriod: "2026-09",
      analysisCutoffAt: new Date("2026-09-25T00:00:00Z"),
      parentInputOpenAt: new Date("2026-09-25T00:00:00Z"),
      parentInputCloseAt: new Date("2026-10-05T23:59:59Z"),
      analysisFrom: null,
    });
    expect(result.cycleId).toBe("grc_002");
  });

  it("E: timezone 기본값 Asia/Seoul 사용", async () => {
    // migration DDL에서 DEFAULT 'Asia/Seoul' 확인
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("Asia/Seoul");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F–G. Report Create
// ─────────────────────────────────────────────────────────────────────────────

describe("F–G. Growth Report Create", () => {
  it("F: report create → { reportId, created: true }", async () => {
    const db = makeDb({ insertReturnsId: "gr_new001" }) as any;
    const result = await createGrowthReport({
      db,
      poolId: "pool_test",
      studentId: "student_001",
      cycleId: "grc_001",
      reportPeriod: "2026-08",
    });
    expect(result.created).toBe(true);
    expect(result.reportId).toBe("gr_new001");
  });

  it("G: 동일 student/cycle 중복 → created: false, 기존 ID 반환", async () => {
    const db = makeDb({ insertReturnsId: null, existingId: "gr_existing" }) as any;
    const result = await createGrowthReport({
      db,
      poolId: "pool_test",
      studentId: "student_001",
      cycleId: "grc_001",
      reportPeriod: "2026-08",
    });
    expect(result.created).toBe(false);
    expect(result.reportId).toBe("gr_existing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H–K. Status Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("H–K. Status Values", () => {
  it("H: ProductStatus 11개 canonical value 모두 존재", () => {
    const expected: ProductStatus[] = [
      "NOT_OPEN", "OPEN", "PREANALYZING", "QUESTION_AVAILABLE",
      "READY_FOR_ANALYSIS", "ANALYZING", "REVIEW_REQUIRED",
      "APPROVED", "PUBLISHED", "PARTIAL", "FAILED",
    ];
    for (const s of expected) {
      expect(ALL_PRODUCT_STATUSES.has(s)).toBe(true);
    }
    expect(ALL_PRODUCT_STATUSES.size).toBe(11);
  });

  it("I: QUESTION_REQUIRED → ForbiddenStatusError", () => {
    expect(() => assertNotForbiddenStatus("QUESTION_REQUIRED"))
      .toThrow(ForbiddenStatusError);
  });

  it("J: CLOSED → ForbiddenStatusError", () => {
    expect(() => assertNotForbiddenStatus("CLOSED"))
      .toThrow(ForbiddenStatusError);
  });

  it("K: ParentInputStatus 4종 모두 유효", () => {
    const expected = ["NONE", "AVAILABLE", "ANSWERED", "CLOSED"] as const;
    for (const s of expected) {
      expect(ALL_PARENT_INPUT_STATUSES.has(s)).toBe(true);
    }
    expect(ALL_PARENT_INPUT_STATUSES.size).toBe(4);
  });

  it("L: CycleStatus 4종 모두 유효", () => {
    const expected = ["PENDING", "ACTIVE", "INPUT_CLOSED", "DONE"] as const;
    for (const s of expected) {
      expect(ALL_CYCLE_STATUSES.has(s)).toBe(true);
    }
    expect(ALL_CYCLE_STATUSES.size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M–R. Lifecycle Transitions
// ─────────────────────────────────────────────────────────────────────────────

describe("M–R. Lifecycle Transitions", () => {
  it("M: valid transition OPEN → PREANALYZING", async () => {
    const db = makeDb({
      reportRow: { id: "gr_001", product_status: "OPEN", swimming_pool_id: "pool_test", deleted_at: null },
    }) as any;
    const result = await transitionReportStatus({
      db,
      reportId: "gr_001",
      toStatus: "PREANALYZING",
      actorType: "system",
      actorId: null,
    });
    expect(result.updated).toBe(true);
    expect(result.previousStatus).toBe("OPEN");
    expect(result.newStatus).toBe("PREANALYZING");
  });

  it("N: invalid transition OPEN → PUBLISHED → InvalidTransitionError", async () => {
    const db = makeDb({
      reportRow: { id: "gr_001", product_status: "OPEN", swimming_pool_id: "pool_test", deleted_at: null },
    }) as any;
    await expect(
      transitionReportStatus({ db, reportId: "gr_001", toStatus: "PUBLISHED", actorType: "system", actorId: null })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("O: PUBLISHED terminal → ReportTerminalError", async () => {
    const db = makeDb({
      reportRow: { id: "gr_001", product_status: "PUBLISHED", swimming_pool_id: "pool_test", deleted_at: null },
    }) as any;
    await expect(
      transitionReportStatus({ db, reportId: "gr_001", toStatus: "APPROVED", actorType: "system", actorId: null })
    ).rejects.toThrow(ReportTerminalError);
  });

  it("P: QUESTION_AVAILABLE → READY_FOR_ANALYSIS (valid)", () => {
    expect(isAllowedTransition("QUESTION_AVAILABLE", "READY_FOR_ANALYSIS")).toBe(true);
  });

  it("Q: FAILED → ANALYZING retry (valid)", () => {
    expect(isAllowedTransition("FAILED", "ANALYZING")).toBe(true);
  });

  it("R: PARTIAL → ANALYZING (valid)", () => {
    expect(isAllowedTransition("PARTIAL", "ANALYZING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S. analysis_status vs product_status 분리
// ─────────────────────────────────────────────────────────────────────────────

describe("S. analysis_status 분리", () => {
  it("S: analysis_status는 product_status에 포함되지 않음", () => {
    const analysisSentinels = [
      "COMPLETE",
      "COMPLETE_WITH_QUESTIONS_AVAILABLE",
      "COMPLETE_WITH_PARENT_EVIDENCE",
    ];
    for (const s of analysisSentinels) {
      // product_status로 쓰이면 안 됨
      expect(isValidProductStatus(s)).toBe(false);
    }
  });

  it("S2: migration에 analysis_status 컬럼이 별도로 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("analysis_status");
    expect(migration).toContain("gr_analysis_status_enum");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T–Z. Questions & Answers
// ─────────────────────────────────────────────────────────────────────────────

describe("T–Z. Questions & Answers", () => {
  it("T: questions 0개 허용 — ALLOWED_TRANSITIONS에서 질문 없이 READY_FOR_ANALYSIS 가능", () => {
    // PREANALYZING → READY_FOR_ANALYSIS (질문 없이도)
    expect(isAllowedTransition("PREANALYZING", "READY_FOR_ANALYSIS")).toBe(true);
    // QUESTION_AVAILABLE → READY_FOR_ANALYSIS (미응답 시에도)
    expect(isAllowedTransition("QUESTION_AVAILABLE", "READY_FOR_ANALYSIS")).toBe(true);
  });

  it("U: is_required=false가 canonical (schema 확인)", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    // is_required NOT NULL DEFAULT false
    expect(migration).toContain("is_required               boolean     NOT NULL DEFAULT false");
  });

  it("V: question options는 JSONB array (schema constraint 확인)", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("chk_grq_options_is_array");
    expect(migration).toContain("jsonb_typeof(options) = 'array'");
  });

  it("W: UNIQUE(report_id, engine_question_id) — duplicate 방지 (schema 확인)", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("uq_growth_report_questions_report_engine");
    expect(migration).toContain("report_id, engine_question_id");
  });

  it("X: selected_values는 JSONB array (schema constraint 확인)", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("chk_gra_selected_values_is_array");
    expect(migration).toContain("jsonb_typeof(selected_values) = 'array'");
  });

  it("Y: answer UNIQUE(report_id, question_id, parent_account_id) — upsert 가능", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("uq_growth_report_answers_report_question_parent");
    expect(migration).toContain("report_id, question_id, parent_account_id");
  });

  it("Z: 학부모 미응답이 report transition을 막지 않음 (transition은 독립적)", () => {
    // QUESTION_AVAILABLE → READY_FOR_ANALYSIS (부모 답변 없어도 가능)
    expect(isAllowedTransition("QUESTION_AVAILABLE", "READY_FOR_ANALYSIS")).toBe(true);
    // PREANALYZING → READY_FOR_ANALYSIS (questions 없어도 가능)
    expect(isAllowedTransition("PREANALYZING", "READY_FOR_ANALYSIS")).toBe(true);
    // QUESTION_REQUIRED는 존재하지 않음
    expect(isValidProductStatus("QUESTION_REQUIRED")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AA–AD. Structured Storage
// ─────────────────────────────────────────────────────────────────────────────

describe("AA–AD. Structured Product Storage", () => {
  it("AA: report_content structured JSON — schema에 report_content jsonb 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain(`"report_content"`);
    expect(migration).toContain("jsonb");
  });

  it("AB: sns_summary structured JSON — schema에 sns_summary jsonb 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain(`"sns_summary"`);
  });

  it("AC: Fact Package opaque storage — report_fact_package jsonb 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("report_fact_package");
  });

  it("AD: APP은 metric_id 의미를 해석하지 않음 (service에 metric 분석 코드 없음)", async () => {
    const { readFileSync } = await import("node:fs");
    const service = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/lib/growth-report-service.ts",
      "utf-8",
    );
    // APP이 F001~F070 metric_id를 파싱/해석하는 코드가 없어야 함
    expect(service).not.toMatch(/F0[0-9]{2}/);
    expect(service).not.toContain("STROKE_TECHNIQUE");
    expect(service).not.toContain("AGREEMENT");
    expect(service).not.toContain("CONTRADICTION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AE–AF. Longitudinal History
// ─────────────────────────────────────────────────────────────────────────────

describe("AE–AF. Longitudinal History", () => {
  it("AE: getPublishedReportHistory — structured history 반환", async () => {
    const mockHistory = [
      {
        id: "gr_pub001",
        report_period: "2026-07",
        cycle_id: "grc_prev",
        product_status: "PUBLISHED",
        analysis_status: "COMPLETE",
        metric_states: { "F001": "STABLE" },
        metric_confidences: { "F001": 0.9 },
        positive_growth_signals: ["수영 자신감 향상"],
        success_conditions: null,
        support_levers: null,
        next_growth_targets: null,
        next_observation_targets: null,
        report_fact_package: { source_event_count: 12 },
        sns_summary: { headline: "이번 달 잘했어요", key_points: [], share_safe: true, supporting_claim_ids: [] },
        published_at: "2026-08-01T00:00:00Z",
        teacher_reviewed_by: "teacher_001",
        teacher_reviewed_at: "2026-07-31T00:00:00Z",
      },
    ];

    const db = makeDb({ historyRows: mockHistory }) as any;

    // getPublishedReportHistory가 호출 가능하고 배열을 반환해야 함
    const history = await getPublishedReportHistory({
      db,
      studentId: "student_001",
    });

    expect(Array.isArray(history)).toBe(true);
  });

  it("AF: multiple previous reports — history는 배열로 N개 반환 (previous_report_id 1개로 제한 안 됨)", async () => {
    const mockHistory = [
      { id: "gr_pub001", report_period: "2026-07", product_status: "PUBLISHED" },
      { id: "gr_pub002", report_period: "2026-06", product_status: "PUBLISHED" },
      { id: "gr_pub003", report_period: "2026-05", product_status: "PUBLISHED" },
    ];
    const db = makeDb({ historyRows: mockHistory }) as any;

    const history = await getPublishedReportHistory({
      db,
      studentId: "student_001",
    });

    // 배열 구조 — N개 이전 리포트 모두 반환
    expect(Array.isArray(history)).toBe(true);
    // mock은 배열을 그대로 반환
    expect(history.length).toBe(3);
    // 단일 ID 체인 구조가 아님
    const hasMultiple = history.length > 1;
    expect(hasMultiple).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AG–AH. X Mode Server-side Guard
// ─────────────────────────────────────────────────────────────────────────────

describe("AG–AH. X Mode Server-side Guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("AG: X entitlement=true + status=READY → allowed=true", async () => {
    // resolvePoolMode mock
    const xmodeModule = await import("../../lib/xmode.js");
    vi.spyOn(xmodeModule, "resolvePoolMode").mockResolvedValueOnce({
      pool_id: "pool_x",
      mode: "x",
      xmode_entitlement: true,
      xmode_config_status: "READY",
    });

    const result = await resolveReportXAccess("pool_x");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.mode).toBe("x");
    }
  });

  it("AH: X entitlement=false → allowed=false, reason=XMODE_NOT_ENTITLED", async () => {
    const xmodeModule = await import("../../lib/xmode.js");
    vi.spyOn(xmodeModule, "resolvePoolMode").mockResolvedValueOnce({
      pool_id: "pool_normal",
      mode: "normal",
      xmode_entitlement: false,
      xmode_config_status: "NOT_CONFIGURED",
    });

    const result = await resolveReportXAccess("pool_normal");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("XMODE_NOT_ENTITLED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI. Published data 삭제 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("AI. PUBLISHED data 보존", () => {
  it("AI: PUBLISHED terminal → 이후 전환 불가 (삭제 방지)", async () => {
    const db = makeDb({
      reportRow: {
        id: "gr_pub",
        product_status: "PUBLISHED",
        swimming_pool_id: "pool_test",
        deleted_at: null,
      },
    }) as any;

    await expect(
      transitionReportStatus({
        db,
        reportId: "gr_pub",
        toStatus: "APPROVED",
        actorType: "system",
        actorId: null,
      })
    ).rejects.toThrow(ReportTerminalError);
  });

  it("AI-2: checkPublishedReportXPolicy — PUBLISHED + X 만료 시에도 viewing 허용", () => {
    const policy = checkPublishedReportXPolicy(true, false); // X 만료
    expect(policy.viewAllowed).toBe(true);
  });

  it("AI-3: checkPublishedReportXPolicy — NOT_PUBLISHED → viewAllowed=false", () => {
    const policy = checkPublishedReportXPolicy(false, true);
    expect(policy.viewAllowed).toBe(false);
    if (!policy.viewAllowed) {
      expect(policy.reason).toBe("NOT_PUBLISHED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AJ. Audit transition
// ─────────────────────────────────────────────────────────────────────────────

describe("AJ. Audit", () => {
  it("AJ: 상태 전환 시 audit execute가 호출됨", async () => {
    const db = makeDb({
      reportRow: {
        id: "gr_audit",
        product_status: "ANALYZING",
        swimming_pool_id: "pool_test",
        deleted_at: null,
      },
    }) as any;

    await transitionReportStatus({
      db,
      reportId: "gr_audit",
      toStatus: "REVIEW_REQUIRED",
      actorType: "teacher",
      actorId: "teacher_001",
      reason: "analysis_complete",
    });

    // execute가 여러 번 호출됨 (SELECT FOR UPDATE + UPDATE + audit version + audit INSERT)
    expect(db._mock).toHaveBeenCalled();
    expect(db._mock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AK. Concurrent duplicate report 방어
// ─────────────────────────────────────────────────────────────────────────────

describe("AK. Concurrency Protection", () => {
  it("AK: 동일 student+cycle ON CONFLICT DO NOTHING — schema에 partial UNIQUE 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("uq_growth_reports_student_cycle");
    expect(migration).toContain("student_id, cycle_id");
    // partial unique (cycle_id IS NOT NULL AND deleted_at IS NULL)
    expect(migration).toContain("cycle_id IS NOT NULL");
  });

  it("AK-2: 동일 pool/period cycle ON CONFLICT DO NOTHING — schema에 UNIQUE 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("uq_growth_report_cycles_pool_period");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AL. Migration additive
// ─────────────────────────────────────────────────────────────────────────────

describe("AL. Additive Migration", () => {
  it("AL: migration에 DROP TABLE / DROP COLUMN 없음 (기존 테이블 보호)", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    // DROP TABLE 금지 (주석 제외)
    const lines = migration.split("\n").filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    const hasDropTable = lines.some(l => /DROP\s+TABLE/i.test(l));
    const hasDropColumn = lines.some(l => /DROP\s+COLUMN/i.test(l));
    expect(hasDropTable).toBe(false);
    expect(hasDropColumn).toBe(false);
  });

  it("AL-2: ADD COLUMN IF NOT EXISTS 패턴 사용", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/migrations/growth-report-gr1-init.ts",
      "utf-8",
    );
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AM–AO. Regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe("AM–AO. Existing APP Regression Guard", () => {
  it("AM: growth-report-service가 diary 관련 import를 하지 않음", async () => {
    const { readFileSync } = await import("node:fs");
    const service = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/lib/growth-report-service.ts",
      "utf-8",
    );
    expect(service).not.toContain("diary_notes");
    expect(service).not.toContain("class_diary");
  });

  it("AN: growth-report-service가 growth-event-service를 import하지 않음 (독립 서비스)", async () => {
    const { readFileSync } = await import("node:fs");
    const service = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/lib/growth-report-service.ts",
      "utf-8",
    );
    expect(service).not.toContain("growth-event-service");
  });

  it("AO: xmode-report-guard가 기존 xmode.ts를 재사용함 (새 fake entitlement 없음)", async () => {
    const { readFileSync } = await import("node:fs");
    const guard = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/lib/xmode-report-guard.ts",
      "utf-8",
    );
    // 기존 resolvePoolMode 재사용
    expect(guard).toContain('from "./xmode.js"');
    expect(guard).toContain("resolvePoolMode");
    // 새 fake entitlement 생성 없음
    expect(guard).not.toContain("xmode_entitlement = true");
    expect(guard).not.toContain("fakeEntitlement");
  });
});
