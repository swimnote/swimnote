import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const classGroupsTable = pgTable("class_groups", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  name: text("name").notNull(),
  schedule_days: text("schedule_days").notNull(),
  schedule_time: text("schedule_time").notNull(),
  instructor: text("instructor"),
  teacher_user_id: text("teacher_user_id"),
  level: text("level"),
  capacity: integer("capacity"),
  description: text("description"),
  is_one_time: boolean("is_one_time").notNull().default(false),
  one_time_date: text("one_time_date"),
  color: text("color").notNull().default("#FFFFFF"),
  is_deleted: boolean("is_deleted").notNull().default(false),
  deleted_at: timestamp("deleted_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClassGroupSchema = createInsertSchema(classGroupsTable).omit({
  created_at: true,
  updated_at: true,
});
export type InsertClassGroup = z.infer<typeof insertClassGroupSchema>;
export type ClassGroup = typeof classGroupsTable.$inferSelect;
