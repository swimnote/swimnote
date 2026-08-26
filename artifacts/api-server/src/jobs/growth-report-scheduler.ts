/**
 * growth-report-scheduler.ts — GR2: Monthly Growth Report Cycle Scheduler
 *
 * 핵심 Product Rule (MONTHLY_FREE 최종 정책):
 *   report_period = previous month (이번 달 실행 → 지난달 리포트)
 *   매월 1~4일 KST: cycle ensure → report ensure → AI analysis 준비
 *   매월 5일 KST: delivery_eligible 학생에게 자동 발행(auto-publish)
 *
 * 원칙:
 *   - analysis_cutoff_at = 1일 00:00 KST (= 이전달 마지막 순간)
 *   - period_start = 이전달 1일, period_end = 이전달 마지막 날 (KST 기준)
 *   - PUBLISHED history 삭제/무효화 금지
 *   - 동일 날짜 여러 번 실행해도 중복 없음 (idempotent)
 *   - missed-run recovery: 이전 달 PENDING → open
 *   - pool 단위 failure isolation
 *   - PII 로그 금지
 *
 * Delivery Eligibility (§E):
 *   students.status = 'active' → eligible
 *   suspended / withdrawn → 제외
 *   scheduled lesson / makeup lesson 존재 여부 무시 (lifecycle 우선)
 *
 * Publication Safety (§K):
 *   analysis_status = COMPLETE, report_content 존재,
 *   grounding PASS/REVISED_PASS, growth_framing PASS/REVISED_PASS,
 *   product_status = REVIEW_REQUIRED → auto-approve → PUBLISHED
 *
 * GR2 금지:
 *   - ENGINE API 호출 → GR3
 *   - Parent Question UI → GR4
 *   - Teacher Review UI → GR5
 *
 * analysis_cutoff_at 정책:
 *   1일 00:00 KST = UTC 전날 15:00:00
 *   이 시각 이전 데이터만 snapshot에 포함 → 이전달 데이터만 포함
 */
import cron from "node-cron";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";
import { transitionReportStatus } from "../lib/growth-report-service.js";
import { autoApproveAndPublishForDelivery } from "../lib/growth-report-service.js";
import { FREE_GROWTH_REPORT_ELIGIBLE_SQL } from "../lib/growth-report-eligibility.js";
import { notifyGrowthReportPublished } from "../utils/notify.js";

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
 */
export function getKSTDate(now: Date): {
  year: number;
  month: number; // 1-based
  day: number;
  hours: number;
  minutes: number;
  isoDate: string; // "YYYY-MM-DD"
  reportPeriod: string; // "YYYY-MM" (current month)
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

// ─────────────────────────────────────────────────────────────────────────────
// Monthly FREE Period Timestamps
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyFreePeriodTimestamps {
  /** "YYYY-MM" — 이전달 */
  reportPeriod: string;
  /** "YYYY-MM-01" — 이전달 1일 (KST 기준) */
  periodStart: string;
  /** "YYYY-MM-DD" — 이전달 마지막 날 (KST 기준) */
  periodEnd: string;
  /** 이번달 1일 00:00:00 KST = UTC 이전달 마지막날 15:00:00 */
  parentInputOpenAt: Date;
  /** = parentInputOpenAt (이번달 1일 00:00 KST = 이전달 데이터 cutoff 상한선) */
  analysisCutoffAt: Date;
  /** 이번달 5일 00:00:00 KST = UTC 이번달 4일 15:00:00 (auto-publish 트리거) */
  parentInputCloseAt: Date;
}

/**
 * computeMonthlyFreePeriodTimestamps — 이번달 KST 기준으로 이전달 cycle 타임스탬프 계산
 *
 * @param year  KST 이번달 year
 * @param month KST 이번달 month (1-based)
 *
 * 예시: year=2026, month=9 (9월 실행)
 *   reportPeriod = "2026-08"
 *   periodStart  = "2026-08-01"
 *   periodEnd    = "2026-08-31"
 *   parentInputOpenAt  = 2026-08-31 15:00 UTC = 2026-09-01 00:00 KST
 *   analysisCutoffAt   = 2026-08-31 15:00 UTC (same)
 *   parentInputCloseAt = 2026-09-04 15:00 UTC = 2026-09-05 00:00 KST
 */
export function computeMonthlyFreePeriodTimestamps(
  year: number,
  month: number,
): MonthlyFreePeriodTimestamps {
  // 이전달
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear = year - 1;
  }
  const prevMM = String(prevMonth).padStart(2, "0");
  const reportPeriod = `${prevYear}-${prevMM}`;

  // 이전달 마지막 날: Date.UTC(year, month-1, 0) = 이전달 마지막 날 00:00 UTC
  // e.g., Date.UTC(2026, 8, 0) = Aug 31 2026 00:00 UTC
  const prevLastDayDate = new Date(Date.UTC(year, month - 1, 0));
  const prevLastDay = prevLastDayDate.getUTCDate();
  const prevLastDD = String(prevLastDay).padStart(2, "0");

  const periodStart = `${prevYear}-${prevMM}-01`;
  const periodEnd   = `${prevYear}-${prevMM}-${prevLastDD}`;

  // 이번달 1일 00:00:00 KST = UTC 전날 15:00:00
  // = Date.UTC(year, month-1, 0, 15, 0, 0)
  // = 이전달 마지막날 15:00 UTC
  const parentInputOpenAt = new Date(Date.UTC(year, month - 1, 0, 15, 0, 0));

  // analysisCutoffAt = parentInputOpenAt (이번달 1일 KST = 이전달 데이터 상한)
  const analysisCutoffAt = new Date(parentInputOpenAt.getTime());

  // 이번달 5일 00:00:00 KST = UTC 4일 15:00:00
  const parentInputCloseAt = new Date(Date.UTC(year, month - 1, 4, 15, 0, 0));

  return {
    reportPeriod,
    periodStart,
    periodEnd,
    parentInputOpenAt,
    analysisCutoffAt,
    parentInputCloseAt,
  };
}

/**
 * @deprecated Use computeMonthlyFreePeriodTimestamps instead.
 * 구 정책(25일 open/5일 close)은 제거됨. 하위호환 alias만 유지.
 */
export function computeCycleTimestamps(year: number, month: number) {
  return computeMonthlyFreePeriodTimestamps(year, month);
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
  reports_auto_published: number;
  reports_delivery_skipped: number;

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
    reports_auto_published: 0,
    reports_delivery_skipped: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// X-eligible pools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getXEligiblePools — FREE Growth Report 대상 pool 목록
 *
 * FREE eligibility = (paid OR manual) AND NOT force AND approval='approved'
 * xmode_config_status='READY' 불필요 — legacy paid X pool(TOYKIDS 등) 포함.
 */
export async function getXEligiblePools(db: Db): Promise<Array<{ id: string }>> {
  const res = await db.execute(sql.raw(`
    SELECT id FROM swimming_pools WHERE ${FREE_GROWTH_REPORT_ELIGIBLE_SQL}
  `));
  return res.rows as Array<{ id: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Open — 이전달 cycle 보장
// ─────────────────────────────────────────────────────────────────────────────

/**
 * openCycleForPool — 단일 pool의 이전달 cycle open 처리
 *
 * 1. Cycle 생성 (이미 있으면 ON CONFLICT DO NOTHING)
 * 2. PENDING → ACTIVE (idempotent: ACTIVE면 skip)
 * 3. pool의 active 학생들에게 NOT_OPEN report 생성 (ON CONFLICT DO NOTHING)
 * 4. NOT_OPEN → OPEN bulk update (period_start/period_end 올바른 날짜로 설정)
 * 5. audit (system)
 */
async function openCycleForPool(
  db: Db,
  poolId: string,
  timestamps: MonthlyFreePeriodTimestamps,
  result: GrowthReportSchedulerRunResult,
): Promise<string | null> {
  const { reportPeriod, periodStart, periodEnd, analysisCutoffAt, parentInputOpenAt, parentInputCloseAt } = timestamps;

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
      ${analysisCutoffAt.toISOString()},
      ${parentInputOpenAt.toISOString()},
      ${parentInputCloseAt.toISOString()},
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
      return cycleId; // 이미 열린 cycle — return ID for publish phase
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

  // 3. pool의 non-deleted 학생들에게 report 생성 (ON CONFLICT DO NOTHING)
  //    period_start/period_end = 이전달 첫날/마지막날 (KST 기준 날짜)
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
        ${periodStart}::date, ${periodEnd}::date
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

  // 4. NOT_OPEN → OPEN (bulk) — period_start/period_end도 올바르게 업데이트
  const openRes = await db.execute(sql`
    UPDATE growth_reports
    SET product_status = 'OPEN',
        parent_input_status = 'AVAILABLE',
        period_start = ${periodStart}::date,
        period_end   = ${periodEnd}::date,
        updated_at = now()
    WHERE cycle_id = ${cycleId}
      AND product_status = 'NOT_OPEN'
      AND deleted_at IS NULL
    RETURNING id
  `);

  const openedCount = (openRes.rows as any[]).length;
  result.reports_opened += openedCount;

  if (openedCount > 0) {
    await writeSchedulerAudit(
      db, cycleId, poolId,
      "NOT_OPEN", "OPEN",
      "MONTHLY_CYCLE_OPEN",
      { reports_opened: openedCount },
    );
    console.log(`[gr-scheduler] REPORTS_OPENED: cycle=${cycleId} count=${openedCount}`);
  }

  return cycleId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-publish — 5일 KST에 delivery eligible 학생에게 자동 발행
// ─────────────────────────────────────────────────────────────────────────────

/**
 * autoPublishMonthlyReports — REVIEW_REQUIRED 상태의 리포트를 자동 publish
 *
 * Delivery eligibility (§E):
 *   students.status = 'active' → eligible
 *   suspended / withdrawn → 제외
 *   makeup lesson 존재 여부는 판단 근거로 사용하지 않음
 *
 * Publication Safety (§K):
 *   analysis_status = COMPLETE
 *   report_content IS NOT NULL
 *   grounding_status IN ('PASS', 'REVISED_PASS')
 *   growth_framing_status IN ('PASS', 'REVISED_PASS') OR val_* fallback
 *   product_status = REVIEW_REQUIRED
 *
 * Idempotent: 이미 PUBLISHED인 경우 skip.
 */
async function autoPublishMonthlyReports(
  db: Db,
  reportPeriod: string,
  result: GrowthReportSchedulerRunResult,
): Promise<void> {
  // 발행 대상: REVIEW_REQUIRED + COMPLETE + report_content 존재 + safety pass
  const candidates = await db.execute(sql`
    SELECT
      gr.id               AS report_id,
      gr.student_id,
      gr.swimming_pool_id AS pool_id,
      gr.report_period,
      gr.analysis_status,
      gr.grounding_status,
      gr.growth_framing_status,
      gr.val_grounding_status,
      gr.val_growth_framing_status,
      gr.report_content,
      gr.report_fact_package,
      gr.sns_summary,
      s.status            AS student_status
    FROM growth_reports gr
    INNER JOIN students s ON s.id = gr.student_id
    WHERE gr.report_period = ${reportPeriod}
      AND gr.product_status = 'REVIEW_REQUIRED'
      AND gr.analysis_status = 'COMPLETE'
      AND gr.report_content IS NOT NULL
      AND gr.report_fact_package IS NOT NULL
      AND gr.sns_summary IS NOT NULL
      AND gr.deleted_at IS NULL
      AND s.deleted_at IS NULL
  `);

  const PASS_VALUES = new Set(["PASS", "REVISED_PASS"]);

  for (const row of candidates.rows as any[]) {
    const {
      report_id, student_id, pool_id, report_period: rPeriod,
      student_status,
      grounding_status, growth_framing_status,
      val_grounding_status, val_growth_framing_status,
    } = row;

    // ── Delivery eligibility check ──────────────────────────────────────────
    if (student_status !== "active") {
      result.reports_delivery_skipped++;
      console.log(
        `[gr-scheduler] DELIVERY_SKIP lifecycle: report=${report_id} student_status=${student_status}`,
      );
      continue;
    }

    // ── Publication safety check ────────────────────────────────────────────
    const groundingOk = PASS_VALUES.has(grounding_status) || PASS_VALUES.has(val_grounding_status);
    const framingOk   = PASS_VALUES.has(growth_framing_status) || PASS_VALUES.has(val_growth_framing_status);

    if (!groundingOk || !framingOk) {
      result.reports_delivery_skipped++;
      console.log(
        `[gr-scheduler] DELIVERY_SKIP safety: report=${report_id} grounding=${grounding_status} framing=${growth_framing_status}`,
      );
      continue;
    }

    // ── Auto-approve + Publish ──────────────────────────────────────────────
    try {
      const publishResult = await autoApproveAndPublishForDelivery({
        db,
        reportId: report_id,
        actorId:  "SYSTEM_MONTHLY_AUTO",
      });

      if (publishResult.alreadyPublished) {
        console.log(`[gr-scheduler] ALREADY_PUBLISHED: report=${report_id}`);
        continue;
      }

      result.reports_auto_published++;
      console.log(`[gr-scheduler] AUTO_PUBLISHED: report=${report_id} period=${rPeriod}`);

      // ── GR7: fire-and-forget notification ──────────────────────────────
      const studentId    = publishResult.studentId   ?? student_id;
      const poolId       = publishResult.poolId      ?? pool_id;
      const reportPeriodFinal = publishResult.reportPeriod ?? rPeriod;
      const publishedAt  = publishResult.publishedAt ?? new Date().toISOString();

      setImmediate(() => {
        notifyGrowthReportPublished({
          reportId:     report_id,
          studentId,
          poolId,
          reportPeriod: reportPeriodFinal,
          publishedAt,
          actorId:      "SYSTEM_MONTHLY_AUTO",
        }).catch(err => {
          console.error(`[gr-scheduler] GR7 notification failed report=${report_id}:`, err);
        });
      });
    } catch (err: any) {
      result.failed++;
      result.errors.push({ report_id, code: "AUTO_PUBLISH_FAILED", message: err.message });
      console.error(`[gr-scheduler] AUTO_PUBLISH_FAILED: report=${report_id}:`, err.message);
    }
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
 * runGrowthReportScheduler — 이전달 cycle ensure + 5일 auto-publish 통합 처리
 *
 * clock injection: now 파라미터로 synthetic date 테스트 가능.
 * 락 불필요: 호출부(cron)에서 acquireLock 처리.
 *
 * 처리 순서:
 *   1. X-eligible pool 목록 조회
 *   2. 이전달 cycle/report 보장 (1일 이후면 항상 실행)
 *   3. 5일 이후면: delivery eligible + safety pass report 자동 publish
 *
 * missed-run recovery:
 *   - PENDING cycles open_at <= now → open
 *   - 5일 이후면 auto-publish 재실행 (idempotent)
 */
export async function runGrowthReportScheduler(
  db: Db,
  now: Date = new Date(),
): Promise<GrowthReportSchedulerRunResult> {
  const runAt = now.toISOString();
  const result = emptyResult(runAt);

  const kst = getKSTDate(now);
  console.log(`[gr-scheduler] RUN: kst=${kst.isoDate} ${kst.hours}:${String(kst.minutes).padStart(2,"0")} KST`);

  // ── Step 1: X-eligible pool 목록 ─────────────────────────────────────────
  let xPools: Array<{ id: string }>;
  try {
    xPools = await getXEligiblePools(db);
  } catch (err: any) {
    console.error("[gr-scheduler] X-eligible pools 조회 실패:", err.message);
    result.errors.push({ code: "X_POOLS_FETCH_FAILED", message: err.message });
    return result;
  }

  // ── Step 2: 이전달 period timestamps 계산 ────────────────────────────────
  const ts = computeMonthlyFreePeriodTimestamps(kst.year, kst.month);
  console.log(
    `[gr-scheduler] period=${ts.reportPeriod} ` +
    `start=${ts.periodStart} end=${ts.periodEnd} ` +
    `openAt=${ts.parentInputOpenAt.toISOString()} ` +
    `closeAt=${ts.parentInputCloseAt.toISOString()}`,
  );

  // ── Step 3: Cycle/Report ensure (1일 이후면 항상 실행) ───────────────────
  const shouldOpen = now.getTime() >= ts.parentInputOpenAt.getTime();

  if (shouldOpen && xPools.length > 0) {
    for (const pool of xPools) {
      try {
        await openCycleForPool(db, pool.id, ts, result);
      } catch (err: any) {
        console.error(`[gr-scheduler] OPEN 실패: pool=${pool.id}:`, err.message);
        result.failed++;
        result.errors.push({ pool_id: pool.id, code: "CYCLE_OPEN_FAILED", message: err.message });
      }
    }
  } else if (!shouldOpen) {
    console.log(`[gr-scheduler] 1일 미도달 — open skip`);
  }

  // missed-run recovery: 이전 주기의 PENDING cycles (open_at <= now)
  try {
    const pRes = await db.execute(sql`
      SELECT id, swimming_pool_id, report_period, parent_input_open_at
      FROM growth_report_cycles
      WHERE cycle_status = 'PENDING'
        AND parent_input_open_at <= ${now.toISOString()}
    `);
    const pendingCycles = pRes.rows as any[];

    for (const cycle of pendingCycles) {
      if (cycle.report_period === ts.reportPeriod) continue; // 이미 처리됨

      try {
        const [pyStr, pmStr] = (cycle.report_period as string).split("-");
        const py = Number(pyStr); const pm = Number(pmStr);
        // 해당 period의 current month = pm+1 (because reportPeriod = prevMonth)
        const cmYear  = pm === 12 ? py + 1 : py;
        const cmMonth = pm === 12 ? 1 : pm + 1;
        const missedTs = computeMonthlyFreePeriodTimestamps(cmYear, cmMonth);
        await openCycleForPool(db, cycle.swimming_pool_id, missedTs, result);
      } catch (err: any) {
        console.error(`[gr-scheduler] MISSED OPEN 실패: cycle=${cycle.id}:`, err.message);
        result.failed++;
        result.errors.push({ cycle_id: cycle.id, code: "MISSED_OPEN_FAILED", message: err.message });
      }
    }
  } catch (err: any) {
    console.error("[gr-scheduler] PENDING cycles 조회 실패:", err.message);
    result.errors.push({ code: "PENDING_CYCLES_FETCH_FAILED", message: err.message });
  }

  // ── Step 4: 5일 이후 → auto-publish ──────────────────────────────────────
  const shouldPublish = now.getTime() >= ts.parentInputCloseAt.getTime();

  if (shouldPublish) {
    try {
      await autoPublishMonthlyReports(db, ts.reportPeriod, result);
    } catch (err: any) {
      console.error("[gr-scheduler] auto-publish 실패:", err.message);
      result.errors.push({ code: "AUTO_PUBLISH_BATCH_FAILED", message: err.message });
    }
  } else {
    const daysUntilPublish = Math.ceil(
      (ts.parentInputCloseAt.getTime() - now.getTime()) / (24 * 3600 * 1000),
    );
    console.log(
      `[gr-scheduler] 5일 미도달 (D-${daysUntilPublish}) — auto-publish skip`,
    );
  }

  console.log(
    `[gr-scheduler] DONE: ` +
    `cycles_created=${result.cycles_created} opened=${result.cycles_opened} ` +
    `reports_opened=${result.reports_opened} ` +
    `auto_published=${result.reports_auto_published} ` +
    `delivery_skipped=${result.reports_delivery_skipped} ` +
    `failed=${result.failed}`,
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureCurrentMonthGrowthReportCycle — READY 전환 직후 즉시 보충 (super.ts용)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ensureCurrentMonthGrowthReportCycle — 단일 pool에 대해 이전달 cycle을 즉시 보충
 *
 * PATCH /super/operators/:id/xmode (READY 전환 성공) 직후 호출.
 * 1일 이후라면 cycle + report row를 idempotent하게 생성.
 * 1일 이전이면 no-op (정상 scheduler에 위임).
 */
export async function ensureCurrentMonthGrowthReportCycle(
  poolId: string,
  db:     Db,
  now:    Date = new Date(),
): Promise<{ skipped: string } | { opened: true; cycleId: string; reportsCreated: number }> {
  const kst = getKSTDate(now);
  const ts  = computeMonthlyFreePeriodTimestamps(kst.year, kst.month);

  // 1일 이전이면 no-op
  if (now.getTime() < ts.parentInputOpenAt.getTime()) {
    console.log(`[gr-ensure] 1일 이전 — no-op: pool=${poolId} openAt=${ts.parentInputOpenAt.toISOString()}`);
    return { skipped: "BEFORE_OPEN_DATE" };
  }

  // Eligible 확인
  const eligRows = await db.execute(sql`
    SELECT id FROM swimming_pools
    WHERE id = ${poolId}
      AND (COALESCE(x_paid_entitlement,   false) OR COALESCE(x_manual_entitlement, false))
      AND NOT COALESCE(x_force_disabled,  false)
      AND approval_status = 'approved'
    LIMIT 1
  `);
  if (!eligRows.rows.length) {
    console.log(`[gr-ensure] eligibility 조건 미충족 — no-op: pool=${poolId}`);
    return { skipped: "NOT_ELIGIBLE" };
  }

  const result = emptyResult(now.toISOString());
  await openCycleForPool(db, poolId, ts, result);
  console.log(`[gr-ensure] DONE: pool=${poolId} period=${ts.reportPeriod} created=${result.cycles_created} opened=${result.cycles_opened} reports=${result.reports_opened}`);
  return { opened: true, cycleId: "opened", reportsCreated: result.reports_opened };
}

// ─────────────────────────────────────────────────────────────────────────────
// startGrowthReportScheduler — cron 등록
// ─────────────────────────────────────────────────────────────────────────────

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
        auto_published: result.reports_auto_published,
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
