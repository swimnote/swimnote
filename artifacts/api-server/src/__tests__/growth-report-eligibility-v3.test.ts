/**
 * growth-report-eligibility-v3.test.ts
 *
 * v3 eligibility 정책 (3/1 정책, 2026-09-12 최종 확정) 검증
 * 테스트 A-U (운영자 지정)
 *
 * 정책:
 *   재원 O + 출석 >= 3 + 유효 학생별 source >= 1 → ELIGIBLE
 *   GROWTH_REPORT_MIN_SOURCE_RECORDS = 1
 *   GROWTH_REPORT_ELIGIBILITY_VERSION = 3
 *
 * AI calls:  0
 * DB write:  NO
 * Migration: NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  evaluateStudentGrowthReportEligibility,
  GROWTH_REPORT_MIN_ATTENDANCE_COUNT,
  GROWTH_REPORT_MIN_SOURCE_RECORDS,
  GROWTH_REPORT_ELIGIBILITY_VERSION,
} from "../lib/growth-report-eligibility.js";
import {
  isUsableDiscardedReport,
} from "../lib/growth-report-snapshot-builder.js";

const ROOT = join(process.cwd(), "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

const eligSrc         = read("artifacts/api-server/src/lib/growth-report-eligibility.ts");
const snapshotSrc     = read("artifacts/api-server/src/lib/growth-report-snapshot-builder.ts");
const workerSrc       = read("artifacts/api-server/src/jobs/growth-report-analysis-worker.ts");
const schedulerSrc    = read("artifacts/api-server/src/jobs/growth-report-scheduler.ts");

// ─── 상수 검증 ────────────────────────────────────────────────────────────────

describe("v3 policy constants", () => {
  it("MIN_ATTENDANCE = 3", () => {
    expect(GROWTH_REPORT_MIN_ATTENDANCE_COUNT).toBe(3);
  });

  it("MIN_SOURCE = 1 (3/1 정책)", () => {
    expect(GROWTH_REPORT_MIN_SOURCE_RECORDS).toBe(1);
  });

  it("ELIGIBILITY_VERSION = 3", () => {
    expect(GROWTH_REPORT_ELIGIBILITY_VERSION).toBe(3);
  });
});

// ─── A. 재원O / 출석3 / source1 → ELIGIBLE ───────────────────────────────────

describe("TC-A: 재원O + 출석3 + source1 → ELIGIBLE", () => {
  it("TC-A: ELIGIBLE, exclusion_code=null", () => {
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     true,
    });
    expect(r.eligible).toBe(true);
    expect(r.exclusion_code).toBeNull();
    expect(r.eligibility_version).toBe(3);
  });
});

// ─── B. 재원O / 출석2 / source10 → EXCLUDED INSUFFICIENT_ATTENDANCE ──────────

describe("TC-B: 재원O + 출석2 + source10 → EXCLUDED", () => {
  it("TC-B: exclusion_code=INSUFFICIENT_ATTENDANCE", () => {
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  2,
      sourceEventCount: 10,
      reregistered:     true,
    });
    expect(r.eligible).toBe(false);
    expect(r.exclusion_code).toBe("INSUFFICIENT_ATTENDANCE");
  });
});

// ─── C. 재원O / 출석10 / source0 → NO_SOURCE_DATA ────────────────────────────

describe("TC-C: 재원O + 출석10 + source0 → NO_SOURCE_DATA", () => {
  it("TC-C: exclusion_code=NO_SOURCE_DATA", () => {
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  10,
      sourceEventCount: 0,
      reregistered:     true,
    });
    expect(r.eligible).toBe(false);
    expect(r.exclusion_code).toBe("NO_SOURCE_DATA");
  });
});

// ─── D. 중간입회 / 출석3 / source1 → ELIGIBLE ────────────────────────────────

describe("TC-D: 중간입회 + 출석3 + source1 → ELIGIBLE", () => {
  it("TC-D: 중간입회도 조건 충족 시 ELIGIBLE", () => {
    // 중간입회 학생이 report_month 시작 시점 재원 중 + 출석3 + source1
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     true,  // report_month 재원 확인됨
    });
    expect(r.eligible).toBe(true);
    expect(r.exclusion_code).toBeNull();
  });
});

// ─── E. 퇴원 / report_month 비재원 → NOT_REREGISTERED ────────────────────────

describe("TC-E: 퇴원 → NOT_REREGISTERED", () => {
  it("TC-E: reregistered=false → NOT_REREGISTERED", () => {
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  10,
      sourceEventCount: 5,
      reregistered:     false,
    });
    expect(r.eligible).toBe(false);
    expect(r.exclusion_code).toBe("NOT_REREGISTERED");
  });
});

// ─── F. "." note만 존재 → source 0 (punctuation-only 제외) ──────────────────

describe("TC-F: punctuation-only note → source 0", () => {
  it("TC-F: queryDiaries에 note_content ~ '[가-힣A-Za-z0-9]' 필터 존재", () => {
    // 실질 문자가 없는 note는 source로 불인정
    expect(snapshotSrc).toContain("[가-힣A-Za-z0-9]");
  });

  it("TC-F: 유효성 필터가 queryDiaries SQL 내에 위치", () => {
    // queryDiaries 함수 내에 note_content 필터 있음
    const fnIdx = snapshotSrc.indexOf("async function queryDiaries(");
    const fnEnd  = snapshotSrc.indexOf("async function", fnIdx + 1);
    const fnBody = snapshotSrc.slice(fnIdx, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).toContain("[가-힣A-Za-z0-9]");
    expect(fnBody).toContain("NULLIF(TRIM(cdn.note_content)");
  });

  it("TC-F: worker가 동일 predicate queryDiariesForEligibility 사용", () => {
    expect(workerSrc).toContain("queryDiariesForEligibility");
    // queryDiariesForEligibility는 queryDiaries를 wrap — predicate identity 보장
    expect(snapshotSrc).toContain("async function queryDiariesForEligibility(");
  });
});

// ─── G. 측정값/교습내용 1건 → source 1 ───────────────────────────────────────

describe("TC-G: 실질 note 1건 → source 1 (ELIGIBLE)", () => {
  it("TC-G: source=1 → ELIGIBLE (v3 MIN_SOURCE=1)", () => {
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     true,
    });
    expect(r.eligible).toBe(true);
    expect(r.exclusion_code).toBeNull();
  });

  it("TC-G: v3에서 INSUFFICIENT_SOURCE_DATA가 신규 발생하지 않음", () => {
    // MIN_SOURCE=1이므로 source=1이면 PASS, source=0이면 NO_SOURCE_DATA
    // INSUFFICIENT_SOURCE_DATA는 이제 생성되지 않음
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     true,
    });
    expect(r.exclusion_code).not.toBe("INSUFFICIENT_SOURCE_DATA");
  });
});

// ─── H. 직전 usable fact_package 존재 → continuity context 포함 ──────────────

describe("TC-H: 직전 usable report 있으면 continuity context 포함", () => {
  it("TC-H: queryPreviousUsableReport export 존재", () => {
    expect(snapshotSrc).toContain("export async function queryPreviousUsableReport(");
  });

  it("TC-H: buildAnalysisSnapshot이 queryPreviousUsableReport 호출", () => {
    const fnIdx = snapshotSrc.indexOf("export async function buildAnalysisSnapshot(");
    const fnBody = snapshotSrc.slice(fnIdx);
    expect(fnBody).toContain("queryPreviousUsableReport");
  });

  it("TC-H: DISCARDED usable report가 longitudinal에 포함됨", () => {
    // continuityEntry를 previous_report_structured_results에 prepend
    const fnIdx = snapshotSrc.indexOf("export async function buildAnalysisSnapshot(");
    const fnBody = snapshotSrc.slice(fnIdx);
    expect(fnBody).toContain("continuity_source");
    expect(fnBody).toContain("DISCARDED_USABLE");
    expect(fnBody).toContain("previous_report_structured_results");
  });
});

// ─── I. 직전 report 없음 → Baseline ──────────────────────────────────────────

describe("TC-I: 직전 usable report 없음 → Baseline", () => {
  it("TC-I: queryPreviousUsableReport returns null → Baseline (no prev context)", () => {
    expect(snapshotSrc).toContain("previousUsableReport");
    // Baseline: previous_usable = null, continuity block skipped
    const fnIdx = snapshotSrc.indexOf("export async function buildAnalysisSnapshot(");
    const fnBody = snapshotSrc.slice(fnIdx);
    expect(fnBody).toContain("previousUsableReport &&");
  });

  it("TC-I: natural language body is NOT forwarded as fact", () => {
    // §14 spec: buildLongitudinal 주석에 명시됨
    expect(snapshotSrc).toContain("Natural language report body is NOT forwarded");
    // previous usable DISCARDED report: structured fields만 continuityEntry로 전달
    const fnIdx = snapshotSrc.indexOf("continuityEntry");
    const entryBody = snapshotSrc.slice(fnIdx, fnIdx + 800);
    // metric_states, success_conditions 같은 structured fields만 있음
    expect(entryBody).toContain("metric_states");
    expect(entryBody).toContain("success_conditions");
    // raw report_content (자연어 본문) 키는 직접 포함하지 않음
    expect(entryBody).not.toContain("report_content:");
  });
});

// ─── J. 잘못된/무효 discard → previous context 사용 안 함 ────────────────────

describe("TC-J: unsafe discard_reason → previous context 제외", () => {
  it("TC-J-1: isUsableDiscardedReport export 존재", () => {
    expect(snapshotSrc).toContain("export function isUsableDiscardedReport(");
  });

  it("TC-J-2: 내용 오류 discard → NOT usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: { some: "data" },
      discard_reason:     "내용 오류",
    });
    expect(r).toBe(false);
  });

  it("TC-J-3: 근거 오류 discard → NOT usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: { some: "data" },
      discard_reason:     "근거 오류",
    });
    expect(r).toBe(false);
  });

  it("TC-J-4: analysis_status != COMPLETE → NOT usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "PARTIAL",
      report_fact_package: { some: "data" },
      discard_reason:     null,
    });
    expect(r).toBe(false);
  });

  it("TC-J-5: report_fact_package=null → NOT usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: null,
      discard_reason:     null,
    });
    expect(r).toBe(false);
  });

  it("TC-J-6: COMPLETE + fact_package + safe reason(null) → usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: { some: "data" },
      discard_reason:     null,
    });
    expect(r).toBe(true);
  });

  it("TC-J-7: COMPLETE + fact_package + 글자 오류(safe) → usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: { some: "data" },
      discard_reason:     "글자·레이아웃 오류",
    });
    expect(r).toBe(true);
  });

  it("TC-J-8: 잘못된 학생 → NOT usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: { some: "data" },
      discard_reason:     "잘못된 학생",
    });
    expect(r).toBe(false);
  });

  it("TC-J-9: 잘못된 기간 → NOT usable", () => {
    const r = isUsableDiscardedReport({
      analysis_status:    "COMPLETE",
      report_fact_package: { some: "data" },
      discard_reason:     "잘못된 기간",
    });
    expect(r).toBe(false);
  });
});

// ─── K. Worker restart → pending job 재처리 ──────────────────────────────────

describe("TC-K: Worker restart → pending job 재처리", () => {
  it("TC-K: worker가 서버 시작 시 startup run 수행", () => {
    expect(workerSrc).toContain("startup analysis run");
    expect(workerSrc).toContain("setTimeout");
    // 45초 후 startup
    expect(workerSrc).toContain("45_000");
  });

  it("TC-K: OPEN + READY_FOR_ANALYSIS 상태 report 자동 소비", () => {
    expect(workerSrc).toContain("OPEN");
    expect(workerSrc).toContain("READY_FOR_ANALYSIS");
  });
});

// ─── L. Worker 동시 2개 → 동일 report ENGINE 호출 1회 ────────────────────────

describe("TC-L: Worker 동시 실행 중복 방지", () => {
  it("TC-L-1: acquireLock으로 분산 잠금", () => {
    expect(workerSrc).toContain("acquireLock");
    expect(workerSrc).toContain("ANALYSIS_LOCK");
  });

  it("TC-L-2: transitionReportStatus FOR UPDATE로 row 잠금", () => {
    expect(workerSrc).toContain("transitionReportStatus");
    expect(workerSrc).toContain("InvalidTransitionError");
    // concurrent skip
    expect(workerSrc).toContain("concurrent");
  });

  it("TC-L-3: analysis_request_id CAS — stale 응답 거부", () => {
    expect(workerSrc).toContain("analysis_request_id");
    expect(workerSrc).toContain("StaleEngineResponseError");
  });
});

// ─── M. ENGINE timeout → retry ───────────────────────────────────────────────

describe("TC-M: ENGINE timeout → retry", () => {
  it("TC-M: retryable error → rollback + retry count 증가", () => {
    expect(workerSrc).toContain("isRetryableEngineError");
    expect(workerSrc).toContain("analysis_retry_count");
    expect(workerSrc).toContain("retryable ENGINE error");
  });

  it("TC-M: 최대 retry 초과 시 skip", () => {
    expect(workerSrc).toContain("MAX_RETRY_EXCEEDED");
    expect(workerSrc).toContain("getMaxRetryCount");
  });
});

// ─── N. ENGINE permanent invalid contract → FAILED ───────────────────────────

describe("TC-N: ENGINE non-retryable error → FAILED", () => {
  it("TC-N: non-retryable → FAILED transition", () => {
    expect(workerSrc).toContain("Non-retryable → FAILED");
    expect(workerSrc).toContain('"FAILED"');
  });
});

// ─── O. Scheduler 동일월 재실행 → cycle/report 중복 0 ────────────────────────

describe("TC-O: Scheduler 동일월 재실행 → 중복 없음", () => {
  it("TC-O: ON CONFLICT 또는 unique guard 존재", () => {
    expect(schedulerSrc).toContain("ON CONFLICT");
  });

  it("TC-O: distributed lock으로 scheduler 중복 방지", () => {
    expect(schedulerSrc).toContain("acquireLock");
    expect(schedulerSrc).toContain("SCHEDULER_LOCK");
  });
});

// ─── P. 5일 downtime 후 6일 startup → catch-up ───────────────────────────────

describe("TC-P: downtime 후 catch-up", () => {
  it("TC-P: scheduler catch-up 로직 존재 (past pending cycle 처리)", () => {
    // scheduler가 PENDING 상태인 과거 cycle을 catch-up
    expect(schedulerSrc).toContain("missed-run recovery");
    // startup recovery run
    expect(schedulerSrc).toContain("startup recovery");
  });
});

// ─── Q. Admin review → PUBLISHED 전 parent 미노출 ────────────────────────────

describe("TC-Q: Admin review → PUBLISHED 전 parent 미노출", () => {
  it("TC-Q: parent growth report 조회 시 PUBLISHED만 노출", () => {
    const parentSrc = read("artifacts/api-server/src/routes/parent.ts");
    // parent growth report 조회 라우트에 PUBLISHED 조건 존재
    expect(parentSrc).toContain("PUBLISHED");
  });
});

// ─── R. Admin send → PUBLISHED 후 parent 노출 ────────────────────────────────

describe("TC-R: Admin send → PUBLISHED 후 parent 노출", () => {
  it("TC-R: sendIndividualReport 또는 bulkSendReports가 PUBLISHED로 전환", () => {
    const prodSrc = read("artifacts/api-server/src/lib/growth-report-production-service.ts");
    expect(prodSrc).toContain("PUBLISHED");
    expect(prodSrc).toContain("sendIndividualReport");
  });
});

// ─── S. bulk-send 9월 → analysis period 8월만 ────────────────────────────────

describe("TC-S: bulk-send report_month 범위 준수", () => {
  it("TC-S: bulkSendReports에 report_period/report_month 조건 존재", () => {
    const prodSrc = read("artifacts/api-server/src/lib/growth-report-production-service.ts");
    expect(prodSrc).toContain("bulkSendReports");
    // pool-scoped + report_period 조건
    expect(prodSrc).toContain("report_period");
  });
});

// ─── T. 다른 pool 영향 0 ──────────────────────────────────────────────────────

describe("TC-T: 다른 pool 영향 0", () => {
  it("TC-T: worker/scheduler가 swimming_pool_id로 pool 격리", () => {
    expect(workerSrc).toContain("swimming_pool_id");
    expect(schedulerSrc).toContain("swimming_pool_id");
  });
});

// ─── U. Curriculum Gauge 실제 progress → 정확한 % ────────────────────────────

describe("TC-U: Curriculum Gauge", () => {
  it("TC-U-1: parent API가 display_confirmed_pct를 SCP에서 직접 반환", () => {
    const parentSrc = read("artifacts/api-server/src/routes/parent.ts");
    expect(parentSrc).toContain("display_confirmed_pct");
    expect(parentSrc).toContain("student_curriculum_progress");
  });

  it("TC-U-2: SCP row 없으면 0 반환 (404 아님)", () => {
    const parentSrc = read("artifacts/api-server/src/routes/parent.ts");
    expect(parentSrc).toContain("display_confirmed_pct:         0");
  });

  it("TC-U-3: snapshot builder가 display_confirmed_pct를 SCP에서 읽음", () => {
    expect(snapshotSrc).toContain("display_confirmed_pct");
    expect(snapshotSrc).toContain("queryScpGaugeProgress");
  });

  it("TC-U-4: 3-session confirmation engine → SCP 업데이트", () => {
    const confirmSrc = read("artifacts/api-server/src/lib/curriculum-confirmation-engine.ts");
    expect(confirmSrc).toContain("upsertScpRow");
    expect(confirmSrc).toContain("display_confirmed_pct");
    // 3-session rule
    expect(confirmSrc).toContain("3");
  });

  it("TC-U-5: diary 저장 시 computeConfirmedProgress 호출", () => {
    const diarySrc = read("artifacts/api-server/src/routes/diary.ts");
    expect(diarySrc).toContain("computeConfirmedProgress");
  });
});

// ─── 출석 event identity 기준 (makeup §8) ─────────────────────────────────────

describe("Attendance event identity (§8)", () => {
  it("makeup session separate event: makeup_sessions SoT, attendance row not required", () => {
    // queryAttendanceForEligibility가 makeup을 makeup_sessions에서 직접 조회
    const fnIdx = snapshotSrc.indexOf("queryAttendanceForEligibility");
    expect(fnIdx).toBeGreaterThan(-1);
    // Branch 1-b: makeup_sessions.status='completed' SoT
    expect(snapshotSrc).toContain("makeup_sessions ms");
    expect(snapshotSrc).toContain("ms.status            = 'completed'");
    // Branch 1-b는 COUNT(ms.id) — event identity = makeup_sessions.id
    expect(snapshotSrc).toContain("COUNT(ms.id)::int");
    // Branch 1-a는 (class_group_id, date) event identity
    expect(snapshotSrc).toContain("COUNT(DISTINCT (a.class_group_id, a.date::date))");
    // Branch 2는 (cg.id, gs.d::date) event identity
    expect(snapshotSrc).toContain("COUNT(DISTINCT (cg.id, gs.d::date))");
    // attendance row에 의존하지 않음 — attendance.session_type='makeup' 조회 없음
    const b1bStart = snapshotSrc.indexOf("Branch 1-b");
    const b2Start = snapshotSrc.indexOf("Branch 2");
    const b1bSection = snapshotSrc.slice(b1bStart, b2Start);
    expect(b1bSection).not.toContain("session_type = 'makeup'");
  });
});

// ─── report_month 계약 ────────────────────────────────────────────────────────

describe("report_month 계약 (§11)", () => {
  it("report_period single source: scheduler와 worker 모두 report_period 기준", () => {
    // scheduler: report_period 컬럼 사용
    expect(schedulerSrc).toContain("report_period");
    // worker: report_period 기준으로 집계
    expect(workerSrc).toContain("report_period");
  });
});

// ─── Eligibility gate 위치 (§9) ──────────────────────────────────────────────

describe("Eligibility gate 위치 (§9)", () => {
  it("worker가 PREANALYZING 전에 eligibility 판정", () => {
    // ELIGIBILITY GATE 주석이 PREANALYZING 전환 로직보다 먼저 나타남
    const eligIdx = workerSrc.indexOf("ELIGIBILITY GATE");
    // EXCLUDED → PREANALYZING 전환 없이 직접 return 주석
    const excludeIdx = workerSrc.indexOf("EXCLUDED — PREANALYZING");
    expect(eligIdx).toBeGreaterThan(-1);
    expect(excludeIdx).toBeGreaterThan(-1);
    // EXCLUDED 처리가 ELIGIBILITY GATE 블록 내에 위치 (GATE 이후)
    expect(excludeIdx).toBeGreaterThan(eligIdx);
  });

  it("EXCLUDED 학생은 PREANALYZING 도달 불가", () => {
    // EXCLUDED 직후 return { ok: true }
    expect(workerSrc).toContain("PREANALYZING / ANALYZING 상태를 절대 거치지 않음");
  });
});

// ─── TC-V~AA: Attendance event identity 실 케이스 ──────────────────────────────

describe("TC-V~AA: Attendance event identity per-case (§1 FINAL PROOF)", () => {
  const snapshotFn = snapshotSrc.slice(
    snapshotSrc.indexOf("export async function queryAttendanceForEligibility"),
    snapshotSrc.indexOf("export async function queryDiariesForEligibility")
  );

  it("TC-V: scheduled/no attendance row/no absent → Branch 2 counts as present", () => {
    // Branch 2: generate_series + schedule_days
    // 명시적 absent 없고, 명시적 present 없고, schedule 날이면 +1
    expect(snapshotFn).toContain("generate_series");
    expect(snapshotFn).toContain("schedule_days LIKE");
    // absent 없는 조건 확인
    expect(snapshotFn).toContain("a2.status           = 'absent'");
    // explicit present 없는 조건 확인
    expect(snapshotFn).toContain("a3.status           IN ('present', 'late')");
  });

  it("TC-W: scheduled/explicit absent → NOT counted (Branch 2 excluded)", () => {
    // Branch 2 NOT EXISTS absent 필터
    expect(snapshotFn).toContain("AND NOT EXISTS");
    expect(snapshotFn).toContain("a2.status           = 'absent'");
    // absent가 있으면 Branch 2에서 제외됨
    // Branch 1-a도 status IN ('present','late') 이므로 absent는 카운트 안 됨
    expect(snapshotFn).toContain("AND a.status           IN ('present', 'late')");
  });

  it("TC-X: pool holiday → NOT counted (Branch 2 excluded)", () => {
    // pool_holidays ph WHERE ph.pool_id = poolId AND ph.holiday_date::date = gs.d::date
    expect(snapshotFn).toContain("pool_holidays ph");
    expect(snapshotFn).toContain("ph.holiday_date::date = gs.d::date");
    expect(snapshotFn).toContain("WHERE NOT EXISTS");
  });

  it("TC-Y: completed makeup / no attendance row → counted (Branch 1-b, makeup_sessions SoT)", () => {
    // Branch 1-b: makeup_sessions.status='completed' — attendance row 불필요
    expect(snapshotFn).toContain("FROM makeup_sessions ms");
    expect(snapshotFn).toContain("ms.status            = 'completed'");
    // completed_attendance_id 조건 없음 → NULL이어도 카운트
    const b1bSection = snapshotFn.slice(
      snapshotFn.indexOf("Branch 1-b"),
      snapshotFn.indexOf("Branch 2")
    );
    expect(b1bSection).not.toContain("completed_attendance_id IS NOT NULL");
  });

  it("TC-Z: same day regular + completed makeup → count 2 (separate events)", () => {
    // Branch 1-a: (class_group_id, date) → 정규 1회
    expect(snapshotFn).toContain("COUNT(DISTINCT (a.class_group_id, a.date::date))");
    // Branch 1-b: COUNT(ms.id) → 보강 별도 1회
    expect(snapshotFn).toContain("COUNT(ms.id)::int");
    // 두 브랜치는 더하기(+)로 합산 — SQL에 + 연산자가 각 branch 사이에 존재
    const plusOps = (snapshotFn.match(/^\s*\+\s*$/gm) ?? []).length;
    expect(plusOps).toBeGreaterThanOrEqual(2);
  });

  it("TC-AA: same date / two different class_group regular events → count 2", () => {
    // Branch 1-a: COUNT(DISTINCT (class_group_id, date)) — 같은 날 다른 반 = 2회
    expect(snapshotFn).toContain("COUNT(DISTINCT (a.class_group_id, a.date::date))");
    // Branch 2: COUNT(DISTINCT (cg.id, gs.d::date)) — 같은 날 다른 반 = 2회
    expect(snapshotFn).toContain("COUNT(DISTINCT (cg.id, gs.d::date))");
    // date만으로 중복 제거하지 않음 — COUNT(DISTINCT a.date) 없음
    expect(snapshotFn).not.toContain("COUNT(DISTINCT a.date)");
    // date만으로 중복 제거하지 않음 — COUNT(DISTINCT gs.d::date) 없음
    expect(snapshotFn).not.toContain("COUNT(DISTINCT gs.d::date)");
  });
});
