import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const classChangeLogsTable = pgTable("class_change_logs", {
  id: text("id").primaryKey(),
  pool_id: text("pool_id").notNull(),
  class_group_id: text("class_group_id").notNull(),
  target_student_id: text("target_student_id"),
  change_type: text("change_type").notNull(),
  effective_date: text("effective_date").notNull(),
  display_week_start: text("display_week_start").notNull(),
  note: text("note"),
  created_by: text("created_by").notNull(),
  is_applied: boolean("is_applied").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export type ClassChangeLog = typeof classChangeLogsTable.$inferSelect;
