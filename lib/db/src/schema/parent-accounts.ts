import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const parentAccountsTable = pgTable("parent_accounts", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  phone: text("phone").notNull(),
  pin_hash: text("pin_hash").notNull(),
  name: text("name").notNull(),
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

export const insertParentAccountSchema = createInsertSchema(parentAccountsTable).omit({
  created_at: true,
  updated_at: true,
});
export type InsertParentAccount = z.infer<typeof insertParentAccountSchema>;
export type ParentAccount = typeof parentAccountsTable.$inferSelect;
export type ParentStudent = typeof parentStudentsTable.$inferSelect;
