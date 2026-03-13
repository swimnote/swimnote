import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
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
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertNoticeSchema = createInsertSchema(noticesTable).omit({
  id: true,
  created_at: true,
});
export type InsertNotice = z.infer<typeof insertNoticeSchema>;
export type Notice = typeof noticesTable.$inferSelect;
