import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const parentPoolRequestsTable = pgTable("parent_pool_requests", {
  id: text("id").primaryKey(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  parent_name: text("parent_name").notNull(),
  phone: text("phone").notNull(),
  request_status: text("request_status").notNull().default("pending"),
  requested_at: timestamp("requested_at").notNull().defaultNow(),
  processed_at: timestamp("processed_at"),
  processed_by: text("processed_by"),
  rejection_reason: text("rejection_reason"),
  parent_account_id: text("parent_account_id"),
  // Children data
  child_name: text("child_name"),
  child_birth_year: integer("child_birth_year"),
  children_requested: jsonb("children_requested").default([]),
});

export const insertParentPoolRequestSchema = createInsertSchema(parentPoolRequestsTable).omit({
  requested_at: true,
  processed_at: true,
});
export type InsertParentPoolRequest = z.infer<typeof insertParentPoolRequestSchema>;
export type ParentPoolRequest = typeof parentPoolRequestsTable.$inferSelect;
