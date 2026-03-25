/**
 * 이벤트 로거 — 운영 행위를 event_logs 테이블에 기록
 */
import { superAdminDb as db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type EventCategory =
  | "삭제"
  | "결제"
  | "구독"
  | "해지"
  | "권한"
  | "선생님"
  | "저장공간"
  | "휴무일";

export interface EventLogParams {
  pool_id:     string;
  category:    EventCategory;
  actor_id?:   string;
  actor_name?: string;
  target?:     string;
  description: string;
  metadata?:   Record<string, unknown>;
}

export async function logEvent(params: EventLogParams): Promise<void> {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = params.metadata ? JSON.stringify(params.metadata) : "{}";
  await db.execute(sql`
    INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
    VALUES (
      ${id},
      ${params.pool_id},
      ${params.category},
      ${params.actor_id ?? null},
      ${params.actor_name ?? null},
      ${params.target ?? null},
      ${params.description},
      ${metadata}::jsonb
    )
  `);
}
