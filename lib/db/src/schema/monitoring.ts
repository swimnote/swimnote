/**
 * 모니터링/이벤트 로그 테이블 (슈퍼관리자 영역)
 *
 * pool_event_logs    : 수영장 운영 이벤트 복제본 (pool_ops → super_admin 이중 저장)
 * event_retry_queue  : 이벤트 전송 실패 재시도 큐
 * db_server_snapshots: DB 용량 스냅샷 (주기적 수집)
 */
import { pgTable, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

/** 수영장 운영 이벤트 복제 로그 (super_admin 영역) */
export const poolEventLogsTable = pgTable("pool_event_logs", {
  id:          text("id").primaryKey().default("gen_random_uuid()"),
  pool_id:     text("pool_id").notNull(),
  event_type:  text("event_type").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id:   text("entity_id"),
  actor_id:    text("actor_id"),
  actor_name:  text("actor_name"),
  payload:     jsonb("payload"),
  source:      text("source").notNull().default("pool_ops"),
  created_at:  timestamp("created_at").notNull().defaultNow(),
});

/** 이벤트 전송 실패 재시도 큐 */
export const eventRetryQueueTable = pgTable("event_retry_queue", {
  id:           text("id").primaryKey().default("gen_random_uuid()"),
  pool_id:      text("pool_id").notNull(),
  event_type:   text("event_type").notNull(),
  entity_type:  text("entity_type").notNull(),
  entity_id:    text("entity_id"),
  actor_id:     text("actor_id"),
  actor_name:   text("actor_name"),
  payload:      jsonb("payload"),
  retry_count:  integer("retry_count").notNull().default(0),
  max_retries:  integer("max_retries").notNull().default(5),
  last_error:   text("last_error"),
  next_retry_at: timestamp("next_retry_at").notNull().defaultNow(),
  resolved:     boolean("resolved").notNull().default(false),
  created_at:   timestamp("created_at").notNull().defaultNow(),
  updated_at:   timestamp("updated_at").notNull().defaultNow(),
});

/** DB 서버 용량 스냅샷 (슈퍼관리자가 조회 가능) */
export const dbServerSnapshotsTable = pgTable("db_server_snapshots", {
  id:                   text("id").primaryKey().default("gen_random_uuid()"),
  db_label:             text("db_label").notNull(),
  total_size_bytes:     text("total_size_bytes").notNull().default("0"),
  pool_count:           integer("pool_count").notNull().default(0),
  table_count:          integer("table_count").notNull().default(0),
  largest_table_name:   text("largest_table_name"),
  largest_table_bytes:  text("largest_table_bytes").default("0"),
  pool_breakdown:       jsonb("pool_breakdown"),
  captured_at:          timestamp("captured_at").notNull().defaultNow(),
});

/** 수영장 내부 변경 감사 로그 (pool_ops DB 영역 — super 로그 실패 대비) */
export const poolChangeLogsTable = pgTable("pool_change_logs", {
  id:          text("id").primaryKey().default("gen_random_uuid()"),
  pool_id:     text("pool_id").notNull(),
  event_type:  text("event_type").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id:   text("entity_id"),
  actor_id:    text("actor_id"),
  actor_name:  text("actor_name"),
  payload:     jsonb("payload"),
  created_at:  timestamp("created_at").notNull().defaultNow(),
});

/** Dead-letter queue — 최대 재시도 초과 이벤트 보관 (수동 재전송 가능) */
export const deadLetterQueueTable = pgTable("dead_letter_queue", {
  id:             text("id").primaryKey().default("gen_random_uuid()"),
  pool_id:        text("pool_id").notNull(),
  event_type:     text("event_type").notNull(),
  entity_type:    text("entity_type").notNull(),
  entity_id:      text("entity_id"),
  actor_id:       text("actor_id"),
  actor_name:     text("actor_name"),
  payload:        jsonb("payload"),
  original_error: text("original_error"),
  total_retries:  integer("total_retries").notNull().default(0),
  resolved:       boolean("resolved").notNull().default(false),
  resolved_at:    timestamp("resolved_at"),
  resolved_by:    text("resolved_by"),
  created_at:     timestamp("created_at").notNull().defaultNow(),
});

export type PoolEventLog      = typeof poolEventLogsTable.$inferSelect;
export type EventRetryQueue   = typeof eventRetryQueueTable.$inferSelect;
export type DbServerSnapshot  = typeof dbServerSnapshotsTable.$inferSelect;
export type PoolChangeLog     = typeof poolChangeLogsTable.$inferSelect;
export type DeadLetterQueue   = typeof deadLetterQueueTable.$inferSelect;
