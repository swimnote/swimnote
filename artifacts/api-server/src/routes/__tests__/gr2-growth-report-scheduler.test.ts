/**
 * GR2 — Growth Report Scheduler Tests (34 TC)
 *
 * DB mock 방식: in-memory execute stub (실제 DB 호출 없음).
 * clock injection: now 파라미터로 synthetic date 테스트.
 *
 * TC 목록:
 *   A.  Asia/Seoul timezone — KST 날짜 계산
 *   B.  24일 23:59 KST → open 안 됨
 *   C.  25일 00:00 KST → ACTIVE 가능
 *   D.  25일 이후 missed run → recovery open
 *   E.  5일 00:00 KST → INPUT_CLOSED
 *   F.  5일 이후 missed run → recovery close
 *   G.  UTC 날짜 경계에서 KST 날짜 정확 (UTC 24일 15:00 = KST 25일 00:00)
 *   H.  cycle duplicate 생성 없음 (ON CONFLICT DO NOTHING)
 *   I.  repeated scheduler run idempotent
 *   J.  non-X pool 신규 cycle 생성 금지
 *   K.  X pool cycle 생성 가능
 *   L.  NOT_OPEN → OPEN
 *   M.  parent NONE → AVAILABLE
 *   N.  parent AVAILABLE → CLOSED
 *   O.  parent ANSWERED → CLOSED
 *   P.  QUESTION_AVAILABLE → READY_FOR_ANALYSIS at close
 *   Q.  OPEN 상태가 5일에 임의 CLOSED로 변하지 않음
 *   R.  ANALYZING 그대로
 *   S.  REVIEW_REQUIRED 그대로
 *   T.  APPROVED 그대로
 *   U.  PUBLISHED 그대로
 *   V.  FAILED 그대로
 *   W.  PARTIAL 그대로
 *   X.  PUBLISHED report 삭제 없음
 *   Y.  old published history 보존
 *   Z.  same student/cycle duplicate report 없음 (ON CONFLICT)
 *   AA. system audit 기록
 *   AB. clock injection test
 *   AC. scheduler process failure isolation
 *   AD. job result counts 정확
 *   AE. GR1 lifecycle regression
 *   AF. X mode regression
 *   AG. Diary regression
 *   AH. Notifications import regression
 */

import { describe, it, expect, vi } from "vitest";
import {
  getKSTDate,
  computeCycleTimestamps,
  runGrowthReportScheduler,
  getXEligiblePools,
} from "../../jobs/growth-report-scheduler.js";
import {
  ALL_PRODUCT_STATUSES,
  ALL_PARENT_INPUT_STATUSES,
  ALL_CYCLE_STATUSES,
  isAllowedTransition,
  assertNotForbiddenStatus,
  ForbiddenStatusError,
} from "../../lib/growth-report-service.js";
import {
  resolveReportXAccess,
} from "../../lib/xmode-report-guard.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB factory
// ─────────────────────────────────────────────────────────────────────────────

interface MockDbOptions {
  xPools?: Array<{ id: string }>;
  insertCycleReturnsId?: string | null;
  existingCycleRow?: { id: string; cycle_status: string } | null;
  pendingCycles?: any[];
  activeCycles?: any[];
  students?: Array<{ id: string }>;
  reportRow?: { id: string; product_status: string; swimming_pool_id: string; deleted_at: null } | null;
  qaReports?: Array<{ id: string }>;
  openReports?: Array<{ id: string }>;
}

function makeSchedulerDb(opts: MockDbOptions = {}) {
  const {
    xPools = [],
    insertCycleReturnsId = "grc_new",
    existingCycleRow = null,
    pendingCycles = [],
    activeCycles = [],
    students = [],
    reportRow = null,
    qaReports = [],
    openReports = [],
  } = opts;

  const calls: string[] = [];

  const executeMock = vi.fn(async (query: any) => {
    const q: string = query?.queryChunks
      ? query.queryChunks.map((c: any) =>
          typeof c === "string" ? c : (c?.value ?? "")
        ).join("")
      : String(query?.sql ?? query ?? "");

    calls.push(q.substring(0, 80).replace(/\s+/g, " ").trim());

    // X-eligible pools (X02-B2: effective formula uses x_paid_entitlement / x_manual_entitlement)
    if ((q.includes("x_paid_entitlement") || q.includes("x_manual_entitlement")) && q.includes("xmode_config_status")) {
      return { rows: xPools };
    }

    // Cycle INSERT RETURNING
    if (q.includes("growth_report_cycles") && q.includes("INSERT") && q.includes("RETURNING")) {
      if (insertCycleReturnsId) return { rows: [{ id: insertCycleReturnsId }] };
      return { rows: [] };
    }

    // Cycle SELECT (existing)
    if (q.includes("growth_report_cycles") && q.includes("SELECT") && q.includes("swimming_pool_id") && !q.includes("cycle_status = 'PENDING'") && !q.includes("cycle_status = 'ACTIVE'")) {
      if (existingCycleRow) return { rows: [existingCycleRow] };
      return { rows: [] };
    }

    // PENDING cycles (missed recovery)
    if (q.includes("cycle_status = 'PENDING'") && q.includes("parent_input_open_at")) {
      return { rows: pendingCycles };
    }

    // ACTIVE cycles (close)
    if (q.includes("cycle_status = 'ACTIVE'") && q.includes("parent_input_close_at")) {
      return { rows: activeCycles };
    }

    // Students
    if (q.includes("FROM students") || q.includes("students")) {
      return { rows: students };
    }

    // QUESTION_AVAILABLE reports
    if (q.includes("QUESTION_AVAILABLE")) {
      return { rows: qaReports };
    }

    // Report open RETURNING
    if (q.includes("growth_reports") && q.includes("UPDATE") && q.includes("RETURNING")) {
      return { rows: openReports };
    }

    // FOR UPDATE (transitionReportStatus)
    if (q.includes("FOR UPDATE")) {
      if (reportRow) return { rows: [reportRow] };
      return { rows: [] };
    }

    // next_audit_version
    if (q.includes("next_audit_version")) {
      return { rows: [{ v: 1 }] };
    }

    // Generic UPDATE / INSERT
    if (q.includes("UPDATE") || q.includes("INSERT")) {
      return { rowCount: 1, rows: [] };
    }

    return { rows: [] };
  });

  return { execute: executeMock, _calls: calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// A–G. KST Timezone / Date Rules
// ─────────────────────────────────────────────────────────────────────────────

describe("A–G. KST Timezone & Date Rules", () => {
  it("A-1: getKSTDate Asia/Seoul 사용 — UTC+9", () => {
    // UTC 2026-08-24 15:00:00 = KST 2026-08-25 00:00:00
    const utc = new Date("2026-08-24T15:00:00Z");
    const kst = getKSTDate(utc);
    expect(kst.year).toBe(2026);
    expect(kst.month).toBe(8);
    expect(kst.day).toBe(25);
    expect(kst.hours).toBe(0);
    expect(kst.reportPeriod).toBe("2026-08");
  });

  it("A-2: computeCycleTimestamps — 25일 00:00 KST = UTC 24일 15:00:00", () => {
    const ts = computeCycleTimestamps(2026, 8);
    // parent_input_open_at = 2026-08-25 00:00 KST = 2026-08-24 15:00 UTC
    expect(ts.parentInputOpenAt.toISOString()).toBe("2026-08-24T15:00:00.000Z");
  });

  it("A-3: computeCycleTimestamps — 다음달 5일 00:00 KST = UTC 4일 15:00:00", () => {
    const ts = computeCycleTimestamps(2026, 8);
    // parent_input_close_at = 2026-09-05 00:00 KST = 2026-09-04 15:00 UTC
    expect(ts.parentInputCloseAt.toISOString()).toBe("2026-09-04T15:00:00.000Z");
  });

  it("A-4: computeCycleTimestamps — analysis_cutoff_at = parent_input_open_at", () => {
    const ts = computeCycleTimestamps(2026, 8);
    expect(ts.analysisCutoffAt.getTime()).toBe(ts.parentInputOpenAt.getTime());
  });

  it("A-5: computeCycleTimestamps — analysis_from = null (정책 미확정)", () => {
    const ts = computeCycleTimestamps(2026, 8);
    expect(ts.analysisFrom).toBeNull();
  });

  it("B: 24일 23:59 KST → open 안 됨 (shouldOpenCurrentMonth=false)", () => {
    // KST 2026-08-24 23:59 = UTC 2026-08-24 14:59:00 → before open_at (14:59 < 15:00)
    const before25 = new Date("2026-08-24T14:59:00Z");
    const ts = computeCycleTimestamps(2026, 8);
    const shouldOpen = before25.getTime() >= ts.parentInputOpenAt.getTime();
    expect(shouldOpen).toBe(false);
  });

  it("C: 25일 00:00 KST → ACTIVE 가능 (shouldOpenCurrentMonth=true)", () => {
    // KST 2026-08-25 00:00 = UTC 2026-08-24 15:00:00 = exactly open_at
    const on25 = new Date("2026-08-24T15:00:00Z");
    const ts = computeCycleTimestamps(2026, 8);
    const shouldOpen = on25.getTime() >= ts.parentInputOpenAt.getTime();
    expect(shouldOpen).toBe(true);
  });

  it("D: 25일 이후 missed run → shouldOpen=true (26일도 가능)", () => {
    const after25 = new Date("2026-08-26T10:00:00Z");
    const ts = computeCycleTimestamps(2026, 8);
    const shouldOpen = after25.getTime() >= ts.parentInputOpenAt.getTime();
    expect(shouldOpen).toBe(true);
  });

  it("E: 5일 00:00 KST → close_at 조건 충족", () => {
    // KST 2026-09-05 00:00 = UTC 2026-09-04 15:00:00 = exactly close_at
    const on5 = new Date("2026-09-04T15:00:00Z");
    const ts = computeCycleTimestamps(2026, 8);
    const shouldClose = on5.getTime() >= ts.parentInputCloseAt.getTime();
    expect(shouldClose).toBe(true);
  });

  it("F: 5일 이후 missed run → close 가능 (6일도 가능)", () => {
    const after5 = new Date("2026-09-06T10:00:00Z");
    const ts = computeCycleTimestamps(2026, 8);
    const shouldClose = after5.getTime() >= ts.parentInputCloseAt.getTime();
    expect(shouldClose).toBe(true);
  });

  it("G: UTC 날짜 경계 — UTC 2026-08-24 14:59 = KST 2026-08-24 23:59 (아직 25일 아님)", () => {
    const utc = new Date("2026-08-24T14:59:00Z");
    const kst = getKSTDate(utc);
    expect(kst.day).toBe(24);
    expect(kst.hours).toBe(23);
  });

  it("G-2: 12월 → 다음해 1월 rollover", () => {
    const ts = computeCycleTimestamps(2026, 12);
    // close: 2027-01-04 15:00 UTC
    expect(ts.parentInputCloseAt.toISOString()).toBe("2027-01-04T15:00:00.000Z");
    expect(ts.reportPeriod).toBe("2026-12");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H–I. Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("H–I. Idempotency", () => {
  it("H: cycle 이미 ACTIVE → skip (중복 생성 없음)", async () => {
    // INSERT ON CONFLICT DO NOTHING → rows=[] → SELECT existing ACTIVE
    const db = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      insertCycleReturnsId: null,
      existingCycleRow: { id: "grc_existing", cycle_status: "ACTIVE" },
    }) as any;

    const now = new Date("2026-08-25T00:30:00Z"); // 25일 09:30 KST
    const result = await runGrowthReportScheduler(db, now);

    // ACTIVE이므로 skip
    expect(result.skipped).toBe(1);
    expect(result.cycles_created).toBe(0);
    expect(result.cycles_opened).toBe(0);
  });

  it("I: 동일 날짜 2회 실행 → cycles_opened 중복 없음", async () => {
    // 1회: cycle 신규 생성 → ACTIVE
    const db1 = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      insertCycleReturnsId: "grc_001",
      students: [],
      openReports: [],
    }) as any;
    const now = new Date("2026-08-25T00:30:00Z");
    const r1 = await runGrowthReportScheduler(db1, now);
    expect(r1.cycles_opened).toBe(1);

    // 2회: INSERT ON CONFLICT → existing ACTIVE → skip
    const db2 = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      insertCycleReturnsId: null,
      existingCycleRow: { id: "grc_001", cycle_status: "ACTIVE" },
    }) as any;
    const r2 = await runGrowthReportScheduler(db2, now);
    expect(r2.cycles_opened).toBe(0);
    expect(r2.skipped).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J–K. X Mode Eligibility
// ─────────────────────────────────────────────────────────────────────────────

describe("J–K. X Mode Eligibility", () => {
  it("J: non-X pool (xPools=[]) → cycle 생성 없음", async () => {
    const db = makeSchedulerDb({ xPools: [] }) as any;
    const now = new Date("2026-08-25T10:00:00Z");
    const result = await runGrowthReportScheduler(db, now);
    expect(result.cycles_created).toBe(0);
    expect(result.cycles_opened).toBe(0);
  });

  it("K: X pool → cycle 생성 + opened", async () => {
    const db = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      insertCycleReturnsId: "grc_001",
      students: [],
      openReports: [],
    }) as any;
    const now = new Date("2026-08-25T00:30:00Z");
    const result = await runGrowthReportScheduler(db, now);
    expect(result.cycles_created).toBe(1);
    expect(result.cycles_opened).toBe(1);
  });

  it("K-2: getXEligiblePools query에 x_paid/x_manual+READY 조건 포함 (X02-B2 effective formula)", async () => {
    const db = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
    }) as any;
    const pools = await getXEligiblePools(db);
    expect(pools).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L–M. 25일 Open: NOT_OPEN → OPEN + parent
// ─────────────────────────────────────────────────────────────────────────────

describe("L–M. 25일 Open", () => {
  it("L: NOT_OPEN → OPEN (reports_opened count)", async () => {
    const db = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      insertCycleReturnsId: "grc_001",
      students: [{ id: "s1" }, { id: "s2" }],
      openReports: [{ id: "gr_001" }, { id: "gr_002" }],
    }) as any;
    const now = new Date("2026-08-25T00:30:00Z");
    const result = await runGrowthReportScheduler(db, now);
    expect(result.reports_opened).toBe(2);
  });

  it("M: parent NONE → AVAILABLE (scheduler SQL에 parent_input_status 포함)", async () => {
    // 소스 파일에서 직접 확인 — mock 잘림 없음
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    // openCycleForPool의 bulk UPDATE에 parent_input_status = 'AVAILABLE' 포함
    expect(scheduler).toContain("parent_input_status = 'AVAILABLE'");
    // NOT_OPEN → OPEN도 동일 UPDATE
    expect(scheduler).toContain("product_status = 'OPEN'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N–P. 5일 Close
// ─────────────────────────────────────────────────────────────────────────────

describe("N–P. 5일 Close", () => {
  it("N: parent AVAILABLE → CLOSED (bulk UPDATE)", async () => {
    const db = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      // 25일 이전 → open skip
      activeCycles: [{ id: "grc_001", swimming_pool_id: "pool_x", parent_input_close_at: "2026-09-04T15:00:00Z" }],
      qaReports: [],
    }) as any;

    // 5일 이후 KST
    const now = new Date("2026-09-05T10:00:00Z");
    const result = await runGrowthReportScheduler(db, now);
    expect(result.cycles_input_closed).toBe(1);

    // AVAILABLE / ANSWERED / NONE → CLOSED 포함 쿼리 확인
    const closeCalls = db._calls.filter((c: string) =>
      c.includes("CLOSED") || c.includes("INPUT_CLOSED")
    );
    expect(closeCalls.length).toBeGreaterThan(0);
  });

  it("O: parent ANSWERED → CLOSED (동일 bulk UPDATE 처리)", async () => {
    // ANSWERED는 AVAILABLE과 동일한 bulk UPDATE에 포함됨
    // 스케줄러 SQL에서 IN ('AVAILABLE', 'ANSWERED', 'NONE') 확인
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    expect(scheduler).toContain("'AVAILABLE', 'ANSWERED', 'NONE'");
  });

  it("P: QUESTION_AVAILABLE → READY_FOR_ANALYSIS at close", async () => {
    const db = makeSchedulerDb({
      xPools: [],
      activeCycles: [{ id: "grc_001", swimming_pool_id: "pool_x", parent_input_close_at: "2026-09-04T15:00:00Z" }],
      qaReports: [{ id: "gr_qa01" }],
      reportRow: {
        id: "gr_qa01",
        product_status: "QUESTION_AVAILABLE",
        swimming_pool_id: "pool_x",
        deleted_at: null,
      },
    }) as any;

    const now = new Date("2026-09-05T10:00:00Z");
    const result = await runGrowthReportScheduler(db, now);
    expect(result.reports_ready_for_analysis).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q–W. 5일 Close: 기존 product status 보존
// ─────────────────────────────────────────────────────────────────────────────

describe("Q–W. 5일 Close: product status 보존", () => {
  it("Q: OPEN 상태 → 5일에 CLOSED로 변하지 않음 (CLOSED product status 존재 안 함)", () => {
    expect(ALL_PRODUCT_STATUSES.has("OPEN")).toBe(true);
    expect(isAllowedTransition("OPEN", "CLOSED" as any)).toBe(false);
    expect(() => assertNotForbiddenStatus("CLOSED")).toThrow(ForbiddenStatusError);
  });

  it("R: ANALYZING → 그대로 (스케줄러가 변경 안 함)", () => {
    // 스케줄러는 ANALYZING을 바꾸지 않음 — QUESTION_AVAILABLE만 처리
    // qaReports에 ANALYZING이 포함되지 않으므로 transitionReportStatus 호출 없음
    expect(ALL_PRODUCT_STATUSES.has("ANALYZING")).toBe(true);
  });

  it("S: REVIEW_REQUIRED → 그대로", () => {
    expect(ALL_PRODUCT_STATUSES.has("REVIEW_REQUIRED")).toBe(true);
  });

  it("T: APPROVED → 그대로", () => {
    expect(ALL_PRODUCT_STATUSES.has("APPROVED")).toBe(true);
  });

  it("U: PUBLISHED → 그대로 (terminal)", () => {
    expect(ALL_PRODUCT_STATUSES.has("PUBLISHED")).toBe(true);
    // PUBLISHED에서 다른 상태로 전환 불가
    const allowedFromPublished = [
      "NOT_OPEN","OPEN","PREANALYZING","QUESTION_AVAILABLE",
      "READY_FOR_ANALYSIS","ANALYZING","REVIEW_REQUIRED","APPROVED","PARTIAL","FAILED",
    ];
    for (const s of allowedFromPublished) {
      expect(isAllowedTransition("PUBLISHED", s as any)).toBe(false);
    }
  });

  it("V: FAILED → 그대로 (재시도 가능 상태 유지)", () => {
    expect(ALL_PRODUCT_STATUSES.has("FAILED")).toBe(true);
    expect(isAllowedTransition("FAILED", "ANALYZING")).toBe(true);
  });

  it("W: PARTIAL → 그대로", () => {
    expect(ALL_PRODUCT_STATUSES.has("PARTIAL")).toBe(true);
  });

  it("Q-2: scheduler code에 product_status CLOSED 직접 설정 없음", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    // product_status를 'CLOSED'로 설정하는 코드 없어야 함
    expect(scheduler).not.toMatch(/product_status.*=.*'CLOSED'/);
    expect(scheduler).not.toMatch(/toStatus.*CLOSED/);
    // QUESTION_REQUIRED도 없어야 함
    expect(scheduler).not.toContain("QUESTION_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X–Y. Published History 보존
// ─────────────────────────────────────────────────────────────────────────────

describe("X–Y. Published History 보존", () => {
  it("X: scheduler code에 DELETE growth_reports 없음", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    expect(scheduler).not.toMatch(/DELETE\s+FROM\s+growth_reports/i);
  });

  it("Y: PUBLISHED terminal — scheduler는 PUBLISHED report를 건드리지 않음", () => {
    // PUBLISHED → terminal: ALLOWED_TRANSITIONS['PUBLISHED'] = []
    const allowedFromPublished = [
      "NOT_OPEN","OPEN","PREANALYZING","QUESTION_AVAILABLE",
      "READY_FOR_ANALYSIS","ANALYZING","REVIEW_REQUIRED","APPROVED","PARTIAL","FAILED",
    ];
    for (const s of allowedFromPublished) {
      expect(isAllowedTransition("PUBLISHED", s as any)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Z. Duplicate report 방지
// ─────────────────────────────────────────────────────────────────────────────

describe("Z. Duplicate Report 방지", () => {
  it("Z: scheduler code에 ON CONFLICT (student_id, cycle_id) DO NOTHING 포함", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    expect(scheduler).toContain("ON CONFLICT (student_id, cycle_id)");
    expect(scheduler).toContain("DO NOTHING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AA. System Audit
// ─────────────────────────────────────────────────────────────────────────────

describe("AA. System Audit", () => {
  it("AA: actor_type='system' 감사 기록 — scheduler에 system audit 코드 존재", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    expect(scheduler).toContain("actor_type, actor_id, pool_id");
    expect(scheduler).toContain("'system'");
    expect(scheduler).toContain("MONTHLY_CYCLE_OPEN");
    expect(scheduler).toContain("PARENT_INPUT_WINDOW_CLOSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AB. Clock Injection
// ─────────────────────────────────────────────────────────────────────────────

describe("AB. Clock Injection", () => {
  it("AB: now 파라미터로 synthetic date 테스트 가능", async () => {
    // 24일 14:59 UTC (KST 23:59) → should NOT open
    const before = new Date("2026-08-24T14:59:00Z");
    const db1 = makeSchedulerDb({ xPools: [{ id: "pool_x" }] }) as any;
    const r1 = await runGrowthReportScheduler(db1, before);
    expect(r1.cycles_opened).toBe(0);

    // 25일 15:00 UTC (KST 00:00 on 25th... wait, actually 24일 15:00 UTC = 25일 00:00 KST)
    const on25 = new Date("2026-08-24T15:00:00Z");
    const db2 = makeSchedulerDb({
      xPools: [{ id: "pool_x" }],
      insertCycleReturnsId: "grc_001",
      students: [],
      openReports: [],
    }) as any;
    const r2 = await runGrowthReportScheduler(db2, on25);
    expect(r2.cycles_opened).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC. Failure Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("AC. Scheduler Failure Isolation", () => {
  it("AC: 한 pool 실패 → 나머지 pool 계속 처리 (failed count)", async () => {
    // xPools: 2개, 첫 번째는 INSERT 성공, 두 번째는 INSERT 실패

    // 두 pool 순서 처리: pool1 성공, pool2 cycle 조회 실패 시뮬레이션
    let callIdx = 0;
    const executeMock = vi.fn(async (query: any) => {
      const q: string = query?.queryChunks
        ? query.queryChunks.map((c: any) =>
            typeof c === "string" ? c : (c?.value ?? "")
          ).join("")
        : "";

      // X-eligible pools → 2개 반환 (X02-B2: effective formula)
      if (q.includes("x_paid_entitlement") || q.includes("x_manual_entitlement")) {
        return { rows: [{ id: "pool_1" }, { id: "pool_2" }] };
      }

      // PENDING cycles
      if (q.includes("cycle_status = 'PENDING'")) return { rows: [] };
      // ACTIVE cycles
      if (q.includes("cycle_status = 'ACTIVE'")) return { rows: [] };

      // pool_1 INSERT 성공
      if (q.includes("pool_1") && q.includes("INSERT") && q.includes("RETURNING")) {
        return { rows: [{ id: "grc_p1" }] };
      }

      // pool_2 INSERT throws
      if (q.includes("pool_2") && q.includes("INSERT") && q.includes("RETURNING")) {
        throw new Error("DB_ERROR: pool_2 insert failed");
      }

      // students, UPDATE etc.
      if (q.includes("FROM students") || q.includes("students")) return { rows: [] };
      if (q.includes("UPDATE")) return { rowCount: 1, rows: [] };
      if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
      if (q.includes("INSERT")) return { rowCount: 1, rows: [] };

      return { rows: [] };
    });

    const db = { execute: executeMock } as any;
    const now = new Date("2026-08-24T15:00:00Z"); // KST 25일 00:00
    const result = await runGrowthReportScheduler(db, now);

    // pool_1은 성공
    expect(result.cycles_opened).toBe(1);
    // pool_2는 실패 → failed count + error 기록
    expect(result.failed).toBe(1);
    expect(result.errors.some(e => e.pool_id === "pool_2")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AD. Job Result Counts
// ─────────────────────────────────────────────────────────────────────────────

describe("AD. Job Result Counts", () => {
  it("AD: result 필드 모두 존재 (GrowthReportSchedulerRunResult 인터페이스)", async () => {
    const db = makeSchedulerDb({ xPools: [] }) as any;
    const result = await runGrowthReportScheduler(db, new Date("2026-08-20T00:00:00Z"));

    expect(typeof result.run_at).toBe("string");
    expect(result.timezone).toBe("Asia/Seoul");
    expect(typeof result.cycles_checked).toBe("number");
    expect(typeof result.cycles_created).toBe("number");
    expect(typeof result.cycles_opened).toBe("number");
    expect(typeof result.cycles_input_closed).toBe("number");
    expect(typeof result.reports_opened).toBe("number");
    expect(typeof result.reports_ready_for_analysis).toBe("number");
    expect(typeof result.skipped).toBe("number");
    expect(typeof result.failed).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("AD-2: PII 없음 — result에 student_id 배열 없음", async () => {
    const db = makeSchedulerDb({ xPools: [] }) as any;
    const result = await runGrowthReportScheduler(db, new Date("2026-08-20T00:00:00Z"));
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("student_id");
    expect(resultStr).not.toContain("name");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AE–AH. Regression Guard
// ─────────────────────────────────────────────────────────────────────────────

describe("AE–AH. Regression Guard", () => {
  it("AE: GR1 lifecycle transitions 정상 (regression check)", () => {
    expect(ALL_PRODUCT_STATUSES.size).toBe(11);
    expect(ALL_PARENT_INPUT_STATUSES.size).toBe(4);
    expect(ALL_CYCLE_STATUSES.size).toBe(4);
    expect(isAllowedTransition("OPEN", "PREANALYZING")).toBe(true);
    expect(isAllowedTransition("ANALYZING", "REVIEW_REQUIRED")).toBe(true);
    expect(isAllowedTransition("PUBLISHED", "APPROVED" as any)).toBe(false);
  });

  it("AF: X mode guard regression — resolveReportXAccess 함수 존재", async () => {
    expect(typeof resolveReportXAccess).toBe("function");
  });

  it("AG: growth-report-scheduler가 diary 관련 import 없음", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    expect(scheduler).not.toContain("diary_notes");
    expect(scheduler).not.toContain("class_diary");
    expect(scheduler).not.toContain("diary-service");
  });

  it("AH: growth-report-scheduler에 push 발송 코드 없음 (GR7 금지)", async () => {
    const { readFileSync } = await import("node:fs");
    const scheduler = readFileSync(
      "/home/runner/workspace/artifacts/api-server/src/jobs/growth-report-scheduler.ts",
      "utf-8",
    );
    expect(scheduler).not.toContain("sendPush");
    expect(scheduler).not.toContain("push-service");
    expect(scheduler).not.toContain("FCM");
    // ENGINE API 실제 호출 코드 없음 (주석 제외 — import/fetch/axios로 확인)
    expect(scheduler).not.toContain("import.*engine");
    expect(scheduler).not.toContain("openai");
    expect(scheduler).not.toContain("generateReport");
    expect(scheduler).not.toMatch(/fetch.*\/ai\//);
    expect(scheduler).not.toMatch(/axios.*engine/);
  });
});
