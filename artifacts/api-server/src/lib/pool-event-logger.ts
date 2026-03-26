/**
 * pool-event-logger.ts
 * 수영장 운영 이벤트 저장 서비스
 *
 * 흐름:
 *   1. 이벤트 발생
 *   2. superAdminDb.pool_event_logs + pool_change_logs 즉시 저장
 *   3. 저장 실패 → event_retry_queue 적재 → 지수 백오프 재시도
 *   4. 재시도 max_retries 초과 → dead_letter_queue 이동 (수동 재전송)
 *
 * [DB 규칙] 모든 데이터는 superAdminDb(Supabase)에만 저장.
 *           poolDb는 사용 금지 (백업 모듈 전용).
 */
import { superAdminDb } from "@workspace/db";
import {
  poolEventLogsTable,
  eventRetryQueueTable,
  poolChangeLogsTable,
  deadLetterQueueTable,
} from "@workspace/db/schema";
import { sql, eq, and, lt } from "drizzle-orm";

export interface PoolEventParams {
  pool_id:     string;
  event_type:  string;
  entity_type: string;
  entity_id?:  string;
  actor_id?:   string;
  actor_name?: string;
  payload?:    Record<string, unknown>;
}

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 1. 슈퍼관리자 DB 이벤트 로그 저장 ─────────────────────────────
async function writeToSuperAdmin(params: PoolEventParams, source = "pool_ops"): Promise<void> {
  await superAdminDb.insert(poolEventLogsTable).values({
    id:          genId("evl"),
    pool_id:     params.pool_id,
    event_type:  params.event_type,
    entity_type: params.entity_type,
    entity_id:   params.entity_id ?? null,
    actor_id:    params.actor_id ?? null,
    actor_name:  params.actor_name ?? null,
    payload:     params.payload ?? {},
    source,
  });
}

// ── 2. superAdminDb에 pool_change_logs 저장 (poolDb 사용 금지) ────────
async function writeToPoolChangeLogs(params: PoolEventParams): Promise<void> {
  try {
    await superAdminDb.insert(poolChangeLogsTable).values({
      id:          genId("pcl"),
      pool_id:     params.pool_id,
      event_type:  params.event_type,
      entity_type: params.entity_type,
      entity_id:   params.entity_id ?? null,
      actor_id:    params.actor_id ?? null,
      actor_name:  params.actor_name ?? null,
      payload:     params.payload ?? {},
    });
  } catch (e) {
    console.warn("[pool-event-logger] pool_change_logs 기록 실패 (무시됨):", (e as Error).message);
  }
}

// ── 3. 재시도 큐 적재 ─────────────────────────────────────────────
async function enqueueRetry(params: PoolEventParams, error: string): Promise<void> {
  try {
    await superAdminDb.insert(eventRetryQueueTable).values({
      id:           genId("rtq"),
      pool_id:      params.pool_id,
      event_type:   params.event_type,
      entity_type:  params.entity_type,
      entity_id:    params.entity_id ?? null,
      actor_id:     params.actor_id ?? null,
      actor_name:   params.actor_name ?? null,
      payload:      params.payload ?? {},
      retry_count:  0,
      max_retries:  5,
      last_error:   error.slice(0, 500),
      next_retry_at: new Date(),
      resolved:     false,
    });
  } catch (e2) {
    console.error("[pool-event-logger] 재시도 큐 적재도 실패:", e2);
  }
}

// ── 4. Dead-letter queue 이동 ─────────────────────────────────────
async function moveToDeadLetter(row: any): Promise<void> {
  try {
    await superAdminDb.insert(deadLetterQueueTable).values({
      id:             genId("dlq"),
      pool_id:        row.pool_id,
      event_type:     row.event_type,
      entity_type:    row.entity_type,
      entity_id:      row.entity_id,
      actor_id:       row.actor_id,
      actor_name:     row.actor_name,
      payload:        row.payload,
      original_error: row.last_error,
      total_retries:  row.retry_count,
      resolved:       false,
    });
    await superAdminDb.execute(sql`
      UPDATE event_retry_queue SET resolved = true, updated_at = NOW() WHERE id = ${row.id}
    `);
    console.warn(`[pool-event-logger] DLQ로 이동: ${row.event_type} (${row.id})`);
  } catch (e) {
    console.error("[pool-event-logger] DLQ 이동 실패:", e);
  }
}

// ── 메인 함수: 이벤트 저장 (superAdminDb 단독) ───────────────────────
// 순서: superAdminDb pool_change_logs + pool_event_logs 저장
// 저장 실패 시 retry queue → DLQ로 보관
export async function logPoolEvent(params: PoolEventParams): Promise<void> {
  // 1. superAdminDb pool_change_logs 저장
  await writeToPoolChangeLogs(params);

  // 2. superAdminDb pool_event_logs 저장
  try {
    await writeToSuperAdmin(params);
  } catch (err) {
    console.error("[pool-event-logger] DB 저장 실패, 재시도 큐 적재:", (err as Error).message);
    await enqueueRetry(params, String(err));
  }
}

// ── 재시도 큐 처리 배치 (크론에서 주기 호출) ─────────────────────────
export async function processRetryQueue(): Promise<void> {
  try {
    const pending = await superAdminDb.execute(sql`
      SELECT * FROM event_retry_queue
      WHERE resolved = false
        AND retry_count < max_retries
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC
      LIMIT 50
    `);
    const rows = pending.rows as any[];
    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        await writeToSuperAdmin({
          pool_id:     row.pool_id,
          event_type:  row.event_type,
          entity_type: row.entity_type,
          entity_id:   row.entity_id,
          actor_id:    row.actor_id,
          actor_name:  row.actor_name,
          payload:     row.payload,
        }, "pool_ops_retry");
        await superAdminDb.execute(sql`
          UPDATE event_retry_queue SET resolved = true, updated_at = NOW() WHERE id = ${row.id}
        `);
      } catch (err) {
        const newCount = row.retry_count + 1;
        if (newCount >= row.max_retries) {
          await moveToDeadLetter({ ...row, retry_count: newCount, last_error: String(err).slice(0, 500) });
        } else {
          const nextRetry = new Date(Date.now() + Math.pow(2, newCount) * 60 * 1000);
          await superAdminDb.execute(sql`
            UPDATE event_retry_queue
            SET retry_count   = ${newCount},
                last_error    = ${String(err).slice(0, 500)},
                next_retry_at = ${nextRetry.toISOString()},
                updated_at    = NOW()
            WHERE id = ${row.id}
          `);
        }
      }
    }
    console.log(`[pool-event-logger] 재시도 처리: ${rows.length}건`);
  } catch (err) {
    console.error("[pool-event-logger] 재시도 큐 처리 오류:", err);
  }
}

// ── Dead-letter 수동 재전송 ──────────────────────────────────────────
export async function resendDeadLetter(dlqId: string, resolvedBy: string): Promise<boolean> {
  try {
    const [row] = (await superAdminDb.execute(sql`
      SELECT * FROM dead_letter_queue WHERE id = ${dlqId} AND resolved = false LIMIT 1
    `)).rows as any[];
    if (!row) return false;

    await writeToSuperAdmin({
      pool_id:     row.pool_id,
      event_type:  row.event_type,
      entity_type: row.entity_type,
      entity_id:   row.entity_id,
      actor_id:    row.actor_id,
      actor_name:  row.actor_name,
      payload:     row.payload,
    }, "dead_letter_resend");

    await superAdminDb.execute(sql`
      UPDATE dead_letter_queue
      SET resolved = true, resolved_at = NOW(), resolved_by = ${resolvedBy}
      WHERE id = ${dlqId}
    `);
    console.log(`[pool-event-logger] DLQ 재전송 성공: ${dlqId}`);
    return true;
  } catch (err) {
    console.error("[pool-event-logger] DLQ 재전송 실패:", err);
    return false;
  }
}
