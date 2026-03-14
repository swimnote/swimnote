import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studentsTable = pgTable("students", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  birth_date: text("birth_date"),
  class_group_id: text("class_group_id"),
  memo: text("memo"),
  notes: text("notes"),
  class_schedule: jsonb("class_schedule").default([]),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  created_at: true,
  updated_at: true,
});
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
