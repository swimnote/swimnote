import { pgTable, text, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trial", "active", "expired", "suspended", "cancelled"]);

export const swimmingPoolsTable = pgTable("swimming_pools", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  owner_name: text("owner_name").notNull(),
  owner_email: text("owner_email").notNull(),
  approval_status: approvalStatusEnum("approval_status").notNull().default("pending"),
  rejection_reason: text("rejection_reason"),
  subscription_status: subscriptionStatusEnum("subscription_status").notNull().default("trial"),
  subscription_start_at: timestamp("subscription_start_at"),
  subscription_end_at: timestamp("subscription_end_at"),
  default_capacity: integer("default_capacity").default(20),

  make_up_expiry_type:    text("make_up_expiry_type").default("end_of_month"),
  make_up_expiry_days:    integer("make_up_expiry_days"),
  make_up_limit_weekly_1: integer("make_up_limit_weekly_1").default(2),
  make_up_limit_weekly_2: integer("make_up_limit_weekly_2").default(4),
  make_up_limit_weekly_3: integer("make_up_limit_weekly_3").default(5),

  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPoolSchema = createInsertSchema(swimmingPoolsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertPool = z.infer<typeof insertPoolSchema>;
export type Pool = typeof swimmingPoolsTable.$inferSelect;
