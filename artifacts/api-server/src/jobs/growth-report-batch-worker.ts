/**
 * growth-report-batch-worker.ts — WP8: Monthly Auto Generation Worker
 *
 * 역할:
 *   - 매월 5일 02:00 KST cron: X-active pool별 batch job 생성 (PENDING)
 *   - Worker loop (매 5분): PENDING batch job claim → 학생별 report 생성/분석
 *   - Pool completion detection → REVIEW_REQUIRED → READY_TO_SEND → admin push
 *
 * 설계 원칙:
 *   - Durable: DB-backed batch_jobs (Render restart 후 작업 재개)
 *   - Multi-instance safe: FOR UPDATE SKIP LOCKED claim
 *   - Idempotent: ON CONFLICT DO NOTHING batch creation
 *   - Concurrency limit: MAX_POOL_WORKERS pool 동시 처리 제한
 *   - AUTO GENERATE ≠ AUTO SEND (관리자 발송 필수)
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
import {
  transitionToReadyToSend,
  refreshWp8Snapshot,
}                                          from "../lib/growth-report-production-service.js";
import { notifyBatchComplete }             from "../utils/notify.js";

type Db = typeof superAdminDb;

// ── Configuration ─────────────────────────────────────────────────────────────

const BATCH_LOCK    = "growth-report-batch-worker";
const LOCK_TTL      = 300;          // 5분
const STALE_RUNNING = 30 * 60;     // 30분 이상 RUNNING → stale (재claim 가능)
const MAX_POOL_WORKERS = 2;        // 동시 처리 pool 수 (부하 분산)
const STUDENT_CONCURRENCY = 1;     // pool 내 학생 동시 처리 (순차)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;  // KST = UTC+9
const MAX_BATCH_ATTEMPTS = 3;      // FAILED/PARTIAL 배치 최대 재시도 횟수

// 월별 자동 생성 실행 여부 (env fail-closed)
function isBatchEnabled(): boolean {
  return process.env["GROWTH_REPORT_BATCH_AUTO_ENABLED"] === "true";
}

// ── KST date helper ───────────────────────────────────────────────────────────

export function getKSTNow(utcNow: Date = new Date()): { year: number; month: number } {
  const kst = new Date(utcNow.getTime() + KST_OFFSET_MS);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1 };
}

// ── getXEligiblePools ─────────────────────────────────────────────────────────
// X mode active pools (기존 growth-report-scheduler.ts와 동일 로직)

async function getXEligiblePools(db: Db): Promise<string[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT sp.id
    FROM swimming_pools sp
    INNER JOIN x_pool_subscriptions xps ON xps.pool_id = sp.id
    WHERE xps.status IN ('ACTIVE','TRIAL')
      AND sp.deleted_at IS NULL
  `);
  return (r.rows as any[]).map(row => row.id as string);
}

// ── getEligibleStudents ───────────────────────────────────────────────────────
// 해당 pool/period의 대상 학생 (기존 eligibility logic 재사용)

async function getEligibleStudents(
  db: Db,
  poolId: string,
  reportPeriod: string,   // 'YYYY-MM'
  cycleId: string,
): Promise<Array<{ studentId: string; classGroupId: string | null }>> {
  const [py, pm] = reportPeriod.split("-").map(Number);
  const periodStart = `${py}-${String(pm).padStart(2, "0")}-01`;
  const nextMonth   = pm === 12 ? `${py + 1}-01-01` : `${py}-${String(pm + 1).padStart(2, "0")}-01`;

  const r = await db.execute(sql`
    SELECT DISTINCT
      s.id            AS student_id,
      sch.class_group_id
    FROM students s
    INNER JOIN student_class_history sch ON sch.student_id = s.id
    INNER JOIN class_groups cg ON cg.id = sch.class_group_id
    WHERE cg.swimming_pool_id = ${poolId}
      AND s.status        = 'active'
      AND s.deleted_at IS NULL
      AND sch.enrolled_at <= ${periodStart}::date
      AND (sch.left_at IS NULL OR sch.left_at >= ${nextMonth}::date)
    ORDER BY s.id
  `);

  return (r.rows as any[]).map(row => ({
    studentId:    row.student_id as string,
    classGroupId: row.class_group_id as string | null,
  }));
}

// ── ensureBatchJobs ───────────────────────────────────────────────────────────

async function ensureBatchJobs(
  db: Db,
  poolIds: string[],
  year: number,
  month: number,
): Promise<void> {
  for (const poolId of poolIds) {
    await db.execute(sql`
      INSERT INTO growth_report_batch_jobs
        (swimming_pool_id, year, month, job_type, status, next_attempt_at)
      VALUES
        (${poolId}, ${year}, ${month}, 'MONTHLY_AUTO', 'PENDING', NOW())
      ON CONFLICT (swimming_pool_id, year, month, job_type) DO NOTHING
    `);
  }
  console.log(`[gr-batch] batch jobs ensured pool_count=${poolIds.length} year=${year} month=${month}`);
}

// ── claimJob ─────────────────────────────────────────────────────────────────

interface BatchJob {
  id: string;
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
        started_at    = COALESCE(started_at, NOW()),
        updated_at    = NOW()
    WHERE id = (
      SELECT id FROM growth_report_batch_jobs
      WHERE (
        -- PENDING — 첫 실행
        status = 'PENDING'
        -- stale RUNNING — heartbeat 없이 30분 경과 → 재claim
        OR (status = 'RUNNING' AND locked_at < ${staleThreshold})
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

// ── processPoolBatch ──────────────────────────────────────────────────────────

async function processPoolBatch(db: Db, job: BatchJob): Promise<void> {
  const { id: jobId, swimming_pool_id: poolId, year, month } = job;

  // report_period = previous month
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const reportPeriod = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  // ── 1. cycle_id 가져오기 (없으면 생성) ───────────────────────────────────
  let cycleId: string | null = null;
  const cycleRes = await db.execute(sql`
    SELECT id FROM growth_report_cycles
    WHERE swimming_pool_id = ${poolId}
      AND report_period    = ${reportPeriod}
    LIMIT 1
  `);
  if (cycleRes.rows.length) {
    cycleId = (cycleRes.rows[0] as any).id as string;
  } else {
    // cycle 없으면 생성
    const periodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const periodEnd   = new Date(
      prevMonth === 12 ? prevYear + 1 : prevYear,
      prevMonth === 12 ? 0 : prevMonth,
      0
    ).toISOString().slice(0, 10);

    // growth_report_cycles 실제 컬럼: analysis_cutoff_at, parent_input_open/close_at
    // period_start/period_end/report_type 컬럼 없음
    const newCycle = await db.execute(sql`
      INSERT INTO growth_report_cycles (
        swimming_pool_id, report_period,
        analysis_cutoff_at, parent_input_open_at, parent_input_close_at
      )
      VALUES (
        ${poolId}, ${reportPeriod},
        NOW() + INTERVAL '7 days', NOW(), NOW() + INTERVAL '30 days'
      )
      ON CONFLICT (swimming_pool_id, report_period) DO NOTHING
      RETURNING id
    `).catch(() => ({ rows: [] }));

    if (newCycle.rows.length) {
      cycleId = (newCycle.rows[0] as any).id as string;
    } else {
      const reFetch = await db.execute(sql`
        SELECT id FROM growth_report_cycles
        WHERE swimming_pool_id = ${poolId} AND report_period = ${reportPeriod} LIMIT 1
      `);
      cycleId = reFetch.rows.length ? (reFetch.rows[0] as any).id as string : null;
    }
  }

  if (!cycleId) {
    console.error(`[gr-batch] CYCLE_MISSING pool=${poolId} period=${reportPeriod}`);
    await markJobFailed(db, jobId, "CYCLE_MISSING");
    return;
  }

  // ── 2. 대상 학생 확정 ────────────────────────────────────────────────────
  const students = await getEligibleStudents(db, poolId, reportPeriod, cycleId);

  await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET target_count = ${students.length}, updated_at = NOW()
    WHERE id = ${jobId}
  `);

  console.log(`[gr-batch] pool=${poolId} period=${reportPeriod} target_students=${students.length}`);

  if (students.length === 0) {
    await markJobComplete(db, jobId, 0, 0);
    return;
  }

  // ── 3. 학생별 report 생성/분석 (순차) ────────────────────────────────────
  let completed = 0;
  let failed    = 0;

  for (const { studentId, classGroupId } of students) {
    try {
      await processStudentReport(db, {
        studentId, poolId, cycleId, classGroupId, reportPeriod, jobId,
        periodStart: `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`,
        periodEnd: new Date(
          prevMonth === 12 ? prevYear + 1 : prevYear,
          prevMonth === 12 ? 0 : prevMonth, 0
        ).toISOString().slice(0, 10),
      });
      completed++;
    } catch (err: any) {
      console.error(`[gr-batch] student failed pool=${poolId} student=${studentId}:`, err.message);
      failed++;
    }

    // 진척도 업데이트
    await db.execute(sql`
      UPDATE growth_report_batch_jobs
      SET completed_count = ${completed}, failed_count = ${failed}, updated_at = NOW()
      WHERE id = ${jobId}
    `);
  }

  // ── 4. Pool completion: REVIEW_REQUIRED → READY_TO_SEND ─────────────────
  await finalizePoolBatch(db, poolId, reportPeriod, year, month);

  // ── 5. Job 완료 ───────────────────────────────────────────────────────────
  const finalStatus = failed > 0 && completed === 0 ? "FAILED"
    : failed > 0 ? "PARTIAL"
    : "COMPLETED";

  await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET status          = ${finalStatus},
        completed_count = ${completed},
        failed_count    = ${failed},
        completed_at    = NOW(),
        updated_at      = NOW()
    WHERE id = ${jobId}
  `);

  console.log(
    `[gr-batch] DONE pool=${poolId} period=${reportPeriod} ` +
    `status=${finalStatus} completed=${completed} failed=${failed}`
  );
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
}

async function processStudentReport(
  db: Db,
  params: StudentReportParams,
): Promise<void> {
  const { studentId, poolId, cycleId, classGroupId, reportPeriod, periodStart, periodEnd, jobId } = params;

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
      console.log(`[gr-batch] SKIP already ${s}: student=${studentId}`);
      return;
    }
    // FAILED 상태면 재시도 위해 OPEN으로 리셋
    if (s === "FAILED") {
      await db.execute(sql`
        UPDATE growth_reports
        SET product_status = 'OPEN', analysis_retry_count = 0, updated_at = NOW()
        WHERE id = ${existRow.id}
      `);
    }
    // OPEN/PREANALYZING/... 는 기존 analysis worker가 처리 — pass
    return;
  }

  // 신규 report row INSERT (OPEN 상태)
  await db.execute(sql`
    INSERT INTO growth_reports (
      student_id, swimming_pool_id, cycle_id,
      class_group_id_at_creation, report_period, period_start, period_end,
      product_status, version_number, batch_job_id,
      created_at, updated_at
    )
    VALUES (
      ${studentId}, ${poolId}, ${cycleId},
      ${classGroupId}, ${reportPeriod}, ${periodStart}::date, ${periodEnd}::date,
      'OPEN', 1, ${jobId},
      NOW(), NOW()
    )
    ON CONFLICT DO NOTHING
  `);

  console.log(`[gr-batch] CREATED OPEN: student=${studentId} pool=${poolId}`);
}

// ── finalizePoolBatch ─────────────────────────────────────────────────────────

async function finalizePoolBatch(
  db: Db,
  poolId: string,
  reportPeriod: string,
  year: number,
  month: number,
): Promise<void> {
  // 해당 pool/period의 batch-generated REVIEW_REQUIRED 리포트 → READY_TO_SEND
  const reviewRequired = await db.execute(sql`
    SELECT id FROM growth_reports
    WHERE swimming_pool_id = ${poolId}
      AND report_period    = ${reportPeriod}
      AND product_status   = 'REVIEW_REQUIRED'
      AND batch_job_id IS NOT NULL
      AND deleted_at IS NULL
  `);

  let readyCount = 0;
  for (const row of reviewRequired.rows as any[]) {
    try {
      const r = await transitionToReadyToSend(db, row.id, "SYSTEM_WP8_FINALIZE");
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

  // Admin push notification (idempotency: admin_push_sent_at)
  await sendAdminReadyPush(db, poolId, year, month, readyCount);
}

// ── sendAdminReadyPush ────────────────────────────────────────────────────────

async function sendAdminReadyPush(
  db: Db,
  poolId: string,
  year: number,
  month: number,
  readyCount: number,
): Promise<void> {
  // idempotency check
  const r = await db.execute(sql`
    SELECT admin_push_sent_at FROM growth_report_batch_jobs
    WHERE swimming_pool_id = ${poolId}
      AND year = ${year} AND month = ${month}
      AND job_type = 'MONTHLY_AUTO'
    LIMIT 1
  `);
  if (!r.rows.length) return;
  const job = r.rows[0] as any;
  if (job.admin_push_sent_at) return;  // 이미 발송

  try {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    const periodLabel = `${prevYear}년 ${prevMonth}월`;

    // 실패 여부 조회
    const statusRes = await db.execute(sql`
      SELECT failed_count FROM growth_report_batch_jobs
      WHERE swimming_pool_id = ${poolId}
        AND year = ${year} AND month = ${month} AND job_type = 'MONTHLY_AUTO'
      LIMIT 1
    `);
    const failedCount = Number((statusRes.rows[0] as any)?.failed_count ?? 0);

    const message = failedCount > 0
      ? `${periodLabel} AI 성장리포트 발송 준비가 완료되었습니다. 일부 리포트는 생성에 실패했습니다. 리포트를 확인한 후 발송해 주세요.`
      : `${periodLabel} AI 성장리포트 발송 준비가 완료되었습니다. 리포트를 확인한 후 발송해 주세요.`;

    await notifyBatchComplete({ poolId, message }).catch((e: unknown) => {
      console.error(`[gr-batch] admin push failed pool=${poolId}:`, e);
    });

    // Mark sent
    await db.execute(sql`
      UPDATE growth_report_batch_jobs
      SET admin_push_sent_at = NOW(), updated_at = NOW()
      WHERE swimming_pool_id = ${poolId}
        AND year = ${year} AND month = ${month}
        AND job_type = 'MONTHLY_AUTO'
        AND admin_push_sent_at IS NULL
    `);

  } catch (err: any) {
    console.error(`[gr-batch] admin push error pool=${poolId}:`, err.message);
  }
}

// ── markJobFailed / markJobComplete ──────────────────────────────────────────

async function markJobFailed(db: Db, jobId: string, reason: string): Promise<void> {
  await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET status = 'FAILED', updated_at = NOW(),
        next_attempt_at = NOW() + INTERVAL '10 minutes'
    WHERE id = ${jobId}
  `);
  console.log(`[gr-batch] JOB_FAILED id=${jobId} reason=${reason}`);
}

async function markJobComplete(db: Db, jobId: string, completed: number, failed: number): Promise<void> {
  const status = failed > 0 && completed === 0 ? "FAILED" : failed > 0 ? "PARTIAL" : "COMPLETED";
  await db.execute(sql`
    UPDATE growth_report_batch_jobs
    SET status = ${status}, completed_count = ${completed}, failed_count = ${failed},
        completed_at = NOW(), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

// ── runMonthlyBatchCron ───────────────────────────────────────────────────────
// 매월 5일 02:00 KST = 전월 4일 17:00 UTC → cron "0 17 4 * *" UTC
// KST 기준: 매월 5일 → UTC "0 17 4 * *"

export async function runMonthlyBatchCron(db: Db, now: Date = new Date()): Promise<void> {
  if (!isBatchEnabled()) {
    console.log("[gr-batch] DISABLED (GROWTH_REPORT_BATCH_AUTO_ENABLED != true)");
    return;
  }

  const { year, month } = getKSTNow(now);
  console.log(`[gr-batch] MONTHLY CRON: KST year=${year} month=${month}`);

  try {
    const poolIds = await getXEligiblePools(db);
    if (!poolIds.length) {
      console.log("[gr-batch] no X-eligible pools");
      return;
    }
    await ensureBatchJobs(db, poolIds, year, month);
    console.log(`[gr-batch] jobs ensured for ${poolIds.length} pools`);
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
      try {
        await processPoolBatch(db, job);
        processed++;
      } catch (err: any) {
        console.error(`[gr-batch] job=${job.id} failed:`, err.message);
        await markJobFailed(db, job.id, err.message.slice(0, 200));
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
// 서버 재시작 후: 오늘이 5일 이후 KST이고 이번 달 batch job이 없으면 즉시 생성.
// process downtime으로 cron을 놓쳤을 때를 복구한다.

export async function startupBatchRecovery(db: Db, now: Date = new Date()): Promise<void> {
  if (!isBatchEnabled()) return;

  const { year, month } = getKSTNow(now);
  const kstDay = new Date(now.getTime() + KST_OFFSET_MS).getUTCDate();
  if (kstDay < 5) {
    console.log(`[gr-batch] startup recovery skip: KST day=${kstDay} (< 5)`);
    return;
  }

  // 이번 달 batch job 존재 여부 확인
  const existing = await db.execute(sql`
    SELECT id FROM growth_report_batch_jobs
    WHERE year = ${year} AND month = ${month} AND job_type = 'MONTHLY_AUTO'
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  if (existing.rows.length > 0) {
    console.log(`[gr-batch] startup recovery skip: batch already exists year=${year} month=${month}`);
    return;
  }

  console.log(`[gr-batch] startup recovery: creating missing batch year=${year} month=${month} KST_day=${kstDay}`);
  await runMonthlyBatchCron(db, now);
}

// ── startGrowthReportBatchWorker ──────────────────────────────────────────────

export function startGrowthReportBatchWorker(): void {
  const db = superAdminDb;

  // 매월 5일 02:00 KST = UTC "0 17 4 * *" (UTC+9 고정; KST DST 없음)
  cron.schedule("0 17 4 * *", async () => {
    console.log("[gr-batch] monthly cron trigger");
    await runMonthlyBatchCron(db).catch(e =>
      console.error("[gr-batch] monthly cron error:", e.message)
    );
  });

  // 매 5분 worker loop (PENDING 배치 소화)
  cron.schedule("*/5 * * * *", async () => {
    await runBatchWorker(db).catch(e =>
      console.error("[gr-batch] worker error:", e.message)
    );
  });

  // 서버 시작 45초 후 — 5일 이후 downtime recovery
  setTimeout(async () => {
    await startupBatchRecovery(db).catch(e =>
      console.error("[gr-batch] startup recovery error:", e.message)
    );
  }, 45_000);

  console.log("[gr-batch] scheduler started (monthly 5일 02:00 KST + 5min worker + startup recovery)");
}
