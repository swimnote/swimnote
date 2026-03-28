/**
 * pools.ts — 수영장 플랫폼 테이블 (super DB 전용)
 *
 * swimming_pools : 수영장 등록/구독/용량/설정 마스터
 */
import { pgTable, text, timestamp, pgEnum, integer, boolean, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trial", "active", "expired", "suspended", "cancelled"]);

export const swimmingPoolsTable = pgTable("swimming_pools", {
  id:             text("id").primaryKey().default("gen_random_uuid()"),
  name:           text("name").notNull(),
  name_en:        text("name_en"),
  address:        text("address").notNull(),
  phone:          text("phone").notNull(),
  owner_name:     text("owner_name").notNull(),
  owner_email:    text("owner_email").notNull(),

  approval_status:   approvalStatusEnum("approval_status").notNull().default("pending"),
  rejection_reason:  text("rejection_reason"),

  subscription_status:   subscriptionStatusEnum("subscription_status").notNull().default("trial"),
  subscription_start_at: timestamp("subscription_start_at"),
  subscription_end_at:   timestamp("subscription_end_at"),
  trial_end_at:          timestamp("trial_end_at", { withTimezone: true }),
  subscription_tier:     text("subscription_tier").default("free"),

  business_reg_number:   text("business_reg_number"),
  business_reg_image_key: text("business_reg_image_key"),
  business_license_status: text("business_license_status").notNull().default("notUploaded"),
  bank_account_verification_status: text("bank_account_verification_status").notNull().default("notUploaded"),

  group_id:    text("group_id"),
  pool_type:   text("pool_type").default("swimming_pool"),
  admin_name:  text("admin_name"),
  admin_email: text("admin_email"),
  admin_phone: text("admin_phone"),

  theme_color:   text("theme_color").default("#1A5CFF"),
  logo_url:      text("logo_url"),
  logo_emoji:    text("logo_emoji"),

  default_capacity: integer("default_capacity").default(20),

  base_storage_gb:   integer("base_storage_gb").default(5),
  extra_storage_gb:  integer("extra_storage_gb").default(0),
  used_storage_bytes: bigint("used_storage_bytes", { mode: "number" }).default(0),
  upload_blocked:    boolean("upload_blocked").default(false),
  storage_warning_sent_at: timestamp("storage_warning_sent_at"),

  video_storage_limit_mb: integer("video_storage_limit_mb").default(0),

  credit_balance:  integer("credit_balance").default(0),
  is_readonly:     boolean("is_readonly").default(false),
  readonly_reason: text("readonly_reason"),

  white_label_enabled: boolean("white_label_enabled").default(false),
  hide_platform_name:  boolean("hide_platform_name").default(false),

  payment_failed_at: timestamp("payment_failed_at", { withTimezone: true }),
  first_payment_used: boolean("first_payment_used").notNull().default(false),

  introduction:       text("introduction"),
  tuition_info:       text("tuition_info"),
  level_test_info:    text("level_test_info"),
  event_info:         text("event_info"),
  equipment_info:     text("equipment_info"),

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
