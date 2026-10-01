/**
 * growth-report-batch-worker.ts — WP8: Monthly Auto Generation Worker
 *
 * 역할:
 *   - 매월 1일 01:10 KST cron (daily recovery): X-active pool별 batch job 생성
 *   - Worker loop (매 5분): PENDING batch job claim → 학생별 report 생성/분석
 *   - Batch completion is preparation-only; admin readiness derives from reports
 *
 * 설계 원칙:
 *   - Durable: DB-backed batch_jobs (Render restart 후 작업 재개)
 *   - Multi-instance safe: FOR UPDATE SKIP LOCKED claim
 *   - Idempotent: ON CONFLICT DO NOTHING batch creation
 *   - Concurrency limit: MAX_POOL_WORKERS pool 동시 처리 제한
 *   - 배치의 row 준비 완료와 실제 PUBLISHED 완료는 별개
 *
 * 기존 worker 재사용:
 *   - 학생별 AI 분석: runGrowthReportAnalysisWorker (기존) 재사용
 *   - 새 row INSERT: REGENERATING → PREANALYZING → ... → REVIEW_REQUIRED
 *   - 배치 완료 후: REVIEW_REQUIRED → READY_TO_SEND (autoValidate)
 *
 * 분리:
 *   - AI ENGINE 직접 호출: 이 파일 금지
 *   - business scheduling 소유: SERVER (AI ENGINE 금지)
 */

import cron                                from "node-cron";
import { sql }                             from "drizzle-orm";
import { superAdminDb }                    from "@workspace/db";
import { acquireLock, releaseLock }        from "../lib/schedulerLock.js";
import { notifyPoolEvent }                from "../lib/pg-realtime.js";
import { FREE_GROWTH_REPORT_ELIGIBLE_SQL } from "../lib/growth-report-eligibility.js";
import {
  getSealedMonthlyTargetRoster,
  sealMonthlyTargets,
} from "../lib/growth-report-monthly-targets.js";
import { computeMonthlyFreePeriodTimestamps } from "./growth-report-scheduler.js";
import {
  transitionToReadyToSend,
  refreshWp8Snapshot,
}                                          from "../lib/growth-report-production-service.js";
import { retryGrowthReportNotifications } from "../utils/notify.js";
import { runMonthlyFreeAutoPublication } from "./growth-report-auto-publisher.js";

type Db = typeof superAdminDb;

// ── Configuration ─────────────────────────────────────────────────────────────

const BATCH_LOCK    = "growth-report-batch-worker";
const LOCK_TTL      = 600;          // 10분 (Standard 인스턴스 처리량 증가 반영)
const STALE_RUNNING = 30 * 60;     // 30분 이상 RUNNING → stale (재claim 가능)
const MAX_POOL_WORKERS = 2;        // 동시 처리 pool 수 (부하 분산)
const STUDENT_CONCURRENCY = 3;     // pool 내 학생 동시 처리 (병렬)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;  // KST = UTC+9
const MAX_BATCH_ATTEMPTS = 3;      // FAILED/PARTIAL 배치 최대 재시도 횟수
const MAX_RECOVERY_MONTHS = 12;

// 월별 자동 생성 실행 여부 (env fail-closed)
function isBatchEnabled(): boolean {
  return process.env["GROWTH_REPORT_BATCH_AUTO_ENABLED"] === "true";
}

// ── KST date helpers ──────────────────────────────────────────────────────────

export function getKSTNow(utcNow: Date = new Date()): { year: number; month: number } {
  const kst = new Date(utcNow.getTime() + KST_OFFSET_MS);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1 };
}

// ── getXEligiblePools ─────────────────────────────────────────────────────────
// X mode active pools — scheduler와 동일한 FREE_GROWTH_REPORT_ELIGIBLE_SQL 사용.
// 이전 x_pool_subscriptions JOIN은 해당 테이블이 존재하지 않아 항상 오류 발생.

export async function getXEligiblePools(db: Db): Promise<string[]> {
  const r = await db.execute(sql.raw(`
    SELECT id FROM swimming_pools
    WHERE ${FREE_GROWTH_REPORT_ELIGIBLE_SQL}
  `));
  return (r.rows as any[]).map(row => row.id as string);
}

// ── getEligibleStudents ───────────────────────────────────────────────────────
// 해당 pool/period의 대상 학생 (기존 eligibility logic 재사용)

export async function getEligibleStudents(
  db: Db,
  poolId: string,
  reportPeriod: string,   // 'YYYY-MM'
  cycleId: string,
): Promise<Array<{ studentId: string; classGroupId: string | null }>> {
  const cycle = await db.execute(sql`
    SELECT id
    FROM growth_report_cycles
    WHERE id = ${cycleId}
      AND swimming_pool_id = ${poolId}
      AND report_period = ${reportPeriod}
      AND eligibility_sealed_at IS NOT NULL
    LIMIT 1
  `);
  if (!cycle.rows.length) {
    throw new Error(`Monthly target roster is not sealed for cycle ${cycleId}.`);
  }
  const roster = await getSealedMonthlyTargetRoster(db, cycleId);
  return roster.map(({ studentId }) => ({ studentId, classGroupId: null }));
}

// ── ensureBatchJobs ───────────────────────────────────────────────────────────

export async function ensureBatchJobs(
  db: Db,
  poolIds: string[],
  year: number,
  month: number,
): Promise<{ ensured: number; failed: number }> {
  let ensured = 0;
  let failed = 0;
  for (const poolId of poolIds) {
    try {
      await db.execute(sql`
        INSERT INTO growth_report_batch_jobs
          (swimming_pool_id, year, month, job_type, status, next_attempt_at)
        VALUES
          (${poolId}, ${year}, ${month}, 'MONTHLY_AUTO', 'PENDING', NOW())
        ON CONFLICT DO NOTHING
      `);
      ensured++;
    } catch (err: any) {
      failed++;
      console.error(`[gr-batch] batch job preparation failed pool=${poolId}:`, err.message);
    }
  }
  console.log(`[gr-batch] batch job preparation pool_count=${poolIds.length} ensured=${ensured} failed=${failed} year=${year} month=${month}`);
  return { ensured, failed };
}

// ── claimJob ─────────────────────────────────────────────────────────────────

interface BatchJob {
  id: string;
  worker_id: string;
  swimming_pool_id: string;
  year: number;
  month: number;
  status: string;
  target_count: number;
  completed_count: number;
  failed_count: number;
  attempts: number;
}

async function claimJob(db: Db): Promise<BatchJob | null> {
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - STALE_RUNNING * 1000).toISOString();
  const maxAttempts = MAX_BATCH_ATTEMPTS;

  const r = await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET status        = 'RUNNING',
        worker_id     = gen_random_uuid()::text,
        locked_at     = NOW(),
        attempts      = attempts + 1,
        completed_count = 0,
        failed_count    = 0,
        started_at    = COALESCE(started_at, NOW()),
        updated_at    = NOW()
    WHERE id = (
      SELECT id FROM growth_report_batch_jobs
      WHERE (
        -- PENDING — 첫 실행
        status = 'PENDING'
        -- stale RUNNING — heartbeat 없이 30분 경과 → 재claim
        OR (status = 'RUNNING' AND (locked_at IS NULL OR locked_at < ${staleThreshold}))
        -- FAILED/PARTIAL — 재시도 가능 (attempts < max + next_attempt_at 경과)
        OR (status IN ('FAILED','PARTIAL') AND attempts < ${maxAttempts} AND next_attempt_at <= ${now})
      )
      AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
      AND status NOT IN ('COMPLETED')
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  if (!r.rows.length) return null;
  return r.rows[0] as unknown as BatchJob;
}

async function heartbeatBatchJob(db: Db, jobId: string, workerId: string): Promise<void> {
  const result = await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET locked_at = NOW(), updated_at = NOW()
    WHERE id = ${jobId}
      AND worker_id = ${workerId}
      AND status = 'RUNNING'
    RETURNING id
  `);
  if (!(result.rows as any[]).length) {
    throw new Error("BATCH_WORKER_FENCE_LOST");
  }
}

async function lockBatchJobOwner(tx: any, jobId: string, workerId: string): Promise<void> {
  const owner = await tx.execute(sql`
    SELECT id
    FROM growth_report_batch_jobs
    WHERE id = ${jobId}
      AND worker_id = ${workerId}
      AND status = 'RUNNING'
    FOR UPDATE
  `);
  if (!(owner.rows as any[]).length) {
    throw new Error("BATCH_WORKER_FENCE_LOST");
  }
}

// ── processPoolBatch ──────────────────────────────────────────────────────────

async function processPoolBatch(db: Db, job: BatchJob): Promise<void> {
  const { id: jobId, worker_id: workerId, swimming_pool_id: poolId, year, month } = job;

  // report_period = previous month
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const reportPeriod = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const cycleTimes = computeMonthlyFreePeriodTimestamps(year, month);

  // ── 1. cycle_id 가져오기 (없으면 생성) ───────────────────────────────────
  const cycleId = await ensureBatchCycle(db, poolId, reportPeriod, year, month, cycleTimes);

  if (!cycleId) {
    console.error(`[gr-batch] CYCLE_MISSING pool=${poolId} period=${reportPeriod}`);
    await markJobFailed(db, jobId, workerId, "CYCLE_MISSING");
    return;
  }
  const resolvedCycleId: string = cycleId; // closure 내 타입 좁히기

  // ── 2. 봉인된 cycle roster 확보 ───────────────────────────────────────────
  await sealMonthlyTargets(db, {
    cycleId: resolvedCycleId,
    poolId,
    reportPeriod,
  });
  await db.transaction(async (tx: any) => {
    await lockBatchJobOwner(tx, jobId, workerId);
    await tx.execute(sql`
      UPDATE growth_reports
      SET product_status = 'OPEN',
          batch_job_id = COALESCE(batch_job_id, ${jobId}),
          period_start = ${cycleTimes.periodStart}::date,
          period_end = ${cycleTimes.periodEnd}::date,
          updated_at = NOW()
      WHERE cycle_id = ${resolvedCycleId}
        AND product_status IN ('NOT_OPEN', 'OPEN')
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM growth_report_eligible_targets target
          WHERE target.cycle_id = growth_reports.cycle_id
            AND target.student_id = growth_reports.student_id
        )
    `);
  });
  const students = await getEligibleStudents(db, poolId, reportPeriod, resolvedCycleId);

  if (job.attempts <= 1) {
    const targetCountSet = await db.execute(sql`
      UPDATE growth_report_batch_jobs
      SET target_count = ${students.length}, updated_at = NOW(), locked_at = NOW()
      WHERE id = ${jobId}
        AND worker_id = ${workerId}
        AND status = 'RUNNING'
      RETURNING id
    `);
    if (!(targetCountSet.rows as any[]).length) {
      throw new Error("BATCH_WORKER_FENCE_LOST");
    }
  } else {
    await heartbeatBatchJob(db, jobId, workerId);
  }

  console.log(`[gr-batch] pool=${poolId} period=${reportPeriod} target_students=${students.length}`);

  if (students.length === 0) {
    await markJobComplete(db, jobId, workerId, 0, 0, poolId);
    return;
  }

  // ── 3. 학생별 report 생성/분석 (STUDENT_CONCURRENCY 병렬) ───────────────
  let completed = 0;
  let failed    = 0;

  const periodStart = cycleTimes.periodStart;
  const periodEnd = cycleTimes.periodEnd;

  // concurrency-limited worker pool (p-limit 없이 직접 구현)
  let studentIdx = 0;
  const studentMutex = { completed: 0, failed: 0 };

  async function studentWorker(): Promise<void> {
    while (true) {
      const i = studentIdx++;
      if (i >= students.length) break;
      const { studentId, classGroupId } = students[i]!;
      let studentSucceeded = false;
      try {
        await heartbeatBatchJob(db, jobId, workerId);
        await processStudentReport(db, {
          studentId, poolId, cycleId: resolvedCycleId, classGroupId, reportPeriod, jobId,
          workerId, periodStart, periodEnd,
        });
        studentMutex.completed++;
        studentSucceeded = true;
      } catch (err: any) {
        console.error(`[gr-batch] student preparation failed pool=${poolId}`);
        studentMutex.failed++;
        // 한 학생 오류가 전체 pool을 중단시키지 않도록 continue
      }
      // Atomic progress and lease heartbeat. Every write is fenced by owner ID.
      const progress = await db.execute(sql`
        UPDATE growth_report_batch_jobs
        SET completed_count = completed_count + ${studentSucceeded ? 1 : 0},
            failed_count = failed_count + ${studentSucceeded ? 0 : 1},
            locked_at = NOW(),
            updated_at = NOW()
        WHERE id = ${jobId}
          AND worker_id = ${workerId}
          AND status = 'RUNNING'
        RETURNING id
      `);
      if (!(progress.rows as any[]).length) {
        throw new Error("BATCH_WORKER_FENCE_LOST");
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(STUDENT_CONCURRENCY, students.length) }, studentWorker),
  );

  completed = studentMutex.completed;
  failed    = studentMutex.failed;

  // ── 4. Pool completion: REVIEW_REQUIRED → READY_TO_SEND ─────────────────
  await finalizePoolBatch(db, poolId, reportPeriod, year, month, jobId, workerId);

  // ── 5. Job 완료 ───────────────────────────────────────────────────────────
  const finalStatus = failed > 0 && completed === 0 ? "FAILED"
    : failed > 0 ? "PARTIAL"
    : "COMPLETED";

  // COMPLETED is terminal status for this batch-preparation pass only; it does
  // not imply that a report was published. Publication remains an admin action.
  await markJobComplete(db, jobId, workerId, completed, failed, poolId);
  console.log(
    `[gr-batch] PREPARATION_FINISHED pool=${poolId} period=${reportPeriod} ` +
    `batch_job_status=${finalStatus} prepared=${completed} failed=${failed} published=0`
  );
}

export async function ensureBatchCycle(
  db: Db,
  poolId: string,
  reportPeriod: string,
  year: number,
  month: number,
  cycleTimes = computeMonthlyFreePeriodTimestamps(year, month),
): Promise<string | null> {
  const cycleRes = await db.execute(sql`
    SELECT id, cycle_status FROM growth_report_cycles
    WHERE swimming_pool_id = ${poolId}
      AND report_period = ${reportPeriod}
    LIMIT 1
  `);
  if (cycleRes.rows.length) {
    // Existing ACTIVE cycle is authoritative and is never replaced by the batch worker.
    return (cycleRes.rows[0] as any).id as string;
  }

  const newCycle = await db.execute(sql`
    INSERT INTO growth_report_cycles (
      swimming_pool_id, report_period,
      analysis_from, analysis_cutoff_at,
      parent_input_open_at, parent_input_close_at,
      timezone, cycle_status
    )
    VALUES (
      ${poolId}, ${reportPeriod},
      NULL, ${cycleTimes.analysisCutoffAt.toISOString()},
      ${cycleTimes.parentInputOpenAt.toISOString()},
      ${cycleTimes.parentInputCloseAt.toISOString()},
      'Asia/Seoul', 'ACTIVE'
    )
    ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
    RETURNING id
  `);

  if (newCycle.rows.length) return (newCycle.rows[0] as any).id as string;

  const reFetch = await db.execute(sql`
    SELECT id FROM growth_report_cycles
    WHERE swimming_pool_id = ${poolId}
      AND report_period = ${reportPeriod}
    LIMIT 1
  `);
  return reFetch.rows.length ? (reFetch.rows[0] as any).id as string : null;
}

// ── processStudentReport ──────────────────────────────────────────────────────

interface StudentReportParams {
  studentId:    string;
  poolId:       string;
  cycleId:      string;
  classGroupId: string | null;
  reportPeriod: string;
  periodStart:  string;
  periodEnd:    string;
  jobId:        string;
  workerId:     string;
}

async function processStudentReport(
  db: Db,
  params: StudentReportParams,
): Promise<void> {
  const {
    studentId, poolId, cycleId, classGroupId, reportPeriod,
    periodStart, periodEnd, jobId, workerId,
  } = params;

  // 이미 존재하는 active report 확인 (idempotency)
  const existing = await db.execute(sql`
    SELECT id, product_status FROM growth_reports
    WHERE student_id       = ${studentId}
      AND cycle_id         = ${cycleId}
      AND product_status  != 'DISCARDED'
      AND deleted_at IS NULL
    LIMIT 1
  `);

  if (existing.rows.length) {
    const existRow = existing.rows[0] as any;
    const s = existRow.product_status as string;
    // 이미 READY_TO_SEND / PUBLISHED → skip
    if (["READY_TO_SEND", "PUBLISHED"].includes(s)) {
      console.log(`[gr-batch] SKIP already ${s}: pool=${poolId}`);
      return;
    }
    // Existing rows, including FAILED/EXCLUDED/DISCARDED terminal rows, remain
    // authoritative. Recovery must never reset a terminal report automatically.
    return;
  }

  // 신규 report row INSERT (OPEN 상태)
  // class_group_id_at_creation 컬럼 운영 DB 미존재 — 제외
  await db.transaction(async (tx: any) => {
    await lockBatchJobOwner(tx, jobId, workerId);
    await tx.execute(sql`
      INSERT INTO growth_reports (
        student_id, swimming_pool_id, cycle_id,
        report_period, period_start, period_end,
        product_status, version_number, batch_job_id,
        eligibility_version, attendance_count, source_event_count,
        created_at, updated_at
      )
      SELECT
        ${studentId}, ${poolId}, ${cycleId},
        ${reportPeriod}, ${periodStart}::date, ${periodEnd}::date,
        'OPEN', 1, ${jobId},
        target.eligibility_version,
        (target.eligibility_evidence->>'attendance_count')::integer,
        (target.eligibility_evidence->>'source_event_count')::integer,
        NOW(), NOW()
      FROM growth_report_eligible_targets target
      WHERE target.cycle_id = ${cycleId}
        AND target.student_id = ${studentId}
      ON CONFLICT DO NOTHING
    `);
  });

  console.log(`[gr-batch] REPORT_ROW_PREPARED: pool=${poolId}`);
}

// ── finalizePoolBatch ─────────────────────────────────────────────────────────

async function finalizePoolBatch(
  db: Db,
  poolId: string,
  reportPeriod: string,
  year: number,
  month: number,
  jobId: string,
  workerId: string,
): Promise<void> {
  // 해당 pool/period의 batch-generated REVIEW_REQUIRED 리포트 → READY_TO_SEND
  const reviewRequired = await db.execute(sql`
    SELECT id FROM growth_reports
    WHERE swimming_pool_id = ${poolId}
      AND report_period    = ${reportPeriod}
      AND product_status   = 'REVIEW_REQUIRED'
      AND batch_job_id = ${jobId}
      AND deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM growth_report_batch_jobs job
        WHERE job.id = ${jobId}
          AND job.worker_id = ${workerId}
          AND job.status = 'RUNNING'
      )
  `);

  let readyCount = 0;
  for (const row of reviewRequired.rows as any[]) {
    await heartbeatBatchJob(db, jobId, workerId);
    try {
      const r = await db.transaction(async (tx: any) => {
        await lockBatchJobOwner(tx, jobId, workerId);
        return transitionToReadyToSend(tx, row.id, "SYSTEM_WP8_FINALIZE");
      });
      if (r.success) readyCount++;
    } catch (err: any) {
      console.error(`[gr-batch] finalize error report=${row.id}:`, err.message);
    }
  }
  console.log(`[gr-batch] finalized pool=${poolId} period=${reportPeriod} ready_to_send=${readyCount}`);

  // KPI refresh
  try {
    await refreshWp8Snapshot(db, { poolId, year, month });
  } catch (err: any) {
    console.error(`[gr-batch] KPI refresh failed:`, err.message);
  }

  // Readiness notification is sent by the fifth-day admin review opener, not
  // batch completion. Partial/failed batches never hide successful reports.
}

// ── markJobFailed / markJobComplete ──────────────────────────────────────────

async function markJobFailed(
  db: Db,
  jobId: string,
  workerId: string,
  reason: string,
): Promise<void> {
  const updated = await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET status = 'FAILED',
        updated_at = NOW(),
        locked_at = NULL,
        next_attempt_at = CASE
          WHEN attempts < ${MAX_BATCH_ATTEMPTS}
            THEN NOW() + (
              LEAST(60, 5 * power(2, GREATEST(attempts - 1, 0)))::int
              * INTERVAL '1 minute'
            )
          ELSE NULL
        END
    WHERE id = ${jobId}
      AND worker_id = ${workerId}
      AND status = 'RUNNING'
    RETURNING id
  `);
  if (!(updated.rows as any[]).length) return;
  console.log(`[gr-batch] JOB_FAILED id=${jobId} reason=${reason}`);

  // 운영자 알림 — 배치 잡 자체가 실패했을 때
  const { sendOperatorAlert } = await import("../lib/sendOperatorAlert.js");
  await sendOperatorAlert(
    `성장리포트 배치 잡 실패\njob=${jobId}\n사유: ${reason.slice(0, 100)}`,
  );
}

async function markJobComplete(
  db: Db,
  jobId: string,
  workerId: string,
  completed: number,
  failed: number,
  poolId?: string,
): Promise<void> {
  const status = failed > 0 && completed === 0 ? "FAILED" : failed > 0 ? "PARTIAL" : "COMPLETED";
  const updated = await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET status = ${status}, completed_count = ${completed}, failed_count = ${failed},
        completed_at = CASE WHEN ${status} = 'COMPLETED' THEN NOW() ELSE NULL END,
        locked_at = NULL,
        next_attempt_at = CASE
          WHEN ${status} IN ('FAILED', 'PARTIAL') AND attempts < ${MAX_BATCH_ATTEMPTS}
            THEN NOW() + (
              LEAST(60, 5 * power(2, GREATEST(attempts - 1, 0)))::int
              * INTERVAL '1 minute'
            )
          ELSE NULL
        END,
        updated_at = NOW()
    WHERE id = ${jobId}
      AND worker_id = ${workerId}
      AND status = 'RUNNING'
    RETURNING id
  `);
  if (!(updated.rows as any[]).length) {
    throw new Error("BATCH_WORKER_FENCE_LOST");
  }
  if (poolId) {
    notifyPoolEvent({ type: "growth_report.changed", pool_id: poolId }).catch(() => {});
  }
}

// ── runMonthlyBatchCron ───────────────────────────────────────────────────────
// Daily from KST day 1: the batch prepares analysis rows; it never publishes.

function getRecoveryIssueMonths(now: Date): Array<{ year: number; month: number }> {
  const current = getKSTNow(now);
  const configured = Number(process.env["GROWTH_REPORT_RECOVERY_MONTHS"] ?? 2);
  const recoveryMonths = Number.isFinite(configured)
    ? Math.max(0, Math.min(MAX_RECOVERY_MONTHS, Math.floor(configured)))
    : 2;
  return Array.from({ length: recoveryMonths + 1 }, (_, offset) => {
    const date = new Date(Date.UTC(current.year, current.month - 1 - offset, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });
}

export async function runMonthlyBatchCron(db: Db, now: Date = new Date()): Promise<void> {
  if (!isBatchEnabled()) {
    console.log("[gr-batch] DISABLED (GROWTH_REPORT_BATCH_AUTO_ENABLED != true)");
    return;
  }

  const issueMonths = getRecoveryIssueMonths(now);
  console.log(`[gr-batch] KST daily preparation run periods=${issueMonths.length}`);

  try {
    const poolIds = await getXEligiblePools(db);
    if (!poolIds.length) {
      console.log("[gr-batch] no X-eligible pools");
      return;
    }
    let ensured = 0;
    let failed = 0;
    for (const issueMonth of issueMonths) {
      const prep = await ensureBatchJobs(db, poolIds, issueMonth.year, issueMonth.month);
      ensured += prep.ensured;
      failed += prep.failed;
    }
    console.log(`[gr-batch] batch preparation finished ensured=${ensured} failed=${failed}`);
  } catch (err: any) {
    console.error("[gr-batch] monthly cron failed:", err.message);
  }
}

// ── runBatchWorker ────────────────────────────────────────────────────────────

export async function runBatchWorker(db: Db): Promise<void> {
  if (!isBatchEnabled()) return;

  const acquired = await acquireLock(BATCH_LOCK, LOCK_TTL);
  if (!acquired) {
    console.log("[gr-batch] worker lock not acquired — another instance running");
    return;
  }

  let processed = 0;
  try {
    for (let i = 0; i < MAX_POOL_WORKERS; i++) {
      const job = await claimJob(db);
      if (!job) break;

      console.log(`[gr-batch] claimed job=${job.id} pool=${job.swimming_pool_id} year=${job.year} month=${job.month}`);
      const heartbeat = setInterval(() => {
        heartbeatBatchJob(db, job.id, job.worker_id).catch((error: any) => {
          console.warn(`[gr-batch] job heartbeat lost job=${job.id}:`, error.message);
        });
      }, 60_000);
      heartbeat.unref?.();
      try {
        await processPoolBatch(db, job);
        processed++;
      } catch (err: any) {
        console.error(`[gr-batch] job=${job.id} failed:`, err.message);
        await markJobFailed(db, job.id, job.worker_id, err.message.slice(0, 200));
      } finally {
        clearInterval(heartbeat);
      }
    }
  } finally {
    await releaseLock(BATCH_LOCK);
  }

  if (processed > 0) {
    console.log(`[gr-batch] worker done processed=${processed}`);
  }
}

// ── startupBatchRecovery ──────────────────────────────────────────────────────
// Server restart recovery re-ensures current and bounded prior preparation
// months. Existing terminal report/batch states are never reset here.

export async function startupBatchRecovery(db: Db, now: Date = new Date()): Promise<void> {
  if (!isBatchEnabled()) return;
  console.log("[gr-batch] startup recovery: ensuring current and bounded incomplete periods");
  await runMonthlyBatchCron(db, now);
}

// ── startGrowthReportBatchWorker ──────────────────────────────────────────────

export function startGrowthReportBatchWorker(): void {
  const db = superAdminDb;

  // Daily at 01:10 KST so KST day-1 cycle/report preparation is independent
  // of process timezone. Recovery also ensures the current period separately.
  cron.schedule("10 1 * * *", async () => {
    console.log("[gr-batch] daily monthly-cycle preparation trigger");
    await runMonthlyBatchCron(db).catch(e =>
      console.error("[gr-batch] monthly cron error:", e.message)
    );
  }, { timezone: "Asia/Seoul" });

  // Every five minutes: preparation/recovery, admin review opening, and
  // durable push delivery. Auto-publisher is now review-only, never publish.
  cron.schedule("*/5 * * * *", async () => {
    await runBatchWorker(db).catch(e =>
      console.error("[gr-batch] worker error:", e.message)
    );
    if (isBatchEnabled()) {
      await runMonthlyFreeAutoPublication(db).catch(e =>
        console.error("[gr-admin-review] worker error:", e.message)
      );
    }
    await retryGrowthReportNotifications().catch(e =>
      console.error("[gr-admin-notification] retry worker error:", e.message)
    );
  }, { timezone: "Asia/Seoul" });

  // 서버 시작 45초 후 — 5일 이후 downtime recovery
  setTimeout(async () => {
    await startupBatchRecovery(db).catch(e =>
      console.error("[gr-batch] startup recovery error:", e.message)
    );
  }, 45_000);

  console.log("[gr-batch] scheduler started (daily KST preparation + 5min worker + startup recovery)");
}
