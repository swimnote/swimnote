CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'pool_admin', 'parent', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'expired', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."snapshot_type" AS ENUM('incremental', 'full');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'synced', 'error');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" "user_role" DEFAULT 'parent' NOT NULL,
	"swimming_pool_id" text,
	"is_activated" boolean DEFAULT true NOT NULL,
	"is_admin_self_teacher" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"permissions" jsonb,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "swimming_pools" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_email" text NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"subscription_status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"subscription_start_at" timestamp,
	"subscription_end_at" timestamp,
	"default_capacity" integer DEFAULT 20,
	"make_up_expiry_type" text DEFAULT 'end_of_month',
	"make_up_expiry_days" integer,
	"make_up_limit_weekly_1" integer DEFAULT 2,
	"make_up_limit_weekly_2" integer DEFAULT 4,
	"make_up_limit_weekly_3" integer DEFAULT 5,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"birth_date" text,
	"parent_user_id" text,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_members" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"class_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"name" text NOT NULL,
	"instructor" text NOT NULL,
	"schedule" text NOT NULL,
	"capacity" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"birth_date" text,
	"birth_year" text,
	"class_group_id" text,
	"assigned_class_ids" jsonb DEFAULT '[]'::jsonb,
	"memo" text,
	"notes" text,
	"class_schedule" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"registration_path" text DEFAULT 'admin_created' NOT NULL,
	"parent_name" text,
	"parent_phone" text,
	"parent_phone2" text,
	"parent_user_id" text,
	"weekly_count" integer DEFAULT 1,
	"schedule_labels" text,
	"invite_code" text,
	"invite_status" text DEFAULT 'none' NOT NULL,
	"withdrawn_at" timestamp,
	"deleted_at" timestamp,
	"archived_reason" text,
	"last_class_group_name" text,
	"pending_status_change" text,
	"pending_effective_mode" text,
	"pending_effective_month" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"name" text NOT NULL,
	"schedule_days" text NOT NULL,
	"schedule_time" text NOT NULL,
	"instructor" text,
	"teacher_user_id" text,
	"level" text,
	"capacity" integer,
	"description" text,
	"is_one_time" boolean DEFAULT false NOT NULL,
	"one_time_date" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"phone" text NOT NULL,
	"pin_hash" text NOT NULL,
	"name" text NOT NULL,
	"login_id" text,
	"nickname" text,
	"gender" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_students" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text NOT NULL,
	"student_id" text NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_registration_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"child_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memo" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_pool_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"parent_name" text NOT NULL,
	"phone" text NOT NULL,
	"request_status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"processed_by" text,
	"rejection_reason" text,
	"parent_account_id" text,
	"child_name" text,
	"child_birth_year" integer,
	"children_requested" jsonb DEFAULT '[]'::jsonb,
	"login_id" text,
	"password_hash" text
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"class_group_id" text,
	"student_id" text,
	"swimming_pool_id" text NOT NULL,
	"date" text NOT NULL,
	"status" "attendance_status" DEFAULT 'absent' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"updated_at" timestamp,
	"modified_by" text,
	"modified_by_name" text,
	"modification_reason" text
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"notice_type" text DEFAULT 'general' NOT NULL,
	"student_id" text,
	"student_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_logs" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"subscription_id" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"status" text NOT NULL,
	"plan_name" text DEFAULT '기본 플랜' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_schedule_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"class_group_id" text NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"schedule_date" text NOT NULL,
	"note_text" text,
	"audio_file_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_diaries" (
	"id" text PRIMARY KEY DEFAULT 'cd_' || replace(gen_random_uuid()::text,'-','') NOT NULL,
	"class_group_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"teacher_name" text NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"lesson_date" text NOT NULL,
	"common_content" text NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp,
	"edited_by" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_diary_audit_logs" (
	"id" text PRIMARY KEY DEFAULT 'cal_' || replace(gen_random_uuid()::text,'-','') NOT NULL,
	"diary_id" text,
	"student_note_id" text,
	"target_type" text NOT NULL,
	"action_type" text NOT NULL,
	"before_content" text,
	"after_content" text,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_diary_student_notes" (
	"id" text PRIMARY KEY DEFAULT 'csn_' || replace(gen_random_uuid()::text,'-','') NOT NULL,
	"diary_id" text NOT NULL,
	"student_id" text NOT NULL,
	"note_content" text NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp,
	"edited_by" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_templates" (
	"id" text PRIMARY KEY DEFAULT 'dt_' || replace(gen_random_uuid()::text,'-','') NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"level" text,
	"template_text" text NOT NULL,
	"created_by" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "makeup_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swimming_pool_id" text NOT NULL,
	"student_id" text NOT NULL,
	"student_name" text,
	"original_class_group_id" text,
	"original_class_group_name" text,
	"original_teacher_id" text,
	"original_teacher_name" text,
	"absence_date" text NOT NULL,
	"absence_attendance_id" text,
	"absence_time" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"expire_at" timestamp,
	"weekly_frequency" integer DEFAULT 1,
	"assigned_class_group_id" text,
	"assigned_class_group_name" text,
	"assigned_teacher_id" text,
	"assigned_teacher_name" text,
	"assigned_date" text,
	"is_substitute" boolean DEFAULT false,
	"substitute_teacher_id" text,
	"substitute_teacher_name" text,
	"completed_at" timestamp,
	"completed_attendance_id" text,
	"transferred_to_teacher_id" text,
	"transferred_to_teacher_name" text,
	"transferred_at" timestamp,
	"transferred_by" text,
	"transferred_by_name" text,
	"cancelled_reason" text,
	"cancelled_custom" text,
	"cancelled_at" timestamp,
	"cancelled_by" text,
	"cancelled_by_name" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_snapshots" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"tenant_id" text,
	"snapshot_type" "snapshot_type" NOT NULL,
	"tables_included" text NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_change_logs" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"tenant_id" text NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"change_type" "change_type" NOT NULL,
	"payload" jsonb,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"synced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "class_change_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"class_group_id" text NOT NULL,
	"target_student_id" text,
	"change_type" text NOT NULL,
	"effective_date" text NOT NULL,
	"display_week_start" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"is_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
