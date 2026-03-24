/**
 * push-notifications.ts — 푸시 알림 설정 테이블 (pool DB 전용)
 *
 * push_settings      : 사용자별/학부모별 알림 수신 설정
 * pool_push_settings : 수영장별 푸시 발송 설정
 */
import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const pushSettingsTable = pgTable("push_settings", {
  id:                 text("id").primaryKey().default(sql`(gen_random_uuid())::text`),
  user_id:            text("user_id"),
  parent_account_id:  text("parent_account_id"),
  notification_type:  text("notification_type"),
  is_enabled:         boolean("is_enabled").default(true),
  updated_at:         timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const poolPushSettingsTable = pgTable("pool_push_settings", {
  id:                   text("id").primaryKey().default(sql`(gen_random_uuid())::text`),
  pool_id:              text("pool_id"),
  prev_day_push_time:   text("prev_day_push_time").default("20:00"),
  same_day_push_offset: integer("same_day_push_offset").default(1),
  tpl_notice:           text("tpl_notice"),
  tpl_prev_day:         text("tpl_prev_day"),
  tpl_same_day:         text("tpl_same_day"),
  tpl_diary:            text("tpl_diary"),
  tpl_photo:            text("tpl_photo"),
  updated_at:           timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type PushSetting     = typeof pushSettingsTable.$inferSelect;
export type PoolPushSetting = typeof poolPushSettingsTable.$inferSelect;
