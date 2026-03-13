import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const classGroupsTable = pgTable("class_groups", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  name: text("name").notNull(),
  schedule_days: text("schedule_days").notNull(),
  schedule_time: text("schedule_time").notNull(),
  instructor: text("instructor"),
  level: text("level"),
  capacity: integer("capacity"),
  description: text("description"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClassGroupSchema = createInsertSchema(classGroupsTable).omit({
  created_at: true,
  updated_at: true,
});
export type InsertClassGroup = z.infer<typeof insertClassGroupSchema>;
export type ClassGroup = typeof classGroupsTable.$inferSelect;
