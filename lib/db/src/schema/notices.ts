import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const noticesTable = pgTable("notices", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  // audience_scope: 'global'(전체) | 'pool'(수영장별)
  // global 공지는 swimming_pool_id null 허용 — 모든 수영장에 노출
  audience_scope: text("audience_scope").notNull().default("pool"),
  swimming_pool_id: text("swimming_pool_id"),   // pool 범위일 때만 필수, global이면 null
  title: text("title").notNull(),
  content: text("content").notNull(),
  author_id: text("author_id").notNull(),
  author_name: text("author_name").notNull(),
  is_pinned: boolean("is_pinned").notNull().default(false),
  notice_type: text("notice_type").notNull().default("general"),
  student_id: text("student_id"),
  student_name: text("student_name"),
  image_urls: text("image_urls").array(),
  push_sent_at: timestamp("push_sent_at"),
  push_sent_count: integer("push_sent_count").default(0),
  // status: 'published'(정상) | 'hidden'(숨김) | 'deleted'(소프트 삭제)
  // 소프트 삭제로 이력 추적 가능 — 완전 삭제는 별도 배치로만 수행
  status: text("status").notNull().default("published"),
  // WP4: Unified Notice/Banner/Push fields (additive)
  show_banner:       boolean("show_banner").notNull().default(false),
  send_push:         boolean("send_push").notNull().default(false),
  target_roles:      text("target_roles").array(),          // ['ADMIN','TEACHER','PARENT']
  target_pools:      text("target_pools").array(),          // pool IDs or null=all
  starts_at:         timestamp("starts_at", { withTimezone: true }),
  ends_at:           timestamp("ends_at",   { withTimezone: true }),
  deep_link:         text("deep_link"),                     // nullable deep-link URL
  target_plan_types: text("target_plan_types").array(),     // WP12 forward-compat
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at"),
});

/** notice_dismissals — Banner "다시 보지 않기" per user */
export const noticeDismissalsTable = pgTable("notice_dismissals", {
  id:           text("id").primaryKey().default("gen_random_uuid()"),
  notice_id:    text("notice_id").notNull().references(() => noticesTable.id, { onDelete: "cascade" }),
  user_id:      text("user_id").notNull(),
  dismissed_at: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNoticeSchema = createInsertSchema(noticesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
  push_sent_at: true,
  push_sent_count: true,
});
export type InsertNotice = z.infer<typeof insertNoticeSchema>;
export type Notice = typeof noticesTable.$inferSelect;
export type NoticeDismissal = typeof noticeDismissalsTable.$inferSelect;
