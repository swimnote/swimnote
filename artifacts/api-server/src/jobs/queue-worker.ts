/**
 * queue-worker.ts — WP11 Background Worker
 *
 * 담당:
 *   1. event_retry_queue 처리 (processRetryQueue 주기 호출, 5분마다)
 *   2. makeup_sessions 만료 처리 (expire_at 기준, 1시간마다)
 *
 * 원칙 (WP11 스펙):
 *   - acquireLock 재사용 — 동시 worker 중복 처리 방지
 *   - 각 job 독립 실행 — job A 실패 시 job B 계속 처리 (§13 error isolation)
 *   - API server startup을 process.exit(1) 시키지 않음 (§12)
 *   - batch limit 50 (§15)
 *   - 개인정보 로그 금지 (§14) — id/status/duration만 기록
 *   - idempotent: makeup_sessions 재실행 시 이미 'expired'이면 WHERE 조건 불충족 → 안전
 */

import { processRetryQueue }                            from "../lib/pool-event-logger.js";
import { acquireLock, releaseLock, recordHeartbeat }   from "../lib/schedulerLock.js";
import { db }                                           from "@workspace/db";
import { sql }                                          from "drizzle-orm";

const RETRY_QUEUE_LOCK   = "event-retry-queue";
const MAKEUP_EXPIRY_LOCK = "makeup-expiry-cleanup";

// 재시도 큐: 5분마다. TTL 290초 (interval보다 약간 짧게 — stale lock 방지)
const RETRY_INTERVAL_MS  = 5 * 60 * 1000;
const RETRY_TTL_SECONDS  = 290;

// makeup 만료: 1시간마다. TTL 3500초
const EXPIRY_INTERVAL_MS = 60 * 60 * 1000;
const EXPIRY_TTL_SECONDS = 3500;

// 한 번 실행 시 처리하는 makeup 최대 건수 (§15)
const MAKEUP_BATCH_LIMIT = 50;

// ── 1. event_retry_queue 처리 ───────────────────────────────────────────────

export interface RetryQueueResult {
  locked:    boolean;
  errors:    number;
  durationMs: number;
}

/**
 * event_retry_queue의 미처리 행(resolved=false, next_retry_at<=NOW())을 처리합니다.
 *
 * - acquireLock 성공 시만 processRetryQueue() 호출
 * - 실패해도 throw 안 함 (caller가 계속 실행 가능)
 * - 로그: job_type, locked, duration, status, error_code
 */
export async function runRetryQueue(): Promise<RetryQueueResult> {
  const start = Date.now();
  const locked = await acquireLock(RETRY_QUEUE_LOCK, RETRY_TTL_SECONDS);

  if (!locked) {
    console.log("[queue-worker] retry-queue: lock_not_acquired — other worker running");
    return { locked: false, errors: 0, durationMs: Date.now() - start };
  }

  try {
    await processRetryQueue();
    const durationMs = Date.now() - start;
    console.log(`[queue-worker] retry-queue: status=ok duration=${durationMs}ms`);
    void recordHeartbeat(RETRY_QUEUE_LOCK, { status: "ok", durationMs }).catch(() => {});
    return { locked: true, errors: 0, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`[queue-worker] retry-queue: status=error duration=${durationMs}ms error=${err?.message ?? "unknown"}`);
    return { locked: true, errors: 1, durationMs };
  } finally {
    await releaseLock(RETRY_QUEUE_LOCK);
  }
}

// ── 2. makeup_sessions 만료 처리 ────────────────────────────────────────────

export interface MakeupExpiryResult {
  locked:     boolean;
  expired:    number;
  durationMs: number;
}

/**
 * expire_at < NOW() 이고 status='waiting' 이며 can_expire=true인
 * makeup_sessions을 status='expired'로 전환합니다.
 *
 * - 이미 expired/completed/cancelled인 row는 WHERE 조건 불충족 → 변경 없음 (idempotent)
 * - batch limit 50 — 한 번에 무제한 처리 금지 (§15)
 * - hard delete 금지 — status 전환만 수행 (§8)
 */
export async function runMakeupExpiry(): Promise<MakeupExpiryResult> {
  const start = Date.now();
  const locked = await acquireLock(MAKEUP_EXPIRY_LOCK, EXPIRY_TTL_SECONDS);

  if (!locked) {
    console.log("[queue-worker] makeup-expiry: lock_not_acquired — other worker running");
    return { locked: false, expired: 0, durationMs: Date.now() - start };
  }

  try {
    // PostgreSQL은 UPDATE ... LIMIT 미지원 → 서브쿼리 IN 패턴
    const result = await db.execute(sql`
      UPDATE makeup_sessions
      SET    status     = 'expired',
             updated_at = NOW()
      WHERE  id IN (
        SELECT id
        FROM   makeup_sessions
        WHERE  status     = 'waiting'
          AND  can_expire = true
          AND  expire_at  IS NOT NULL
          AND  expire_at  < NOW()
        ORDER BY expire_at ASC
        LIMIT  ${MAKEUP_BATCH_LIMIT}
      )
    `);

    const expired    = (result as any).rowCount ?? 0;
    const durationMs = Date.now() - start;
    console.log(`[queue-worker] makeup-expiry: status=ok expired=${expired} duration=${durationMs}ms`);
    void recordHeartbeat(MAKEUP_EXPIRY_LOCK, { status: "ok", expired, durationMs }).catch(() => {});
    return { locked: true, expired, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`[queue-worker] makeup-expiry: status=error duration=${durationMs}ms error=${err?.message ?? "unknown"}`);
    return { locked: true, expired: 0, durationMs };
  } finally {
    await releaseLock(MAKEUP_EXPIRY_LOCK);
  }
}

// ── 스케줄러 등록 ─────────────────────────────────────────────────────────────

/**
 * queue-worker 스케줄러를 등록합니다.
 *
 * 호출 위치: src/index.ts (WORKER_MODE와 API 모드 모두)
 * - retry-queue: 서버 시작 후 30초 뒤 1회 + 이후 5분마다
 * - makeup-expiry: 서버 시작 후 60초 뒤 1회 + 이후 1시간마다
 *
 * 각 job은 독립 실행 — 하나 실패해도 다른 것 계속 실행됨 (§13).
 * API server startup을 process.exit(1)로 종료시키지 않음 (§12).
 */
export function startQueueWorker(): void {
  console.log("[queue-worker] 시작: retry-queue(5분), makeup-expiry(1시간)");

  // ── retry-queue ────────────────────────────────────────────────────────────
  setTimeout(() => {
    runRetryQueue().catch((e: any) =>
      console.error("[queue-worker] retry-queue initial run error:", e?.message)
    );
  }, 30_000);

  setInterval(() => {
    runRetryQueue().catch((e: any) =>
      console.error("[queue-worker] retry-queue interval error:", e?.message)
    );
  }, RETRY_INTERVAL_MS);

  // ── makeup-expiry ──────────────────────────────────────────────────────────
  setTimeout(() => {
    runMakeupExpiry().catch((e: any) =>
      console.error("[queue-worker] makeup-expiry initial run error:", e?.message)
    );
  }, 60_000);

  setInterval(() => {
    runMakeupExpiry().catch((e: any) =>
      console.error("[queue-worker] makeup-expiry interval error:", e?.message)
    );
  }, EXPIRY_INTERVAL_MS);
}
