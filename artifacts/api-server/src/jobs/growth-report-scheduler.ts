/**
 * growth-report-scheduler.ts — GR2: Monthly Growth Report Cycle Scheduler
 *
 * 핵심 Product Rule:
 *   매월 25일 Asia/Seoul 00:00 이후 → 해당 month Cycle OPEN
 *   다음달 5일 Asia/Seoul 00:00 이후 → Parent Input CLOSE
 *
 * 원칙:
 *   - 5일은 Report 종료일이 아님. QUESTION_AVAILABLE → READY_FOR_ANALYSIS만 처리.
 *   - product_status = CLOSED 생성 금지
 *   - X Mode 접근 가능 pool만 신규 Cycle 생성
 *   - PUBLISHED history 삭제/무효화 금지
 *   - 동일 날짜 여러 번 실행해도 중복 없음 (idempotent)
 *   - missed-run recovery: now >= open_at AND PENDING → open
 *   - clock injection: now 파라미터로 테스트 가능
 *   - pool 단위 failure isolation: 한 pool 실패가 전체 중단 금지
 *   - PII 로그 금지 (student_id 열거 금지)
 *
 * GR2 금지:
 *   - ENGINE API 호출 → GR3
 *   - Parent Question UI → GR4
 *   - Teacher Review UI → GR5
 *   - Push 실제 발송 → GR7
 *
 * analysis_cutoff_at 정책 (GR2 확정):
 *   Cycle open 시점 = 25일 00:00 KST = UTC 전날 15:00:00
 *   ENGINE Snapshot에서 이 시각 이전 데이터만 사용.
 *   이후 데이터(25일 이후 수업/일지)는 다음 cycle에 포함.
 *   → analysis_cutoff_at = parent_input_open_at (= 25일 00:00 KST)
 *   → analysis_from = null (정책 미확정, ENGINE Contract 확정 후 결정)
 */
import cron from "node-cron";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";
import { transitionReportStatus } from "../lib/growth-report-service.js";

type Db = typeof superAdminDb;

const SCHEDULER_LOCK = "growth-report-cycle";
const LOCK_TTL_SECONDS = 600; // 10분

// ─────────────────────────────────────────────────────────────────────────────
// KST 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getKSTDate — now를 Asia/Seoul 기준으로 변환
 *
 * 한국은 DST 없음. UTC+9 고정.
 * 기존 codebase 패턴(getTime() + 9*60*60*1000) 재사용.
 * clock injection을 위해 now 파라미터 허용.
 */
export function getKSTDate(now: Date): {
  year: number;
  month: number; // 1-based
  day: number;
  hours: number;
  minutes: number;
  isoDate: string; // "YYYY-MM-DD"
  reportPeriod: string; // "YYYY-MM"
} {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);

  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1; // 1-based
  const day = kst.getUTCDate();
  const hours = kst.getUTCHours();
  const minutes = kst.getUTCMinutes();

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  return {
    year,
    month,
    day,
    hours,
    minutes,
    isoDate: `${year}-${mm}-${dd}`,
    reportPeriod: `${year}-${mm}`,
  };
}

/**
 * computeCycleTimestamps — report_period에 대한 Cycle 날짜 계산
 *
 * report_period: "YYYY-MM"
 * parent_input_open_at  = 해당 월 25일 00:00 KST (= UTC 전날 15:00:00)
 * analysis_cutoff_at    = parent_input_open_at (Cycle open 시점이 데이터 상한선)
 * parent_input_close_at = 다음달 5일 00:00 KST (= UTC 다음달 4일 15:00:00)
 * analysis_from         = null (정책 미확정)
 */
export function computeCycleTimestamps(year: number, month: number): {
  reportPeriod: string;
  parentInputOpenAt: Date;  // 25일 00:00 KST
  analysisCutoffAt: Date;   // = parentInputOpenAt (Cycle open 시점)
  parentInputCloseAt: Date; // 다음달 5일 00:00 KST
  analysisFrom: null;
} {
  const mm = String(month).padStart(2, "0");
  const reportPeriod = `${year}-${mm}`;

  // 25일 00:00 KST = UTC 전날(24일) 15:00:00
  // Date.UTC(year, month-1, 25) = 25일 00:00 UTC → KST는 25일 09:00
  // 25일 00:00 KST = 24일 15:00 UTC
  const parentInputOpenAt = new Date(Date.UTC(year, month - 1, 24, 15, 0, 0));

  // analysis_cutoff_at = Cycle open 시점 (25일 00:00 KST)
  const analysisCutoffAt = new Date(parentInputOpenAt.getTime());

  // 다음달 5일 00:00 KST = 다음달 4일 15:00 UTC
  let closeYear = year;
  let closeMonth = month + 1;
  if (closeMonth > 12) {
    closeMonth = 1;
    closeYear += 1;
  }
  const parentInputCloseAt = new Date(Date.UTC(closeYear, closeMonth - 1, 4, 15, 0, 0));

  return {
    reportPeriod,
    parentInputOpenAt,
    analysisCutoffAt,
    parentInputCloseAt,
    analysisFrom: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Result
// ─────────────────────────────────────────────────────────────────────────────

export interface GrowthReportSchedulerRunResult {
  run_at: string;
  timezone: "Asia/Seoul";

  cycles_checked: number;
  cycles_created: number;
  cycles_opened: number;
  cycles_input_closed: number;

  reports_opened: number;
  reports_ready_for_analysis: number;

  skipped: number;
  failed: number;

  errors: Array<{
    pool_id?: string;
    cycle_id?: string;
    report_id?: string;
    code: string;
    message?: string;
  }>;
}

function emptyResult(runAt: string): GrowthReportSchedulerRunResult {
  return {
    run_at: runAt,
    timezone: "Asia/Seoul",
    cycles_checked: 0,
    cycles_created: 0,
    cycles_opened: 0,
    cycles_input_closed: 0,
    reports_opened: 0,
    reports_ready_for_analysis: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// X-eligible pools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getXEligiblePools — xmode_entitlement=true + xmode_config_status='READY' pool 목록
 *
 * 기존 resolvePoolMode() 로직을 bulk 버전으로 적용.
 * non-X pool에 신규 Cycle 생성 금지.
 */
export async function getXEligiblePools(db: Db): Promise<Array<{ id: string }>> {
  const res = await db.execute(sql`
    SELECT id
    FROM swimming_pools
    WHERE xmode_entitlement = true
      AND xmode_config_status = 'READY'
      AND approval_status = 'approved'
  `);
  return res.rows as Array<{ id: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Open (25th rule)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * openCycleForPool — 단일 pool의 cycle open 처리
 *
 * 1. Cycle 생성 (이미 있으면 ON CONFLICT DO NOTHING)
 * 2. PENDING → ACTIVE (idempotent: ACTIVE면 skip)
 * 3. 이 pool의 active 학생들에게 NOT_OPEN report 생성 (ON CONFLICT DO NOTHING)
 * 4. NOT_OPEN → OPEN bulk update
 * 5. parent_input_status NONE → AVAILABLE
 * 6. audit (system)
 */
async function openCycleForPool(
  db: Db,
  poolId: string,
  reportPeriod: string,
  timestamps: ReturnType<typeof computeCycleTimestamps>,
  result: GrowthReportSchedulerRunResult,
): Promise<void> {
  // 1. Cycle 생성 (idempotent)
  const insertCycle = await db.execute(sql`
    INSERT INTO growth_report_cycles (
      swimming_pool_id, report_period,
      analysis_from, analysis_cutoff_at,
      parent_input_open_at, parent_input_close_at,
      timezone, cycle_status
    ) VALUES (
      ${poolId}, ${reportPeriod},
      ${null},
      ${timestamps.analysisCutoffAt.toISOString()},
      ${timestamps.parentInputOpenAt.toISOString()},
      ${timestamps.parentInputCloseAt.toISOString()},
      'Asia/Seoul', 'PENDING'
    )
    ON CONFLICT (swimming_pool_id, report_period)
    DO NOTHING
    RETURNING id
  `);

  let cycleId: string;

  if (insertCycle.rows.length > 0) {
    cycleId = (insertCycle.rows[0] as any).id as string;
    result.cycles_created++;
    console.log(`[gr-scheduler] CYCLE_CREATED: cycle=${cycleId} pool=${poolId} period=${reportPeriod}`);
  } else {
    // 기존 cycle 조회
    const existCycle = await db.execute(sql`
      SELECT id, cycle_status FROM growth_report_cycles
      WHERE swimming_pool_id = ${poolId}
        AND report_period = ${reportPeriod}
      LIMIT 1
    `);
    if (!existCycle.rows.length) {
      throw new Error(`CYCLE_LOOKUP_FAILED: pool=${poolId} period=${reportPeriod}`);
    }
    const row = existCycle.rows[0] as any;
    cycleId = row.id as string;

    // 이미 ACTIVE 이상이면 skip (idempotent)
    if (row.cycle_status !== "PENDING") {
      result.skipped++;
      console.log(`[gr-scheduler] CYCLE_SKIP (status=${row.cycle_status}): cycle=${cycleId}`);
      return;
    }
  }

  result.cycles_checked++;

  // 2. Cycle PENDING → ACTIVE
  await db.execute(sql`
    UPDATE growth_report_cycles
    SET cycle_status = 'ACTIVE', updated_at = now()
    WHERE id = ${cycleId}
      AND cycle_status = 'PENDING'
  `);
  result.cycles_opened++;

  // Audit: cycle open
  await writeSchedulerAudit(db, cycleId, poolId, "PENDING", "ACTIVE", "MONTHLY_CYCLE_OPEN");

  // 3. 이 pool의 non-deleted 학생들에게 report 생성 (ON CONFLICT DO NOTHING)
  //    batch insert: student_id별 ON CONFLICT (student_id, cycle_id) WHERE ... DO NOTHING
  const students = await db.execute(sql`
    SELECT id FROM students
    WHERE swimming_pool_id = ${poolId}
      AND deleted_at IS NULL
  `);

  let reportsCreated = 0;
  for (const s of students.rows as Array<{ id: string }>) {
    await db.execute(sql`
      INSERT INTO growth_reports (
        student_id, swimming_pool_id, cycle_id, report_period,
        product_status, parent_input_status, snapshot_version,
        period_start, period_end
      ) VALUES (
        ${s.id}, ${poolId}, ${cycleId}, ${reportPeriod},
        'NOT_OPEN', 'NONE', 0,
        now()::date, now()::date
      )
      ON CONFLICT (student_id, cycle_id)
        WHERE cycle_id IS NOT NULL AND deleted_at IS NULL
      DO NOTHING
    `);
    reportsCreated++;
  }

  if (reportsCreated > 0) {
    console.log(`[gr-scheduler] REPORTS_ENSURED: cycle=${cycleId} pool=${poolId} students=${reportsCreated}`);
  }

  // 4. NOT_OPEN → OPEN (bulk)
  const openRes = await db.execute(sql`
    UPDATE growth_reports
    SET product_status = 'OPEN',
        parent_input_status = 'AVAILABLE',
        updated_at = now()
    WHERE cycle_id = ${cycleId}
      AND product_status = 'NOT_OPEN'
      AND deleted_at IS NULL
    RETURNING id
  `);

  const openedCount = (openRes.rows as any[]).length;
  result.reports_opened += openedCount;

  // Audit: bulk report open (system)
  if (openedCount > 0) {
    await writeSchedulerAudit(
      db, cycleId, poolId,
      "NOT_OPEN", "OPEN",
      "MONTHLY_CYCLE_OPEN",
      { reports_opened: openedCount },
    );
    console.log(`[gr-scheduler] REPORTS_OPENED: cycle=${cycleId} count=${openedCount}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Close (5th rule)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * closeCycleForPool — 단일 cycle의 parent input close 처리
 *
 * 1. Cycle ACTIVE → INPUT_CLOSED
 * 2. parent_input_status AVAILABLE/ANSWERED/NONE → CLOSED (bulk)
 * 3. product_status QUESTION_AVAILABLE → READY_FOR_ANALYSIS (transitionReportStatus)
 * 4. 나머지 product_status는 그대로 (ANALYZING, REVIEW_REQUIRED, APPROVED, PUBLISHED, FAILED, PARTIAL)
 * 5. audit
 */
async function closeCycleInput(
  db: Db,
  cycleId: string,
  poolId: string,
  result: GrowthReportSchedulerRunResult,
): Promise<void> {
  // 1. ACTIVE → INPUT_CLOSED
  await db.execute(sql`
    UPDATE growth_report_cycles
    SET cycle_status = 'INPUT_CLOSED', updated_at = now()
    WHERE id = ${cycleId}
      AND cycle_status = 'ACTIVE'
  `);
  result.cycles_input_closed++;

  // Audit: cycle close
  await writeSchedulerAudit(db, cycleId, poolId, "ACTIVE", "INPUT_CLOSED", "PARENT_INPUT_WINDOW_CLOSED");

  // 2. parent_input_status AVAILABLE / ANSWERED / NONE → CLOSED (bulk)
  //    product_status는 변경하지 않음 (PUBLISHING 계속 진행 가능)
  await db.execute(sql`
    UPDATE growth_reports
    SET parent_input_status = 'CLOSED',
        parent_input_closed_at = now(),
        updated_at = now()
    WHERE cycle_id = ${cycleId}
      AND parent_input_status IN ('AVAILABLE', 'ANSWERED', 'NONE')
      AND deleted_at IS NULL
  `);
  console.log(`[gr-scheduler] PARENT_INPUT_CLOSED: cycle=${cycleId} pool=${poolId}`);

  // 3. QUESTION_AVAILABLE → READY_FOR_ANALYSIS
  //    (학부모 미응답이어도 ENGINE 분석 계속 진행 가능)
  const qaReports = await db.execute(sql`
    SELECT id FROM growth_reports
    WHERE cycle_id = ${cycleId}
      AND product_status = 'QUESTION_AVAILABLE'
      AND deleted_at IS NULL
  `);

  for (const row of qaReports.rows as Array<{ id: string }>) {
    try {
      await transitionReportStatus({
        db,
        reportId: row.id,
        toStatus: "READY_FOR_ANALYSIS",
        actorType: "system",
        actorId: null,
        reason: "PARENT_INPUT_WINDOW_CLOSED",
      });
      result.reports_ready_for_analysis++;
    } catch (err: any) {
      console.warn(
        `[gr-scheduler] QUESTION_AVAILABLE→READY_FOR_ANALYSIS 실패: report=${row.id}:`,
        err.message,
      );
      result.errors.push({ cycle_id: cycleId, report_id: row.id, code: "QA_TRANSITION_FAILED", message: err.message });
    }
  }

  if (qaReports.rows.length > 0) {
    console.log(
      `[gr-scheduler] QA_TO_READY: cycle=${cycleId} count=${result.reports_ready_for_analysis}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit helper
// ─────────────────────────────────────────────────────────────────────────────

async function writeSchedulerAudit(
  db: Db,
  entityId: string,
  poolId: string,
  fromStatus: string,
  toStatus: string,
  reason: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const vRes = await db.execute(sql`
      SELECT next_audit_version('growth_report_cycle', ${entityId}) AS v
    `);
    const version = (vRes.rows[0] as any)?.v ?? 1;

    await db.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason,
        request_id, correlation_id, ip_hash
      ) VALUES (
        'growth_report_cycle', ${entityId}, ${version},
        'update', 'system', NULL, ${poolId},
        ${JSON.stringify({ status: fromStatus })}::jsonb,
        ${JSON.stringify({ status: toStatus, ...(context ?? {}) })}::jsonb,
        ${reason},
        NULL, NULL, NULL
      )
    `);
  } catch (auditErr: any) {
    console.warn("[gr-scheduler] audit 기록 실패:", auditErr.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runGrowthReportScheduler — 통합 실행 함수 (clock-injectable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runGrowthReportScheduler — 25일 open + 5일 close 통합 처리
 *
 * clock injection: now 파라미터로 synthetic date 테스트 가능.
 * 락 불필요: 호출부(cron)에서 acquireLock 처리.
 *
 * 처리 순서:
 *   1. X-eligible pool 목록 조회
 *   2. 현재 month 25일 이후면: PENDING cycles → ACTIVE + reports OPEN
 *   3. 5일 close: ACTIVE cycles의 close_at <= now → INPUT_CLOSED + parent close
 *
 * missed-run recovery:
 *   - now >= parent_input_open_at AND cycle PENDING → open (과거 month 포함)
 *   - now >= parent_input_close_at AND cycle ACTIVE → close
 */
export async function runGrowthReportScheduler(
  db: Db,
  now: Date = new Date(),
): Promise<GrowthReportSchedulerRunResult> {
  const runAt = now.toISOString();
  const result = emptyResult(runAt);

  const kst = getKSTDate(now);
  console.log(`[gr-scheduler] RUN: kst=${kst.isoDate} ${kst.hours}:${String(kst.minutes).padStart(2,"0")} KST`);

  // ── Step 1: 25일 open ────────────────────────────────────────────────────────
  // X-eligible pool 목록
  let xPools: Array<{ id: string }>;
  try {
    xPools = await getXEligiblePools(db);
  } catch (err: any) {
    console.error("[gr-scheduler] X-eligible pools 조회 실패:", err.message);
    result.errors.push({ code: "X_POOLS_FETCH_FAILED", message: err.message });
    return result;
  }

  // 현재 month의 timestamps 계산
  const currentTs = computeCycleTimestamps(kst.year, kst.month);

  // 25일 open: now >= parentInputOpenAt (현재 month)
  const shouldOpenCurrentMonth = now.getTime() >= currentTs.parentInputOpenAt.getTime();

  if (shouldOpenCurrentMonth && xPools.length > 0) {
    for (const pool of xPools) {
      try {
        await openCycleForPool(db, pool.id, currentTs.reportPeriod, currentTs, result);
      } catch (err: any) {
        console.error(`[gr-scheduler] OPEN 실패: pool=${pool.id}:`, err.message);
        result.failed++;
        result.errors.push({ pool_id: pool.id, code: "CYCLE_OPEN_FAILED", message: err.message });
      }
    }
  } else {
    console.log(
      `[gr-scheduler] 25일 미도달 (kst_day=${kst.day}): open skip`,
    );
  }

  // missed-run recovery: 이전 달의 PENDING cycles (open_at <= now)
  let pendingCycles: Array<{ id: string; swimming_pool_id: string; report_period: string; parent_input_open_at: Date }>;
  try {
    const pRes = await db.execute(sql`
      SELECT id, swimming_pool_id, report_period, parent_input_open_at
      FROM growth_report_cycles
      WHERE cycle_status = 'PENDING'
        AND parent_input_open_at <= ${now.toISOString()}
    `);
    pendingCycles = pRes.rows as any[];
  } catch (err: any) {
    console.error("[gr-scheduler] PENDING cycles 조회 실패:", err.message);
    result.errors.push({ code: "PENDING_CYCLES_FETCH_FAILED", message: err.message });
    pendingCycles = [];
  }

  for (const cycle of pendingCycles) {
    // 현재 month는 이미 처리됨 (중복 방지)
    if (cycle.report_period === currentTs.reportPeriod) continue;

    try {
      const ts = (() => {
        const [y, m] = cycle.report_period.split("-").map(Number);
        return computeCycleTimestamps(y!, m!);
      })();
      await openCycleForPool(db, cycle.swimming_pool_id, cycle.report_period, ts, result);
    } catch (err: any) {
      console.error(`[gr-scheduler] MISSED OPEN 실패: cycle=${cycle.id}:`, err.message);
      result.failed++;
      result.errors.push({ cycle_id: cycle.id, code: "MISSED_OPEN_FAILED", message: err.message });
    }
  }

  // ── Step 2: 5일 close ────────────────────────────────────────────────────────
  // ACTIVE cycles with close_at <= now
  let activeCycles: Array<{ id: string; swimming_pool_id: string; parent_input_close_at: string }>;
  try {
    const aRes = await db.execute(sql`
      SELECT id, swimming_pool_id, parent_input_close_at
      FROM growth_report_cycles
      WHERE cycle_status = 'ACTIVE'
        AND parent_input_close_at <= ${now.toISOString()}
    `);
    activeCycles = aRes.rows as any[];
  } catch (err: any) {
    console.error("[gr-scheduler] ACTIVE cycles 조회 실패:", err.message);
    result.errors.push({ code: "ACTIVE_CYCLES_FETCH_FAILED", message: err.message });
    activeCycles = [];
  }

  for (const cycle of activeCycles) {
    try {
      await closeCycleInput(db, cycle.id, cycle.swimming_pool_id, result);
    } catch (err: any) {
      console.error(`[gr-scheduler] CLOSE 실패: cycle=${cycle.id}:`, err.message);
      result.failed++;
      result.errors.push({ cycle_id: cycle.id, code: "CYCLE_CLOSE_FAILED", message: err.message });
    }
  }

  console.log(
    `[gr-scheduler] DONE: ` +
    `cycles_created=${result.cycles_created} opened=${result.cycles_opened} ` +
    `input_closed=${result.cycles_input_closed} ` +
    `reports_opened=${result.reports_opened} ready=${result.reports_ready_for_analysis} ` +
    `failed=${result.failed}`,
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// startGrowthReportScheduler — cron 등록 (Worker mode에서 호출)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * startGrowthReportScheduler — node-cron 등록
 *
 * 실행: 매일 01:00 KST (UTC 16:00) — 25일 자정 직후 충분히 처리됨
 *       + 서버 시작 30초 후 1회 즉시 실행 (missed-run recovery)
 *
 * cron pattern: "0 16 * * *" UTC = "0 1 * * *" KST
 * node-cron timezone option: "Asia/Seoul" (직접 지정 가능)
 *
 * lock: acquireLock("growth-report-cycle", 600) — 10분 TTL
 */
export function startGrowthReportScheduler(): void {
  // 매일 01:00 KST (Asia/Seoul timezone)
  cron.schedule("0 1 * * *", async () => {
    const locked = await acquireLock(SCHEDULER_LOCK, LOCK_TTL_SECONDS);
    if (!locked) {
      console.log("[gr-scheduler] lock not acquired — other instance running");
      return;
    }
    try {
      const result = await runGrowthReportScheduler(superAdminDb);
      await recordHeartbeat(SCHEDULER_LOCK, {
        ran: true,
        at: new Date().toISOString(),
        cycles_opened: result.cycles_opened,
        cycles_input_closed: result.cycles_input_closed,
        failed: result.failed,
      });
    } catch (err: any) {
      console.error("[gr-scheduler] cron 실행 오류:", err.message);
    } finally {
      await releaseLock(SCHEDULER_LOCK);
    }
  }, { timezone: "Asia/Seoul" });

  // 서버 시작 30초 후 missed-run recovery 1회 실행
  setTimeout(async () => {
    const locked = await acquireLock(SCHEDULER_LOCK, LOCK_TTL_SECONDS);
    if (!locked) return;
    try {
      console.log("[gr-scheduler] startup recovery run");
      await runGrowthReportScheduler(superAdminDb);
    } catch (err: any) {
      console.error("[gr-scheduler] startup recovery 오류:", err.message);
    } finally {
      await releaseLock(SCHEDULER_LOCK);
    }
  }, 30_000);

  console.log("[gr-scheduler] Growth Report Scheduler 시작 (01:00 KST daily + 30s startup recovery)");
}
