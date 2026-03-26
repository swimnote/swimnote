import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const noticesTable = pgTable("notices", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  swimming_pool_id: text("swimming_pool_id").notNull(),
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
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at"),
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
