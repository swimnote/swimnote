CREATE TABLE "parent_content_reads" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"parent_id" text NOT NULL,
	"student_id" text NOT NULL,
	"content_type" text NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_server_snapshots" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"db_label" text NOT NULL,
	"total_size_bytes" text DEFAULT '0' NOT NULL,
	"pool_count" integer DEFAULT 0 NOT NULL,
	"table_count" integer DEFAULT 0 NOT NULL,
	"largest_table_name" text,
	"largest_table_bytes" text DEFAULT '0',
	"pool_breakdown" jsonb,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letter_queue" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"pool_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"actor_id" text,
	"actor_name" text,
	"payload" jsonb,
	"original_error" text,
	"total_retries" integer DEFAULT 0 NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_retry_queue" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"pool_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"actor_id" text,
	"actor_name" text,
	"payload" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp DEFAULT now() NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_change_logs" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"pool_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"actor_id" text,
	"actor_name" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_event_logs" (
	"id" text PRIMARY KEY DEFAULT 'gen_random_uuid()' NOT NULL,
	"pool_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"actor_id" text,
	"actor_name" text,
	"payload" jsonb,
	"source" text DEFAULT 'pool_ops' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_assets_meta" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"pool_id" text NOT NULL,
	"student_id" text,
	"class_id" text,
	"journal_id" text,
	"album_type" text DEFAULT 'group' NOT NULL,
	"bucket_name" text DEFAULT 'photos' NOT NULL,
	"object_key" text NOT NULL,
	"file_type" text,
	"file_size" integer,
	"uploaded_by" text NOT NULL,
	"uploaded_by_name" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'class' NOT NULL,
	"is_thumbnail" boolean DEFAULT false NOT NULL,
	"is_compressed" boolean DEFAULT false NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_assets_meta" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"pool_id" text NOT NULL,
	"student_id" text,
	"class_id" text,
	"journal_id" text,
	"album_type" text DEFAULT 'group' NOT NULL,
	"bucket_name" text DEFAULT 'videos' NOT NULL,
	"object_key" text NOT NULL,
	"file_type" text,
	"file_size" bigint,
	"uploaded_by" text NOT NULL,
	"uploaded_by_name" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'class' NOT NULL,
	"caption" text,
	"duration_sec" integer,
	"codec" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_push_settings" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"pool_id" text,
	"prev_day_push_time" text DEFAULT '20:00',
	"same_day_push_offset" integer DEFAULT 1,
	"tpl_notice" text,
	"tpl_prev_day" text,
	"tpl_same_day" text,
	"tpl_diary" text,
	"tpl_photo" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_settings" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"user_id" text,
	"parent_account_id" text,
	"notification_type" text,
	"is_enabled" boolean DEFAULT true,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "platform_banners" (
	"id" text PRIMARY KEY NOT NULL,
	"banner_type" text DEFAULT 'slider' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image_url" text,
	"image_key" text,
	"link_url" text,
	"link_label" text,
	"color_theme" text DEFAULT 'teal' NOT NULL,
	"target" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"display_start" timestamp NOT NULL,
	"display_end" timestamp NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notices" ALTER COLUMN "swimming_pool_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "withdrawal_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "trial_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "subscription_tier" text DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "business_reg_number" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "business_reg_image_key" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "business_license_status" text DEFAULT 'notUploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "bank_account_verification_status" text DEFAULT 'notUploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "pool_type" text DEFAULT 'swimming_pool';--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "admin_name" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "admin_email" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "admin_phone" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "theme_color" text DEFAULT '#1A5CFF';--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "logo_emoji" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "base_storage_gb" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "extra_storage_gb" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "used_storage_bytes" bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "upload_blocked" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "storage_warning_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "video_storage_limit_mb" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "credit_balance" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "is_readonly" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "readonly_reason" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "homepage_slug" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "homepage_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "white_label_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "hide_platform_name" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "payment_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "first_payment_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "introduction" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "tuition_info" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "level_test_info" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "event_info" text;--> statement-breakpoint
ALTER TABLE "swimming_pools" ADD COLUMN "equipment_info" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "name_korean" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "parent_phone3" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "class_enrolled_at" text;--> statement-breakpoint
ALTER TABLE "class_groups" ADD COLUMN "color" text DEFAULT '#FFFFFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "class_groups" ADD COLUMN "co_teacher_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_accounts" ADD COLUMN "kakao_id" text;--> statement-breakpoint
ALTER TABLE "parent_accounts" ADD COLUMN "kakao_profile_image" text;--> statement-breakpoint
ALTER TABLE "parent_accounts" ADD COLUMN "withdrawal_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "audience_scope" text DEFAULT 'pool' NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "image_urls" text[];--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "push_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "push_sent_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_parent_student_unique" UNIQUE("parent_id","student_id");