/**
 * push-service.ts — 중앙화된 Expo 푸시 알림 서비스
 *
 * 제공 함수:
 *  - sendRawPush(tokens, title, body, data) — Expo API 직접 호출 (WP5: chunked, bounded, retry)
 *  - checkPushEnabled(userId, notifType) — 유저 ON/OFF 설정 확인
 *  - sendPushToUser(userId, role, notifType, title, body, data) — 유저 1명
 *  - sendPushToClassParents(classId, notifType, title, body, data) — 반 학부모 전체
 *  - sendPushToPoolAdmins(poolId, notifType, title, body, data) — 수영장 관리자
 *  - sendPushToPoolTeachers(poolId, notifType, title, body, data) — 수영장 선생님 전체
 *  - initPushTables() — DB 테이블 자동 생성
 *
 * WP5 scale guarantees:
 *  - Expo chunk size ≤100 messages/request
 *  - Bounded concurrency: MAX_CONCURRENT_CHUNKS simultaneous Expo requests
 *  - Token deduplication before dispatch
 *  - Expo response ticket inspection: success/error/DeviceNotRegistered
 *  - Invalid token auto-cleanup (push_tokens DELETE)
 *  - Bounded retry (MAX_RETRY_ATTEMPTS) with exponential backoff (transient only)
 *  - Permanent failures: no infinite retry
 *  - Large fan-out (pool/all): background async (non-blocking HTTP response)
 */
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logOperationalError } from "./event-logger.js";

// ── Expo Push API ─────────────────────────────────────────────────────────────
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ── WP5 Scale constants ───────────────────────────────────────────────────────
/** Expo SDK convention: max 100 messages per request */
export const EXPO_CHUNK_SIZE = 100;
/** Max simultaneous Expo requests. Avoids burst / rate-limit. */
export const MAX_CONCURRENT_CHUNKS = 5;
/** Max retry attempts per chunk (transient failures only) */
export const MAX_RETRY_ATTEMPTS = 3;
/** Base backoff delay ms (doubles per attempt: 1s, 2s, 4s) */
export const RETRY_BASE_DELAY_MS = 1000;
/** Internal override — set via _setRetryDelayMs(0) in tests to skip real sleep */
let _retryDelayMs = RETRY_BASE_DELAY_MS;
/** For tests only: override the retry base delay. Call _setRetryDelayMs(RETRY_BASE_DELAY_MS) to restore. */
export function _setRetryDelayMs(ms: number): void { _retryDelayMs = ms; }
/** Per-chunk fetch timeout */
const CHUNK_TIMEOUT_MS = 30_000;

export interface PushMessage {
  to: string;
  title: string;
  subtitle?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
}

export interface PushOptions {
  subtitle?: string;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
}

/** WP5: result summary returned by sendRawPush */
export interface PushResult {
  totalTokens:        number;
  uniqueTokens:       number;
  chunks:             number;
  successCount:       number;
  failureCount:       number;
  invalidTokenCount:  number;
  configFailureCount: number;  // InvalidCredentials — APNs/FCM credential issue, token NOT deleted
  retryCount:         number;
}

// ── WP5 internal helpers ──────────────────────────────────────────────────────

/** Split array into chunks of at most `size` */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * Run an array of async tasks with bounded concurrency.
 * Workers claim tasks from a shared index counter — no external library required.
 */
export async function runBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/** Expo ticket error: device token is permanently invalid → delete token */
const DEVICE_NOT_REGISTERED_ERRORS = new Set(["DeviceNotRegistered"]);

/**
 * Expo ticket error: APNs/FCM push credential configuration problem.
 * This is NOT a device token issue — token must NOT be deleted.
 * Log as configuration failure for ops visibility.
 */
const CONFIG_FAILURE_ERRORS = new Set(["InvalidCredentials"]);

/** Delete a single bad token from push_tokens — exact token only */
export async function cleanupInvalidToken(token: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM push_tokens WHERE token = ${token}`);
    console.log(`[push-service] invalid token cleanup: ${token.slice(0, 8)}...`);
  } catch (e) {
    console.error("[push-service] token cleanup error:", e);
  }
}

/** Returns true for transient errors that should be retried */
function isRetryable(httpStatus: number | null, err?: unknown): boolean {
  if (httpStatus === 429) return true;
  if (httpStatus !== null && httpStatus >= 500) return true;
  // Network/timeout errors
  const code = (err as any)?.code ?? "";
  return code === "ECONNRESET" || code === "ECONNREFUSED" || code === "UND_ERR_CONNECT_TIMEOUT";
}

/**
 * Send one chunk (≤100 messages) to Expo with retry.
 * Inspects response tickets to detect per-token failures.
 * @returns partial result for this chunk
 */
export async function sendChunkWithRetry(
  chunk: PushMessage[],
  attempt = 0,
): Promise<{ success: number; failure: number; invalidTokens: string[]; configFailures: number; retries: number }> {
  let httpStatus: number | null = null;
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
    });
    httpStatus = resp.status;

    // Rate-limit or server error → retryable
    if (isRetryable(httpStatus, null)) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delayMs = _retryDelayMs * 2 ** attempt;
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        const sub = await sendChunkWithRetry(chunk, attempt + 1);
        return { ...sub, retries: sub.retries + 1 };
      }
      return { success: 0, failure: chunk.length, invalidTokens: [], retries: attempt };
    }

    // Other non-OK status (4xx not 429) — permanent, don't retry
    if (!resp.ok) {
      return { success: 0, failure: chunk.length, invalidTokens: [], retries: 0 };
    }

    // Parse Expo ticket array
    let tickets: any[] = [];
    try {
      const json = (await resp.json()) as any;
      tickets = Array.isArray(json?.data) ? json.data : [];
    } catch { /* JSON parse failure → treat all as success (conservative) */ }

    let success = 0;
    let failure = 0;
    const invalidTokens: string[] = [];      // DeviceNotRegistered → token cleanup
    const configFailureTokens: string[] = []; // InvalidCredentials → log only, NO cleanup

    for (let i = 0; i < chunk.length; i++) {
      const ticket = tickets[i];
      if (!ticket || ticket.status === "ok") {
        success++;
      } else {
        failure++;
        const errCode = ticket.details?.error ?? "";
        if (DEVICE_NOT_REGISTERED_ERRORS.has(errCode)) {
          // Device token is permanently invalid — safe to delete
          invalidTokens.push(chunk[i].to);
        } else if (CONFIG_FAILURE_ERRORS.has(errCode)) {
          // APNs/FCM credential misconfiguration — NOT a device token issue
          // Token must NOT be deleted; log for ops awareness
          configFailureTokens.push(chunk[i].to);
          console.error(
            `[push-service] InvalidCredentials for token ${chunk[i].to.slice(0, 12)}... ` +
            `— APNs/FCM credential problem (token retained, check push credentials)`,
          );
        }
      }
    }
    // If Expo returned empty tickets (edge case), assume all sent
    if (!tickets.length && resp.ok) success = chunk.length;

    return { success, failure, invalidTokens, configFailures: configFailureTokens.length, retries: 0 };

  } catch (err: any) {
    // Network / timeout errors
    if (attempt < MAX_RETRY_ATTEMPTS && isRetryable(httpStatus, err)) {
      const delayMs = _retryDelayMs * 2 ** attempt;
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      const sub = await sendChunkWithRetry(chunk, attempt + 1);
      return { ...sub, retries: sub.retries + 1 };
    }
    console.error(`[push-service] chunk send failed (attempt ${attempt + 1}):`, err?.message);
    return { success: 0, failure: chunk.length, invalidTokens: [], configFailures: 0, retries: attempt };
  }
}

/**
 * WP5: Expo Push API로 실제 발송 (scale-safe)
 *
 * - token dedup (Set)
 * - chunked (≤100 per request)
 * - bounded concurrency (MAX_CONCURRENT_CHUNKS)
 * - response ticket inspection (per-token success/failure)
 * - invalid token cleanup (DeviceNotRegistered → DELETE push_tokens)
 * - bounded retry with backoff (transient failures only)
 * - partial failure safe (successful recipients NOT resent on partial failure)
 * - structured log (job ref, counts, latency)
 *
 * Signature is backward-compatible (returns Promise<void>).
 * Internal PushResult available via sendRawPushWithResult().
 */
export async function sendRawPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  options: PushOptions = {},
  poolId?: string,  // WP6: optional for operational error logging
  jobRef?: string,  // WP5: idempotency / log reference (e.g. triggered_by)
): Promise<void> {
  await sendRawPushWithResult(tokens, title, body, data, options, poolId, jobRef);
}

/** Same as sendRawPush but returns PushResult for callers that need it */
export async function sendRawPushWithResult(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  options: PushOptions = {},
  poolId?: string,
  jobRef?: string,
): Promise<PushResult> {
  const startMs = Date.now();
  const totalTokens = tokens.length;

  if (!totalTokens) {
    return { totalTokens: 0, uniqueTokens: 0, chunks: 0, successCount: 0, failureCount: 0, invalidTokenCount: 0, configFailureCount: 0, retryCount: 0 };
  }

  // ── 1. Token deduplication ─────────────────────────────────────────
  const uniqueSet = [...new Set(tokens.filter(Boolean))];
  const uniqueTokens = uniqueSet.length;

  // ── 2. Build messages (preserve full payload contract) ────────────
  const messages: PushMessage[] = uniqueSet.map(to => ({
    to, title, body, data, sound: "default" as const,
    ...(options.subtitle   && { subtitle: options.subtitle }),
    ...(options.channelId  && { channelId: options.channelId }),
    ...(options.priority   && { priority: options.priority }),
    ...(options.ttl != null && { ttl: options.ttl }),
  }));

  // ── 3. Chunk ──────────────────────────────────────────────────────
  const chunks = chunkArray(messages, EXPO_CHUNK_SIZE);
  const numChunks = chunks.length;

  console.log(
    `[push-service] job=${jobRef ?? "?"} tokens=${totalTokens}→dedup=${uniqueTokens}` +
    ` chunks=${numChunks} concurrency=${MAX_CONCURRENT_CHUNKS}`,
  );

  // ── 4. Bounded concurrency dispatch ──────────────────────────────
  const chunkTasks = chunks.map((chunk) => () => sendChunkWithRetry(chunk));
  const chunkResults = await runBounded(chunkTasks, MAX_CONCURRENT_CHUNKS);

  // ── 5. Aggregate results ──────────────────────────────────────────
  let successCount = 0;
  let failureCount = 0;
  let invalidTokenCount = 0;
  let configFailureCount = 0;
  let retryCount = 0;
  const allInvalidTokens: string[] = [];

  for (const r of chunkResults) {
    successCount    += r.success;
    failureCount    += r.failure;
    retryCount      += r.retries;
    configFailureCount += r.configFailures;
    allInvalidTokens.push(...r.invalidTokens);
  }
  invalidTokenCount = allInvalidTokens.length;

  // ── 6. Invalid token cleanup (DeviceNotRegistered only) ──────────
  // Exact token only — no user-wide or pool-wide side effects.
  // InvalidCredentials tokens are NOT cleaned up (credential config problem, not device).
  if (allInvalidTokens.length > 0) {
    await Promise.all(allInvalidTokens.map(cleanupInvalidToken));
  }

  const latencyMs = Date.now() - startMs;

  // ── 7. Structured log ─────────────────────────────────────────────
  console.log(
    `[push-service] done job=${jobRef ?? "?"} total=${totalTokens} unique=${uniqueTokens}` +
    ` chunks=${numChunks} success=${successCount} fail=${failureCount}` +
    ` invalid=${invalidTokenCount} configFail=${configFailureCount} retries=${retryCount} latency=${latencyMs}ms`,
  );

  // WP6: operational error log when poolId known and there are failures
  if (poolId && failureCount > 0) {
    void logOperationalError({
      pool_id: poolId,
      feature: "PUSH",
      level: "ERROR",
      error_code: "PUSH_PARTIAL_FAILURE",
      safe_message: `Push partial failure: ${failureCount}/${uniqueTokens} failed, ${invalidTokenCount} invalid, ${configFailureCount} credential`,
      entity_type: "push_batch",
      metadata: { total: totalTokens, unique: uniqueTokens, chunks: numChunks, success: successCount, failure: failureCount, invalid: invalidTokenCount, configFail: configFailureCount, retries: retryCount },
    });
  }

  const result: PushResult = { totalTokens, uniqueTokens, chunks: numChunks, successCount, failureCount, invalidTokenCount, configFailureCount, retryCount };
  return result;
}

// ── 푸시 설정 ON/OFF 확인 ────────────────────────────────────────────

/**
 * 특정 유저(user_id 또는 parent_account_id)의 알림 타입 ON/OFF 조회
 * 설정 없으면 기본값 true(활성화)
 */
export async function checkPushEnabled(
  userId: string,
  notifType: string,
  isParent = false
): Promise<boolean> {
  try {
    const col = isParent ? "parent_account_id" : "user_id";
    const rows = await db.execute(sql`
      SELECT is_enabled FROM push_settings
      WHERE ${sql.raw(col)} = ${userId}
        AND notification_type = ${notifType}
      LIMIT 1
    `);
    if (!rows.rows.length) return true; // 기본값: 활성화
    return Boolean((rows.rows[0] as any).is_enabled);
  } catch {
    return true;
  }
}

/** 토큰 조회 (user_id) */
async function getTokensByUserId(userId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT token FROM push_tokens
    WHERE user_id = ${userId} AND token IS NOT NULL AND token != ''
  `);
  return (rows.rows as any[]).map(r => r.token).filter(Boolean);
}

/** 토큰 조회 (parent_account_id) */
async function getTokensByParentId(parentId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT token FROM push_tokens
    WHERE parent_account_id = ${parentId} AND token IS NOT NULL AND token != ''
  `);
  return (rows.rows as any[]).map(r => r.token).filter(Boolean);
}

/** 토큰 ID+string 조회 (user_id) — fan-out durable delivery snapshot용 */
async function getTokenRowsByUserId(userId: string): Promise<{ id: string; token: string }[]> {
  const rows = await db.execute(sql`
    SELECT id, token FROM push_tokens
    WHERE user_id = ${userId} AND token IS NOT NULL AND token != ''
  `);
  return (rows.rows as any[]).map(r => ({ id: r.id as string, token: r.token as string }));
}

/** 토큰 ID+string 조회 (parent_account_id) — fan-out durable delivery snapshot용 */
async function getTokenRowsByParentId(parentId: string): Promise<{ id: string; token: string }[]> {
  const rows = await db.execute(sql`
    SELECT id, token FROM push_tokens
    WHERE parent_account_id = ${parentId} AND token IS NOT NULL AND token != ''
  `);
  return (rows.rows as any[]).map(r => ({ id: r.id as string, token: r.token as string }));
}

// ── WP5 DURABLE FAN-OUT ENQUEUE ──────────────────────────────────────────────

export interface FanoutJobSpec {
  jobRef:     string;
  jobType:    "pool_parents" | "all_users";
  targetRef?: string;          // poolId for pool_parents
  notifType:  string;
  title:      string;
  body:       string;
  data:       Record<string, unknown>;
}

export interface FanoutEnqueueResult {
  jobRef:          string;
  duplicate:       boolean;  // true = job already existed (idempotent skip)
  deliveriesAdded: number;
}

/**
 * Durably enqueue a large push fan-out job.
 *
 * - Inserts push_fanout_jobs row (ON CONFLICT DO NOTHING on job_ref)
 * - Resolves recipient tokens at enqueue time (snapshot)
 * - Inserts push_fanout_deliveries rows (ON CONFLICT DO NOTHING per push_token_id)
 * - Returns immediately; background worker processes the deliveries
 *
 * Idempotent: same jobRef → 0 duplicate rows.
 */
export async function enqueueFanoutJob(spec: FanoutJobSpec): Promise<FanoutEnqueueResult> {
  const { jobRef, jobType, targetRef, notifType, title, body, data } = spec;

  // ── Step 1: Insert job (idempotent) ─────────────────────────────────────
  const jobInsert = await superAdminDb.execute(sql`
    INSERT INTO push_fanout_jobs
      (job_ref, job_type, target_ref, notif_type, title, body_text, data_json, status, created_at, updated_at)
    VALUES
      (${jobRef}, ${jobType}, ${targetRef ?? null}, ${notifType},
       ${title}, ${body}, ${JSON.stringify(data)}::jsonb,
       'PENDING', NOW(), NOW())
    ON CONFLICT (job_ref) DO NOTHING
  `);

  if ((jobInsert as any).rowCount === 0) {
    // Duplicate job_ref — idempotent skip
    console.log(`[push-service] enqueueFanoutJob: duplicate job_ref=${jobRef} — skipped`);
    return { jobRef, duplicate: true, deliveriesAdded: 0 };
  }

  // ── Step 2: Resolve tokens at enqueue time (recipient snapshot) ──────────
  const tokenRows: { id: string; token: string }[] = [];
  const seenTokenIds = new Set<string>();

  if (jobType === "pool_parents" && targetRef) {
    const parentRows = await db.execute(sql`
      SELECT DISTINCT pa.id AS parent_account_id
      FROM parent_accounts pa
      WHERE pa.swimming_pool_id = ${targetRef}
    `);
    for (const p of parentRows.rows as any[]) {
      const enabled = await checkPushEnabled(p.parent_account_id, notifType, true);
      if (!enabled) continue;
      const rows = await getTokenRowsByParentId(p.parent_account_id);
      for (const r of rows) {
        if (!seenTokenIds.has(r.id)) { seenTokenIds.add(r.id); tokenRows.push(r); }
      }
    }
  } else if (jobType === "all_users") {
    // Admins + teachers
    const userRows = await superAdminDb.execute(sql`
      SELECT id FROM users
      WHERE role IN ('pool_admin', 'teacher') AND swimming_pool_id IS NOT NULL
    `);
    for (const u of userRows.rows as any[]) {
      const enabled = await checkPushEnabled(u.id, notifType, false);
      if (!enabled) continue;
      const rows = await getTokenRowsByUserId(u.id);
      for (const r of rows) {
        if (!seenTokenIds.has(r.id)) { seenTokenIds.add(r.id); tokenRows.push(r); }
      }
    }
    // Parents
    const parentRows = await db.execute(sql`
      SELECT DISTINCT id AS parent_account_id FROM parent_accounts
      WHERE swimming_pool_id IS NOT NULL
    `);
    for (const p of parentRows.rows as any[]) {
      const enabled = await checkPushEnabled(p.parent_account_id, notifType, true);
      if (!enabled) continue;
      const rows = await getTokenRowsByParentId(p.parent_account_id);
      for (const r of rows) {
        if (!seenTokenIds.has(r.id)) { seenTokenIds.add(r.id); tokenRows.push(r); }
      }
    }
  }

  if (!tokenRows.length) {
    console.log(`[push-service] enqueueFanoutJob: job=${jobRef} no eligible tokens → no deliveries`);
    return { jobRef, duplicate: false, deliveriesAdded: 0 };
  }

  // ── Step 3: Insert delivery rows (snapshot) ─────────────────────────────
  let deliveriesAdded = 0;
  // Batch insert in chunks of 500 to avoid overly large statements
  const INSERT_BATCH = 500;
  for (let i = 0; i < tokenRows.length; i += INSERT_BATCH) {
    const batch = tokenRows.slice(i, i + INSERT_BATCH);
    for (const row of batch) {
      const r = await superAdminDb.execute(sql`
        INSERT INTO push_fanout_deliveries
          (id, job_ref, push_token_id, token_str, status, created_at)
        VALUES
          (gen_random_uuid()::text, ${jobRef}, ${row.id}, ${row.token}, 'PENDING', NOW())
        ON CONFLICT (job_ref, push_token_id) DO NOTHING
      `);
      if ((r as any).rowCount > 0) deliveriesAdded++;
    }
  }

  // ── Step 4: Update total_count ───────────────────────────────────────────
  await superAdminDb.execute(sql`
    UPDATE push_fanout_jobs
    SET total_count = ${deliveriesAdded}, updated_at = NOW()
    WHERE job_ref = ${jobRef}
  `);

  console.log(`[push-service] enqueueFanoutJob: job=${jobRef} type=${jobType} deliveries=${deliveriesAdded}`);
  return { jobRef, duplicate: false, deliveriesAdded };
}

// ── 푸시 로그 기록 ────────────────────────────────────────────────────
async function logPush(
  targetUserId: string,
  role: string,
  type: string,
  status: "sent" | "skipped" | "failed",
  message: string,
  triggeredBy?: string,
  poolId?: string,          // WP6: additive
  recipientCount?: number,  // WP6: additive
  errorMessage?: string,    // WP6: additive
): Promise<void> {
  try {
    const id = `pl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await superAdminDb.execute(sql`
      INSERT INTO push_logs (id, target_user_id, role, type, status, message, triggered_by, created_at, pool_id, recipient_count, error_message)
      VALUES (${id}, ${targetUserId}, ${role}, ${type}, ${status}, ${message}, ${triggeredBy || null}, now(), ${poolId ?? null}, ${recipientCount ?? 1}, ${errorMessage ?? null})
      ON CONFLICT DO NOTHING
    `);
  } catch { /* 로그 실패는 무시 */ }
}

// ── 단일 유저 푸시 발송 ────────────────────────────────────────────────

/**
 * 유저 1명에게 푸시 발송 (settings ON/OFF 확인)
 * @param userId user_id (teachers, admins) 또는 parent_account_id (parents)
 * @param isParent true면 parent_account_id 기준
 */
export async function sendPushToUser(
  userId: string,
  isParent: boolean,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string,
  options: PushOptions = {}
): Promise<void> {
  try {
    const enabled = await checkPushEnabled(userId, notifType, isParent);
    if (!enabled) {
      await logPush(userId, isParent ? "parent" : "user", notifType, "skipped", `${notifType} OFF`, triggeredBy);
      return;
    }
    const tokens = isParent
      ? await getTokensByParentId(userId)
      : await getTokensByUserId(userId);
    if (!tokens.length) return;
    await sendRawPush(tokens, title, body, data, options);
    await logPush(userId, isParent ? "parent" : "user", notifType, "sent", body, triggeredBy);
  } catch (e) {
    console.error("[push-service] sendPushToUser 오류:", e);
  }
}

// ── 반 학부모 전체 푸시 ───────────────────────────────────────────────

/**
 * 특정 반(classId)의 학부모 전원에게 푸시 발송
 * 각 학부모의 개별 설정(notifType ON/OFF) 확인 후 발송
 */
export async function sendPushToClassParents(
  classId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string,
  skipIfDiaryRecentlySent = false,
  options: PushOptions = {}
): Promise<void> {
  try {
    if (skipIfDiaryRecentlySent) {
      // 5분 내 diary_upload 푸시가 이미 발송된 경우 skip
      const recent = await superAdminDb.execute(sql`
        SELECT id FROM push_logs
        WHERE triggered_by = ${triggeredBy || ""}
          AND type = 'diary_upload'
          AND status = 'sent'
          AND created_at > now() - interval '5 minutes'
        LIMIT 1
      `);
      if (recent.rows.length > 0) return;
    }

    // 이 반의 승인된 학부모 목록
    const parentRows = await db.execute(sql`
      SELECT DISTINCT ps.parent_id AS parent_account_id
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id AND ps.status = 'approved'
      WHERE s.class_group_id = ${classId} AND s.status != 'deleted'
    `);

    for (const p of parentRows.rows as any[]) {
      const pid = p.parent_account_id;
      const enabled = await checkPushEnabled(pid, notifType, true);
      if (!enabled) continue;
      const tokens = await getTokensByParentId(pid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data, options);
      await logPush(pid, "parent", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToClassParents 오류:", e);
  }
}

// ── 수영장 학부모 전체 푸시 ───────────────────────────────────────────

/**
 * 특정 수영장(poolId)의 학부모 전원에게 푸시 발송.
 *
 * WP5 DURABLE: 토큰을 DB에 snapshot 후 worker가 background 처리.
 * HTTP response를 block하지 않음.
 * 동일 triggeredBy/jobRef로 재호출 시 duplicate 0 (idempotent).
 */
export async function sendPushToPoolParents(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  const jobRef = triggeredBy ?? `pool_parents_${poolId}_${Date.now()}`;
  // Durable enqueue — returns immediately after DB insert
  enqueueFanoutJob({ jobRef, jobType: "pool_parents", targetRef: poolId, notifType, title, body, data })
    .catch(e => console.error("[push-service] sendPushToPoolParents enqueue 오류:", e));
}

// ── 수영장 관리자 푸시 ───────────────────────────────────────────────

/**
 * 특정 수영장(poolId)의 관리자에게 푸시 발송
 * notifType이 'subscription' | 'billing'이면 ON/OFF 무관 항상 발송
 */
export async function sendPushToPoolAdmins(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  try {
    const alwaysSend = ["subscription", "billing"].includes(notifType);
    const adminRows = await superAdminDb.execute(sql`
      SELECT id FROM users
      WHERE swimming_pool_id = ${poolId}
        AND role = 'pool_admin'
    `);
    for (const a of adminRows.rows as any[]) {
      const uid = a.id;
      if (!alwaysSend) {
        const enabled = await checkPushEnabled(uid, notifType, false);
        if (!enabled) continue;
      }
      const tokens = await getTokensByUserId(uid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data);
      await logPush(uid, "admin", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToPoolAdmins 오류:", e);
  }
}

// ── 수영장 선생님 전체 푸시 ──────────────────────────────────────────

export async function sendPushToPoolTeachers(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  try {
    const teacherRows = await superAdminDb.execute(sql`
      SELECT id FROM users
      WHERE swimming_pool_id = ${poolId}
        AND role = 'teacher'
    `);
    for (const t of teacherRows.rows as any[]) {
      const uid = t.id;
      const enabled = await checkPushEnabled(uid, notifType, false);
      if (!enabled) continue;
      const tokens = await getTokensByUserId(uid);
      if (!tokens.length) continue;
      await sendRawPush(tokens, title, body, data);
      await logPush(uid, "teacher", notifType, "sent", body, triggeredBy);
    }
  } catch (e) {
    console.error("[push-service] sendPushToPoolTeachers 오류:", e);
  }
}

// ── 플랫폼 전체 푸시 (global 공지) ───────────────────────────────────

/**
 * 플랫폼 전체 사용자에게 푸시 발송.
 *
 * WP5 DURABLE: 토큰을 DB에 snapshot 후 worker가 background 처리.
 * HTTP response를 block하지 않음.
 * 동일 triggeredBy/jobRef로 재호출 시 duplicate 0 (idempotent).
 */
export async function sendPushToAllUsers(
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  const jobRef = triggeredBy ?? `all_users_${notifType}_${Date.now()}`;
  enqueueFanoutJob({ jobRef, jobType: "all_users", notifType, title, body, data })
    .catch(e => console.error("[push-service] sendPushToAllUsers enqueue 오류:", e));
}

// ── 슈퍼관리자 푸시 ──────────────────────────────────────────────────

/**
 * 슈퍼관리자 전원에게 푸시 발송 (운영 알림용)
 * superAdminDb에서 super_admin 역할 유저 ID 조회 → pool DB에서 토큰 조회 → 발송
 */
export async function sendPushToSuperAdmins(
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    const superRows = await superAdminDb.execute(sql`
      SELECT id FROM users
      WHERE role = 'super_admin'
    `);
    const superIds = (superRows.rows as any[]).map(r => r.id).filter(Boolean);
    if (!superIds.length) return;

    const tokens: string[] = [];
    for (const uid of superIds) {
      const rows = await db.execute(sql`
        SELECT DISTINCT token FROM push_tokens
        WHERE user_id = ${uid} AND token IS NOT NULL AND token != ''
      `);
      tokens.push(...(rows.rows as any[]).map(r => r.token));
    }
    if (!tokens.length) return;
    await sendRawPush(tokens, title, body, data);
  } catch (e) {
    console.error("[push-service] sendPushToSuperAdmins 오류:", e);
  }
}

// ── DB 테이블 자동 생성 ───────────────────────────────────────────────

export async function initPushTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_settings (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id          TEXT,
        parent_account_id TEXT,
        notification_type TEXT NOT NULL,
        is_enabled       BOOLEAN NOT NULL DEFAULT true,
        updated_at       TIMESTAMPTZ DEFAULT now()
      )
    `);
    // 부분 유니크 인덱스 (PostgreSQL UNIQUE 제약은 NULL을 다르게 처리하므로 partial index 사용)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS push_settings_user_uniq
        ON push_settings (user_id, notification_type) WHERE user_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS push_settings_parent_uniq
        ON push_settings (parent_account_id, notification_type) WHERE parent_account_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pool_push_settings (
        id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        pool_id                TEXT NOT NULL UNIQUE,
        prev_day_push_time     TEXT NOT NULL DEFAULT '20:00',
        same_day_push_offset   INTEGER NOT NULL DEFAULT 1,
        tpl_notice             TEXT DEFAULT '새 공지사항이 등록되었습니다.',
        tpl_prev_day           TEXT DEFAULT '내일 수업이 있습니다. 준비하세요!',
        tpl_same_day           TEXT DEFAULT '오늘 수업 {offset}시간 전입니다.',
        tpl_diary              TEXT DEFAULT '새 수업 일지가 작성되었습니다.',
        tpl_photo              TEXT DEFAULT '새 사진이 업로드되었습니다.',
        updated_at             TIMESTAMPTZ DEFAULT now()
      )
    `);
    await superAdminDb.execute(sql`
      CREATE TABLE IF NOT EXISTS push_logs (
        id              TEXT PRIMARY KEY,
        target_user_id  TEXT,
        role            TEXT,
        type            TEXT,
        status          TEXT,
        message         TEXT,
        triggered_by    TEXT,
        created_at      TIMESTAMPTZ DEFAULT now()
      )
    `);
    // 일지 푸시 예약 큐 (22시 이후 작성 → 다음날 10시 발송)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS diary_push_queue (
        id            TEXT PRIMARY KEY,
        pool_id       TEXT NOT NULL,
        class_id      TEXT,
        diary_id      TEXT NOT NULL,
        student_ids   JSONB,
        class_name    TEXT NOT NULL,
        lesson_date   TEXT,
        is_individual BOOLEAN NOT NULL DEFAULT false,
        scheduled_at  TIMESTAMPTZ NOT NULL,
        sent_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    // 예약 발송 중복 방지용 테이블
    await superAdminDb.execute(sql`
      CREATE TABLE IF NOT EXISTS push_scheduled_sent (
        id         TEXT PRIMARY KEY,
        pool_id    TEXT,
        class_id   TEXT,
        type       TEXT,
        sent_date  TEXT,
        sent_time  TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT push_scheduled_unique UNIQUE (pool_id, class_id, type, sent_date, sent_time)
      )
    `);
  } catch (e) {
    console.error("[push-service] initPushTables 오류:", e);
  }
}
