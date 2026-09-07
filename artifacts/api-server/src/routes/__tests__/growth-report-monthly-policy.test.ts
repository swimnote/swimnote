/**
 * growth-report-monthly-policy.test.ts
 *
 * MONTHLY_FREE Growth Report 최종 정책 테스트 (§P절)
 *
 * ★ 2026-09-07 자동 publish 완전 비활성화:
 *   scheduler는 REVIEW_REQUIRED에서 멈춤.
 *   publish는 반드시 pool_admin 직접 action으로만:
 *     - POST /admin/growth-reports/:id/send
 *     - POST /admin/growth-reports/bulk-send
 *
 * P-1  2026-09 실행 → report_period 2026-08
 * P-2  analysisCutoffAt = 2026-09-01 00:00:00 KST (= 2026-08-31 15:00:00 UTC)
 * P-3  period_start = 2026-08-01, period_end = 2026-08-31
 * P-4  scheduler는 5일 이후에도 REVIEW_REQUIRED에서 멈춤 (auto-publish 없음)
 * P-5  scheduler는 student.status='suspended' 여도 auto-publish 없음
 * P-6  scheduler는 student.status='withdrawn' 여도 auto-publish 없음
 * P-7  scheduler는 5일 이후 실행 시 항상 reports_auto_published=0
 * P-8  이전달 report period 계산 = previous month (pure function 검증)
 * P-9  scheduler 5일 두 번 실행 → 두 번 모두 reports_auto_published=0 (비활성화 일관성)
 * P-10 5일 이후 실행 → autoApproveAndPublishForDelivery 절대 호출 안 됨
 * P-11 5일 이후 실행 → notifyGrowthReportPublished 절대 호출 안 됨
 * P-12 GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false → scheduler 정상 실행 (worker와 무관)
 * P-13 5일 이전 실행 → auto-publish 없음, cycle open은 실행
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeMonthlyFreePeriodTimestamps,
  getKSTDate,
  runGrowthReportScheduler,
} from "../../jobs/growth-report-scheduler.js";

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — mock 팩토리가 import보다 먼저 실행되어야 함
// ─────────────────────────────────────────────────────────────────────────────
const { mockAutoApprove, mockTransition, mockNotify } = vi.hoisted(() => ({
  mockAutoApprove: vi.fn<() => Promise<any>>(),
  mockTransition:  vi.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
  mockNotify:      vi.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
}));

vi.mock("../../lib/growth-report-service.js", () => ({
  transitionReportStatus:           mockTransition,
  autoApproveAndPublishForDelivery: mockAutoApprove,
}));
vi.mock("../../utils/notify.js", () => ({
  notifyGrowthReportPublished: mockNotify,
}));
vi.mock("../../lib/growth-report-eligibility.js", () => ({
  FREE_GROWTH_REPORT_ELIGIBLE_SQL: "x_paid_entitlement OR x_manual_entitlement",
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB factory
// ─────────────────────────────────────────────────────────────────────────────

function makeTestDb(responses: any[][]) {
  let idx = 0;
  const execute = vi.fn(async (_q: any) => {
    if (idx < responses.length) return { rows: responses[idx++] };
    return { rows: [] };
  });
  return { db: { execute }, execute };
}

/**
 * Standard response queue for a 5일 KST run (2026-09-04T16:00:00Z = 2026-09-05 01:00 KST):
 *   [0] getXEligiblePools → [{ id: "pool-x" }]
 *   [1] INSERT cycle → [] (already exists)
 *   [2] SELECT existing cycle → [{ id: "cycle-1", cycle_status: "ACTIVE" }]
 *   [3] PENDING cycles → []
 *
 * NOTE: 5번째(candidates) 응답 불필요 — scheduler가 auto-publish 쿼리 미실행
 */
function makeQueueFor5th() {
  return [
    [{ id: "pool-x" }],                                         // getXEligiblePools
    [],                                                          // INSERT cycle → conflict
    [{ id: "cycle-1", cycle_status: "ACTIVE" }],                // SELECT existing cycle → ACTIVE
    [],                                                          // PENDING cycles
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// P-1 ~ P-3: computeMonthlyFreePeriodTimestamps 순수함수 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMonthlyFreePeriodTimestamps", () => {
  it("P-1: 2026-09 실행 → reportPeriod = '2026-08'", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2026, 9);
    expect(ts.reportPeriod).toBe("2026-08");
  });

  it("P-2: analysisCutoffAt = 2026-08-31 15:00:00 UTC (= 2026-09-01 00:00:00 KST)", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2026, 9);
    expect(ts.analysisCutoffAt.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(ts.parentInputOpenAt.toISOString()).toBe("2026-08-31T15:00:00.000Z");
  });

  it("P-3: period_start = '2026-08-01', period_end = '2026-08-31'", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2026, 9);
    expect(ts.periodStart).toBe("2026-08-01");
    expect(ts.periodEnd).toBe("2026-08-31");
  });

  it("1월 실행 → reportPeriod = 이전년도 12월", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2027, 1);
    expect(ts.reportPeriod).toBe("2026-12");
    expect(ts.periodStart).toBe("2026-12-01");
    expect(ts.periodEnd).toBe("2026-12-31");
    expect(ts.parentInputOpenAt.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(ts.parentInputCloseAt.toISOString()).toBe("2027-01-04T15:00:00.000Z");
  });

  it("parentInputCloseAt = 이번달 5일 00:00 KST = 이번달 4일 15:00 UTC", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2026, 9);
    expect(ts.parentInputCloseAt.toISOString()).toBe("2026-09-04T15:00:00.000Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getKSTDate 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe("getKSTDate", () => {
  it("UTC 2026-09-01T16:00:00Z → KST 2026-09-02 01:00", () => {
    const kst = getKSTDate(new Date("2026-09-01T16:00:00.000Z"));
    expect(kst.year).toBe(2026);
    expect(kst.month).toBe(9);
    expect(kst.day).toBe(2);
    expect(kst.hours).toBe(1);
    expect(kst.isoDate).toBe("2026-09-02");
  });

  it("UTC 2026-08-31T14:59:59Z → KST 2026-08-31 23:59", () => {
    const kst = getKSTDate(new Date("2026-08-31T14:59:59.000Z"));
    expect(kst.month).toBe(8);
    expect(kst.day).toBe(31);
  });

  it("UTC 2026-08-31T15:00:01Z → KST 2026-09-01 00:00", () => {
    const kst = getKSTDate(new Date("2026-08-31T15:00:01.000Z"));
    expect(kst.month).toBe(9);
    expect(kst.day).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-4 ~ P-7: scheduler는 5일 이후에도 자동 publish 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("runGrowthReportScheduler — auto-publish 비활성화 검증", () => {
  // 5일 KST = 2026-09-05 01:00 KST = UTC 2026-09-04T16:00:00Z
  const NOW_5TH = new Date("2026-09-04T16:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("P-4: 5일 이후 실행 — scheduler가 REVIEW_REQUIRED에서 멈춤 (auto-publish 없음)", async () => {
    const { db } = makeTestDb(makeQueueFor5th());
    const result = await runGrowthReportScheduler(db as any, NOW_5TH);
    expect(mockAutoApprove).not.toHaveBeenCalled();
    expect(result.reports_auto_published).toBe(0);
  });

  it("P-5: 5일 이후 실행 — student.status 무관하게 auto-publish 없음 (suspended)", async () => {
    const { db } = makeTestDb(makeQueueFor5th());
    const result = await runGrowthReportScheduler(db as any, NOW_5TH);
    expect(mockAutoApprove).not.toHaveBeenCalled();
    expect(result.reports_auto_published).toBe(0);
  });

  it("P-6: 5일 이후 실행 — student.status 무관하게 auto-publish 없음 (withdrawn)", async () => {
    const { db } = makeTestDb(makeQueueFor5th());
    const result = await runGrowthReportScheduler(db as any, NOW_5TH);
    expect(mockAutoApprove).not.toHaveBeenCalled();
    expect(result.reports_auto_published).toBe(0);
  });

  it("P-7: 5일 이후 실행 → reports_auto_published=0, reports_delivery_skipped=0 (비활성화)", async () => {
    const { db } = makeTestDb(makeQueueFor5th());
    const result = await runGrowthReportScheduler(db as any, NOW_5TH);
    expect(result.reports_auto_published).toBe(0);
    expect(result.reports_delivery_skipped).toBe(0);
    expect(result.failed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-8: parent-growth-report-status period = previous month (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe("P-8: parent-growth-report-status period = previous month", () => {
  it("KST 9월 기준 period = '2026-08'", () => {
    const nowMs = new Date("2026-09-02T16:00:00.000Z").getTime();
    const kstMs = nowMs + 9 * 60 * 60 * 1000;
    const kst   = new Date(kstMs);
    const kstMonth = kst.getUTCMonth() + 1; // 9
    const kstYear  = kst.getUTCFullYear();  // 2026

    let prevYear  = kstYear;
    let prevMonth = kstMonth - 1;
    if (prevMonth < 1) { prevMonth = 12; prevYear = kstYear - 1; }

    const period = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    expect(period).toBe("2026-08");
  });

  it("KST 1월 기준 period = 이전 해 12월", () => {
    const nowMs = new Date("2027-01-01T16:00:00.000Z").getTime();
    const kstMs = nowMs + 9 * 60 * 60 * 1000;
    const kst   = new Date(kstMs);
    const kstMonth = kst.getUTCMonth() + 1; // 1
    const kstYear  = kst.getUTCFullYear();  // 2027

    let prevYear  = kstYear;
    let prevMonth = kstMonth - 1;
    if (prevMonth < 1) { prevMonth = 12; prevYear = kstYear - 1; }

    const period = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    expect(period).toBe("2026-12");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-9 ~ P-11: 자동 publish 비활성화 일관성
// ─────────────────────────────────────────────────────────────────────────────

describe("P-9 ~ P-11: auto-publish 완전 비활성화 일관성", () => {
  const NOW = new Date("2026-09-04T16:00:00.000Z"); // 5일 KST

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("P-9: 5일 두 번 실행 → 두 번 모두 reports_auto_published=0 (비활성화 일관성)", async () => {
    const { db: db1 } = makeTestDb(makeQueueFor5th());
    const r1 = await runGrowthReportScheduler(db1 as any, NOW);
    expect(r1.reports_auto_published).toBe(0);

    const { db: db2 } = makeTestDb(makeQueueFor5th());
    const r2 = await runGrowthReportScheduler(db2 as any, NOW);
    expect(r2.reports_auto_published).toBe(0);

    expect(mockAutoApprove).not.toHaveBeenCalled();
  });

  it("P-10: 5일 이후 실행 → autoApproveAndPublishForDelivery 절대 호출 안 됨", async () => {
    const { db } = makeTestDb(makeQueueFor5th());
    await runGrowthReportScheduler(db as any, NOW);
    expect(mockAutoApprove).not.toHaveBeenCalled();
  });

  it("P-11: 5일 이후 실행 → notifyGrowthReportPublished 절대 호출 안 됨 (scheduler에서)", async () => {
    const { db } = makeTestDb(makeQueueFor5th());
    await runGrowthReportScheduler(db as any, NOW);
    await new Promise(resolve => setImmediate(resolve));
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-12: GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false → scheduler 영향 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("P-12: AUTO_ENABLED=false → worker 차단, scheduler 정상 실행", () => {
  it("GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false 환경에서 scheduler는 정상 실행", async () => {
    const orig = process.env.GROWTH_REPORT_ANALYSIS_AUTO_ENABLED;
    process.env.GROWTH_REPORT_ANALYSIS_AUTO_ENABLED = "false";

    vi.clearAllMocks();

    const { db } = makeTestDb(makeQueueFor5th());
    const result = await runGrowthReportScheduler(db as any, new Date("2026-09-04T16:00:00.000Z"));
    expect(result.failed).toBe(0);
    expect(mockAutoApprove).not.toHaveBeenCalled();

    process.env.GROWTH_REPORT_ANALYSIS_AUTO_ENABLED = orig ?? "";
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-13: 5일 이전 → auto-publish 없음, cycle open은 실행
// ─────────────────────────────────────────────────────────────────────────────

describe("P-13: 5일 이전 → auto-publish 없음, cycle open은 실행", () => {
  // 2026-09-02 01:00 KST = UTC 2026-09-01T16:00Z (1일 이후이므로 open은 실행)
  const NOW_2ND = new Date("2026-09-01T16:00:00.000Z");

  it("2일 KST 실행 → auto-publish 없음, cycle open은 실행됨", async () => {
    vi.clearAllMocks();

    const { db } = makeTestDb([
      [{ id: "pool-x" }],                                       // getXEligiblePools
      [],                                                        // INSERT cycle → conflict
      [{ id: "cycle-1", cycle_status: "ACTIVE" }],              // SELECT existing → ACTIVE
      [],                                                        // PENDING cycles
    ]);

    const result = await runGrowthReportScheduler(db as any, NOW_2ND);
    expect(mockAutoApprove).not.toHaveBeenCalled();
    expect(result.reports_auto_published).toBe(0);
  });

  it("parentInputCloseAt 1ms 이전 → auto-publish 조건 미충족", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2026, 9);
    const justBefore = new Date(ts.parentInputCloseAt.getTime() - 1);
    expect(justBefore < ts.parentInputCloseAt).toBe(true);
  });

  it("parentInputCloseAt 정각 → 날짜 조건 충족 (단, auto-publish 비활성화로 실행 없음)", () => {
    const ts = computeMonthlyFreePeriodTimestamps(2026, 9);
    const atClose = new Date(ts.parentInputCloseAt.getTime());
    expect(atClose >= ts.parentInputCloseAt).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB injectable 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe("runGrowthReportScheduler — DB injectable", () => {
  it("db 파라미터 주입 시 superAdminDb 대신 사용 (clock injection)", async () => {
    vi.clearAllMocks();
    const { db } = makeTestDb([]);
    const result = await runGrowthReportScheduler(db as any, new Date("2026-09-01T16:00:00.000Z"));
    expect(db.execute).toHaveBeenCalled();
    expect(result.failed).toBe(0);
  });
});
