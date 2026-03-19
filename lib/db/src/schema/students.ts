import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studentsTable = pgTable("students", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  birth_date: text("birth_date"),
  birth_year: text("birth_year"),
  class_group_id: text("class_group_id"),
  assigned_class_ids: jsonb("assigned_class_ids").$type<string[]>().default([]),
  memo: text("memo"),
  notes: text("notes"),
  class_schedule: jsonb("class_schedule").default([]),
  status: text("status").notNull().default("active"),
  registration_path: text("registration_path").notNull().default("admin_created"),
  parent_name: text("parent_name"),
  parent_phone: text("parent_phone"),
  parent_user_id: text("parent_user_id"),
  weekly_count: integer("weekly_count").default(1),
  schedule_labels: text("schedule_labels"),
  invite_code: text("invite_code"),
  invite_status: text("invite_status").notNull().default("none"),
  withdrawn_at: timestamp("withdrawn_at"),
  deleted_at: timestamp("deleted_at"),
  archived_reason: text("archived_reason"),
  last_class_group_name: text("last_class_group_name"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  created_at: true,
  updated_at: true,
});
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
