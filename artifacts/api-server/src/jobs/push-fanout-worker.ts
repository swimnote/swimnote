/**
 * push-fanout-worker.ts — WP5 Durable Fan-out Push Worker
 *
 * 담당:
 *   - push_fanout_jobs (PENDING) → claim → delivery rows → Expo 발송 → status update
 *
 * 원칙:
 *   - acquireLock 재사용 — 동시 worker 중복 처리 방지
 *   - FOR UPDATE SKIP LOCKED — delivery-level concurrent claim 방지
 *   - 기존 sendChunkWithRetry / MAX_CONCURRENT_CHUNKS / EXPO_CHUNK_SIZE 재사용
 *   - 이미 SENT/PERMANENT_FAIL delivery 재발송 없음
 *   - process restart 후 PENDING delivery 자동 복구
 *   - Exactly-once residual risk: Expo 성공 후 DB 커밋 전 crash → 재발송 가능 (허용됨, §10)
 */
import { db, superAdminDb }    from "@workspace/db";
import { sql }                  from "drizzle-orm";
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";
import {
  sendChunkWithRetry,
  cleanupInvalidToken,
  chunkArray,
  runBounded,
  EXPO_CHUNK_SIZE,
  MAX_CONCURRENT_CHUNKS,
  MAX_RETRY_ATTEMPTS,
} from "../lib/push-service.js";

// ── Constants ────────────────────────────────────────────────────────────────
const WORKER_LOCK         = "push-fanout-worker";
const WORKER_TTL_SECONDS  = 120;
const POLL_INTERVAL_MS    = 30_000;  // 30s
const STALE_PROCESSING_MS = 10 * 60 * 1000; // 10분 이상 PROCESSING → stale (재claim)
const DELIVERY_BATCH_LIMIT = 500;  // 한 번에 PENDING delivery 최대 처리 건수

// ── Types ────────────────────────────────────────────────────────────────────
interface FanoutJob {
  job_ref:    string;
  job_type:   string;
  title:      string;
  body_text:  string;
  data_json:  Record<string, unknown>;
  total_count: number;
  attempts:   number;
}

interface PendingDelivery {
  id:            string;
  push_token_id: string;
  token_str:     string;
  attempt_count: number;
}

// ── claimJob ─────────────────────────────────────────────────────────────────

async function claimJob(): Promise<FanoutJob | null> {
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const r = await superAdminDb.execute(sql`
    UPDATE push_fanout_jobs
    SET status      = 'PROCESSING',
        worker_id   = gen_random_uuid()::text,
        locked_at   = NOW(),
        attempts    = attempts + 1,
        started_at  = COALESCE(started_at, NOW()),
        updated_at  = NOW()
    WHERE job_ref = (
      SELECT job_ref FROM push_fanout_jobs
      WHERE (
        status = 'PENDING'
        OR (status = 'PROCESSING' AND locked_at < ${staleThreshold})
      )
      AND status NOT IN ('COMPLETED', 'FAILED')
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING job_ref, job_type, title, body_text, data_json, total_count, attempts
  `);
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  return {
    job_ref:     row.job_ref,
    job_type:    row.job_type,
    title:       row.title,
    body_text:   row.body_text,
    data_json:   typeof row.data_json === "object" ? row.data_json : {},
    total_count: Number(row.total_count),
    attempts:    Number(row.attempts),
  };
}

// ── getPendingDeliveries ─────────────────────────────────────────────────────

async function getPendingDeliveries(jobRef: string): Promise<PendingDelivery[]> {
  const r = await superAdminDb.execute(sql`
    SELECT id, push_token_id, token_str, attempt_count
    FROM push_fanout_deliveries
    WHERE job_ref = ${jobRef}
      AND status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT ${DELIVERY_BATCH_LIMIT}
    FOR UPDATE SKIP LOCKED
  `);
  return (r.rows as any[]).map(row => ({
    id:            row.id,
    push_token_id: row.push_token_id,
    token_str:     row.token_str,
    attempt_count: Number(row.attempt_count),
  }));
}

// ── markDeliveries ───────────────────────────────────────────────────────────

async function markDeliveriesSent(deliveryIds: string[]): Promise<void> {
  if (!deliveryIds.length) return;
  await superAdminDb.execute(sql`
    UPDATE push_fanout_deliveries
    SET status  = 'SENT', sent_at = NOW(), attempt_count = attempt_count + 1
    WHERE id = ANY(${deliveryIds})
      AND status = 'PENDING'
  `);
}

async function markDeliveryPermanentFail(tokenStr: string, jobRef: string, reason: string): Promise<void> {
  await superAdminDb.execute(sql`
    UPDATE push_fanout_deliveries
    SET status        = 'PERMANENT_FAIL',
        last_error    = ${reason},
        attempt_count = attempt_count + 1
    WHERE job_ref = ${jobRef}
      AND token_str = ${tokenStr}
      AND status = 'PENDING'
  `);
}

async function markDeliveriesFailed(deliveryIds: string[], error: string): Promise<void> {
  if (!deliveryIds.length) return;
  await superAdminDb.execute(sql`
    UPDATE push_fanout_deliveries
    SET last_error    = ${error},
        attempt_count = attempt_count + 1
    WHERE id = ANY(${deliveryIds})
      AND status = 'PENDING'
  `);
}

// ── updateJobStatus ──────────────────────────────────────────────────────────

async function finalizeJob(jobRef: string): Promise<void> {
  // Count actual delivery outcomes
  const r = await superAdminDb.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'SENT')            AS sent,
      COUNT(*) FILTER (WHERE status = 'PENDING')         AS pending,
      COUNT(*) FILTER (WHERE status = 'FAILED')          AS failed,
      COUNT(*) FILTER (WHERE status = 'PERMANENT_FAIL')  AS perm_fail
    FROM push_fanout_deliveries
    WHERE job_ref = ${jobRef}
  `);
  const row = r.rows[0] as any;
  const sent      = Number(row.sent ?? 0);
  const pending   = Number(row.pending ?? 0);
  const failed    = Number(row.failed ?? 0);
  const permFail  = Number(row.perm_fail ?? 0);

  // Job is COMPLETED only when no deliveries remain PENDING
  let newStatus: string;
  if (pending > 0) {
    // still work to do (e.g. delivery batch limit hit, or retryable failures left as PENDING)
    newStatus = "PENDING";
  } else if (sent > 0 && (failed + permFail) === 0) {
    newStatus = "COMPLETED";
  } else if (sent > 0) {
    newStatus = "PARTIAL_FAILED";
  } else {
    newStatus = "FAILED";
  }

  await superAdminDb.execute(sql`
    UPDATE push_fanout_jobs
    SET status        = ${newStatus},
        sent_count    = ${sent},
        failed_count  = ${failed + permFail},
        completed_at  = CASE WHEN ${newStatus} IN ('COMPLETED','PARTIAL_FAILED','FAILED') THEN NOW() ELSE NULL END,
        updated_at    = NOW()
    WHERE job_ref = ${jobRef}
  `);
  console.log(`[push-fanout-worker] finalize job=${jobRef} status=${newStatus} sent=${sent} failed=${failed + permFail} pending=${pending}`);
}

// ── processJob ───────────────────────────────────────────────────────────────

export async function processJob(job: FanoutJob): Promise<void> {
  const { job_ref, title, body_text, data_json } = job;
  console.log(`[push-fanout-worker] processing job=${job_ref} type=${job.job_type}`);

  const deliveries = await getPendingDeliveries(job_ref);
  if (!deliveries.length) {
    console.log(`[push-fanout-worker] job=${job_ref} no pending deliveries → finalize`);
    await finalizeJob(job_ref);
    return;
  }

  // Build PushMessage array with delivery ID mapping for status updates
  const deliveryIdByToken = new Map<string, string>();
  for (const d of deliveries) deliveryIdByToken.set(d.token_str, d.id);

  const messages = deliveries.map(d => ({
    to:    d.token_str,
    title,
    body:  body_text,
    data:  data_json,
  }));

  // Chunk and send with bounded concurrency (reuse WP5 logic)
  const chunks = chunkArray(messages, EXPO_CHUNK_SIZE);
  console.log(`[push-fanout-worker] job=${job_ref} deliveries=${deliveries.length} chunks=${chunks.length}`);

  const sentIds:    string[] = [];
  const failedIds:  string[] = [];
  const invalidTokens: string[] = [];

  // Process all chunks with bounded concurrency
  const chunkTasks = chunks.map(chunk => async () => {
    const result = await sendChunkWithRetry(chunk);
    const chunkTokens = chunk.map(m => m.to);
    const invalidSet  = new Set(result.invalidTokens);

    // Classify each token in this chunk
    let chunkSuccessIdx = 0;
    for (const token of chunkTokens) {
      const did = deliveryIdByToken.get(token);
      if (!did) continue;
      if (invalidSet.has(token)) {
        // DeviceNotRegistered → permanent fail
        invalidTokens.push(token);
      } else if (chunkSuccessIdx < result.success) {
        sentIds.push(did);
        chunkSuccessIdx++;
      } else {
        failedIds.push(did);
      }
    }
  });

  await runBounded(chunkTasks, MAX_CONCURRENT_CHUNKS);

  // 1. Cleanup invalid tokens (DeviceNotRegistered)
  await Promise.all(invalidTokens.map(async (token) => {
    const did = deliveryIdByToken.get(token);
    if (did) {
      await markDeliveryPermanentFail(token, job_ref, "DeviceNotRegistered").catch(() => {});
    }
    await cleanupInvalidToken(token).catch(() => {});
  }));

  // 2. Mark sent deliveries
  await markDeliveriesSent(sentIds);

  // 3. Mark failed deliveries (keep as PENDING for worker retry if attempts < MAX_RETRY_ATTEMPTS)
  // Failed deliveries stay PENDING (attempt_count bumped) — worker re-picks on next tick
  // If attempt_count >= MAX_RETRY_ATTEMPTS, mark FAILED
  const maxRetryDeliveryIds: string[] = [];
  const retryDeliveryIds: string[] = [];
  for (const did of failedIds) {
    const d = deliveries.find(x => x.id === did);
    if (!d) continue;
    if (d.attempt_count + 1 >= MAX_RETRY_ATTEMPTS) {
      maxRetryDeliveryIds.push(did);
    } else {
      retryDeliveryIds.push(did);
    }
  }
  if (retryDeliveryIds.length) {
    await markDeliveriesFailed(retryDeliveryIds, "send_failed_retryable");
  }
  if (maxRetryDeliveryIds.length) {
    await superAdminDb.execute(sql`
      UPDATE push_fanout_deliveries
      SET status        = 'FAILED',
          last_error    = 'max_attempts_exceeded',
          attempt_count = attempt_count + 1
      WHERE id = ANY(${maxRetryDeliveryIds})
        AND status = 'PENDING'
    `);
  }

  console.log(
    `[push-fanout-worker] job=${job_ref} ` +
    `sent=${sentIds.length} invalid=${invalidTokens.length} ` +
    `retry=${retryDeliveryIds.length} max_fail=${maxRetryDeliveryIds.length}`
  );

  await finalizeJob(job_ref);
}

// ── runFanoutWorker ──────────────────────────────────────────────────────────

export interface FanoutWorkerResult {
  locked:     boolean;
  jobRef:     string | null;
  durationMs: number;
}

/**
 * One worker tick: try to claim and process one pending fanout job.
 */
export async function runFanoutWorker(): Promise<FanoutWorkerResult> {
  const start = Date.now();
  const locked = await acquireLock(WORKER_LOCK, WORKER_TTL_SECONDS);
  if (!locked) {
    console.log("[push-fanout-worker] lock_not_acquired — other worker running");
    return { locked: false, jobRef: null, durationMs: Date.now() - start };
  }

  let jobRef: string | null = null;
  try {
    const job = await claimJob();
    if (!job) {
      console.log("[push-fanout-worker] no pending jobs");
      return { locked: true, jobRef: null, durationMs: Date.now() - start };
    }
    jobRef = job.job_ref;
    await processJob(job);
    const durationMs = Date.now() - start;
    console.log(`[push-fanout-worker] done job=${jobRef} duration=${durationMs}ms`);
    void recordHeartbeat(WORKER_LOCK, { status: "ok", jobRef, durationMs }).catch(() => {});
    return { locked: true, jobRef, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`[push-fanout-worker] error job=${jobRef ?? "?"} duration=${durationMs}ms`, err?.message);
    // Reset job to PENDING so it can be retried
    if (jobRef) {
      await superAdminDb.execute(sql`
        UPDATE push_fanout_jobs
        SET status = 'PENDING', worker_id = NULL, locked_at = NULL, updated_at = NOW()
        WHERE job_ref = ${jobRef}
          AND status = 'PROCESSING'
      `).catch(() => {});
    }
    return { locked: true, jobRef, durationMs };
  } finally {
    await releaseLock(WORKER_LOCK);
  }
}

// ── startPushFanoutWorker ────────────────────────────────────────────────────

let _pollInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the push fan-out worker polling loop.
 * Runs one tick immediately, then every POLL_INTERVAL_MS.
 */
export function startPushFanoutWorker(): void {
  if (_pollInterval) {
    console.warn("[push-fanout-worker] already started");
    return;
  }
  console.log(`[push-fanout-worker] started (poll every ${POLL_INTERVAL_MS / 1000}s)`);
  // First tick immediately
  void runFanoutWorker().catch(e => console.error("[push-fanout-worker] initial tick error:", e));
  // Then poll every POLL_INTERVAL_MS
  _pollInterval = setInterval(() => {
    void runFanoutWorker().catch(e => console.error("[push-fanout-worker] poll tick error:", e));
  }, POLL_INTERVAL_MS);
}

/** For tests: stop the polling loop */
export function stopPushFanoutWorker(): void {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}
