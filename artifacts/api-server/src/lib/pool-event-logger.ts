/**
 * pool-event-logger.ts
 * 수영장 운영 이벤트를 슈퍼관리자 DB에 복제 저장
 *
 * 흐름:
 *   1. pool_ops (poolDb) 에서 이벤트 발생
 *   2. superAdminDb.pool_event_logs 에 즉시 저장 시도
 *   3. 실패 시 event_retry_queue 에 적재 → 재시도 배치가 처리
 *
 * 사용법:
 *   import { logPoolEvent } from "@/lib/pool-event-logger";
 *   await logPoolEvent({ pool_id, event_type, entity_type, entity_id, actor_id, actor_name, payload });
 */
import { superAdminDb } from "@workspace/db";
import { poolEventLogsTable, eventRetryQueueTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

export interface PoolEventParams {
  pool_id:     string;
  event_type:  string;
  entity_type: string;
  entity_id?:  string;
  actor_id?:   string;
  actor_name?: string;
  payload?:    Record<string, unknown>;
}

/** 이벤트를 슈퍼관리자 DB에 저장 (실패 시 재시도 큐 적재) */
export async function logPoolEvent(params: PoolEventParams): Promise<void> {
  const id = `evl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await superAdminDb.insert(poolEventLogsTable).values({
      id,
      pool_id:     params.pool_id,
      event_type:  params.event_type,
      entity_type: params.entity_type,
      entity_id:   params.entity_id ?? null,
      actor_id:    params.actor_id ?? null,
      actor_name:  params.actor_name ?? null,
      payload:     params.payload ?? {},
      source:      "pool_ops",
    });
  } catch (err) {
    console.error("[pool-event-logger] 이벤트 저장 실패, 재시도 큐 적재:", err);
    await enqueueRetry(params, String(err));
  }
}

/** 실패한 이벤트를 재시도 큐에 적재 */
async function enqueueRetry(params: PoolEventParams, error: string): Promise<void> {
  const id = `rtq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await superAdminDb.insert(eventRetryQueueTable).values({
      id,
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

/** 재시도 큐 처리 (크론 잡에서 주기적으로 호출) */
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
      const logId = `evl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await superAdminDb.insert(poolEventLogsTable).values({
          id:          logId,
          pool_id:     row.pool_id,
          event_type:  row.event_type,
          entity_type: row.entity_type,
          entity_id:   row.entity_id,
          actor_id:    row.actor_id,
          actor_name:  row.actor_name,
          payload:     row.payload,
          source:      "pool_ops_retry",
        });
        await superAdminDb.execute(sql`
          UPDATE event_retry_queue
          SET resolved = true, updated_at = NOW()
          WHERE id = ${row.id}
        `);
      } catch (err) {
        const nextRetry = new Date(Date.now() + Math.pow(2, row.retry_count) * 60 * 1000);
        await superAdminDb.execute(sql`
          UPDATE event_retry_queue
          SET retry_count  = ${row.retry_count + 1},
              last_error   = ${String(err).slice(0, 500)},
              next_retry_at = ${nextRetry.toISOString()},
              updated_at   = NOW()
          WHERE id = ${row.id}
        `);
      }
    }
    if (rows.length > 0) {
      console.log(`[pool-event-logger] 재시도 처리: ${rows.length}건`);
    }
  } catch (err) {
    console.error("[pool-event-logger] 재시도 큐 처리 오류:", err);
  }
}
