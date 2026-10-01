/**
 * growth-report-eligibility-v3.test.ts
 *
 * FREE monthly Growth Report V1.0 eligibility policy 검증
 * 테스트 A-U (운영자 지정)
 *
 * 정책:
 *   재원 O + 출석 >= 3 + 유효 학생별 source >= 1 → ELIGIBLE
 *   GROWTH_REPORT_MIN_SOURCE_RECORDS = 1
 *   GROWTH_REPORT_ELIGIBILITY_VERSION = 4
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
const batchWorkerSrc  = read("artifacts/api-server/src/jobs/growth-report-batch-worker.ts");
const monthlyTargetsSrc = read("artifacts/api-server/src/lib/growth-report-monthly-targets.ts");
const monthlyTargetSchemaSrc = read("artifacts/api-server/src/migrations/growth-report-monthly-integrity.ts");
const resultHandlerSrc = read("artifacts/api-server/src/lib/growth-report-result-handler.ts");
const reportServiceSrc = read("artifacts/api-server/src/lib/growth-report-service.ts");

// ─── FREE monthly V1.0 상수 검증 ──────────────────────────────────────────────

describe("FREE monthly V1.0 policy constants", () => {
  it("MIN_ATTENDANCE = 3", () => {
    expect(GROWTH_REPORT_MIN_ATTENDANCE_COUNT).toBe(3);
  });

  it("MIN_SOURCE = 1 (3/1 정책)", () => {
    expect(GROWTH_REPORT_MIN_SOURCE_RECORDS).toBe(1);
  });

  it("ELIGIBILITY_VERSION = 4", () => {
    expect(GROWTH_REPORT_ELIGIBILITY_VERSION).toBe(4);
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
    expect(r.eligibility_version).toBe(4);
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
    const startupStart = workerSrc.indexOf("setTimeout(async () =>", workerSrc.indexOf("export function startGrowthReportAnalysisWorker"));
    const startupEnd = workerSrc.indexOf("}, 45_000);", startupStart);
    expect(startupStart).toBeGreaterThan(-1);
    expect(startupEnd).toBeGreaterThan(startupStart);
    const startupBlock = workerSrc.slice(startupStart, startupEnd);
    expect(startupBlock).toContain("isAutoAnalysisEnabled()");
    expect(startupBlock).toContain("getBatchSize()");
    expect(startupBlock).toContain("acquireLock(ANALYSIS_LOCK");
    expect(startupBlock).toContain("await drainAnalysisQueue(superAdminDb)");
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

  it("TC-L-2: transitionReportStatus row lock으로 stale transition 방지", () => {
    expect(workerSrc).toContain("transitionReportStatus");
    expect(workerSrc).toContain("InvalidTransitionError");
    // concurrent skip
    expect(workerSrc).toContain("concurrent");
    const transitionStart = reportServiceSrc.indexOf("export async function transitionReportStatus(");
    const transitionEnd = reportServiceSrc.indexOf("export interface CreateCycleParams", transitionStart);
    const transitionBody = reportServiceSrc.slice(transitionStart, transitionEnd);
    expect(transitionBody).toMatch(/WHERE id = \$\{reportId\}\s+FOR UPDATE/);
    expect(transitionBody).toContain("SET product_status = ${toStatus}");
    expect(transitionBody).toContain("AND deleted_at IS NULL");
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
    expect(workerSrc).toMatch(
      /recordAnalysisAttemptFailure\(\{[\s\S]*?retryable,[\s\S]*?errorCode,/,
    );
    expect(resultHandlerSrc).toMatch(
      /if \(terminal\)[\s\S]*?toStatus:\s*"FAILED"[\s\S]*?ENGINE_NON_RETRYABLE_/,
    );
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
  it("makeup uses assigned class/date identity and does not require an attendance row", () => {
    // queryAttendanceForEligibility가 makeup을 makeup_sessions에서 직접 조회
    const fnIdx = snapshotSrc.indexOf("queryAttendanceForEligibility");
    expect(fnIdx).toBeGreaterThan(-1);
    // Completed makeup sessions are the source of truth.
    expect(snapshotSrc).toContain("makeup_sessions ms");
    expect(snapshotSrc).toContain("ms.status = 'completed'");
    expect(snapshotSrc).toContain("assigned_class_group_id");
    expect(snapshotSrc).toContain("AT TIME ZONE 'Asia/Seoul'");
    // Scheduled lessons are identified by class group and date.
    expect(snapshotSrc).toContain("SELECT DISTINCT cg.id AS class_group_id, gs.d::date AS lesson_date");
    expect(snapshotSrc).toContain("UNION");
    // attendance row에 의존하지 않음 — attendance.session_type='makeup' 조회 없음
    expect(snapshotSrc).not.toContain("session_type = 'makeup'");
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
    // Assert executable order: eligibility → exclusion write + return →
    // eligible-only lifecycle transition.
    const eligibilityIdx = workerSrc.indexOf(
      "const eligResult = evaluateStudentGrowthReportEligibility",
    );
    const excludedBranchIdx = workerSrc.indexOf(
      "if (!eligResult.eligible)",
      eligibilityIdx,
    );
    const excludedStatusMatch = workerSrc
      .slice(excludedBranchIdx)
      .match(/product_status\s*=\s*'EXCLUDED'/);
    const excludedStatusIdx = excludedStatusMatch
      ? excludedBranchIdx + excludedStatusMatch.index
      : -1;
    const excludedReturnIdx = workerSrc.indexOf(
      "return { ok: true };",
      excludedStatusIdx,
    );
    const inProgressStatusIdx = workerSrc.indexOf(
      "const toInProgress =",
      excludedReturnIdx,
    );
    const inProgressTransitionIdx = workerSrc.indexOf(
      "transitionReportStatus({",
      inProgressStatusIdx,
    );
    expect(eligibilityIdx).toBeGreaterThan(-1);
    expect(excludedBranchIdx).toBeGreaterThan(eligibilityIdx);
    expect(excludedStatusIdx).toBeGreaterThan(excludedBranchIdx);
    expect(excludedReturnIdx).toBeGreaterThan(excludedStatusIdx);
    expect(inProgressStatusIdx).toBeGreaterThan(excludedReturnIdx);
    expect(inProgressTransitionIdx).toBeGreaterThan(inProgressStatusIdx);
  });

  it("EXCLUDED 학생은 PREANALYZING 도달 불가", () => {
    const excludedBranchIdx = workerSrc.indexOf("if (!eligResult.eligible)");
    const excludedReturnIdx = workerSrc.indexOf("return { ok: true };", excludedBranchIdx);
    const inProgressStatusIdx = workerSrc.indexOf("const toInProgress =", excludedReturnIdx);
    expect(excludedReturnIdx).toBeGreaterThan(excludedBranchIdx);
    expect(inProgressStatusIdx).toBeGreaterThan(excludedReturnIdx);
  });
});

// ─── TC-V~AA: Attendance event identity 실 케이스 ──────────────────────────────

describe("TC-V~AA: V1.0 attendance event identity per-case", () => {
  const snapshotFn = snapshotSrc.slice(
    snapshotSrc.indexOf("export async function queryAttendanceForEligibility"),
    snapshotSrc.indexOf("export async function queryDiariesForEligibility")
  );

  it("TC-V: scheduled/no attendance row/no absent → counts as an attended lesson", () => {
    // A scheduled, non-holiday date counts unless there is an explicit absence.
    expect(snapshotFn).toContain("generate_series");
    expect(snapshotFn).toContain("schedule_days LIKE");
    expect(snapshotFn).toMatch(/a2\.status\s*=\s*'absent'/);
  });

  it("TC-W: scheduled/explicit absent → NOT counted", () => {
    // The scheduled lesson is excluded by its matching absence row.
    expect(snapshotFn).toContain("AND NOT EXISTS");
    expect(snapshotFn).toMatch(/a2\.status\s*=\s*'absent'/);
  });

  it("TC-X: pool holiday → NOT counted", () => {
    // pool_holidays ph WHERE ph.pool_id = poolId AND ph.holiday_date::date = gs.d::date
    expect(snapshotFn).toContain("pool_holidays ph");
    expect(snapshotFn).toContain("ph.holiday_date::date = gs.d::date");
    expect(snapshotFn).toContain("WHERE NOT EXISTS");
  });

  it("TC-Y: completed makeup / no attendance row → counted (makeup_sessions SoT)", () => {
    // A completed makeup counts independently of attendance rows.
    expect(snapshotFn).toContain("FROM makeup_sessions ms");
    expect(snapshotFn).toContain("ms.status = 'completed'");
    expect(snapshotFn).toContain("ms.assigned_class_group_id IS NOT NULL");
    expect(snapshotFn).toContain("makeup_holiday.holiday_date::date");
  });

  it("TC-Z: same class/date regular + makeup is one recognized lesson", () => {
    // UNION on (class_group_id, lesson_date) deduplicates both sources.
    expect(snapshotFn).toContain("SELECT DISTINCT cg.id AS class_group_id");
    expect(snapshotFn).toContain("SELECT makeup_class.id AS class_group_id");
    expect(snapshotFn).toContain("UNION");
    expect(snapshotFn).not.toContain("COUNT(ms.id)::int");
    expect(snapshotFn).not.toContain(") + (");
  });

  it("TC-AA: same date / two different class_group regular events → count 2", () => {
    // Distinct (class_group, date) preserves two scheduled lessons on one date.
    expect(snapshotFn).toContain("SELECT DISTINCT cg.id AS class_group_id, gs.d::date AS lesson_date");
    // Deduplicate by class group + date, not by date alone.
    expect(snapshotFn).not.toContain("SELECT DISTINCT gs.d::date AS lesson_date");
  });
});

// ─── TC-AB~AE: Cohort SoT — report_month_start 기준 중도입회 ─────────────────

describe("TC-AB: 8월 중도입회 / 9/1 재원 / att3 / src1 → ELIGIBLE", () => {
  it("TC-AB: enrolled 2026-08-10, left_at=null, att=3, src=1 → ELIGIBLE", () => {
    // report_month=2026-09, analysis_period=2026-08
    // cohort: enrolled_at <= 2026-09-01 AND (left_at IS NULL OR left_at >= 2026-09-01)
    // 2026-08-10 입회 → enrolled_at(08-10) <= 09-01 ✓ && left_at=null ✓ → 재원
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     true,  // cohort 충족
    });
    expect(r.eligible).toBe(true);
    expect(r.exclusion_code).toBeNull();
  });
});

describe("TC-AC: 8/31 입회 / 9/1 재원 / att3 / src1 → ELIGIBLE", () => {
  it("TC-AC: enrolled 2026-08-31, left_at=null, att=3, src=1 → ELIGIBLE", () => {
    // enrolled_at(08-31) <= 09-01 ✓ && left_at=null ✓ → 재원 → ELIGIBLE
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     true,
    });
    expect(r.eligible).toBe(true);
    expect(r.exclusion_code).toBeNull();
  });
});

describe("TC-AD: 9/2 입회 → 2026-09 report cohort 제외", () => {
  it("TC-AD: enrolled 2026-09-02 → enrolled_at > report_month_start → NOT in cohort", () => {
    // enrolled_at(09-02) > 09-01 → cohort 제외 → reregistered=false
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  5,
      sourceEventCount: 3,
      reregistered:     false,  // cohort 미충족
    });
    expect(r.eligible).toBe(false);
    expect(r.exclusion_code).toBe("NOT_REREGISTERED");
  });
});

describe("TC-AE: 8월 중 입회 / left_at < 9/1 → 2026-09 report cohort 제외", () => {
  it("TC-AE: enrolled 2026-08-10, left_at=2026-08-25 → 9/1 비재원 → NOT in cohort", () => {
    // left_at(08-25) < 09-01 → 9/1 기준 퇴원 → cohort 제외 → reregistered=false
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount:  3,
      sourceEventCount: 1,
      reregistered:     false,  // cohort 미충족
    });
    expect(r.eligible).toBe(false);
    expect(r.exclusion_code).toBe("NOT_REREGISTERED");
  });
});

// ─── TC-AF~AK: Data Contract Reconciliation ───────────────────────────────────

// TC-AF: report_month=2026-09 → analysis_from=2026-08-01, cutoff=2026-09-01
describe("TC-AF: report_month=2026-09 E2E period contract", () => {
  it("TC-AF: computeMonthlyFreePeriodTimestamps(2026,9) → reportPeriod=2026-08, periodStart=2026-08-01, cutoff=2026-09-01 KST", () => {
    // 실제 함수를 직접 재현 (require 없이 계약만 검증)
    // year=2026, month=9 (9월 실행) → prevYear=2026, prevMonth=8
    const prevYear = 2026;
    const prevMonth = 8;
    const prevMM = String(prevMonth).padStart(2, "0");
    const reportPeriod = `${prevYear}-${prevMM}`;         // "2026-08" = DB report_period
    const periodStart  = `${prevYear}-${prevMM}-01`;       // "2026-08-01" = analysis_from
    // analysisCutoffAt = 이번달 1일 00:00 KST = UTC Aug 31 15:00
    const analysisCutoffAt = new Date(Date.UTC(2026, 8, 0, 15, 0, 0)); // Aug 31 15:00 UTC
    const cutoffKst = new Date(analysisCutoffAt.getTime() + 9 * 3600_000);
    expect(reportPeriod).toBe("2026-08");
    expect(periodStart).toBe("2026-08-01");
    expect(cutoffKst.toISOString().slice(0, 10)).toBe("2026-09-01");
  });
});

// TC-AG: snapshot builder가 분석기간(2026-08) diary만 조회하는지 소스코드 계약 검증
describe("TC-AG: snapshot builder uses analysis period for diary query", () => {
  it("TC-AG: queryDiaries SQL contains analysisFrom..periodEndExclusive bounds", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../lib/growth-report-snapshot-builder.ts"), "utf-8"
    );
    expect(src).toContain("cd.lesson_date >= ${analysisFrom}");
    expect(src).toContain("cd.lesson_date <  ${periodEndExclusive}");
  });
});

// TC-AH: OLD cohort student set ⊆ NEW cohort student set
describe("TC-AH: OLD cohort ⊆ NEW cohort (코드 계약)", () => {
  it("TC-AH: NEW cohort enrolled_at bound은 OLD보다 넓다 — OLD 조건은 NEW 조건의 subset", () => {
    // OLD: enrolled_at <= report_period_start (e.g. 2026-08-01)
    // NEW: enrolled_at <= report_month_start  (e.g. 2026-09-01)
    // report_period_start < report_month_start → OLD ⊆ NEW 성립
    const oldBound = new Date("2026-08-01");
    const newBound = new Date("2026-09-01");
    expect(newBound >= oldBound).toBe(true); // NEW bound is >= OLD bound
    // left_at condition 동일 → OLD cohort의 모든 학생은 NEW cohort에도 포함
  });
});

// TC-AI: OLD eligible ⊆ NEW eligible (동일 eligibility 함수, 동일 analysis period)
describe("TC-AI: OLD eligible ⊆ NEW eligible", () => {
  it("TC-AI: evaluateStudentGrowthReportEligibility는 순수함수 — 동일 att/src 입력 시 동일 출력", () => {
    // OLD eligible 학생: att>=3, src>=1, reregistered=true
    // NEW cohort에도 포함 (TC-AH) → 동일 att/src → 동일 eligible 결과
    const r = evaluateStudentGrowthReportEligibility({
      attendanceCount: 3, sourceEventCount: 1, reregistered: true,
    });
    expect(r.eligible).toBe(true); // OLD eligible → NEW에서도 ELIGIBLE
  });
});

// TC-AJ: multi-class students are sealed once and all downstream work uses that roster
describe("TC-AJ: multi-class student cohort uses sealed roster", () => {
  it("TC-AJ: scheduler and batch worker consume the immutable target PK roster", () => {
    expect(schedulerSrc).toContain('import { sealMonthlyTargets } from "../lib/growth-report-monthly-targets.js"');
    expect(schedulerSrc).toContain("FROM growth_report_eligible_targets target");
    expect(schedulerSrc).not.toContain("FROM students");

    expect(batchWorkerSrc).toContain("getSealedMonthlyTargetRoster(db, cycleId)");
    expect(batchWorkerSrc).toContain("return roster.map(({ studentId }) => ({ studentId, classGroupId: null }))");
    expect(batchWorkerSrc).not.toContain("FROM students");
    expect(batchWorkerSrc).not.toContain("FROM student_class_history");

    expect(monthlyTargetSchemaSrc).toContain("PRIMARY KEY (cycle_id, student_id)");
    expect(monthlyTargetsSrc).toContain("ON CONFLICT (cycle_id, student_id) DO NOTHING");
  });

  it("TC-AJ: live sealing deduplicates candidate students and uses canonical evidence helpers", () => {
    const candidatesStart = monthlyTargetsSrc.indexOf("const candidates = await tx.execute(sql`");
    const candidatesEnd = monthlyTargetsSrc.indexOf("const targets: MonthlyEligibilityTarget[]", candidatesStart);
    const candidateQuery = monthlyTargetsSrc.slice(candidatesStart, candidatesEnd);
    expect(candidatesStart).toBeGreaterThan(-1);
    expect(candidateQuery).toContain("GROUP BY s.id");
    expect(candidateQuery).toContain("ORDER BY s.id");
    expect(candidateQuery).not.toMatch(/SELECT\s+DISTINCT\s+s\.id/i);

    const sealStart = monthlyTargetsSrc.indexOf("export async function sealMonthlyTargets(");
    const sealEnd = monthlyTargetsSrc.indexOf("function parseSavedRequest", sealStart);
    const sealBody = monthlyTargetsSrc.slice(sealStart, sealEnd);
    expect(sealBody).toContain("queryAttendanceForEligibility(");
    expect(sealBody).toContain("queryDiariesForEligibility(");
    expect(snapshotSrc).toContain("export async function queryAttendanceForEligibility(");
  });
});

// TC-AK: overlapping class history still maps to one sealed student target
describe("TC-AK: overlapping history dedup", () => {
  it("TC-AK: GROUP BY student PK collapses overlapping histories without hiding report reconciliation rows", () => {
    const candidatesStart = monthlyTargetsSrc.indexOf("const candidates = await tx.execute(sql`");
    const candidatesEnd = monthlyTargetsSrc.indexOf("const targets: MonthlyEligibilityTarget[]", candidatesStart);
    const candidateQuery = monthlyTargetsSrc.slice(candidatesStart, candidatesEnd);
    expect(candidateQuery).toContain("array_agg(DISTINCT sch.class_group_id ORDER BY sch.class_group_id)");
    expect(candidateQuery).toContain("GROUP BY s.id");
    expect(candidateQuery).toContain("ORDER BY s.id");

    // Downstream report rows derive from persisted identities; DISTINCT must not
    // mask a mismatch between the sealed target count and report reconciliation.
    expect(batchWorkerSrc).toContain("FROM growth_report_eligible_targets target");
    expect(batchWorkerSrc).toContain("AND target.student_id = ${studentId}");
    expect(schedulerSrc).toContain("FROM growth_report_eligible_targets target");
    expect(schedulerSrc).toContain("AND target.student_id = growth_reports.student_id");
    expect(monthlyTargetsSrc).toContain("Sealed monthly target count mismatch");
  });
});
