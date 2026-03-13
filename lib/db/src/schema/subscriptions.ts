import { pgTable, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subscriptionsTable = pgTable("subscriptions", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  status: text("status").notNull(),
  plan_name: text("plan_name").notNull().default("기본 플랜"),
  amount: integer("amount").notNull().default(0),
  start_at: timestamp("start_at"),
  end_at: timestamp("end_at"),
  note: text("note"),
  created_by: text("created_by"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const paymentLogsTable = pgTable("payment_logs", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  subscription_id: text("subscription_id"),
  amount: integer("amount").notNull().default(0),
  status: text("status").notNull().default("pending"),
  method: text("method"),
  note: text("note"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  created_at: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type PaymentLog = typeof paymentLogsTable.$inferSelect;
