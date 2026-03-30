import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const parentAccountsTable = pgTable("parent_accounts", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  phone: text("phone").notNull(),
  pin_hash: text("pin_hash").notNull(),
  name: text("name").notNull(),
  login_id: text("login_id"),
  nickname: text("nickname"),
  gender: text("gender"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const parentStudentsTable = pgTable("parent_students", {
  id: text("id").primaryKey(),
  parent_id: text("parent_id").notNull(),
  student_id: text("student_id").notNull(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  status: text("status").notNull().default("pending"),
  approved_by: text("approved_by"),
  approved_at: timestamp("approved_at"),
  rejection_reason: text("rejection_reason"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const studentRegistrationRequestsTable = pgTable("student_registration_requests", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  parent_id: text("parent_id").notNull(),
  child_names: jsonb("child_names").notNull().default([]),
  memo: text("memo"),
  status: text("status").notNull().default("pending"),
  reviewed_by: text("reviewed_by"),
  reviewed_at: timestamp("reviewed_at"),
  rejection_reason: text("rejection_reason"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// parent_content_reads: 학부모가 사진/일지를 마지막으로 확인한 시점 추적
// content_type: 'photo' | 'diary'
export const parentContentReadsTable = pgTable("parent_content_reads", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  parent_id: text("parent_id").notNull(),
  student_id: text("student_id").notNull(),
  content_type: text("content_type").notNull(),
  last_read_at: timestamp("last_read_at").notNull().defaultNow(),
});

export const insertParentAccountSchema = createInsertSchema(parentAccountsTable).omit({
  created_at: true,
  updated_at: true,
});
export type InsertParentAccount = z.infer<typeof insertParentAccountSchema>;
export type ParentAccount = typeof parentAccountsTable.$inferSelect;
export type ParentStudent = typeof parentStudentsTable.$inferSelect;
