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
  totalTokens:      number;
  uniqueTokens:     number;
  chunks:           number;
  successCount:     number;
  failureCount:     number;
  invalidTokenCount: number;
  retryCount:       number;
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

/** Expo ticket error codes that mean the token is permanently invalid */
const INVALID_TOKEN_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

/** Delete a single bad token from push_tokens — exact token only */
async function cleanupInvalidToken(token: string): Promise<void> {
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
async function sendChunkWithRetry(
  chunk: PushMessage[],
  attempt = 0,
): Promise<{ success: number; failure: number; invalidTokens: string[]; retries: number }> {
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
    const invalidTokens: string[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const ticket = tickets[i];
      if (!ticket || ticket.status === "ok") {
        success++;
      } else {
        failure++;
        const errCode = ticket.details?.error ?? "";
        if (INVALID_TOKEN_ERRORS.has(errCode)) {
          invalidTokens.push(chunk[i].to);
        }
      }
    }
    // If Expo returned empty tickets (edge case), assume all sent
    if (!tickets.length && resp.ok) success = chunk.length;

    return { success, failure, invalidTokens, retries: 0 };

  } catch (err: any) {
    // Network / timeout errors
    if (attempt < MAX_RETRY_ATTEMPTS && isRetryable(httpStatus, err)) {
      const delayMs = _retryDelayMs * 2 ** attempt;
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      const sub = await sendChunkWithRetry(chunk, attempt + 1);
      return { ...sub, retries: sub.retries + 1 };
    }
    console.error(`[push-service] chunk send failed (attempt ${attempt + 1}):`, err?.message);
    return { success: 0, failure: chunk.length, invalidTokens: [], retries: attempt };
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
    return { totalTokens: 0, uniqueTokens: 0, chunks: 0, successCount: 0, failureCount: 0, invalidTokenCount: 0, retryCount: 0 };
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
  let retryCount = 0;
  const allInvalidTokens: string[] = [];

  for (const r of chunkResults) {
    successCount += r.success;
    failureCount += r.failure;
    retryCount   += r.retries;
    allInvalidTokens.push(...r.invalidTokens);
  }
  invalidTokenCount = allInvalidTokens.length;

  // ── 6. Invalid token cleanup ──────────────────────────────────────
  // Exact token only — no user-wide or pool-wide side effects
  if (allInvalidTokens.length > 0) {
    await Promise.all(allInvalidTokens.map(cleanupInvalidToken));
  }

  const latencyMs = Date.now() - startMs;

  // ── 7. Structured log ─────────────────────────────────────────────
  console.log(
    `[push-service] done job=${jobRef ?? "?"} total=${totalTokens} unique=${uniqueTokens}` +
    ` chunks=${numChunks} success=${successCount} fail=${failureCount}` +
    ` invalid=${invalidTokenCount} retries=${retryCount} latency=${latencyMs}ms`,
  );

  // WP6: operational error log when poolId known and there are failures
  if (poolId && failureCount > 0) {
    void logOperationalError({
      pool_id: poolId,
      feature: "PUSH",
      level: "ERROR",
      error_code: "PUSH_PARTIAL_FAILURE",
      safe_message: `Push partial failure: ${failureCount}/${uniqueTokens} failed, ${invalidTokenCount} invalid`,
      entity_type: "push_batch",
      metadata: { total: totalTokens, unique: uniqueTokens, chunks: numChunks, success: successCount, failure: failureCount, invalid: invalidTokenCount, retries: retryCount },
    });
  }

  const result: PushResult = { totalTokens, uniqueTokens, chunks: numChunks, successCount, failureCount, invalidTokenCount, retryCount };
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
 * 특정 수영장(poolId)의 학부모 전원에게 푸시 발송
 *
 * WP5: 대량 fan-out — 토큰을 한 번에 모아 chunked 발송.
 * HTTP request를 block하지 않도록 background 처리.
 */
export async function sendPushToPoolParents(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  // [WP5] background — HTTP response를 block하지 않음
  void _doSendPushToPoolParents(poolId, notifType, title, body, data, triggeredBy);
}

async function _doSendPushToPoolParents(
  poolId: string,
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  triggeredBy?: string,
): Promise<void> {
  try {
    const parentRows = await db.execute(sql`
      SELECT DISTINCT pa.id AS parent_account_id
      FROM parent_accounts pa
      WHERE pa.swimming_pool_id = ${poolId}
    `);

    // Collect all enabled tokens across all parents
    const allTokens: string[] = [];
    let enabledCount = 0;
    for (const p of parentRows.rows as any[]) {
      const pid = p.parent_account_id;
      const enabled = await checkPushEnabled(pid, notifType, true);
      if (!enabled) continue;
      enabledCount++;
      const tokens = await getTokensByParentId(pid);
      allTokens.push(...tokens);
    }

    if (!allTokens.length) return;

    // [WP5] single sendRawPush call → internal dedup + chunking + bounded concurrency
    await sendRawPush(allTokens, title, body, data, {}, poolId, triggeredBy);
    await logPush(poolId, "pool_batch", notifType, "sent", body, triggeredBy, poolId, enabledCount);
  } catch (e) {
    console.error("[push-service] sendPushToPoolParents 오류:", e);
  }
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
 * 플랫폼 전체 사용자에게 푸시 발송
 * - 모든 수영장의 관리자·선생님·학부모를 대상으로 함
 * - 삭제되지 않은(deleted_at IS NULL) 활성 계정만 포함
 * - 각 사용자의 알림 ON/OFF 설정 준수
 *
 * WP5: background async (HTTP non-blocking), 토큰 일괄 수집 후 chunked 발송
 */
export async function sendPushToAllUsers(
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  triggeredBy?: string
): Promise<void> {
  // [WP5] background — HTTP response를 block하지 않음
  void _doSendPushToAllUsers(notifType, title, body, data, triggeredBy);
}

async function _doSendPushToAllUsers(
  notifType: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  triggeredBy?: string,
): Promise<void> {
  try {
    const allTokens: string[] = [];
    let enabledCount = 0;

    // 1) 모든 관리자·선생님
    const userRows = await superAdminDb.execute(sql`
      SELECT id, role FROM users
      WHERE role IN ('pool_admin', 'teacher')
        AND swimming_pool_id IS NOT NULL
    `);
    for (const u of userRows.rows as any[]) {
      const uid = u.id;
      const enabled = await checkPushEnabled(uid, notifType, false);
      if (!enabled) continue;
      const tokens = await getTokensByUserId(uid);
      allTokens.push(...tokens);
      if (tokens.length) enabledCount++;
    }

    // 2) 모든 학부모
    const parentRows = await db.execute(sql`
      SELECT DISTINCT id AS parent_account_id
      FROM parent_accounts
      WHERE swimming_pool_id IS NOT NULL
    `);
    for (const p of parentRows.rows as any[]) {
      const pid = p.parent_account_id;
      const enabled = await checkPushEnabled(pid, notifType, true);
      if (!enabled) continue;
      const tokens = await getTokensByParentId(pid);
      allTokens.push(...tokens);
      if (tokens.length) enabledCount++;
    }

    if (!allTokens.length) return;

    // [WP5] single sendRawPush call → internal dedup + chunking + bounded concurrency
    await sendRawPush(allTokens, title, body, data, {}, undefined, triggeredBy);
    await logPush("ALL", "global_batch", notifType, "sent", body, triggeredBy, undefined, enabledCount);
  } catch (e) {
    console.error("[push-service] sendPushToAllUsers 오류:", e);
  }
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
