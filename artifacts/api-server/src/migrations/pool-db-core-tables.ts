/**
 * pool-db-core-tables.ts — Core tables that MUST exist before all other migrations
 *
 * Creates: swimming_pools, users, push_logs, audit_logs, ai_traces,
 *          diary_entries, curriculum_items, support_cases, support_case_notes,
 *          x_monthly_operational_snapshots, x_setup_submissions, x_setup_files,
 *          x_curriculum_class_assignments
 *
 * Design rules:
 * - All statements use CREATE TABLE IF NOT EXISTS / ALTER TABLE ... IF NOT EXISTS → idempotent
 * - swimming_pools has NO FK constraints (it is the FK target for everything else)
 * - Tables that REFERENCE swimming_pools come AFTER swimming_pools in this file
 * - push_logs is created here; wp6-wp7-additive-schema only ADDs columns (idempotent)
 * - This migration MUST run as the very first step in any fresh-DB scenario
 *
 * Called by staging-manifest.ts §-1.
 * In production, these tables already exist; every statement is IF NOT EXISTS — safe to re-run.
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function initCoreTablesSchema(db: MigrationDb): Promise<void> {

  // ─── ENUMs (idempotent DO $$ ... EXCEPTION) ─────────────────────────────
  await db.execute(sql.raw(`
    DO $$ BEGIN CREATE TYPE approval_status    AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE subscription_status AS ENUM ('trial','active','expired','suspended','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE user_role          AS ENUM ('super_admin','pool_admin','parent','teacher'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)).catch(() => {});

  // ─── swimming_pools (no FK refs — everything else references this) ────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS swimming_pools (
      id                              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name                            TEXT        NOT NULL,
      name_en                         TEXT,
      address                         TEXT        NOT NULL,
      phone                           TEXT        NOT NULL,
      owner_name                      TEXT        NOT NULL,
      owner_email                     TEXT        NOT NULL,
      approval_status                 TEXT        NOT NULL DEFAULT 'pending',
      rejection_reason                TEXT,
      subscription_status             TEXT        NOT NULL DEFAULT 'trial',
      subscription_start_at           TIMESTAMPTZ,
      subscription_end_at             TIMESTAMPTZ,
      trial_end_at                    TIMESTAMPTZ,
      subscription_tier               TEXT        DEFAULT 'free',
      business_reg_number             TEXT,
      business_reg_image_key          TEXT,
      business_license_status         TEXT        NOT NULL DEFAULT 'notUploaded',
      bank_account_verification_status TEXT       NOT NULL DEFAULT 'notUploaded',
      group_id                        TEXT,
      pool_type                       TEXT        DEFAULT 'swimming_pool',
      admin_name                      TEXT,
      admin_email                     TEXT,
      admin_phone                     TEXT,
      theme_color                     TEXT        DEFAULT '#1A5CFF',
      logo_url                        TEXT,
      logo_emoji                      TEXT,
      default_capacity                INTEGER     DEFAULT 20,
      base_storage_gb                 INTEGER     DEFAULT 5,
      extra_storage_gb                INTEGER     DEFAULT 0,
      used_storage_bytes              BIGINT      DEFAULT 0,
      upload_blocked                  BOOLEAN     DEFAULT false,
      storage_warning_sent_at         TIMESTAMPTZ,
      video_storage_limit_mb          INTEGER     DEFAULT 0,
      credit_balance                  INTEGER     DEFAULT 0,
      is_readonly                     BOOLEAN     DEFAULT false,
      readonly_reason                 TEXT,
      homepage_slug                   TEXT,
      homepage_enabled                BOOLEAN     DEFAULT false,
      white_label_enabled             BOOLEAN     DEFAULT false,
      hide_platform_name              BOOLEAN     DEFAULT false,
      payment_failed_at               TIMESTAMPTZ,
      first_payment_used              BOOLEAN     NOT NULL DEFAULT false,
      introduction                    TEXT,
      tuition_info                    TEXT,
      level_test_info                 TEXT,
      event_info                      TEXT,
      equipment_info                  TEXT,
      make_up_expiry_type             TEXT        DEFAULT 'end_of_month',
      make_up_expiry_days             INTEGER,
      make_up_limit_weekly_1          INTEGER     DEFAULT 2,
      make_up_limit_weekly_2          INTEGER     DEFAULT 4,
      make_up_limit_weekly_3          INTEGER     DEFAULT 5,
      -- X mode columns (added by pool-db-x-init.ts and pool-db-x-payment-init.ts — kept here for fresh-DB correctness)
      xmode_entitlement               BOOLEAN     DEFAULT false,
      xmode_config_status             TEXT        DEFAULT 'INACTIVE',
      x_slot_id                       BIGINT,
      member_limit                    INTEGER,
      subscription_source             TEXT,
      subscription_plan_name          TEXT,
      storage_mb                      INTEGER     NOT NULL DEFAULT 512,
      display_storage                 TEXT        NOT NULL DEFAULT '500MB',
      admin_user_id                   TEXT,
      base_manual_entitlement         BOOLEAN     NOT NULL DEFAULT false,
      -- GR1 columns
      gr_enabled                      BOOLEAN     DEFAULT false,
      gr_auto_send_enabled            BOOLEAN     DEFAULT false,
      gr_parent_input_enabled         BOOLEAN     DEFAULT false,
      -- deactivation
      deactivated_at                  TIMESTAMPTZ,
      deletion_scheduled_at           TIMESTAMPTZ,
      created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  console.log("[core-tables] swimming_pools OK");

  // ─── users ────────────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email                   TEXT        NOT NULL UNIQUE,
      password_hash           TEXT        NOT NULL,
      name                    TEXT        NOT NULL,
      phone                   TEXT,
      role                    TEXT        NOT NULL DEFAULT 'parent',
      swimming_pool_id        TEXT,
      is_activated            BOOLEAN     NOT NULL DEFAULT true,
      is_admin_self_teacher   BOOLEAN     NOT NULL DEFAULT false,
      phone_verified          BOOLEAN     NOT NULL DEFAULT false,
      created_by              TEXT,
      permissions             JSONB,
      roles                   TEXT[]      NOT NULL DEFAULT '{}',
      totp_secret             TEXT,
      totp_enabled            BOOLEAN     NOT NULL DEFAULT false,
      withdrawal_requested_at TIMESTAMPTZ,
      apple_id                TEXT,
      kakao_id                TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  // FK: NOT VALID avoids full-table scan on existing data; safe to add idempotently via DO block
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT fk_users_pool
        FOREIGN KEY (swimming_pool_id) REFERENCES swimming_pools(id) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)).catch(() => {});
  console.log("[core-tables] users OK");

  // ─── push_logs ────────────────────────────────────────────────────────────
  // Source of truth: push-service.ts CREATE TABLE (boot-time DDL).
  // Exact same schema — wp6-wp7-additive-schema.ts will ADD extra columns (IF NOT EXISTS).
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS push_logs (
      id              TEXT PRIMARY KEY,
      target_user_id  TEXT,
      role            TEXT,
      type            TEXT,
      status          TEXT,
      message         TEXT,
      triggered_by    TEXT,
      created_at      TIMESTAMPTZ DEFAULT now()
    )
  `));
  console.log("[core-tables] push_logs OK");

  // ─── audit_logs ──────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id              TEXT        PRIMARY KEY DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
      entity_type     TEXT        NOT NULL,
      entity_id       TEXT        NOT NULL,
      entity_version  BIGINT      NOT NULL,
      action          TEXT        NOT NULL,
      actor_type      TEXT        NOT NULL,
      actor_id        TEXT,
      pool_id         TEXT,
      before_data     JSONB,
      after_data      JSONB,
      reason          TEXT,
      request_id      TEXT,
      correlation_id  TEXT,
      ip_hash         TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, entity_version)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_audit_logs_actor  ON audit_logs (actor_id, created_at DESC) WHERE actor_id IS NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_audit_logs_pool   ON audit_logs (pool_id, created_at DESC) WHERE pool_id IS NOT NULL`)).catch(() => {});
  console.log("[core-tables] audit_logs OK");

  // ─── ai_traces ───────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ai_traces (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id           TEXT,
      actor_id          TEXT,
      actor_type        TEXT,
      trace_type        TEXT,
      model             TEXT,
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      total_tokens      INTEGER,
      duration_ms       INTEGER,
      success           BOOLEAN     NOT NULL DEFAULT true,
      error_message     TEXT,
      request_meta      JSONB,
      response_meta     JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_ai_traces_pool  ON ai_traces (pool_id, created_at DESC) WHERE pool_id IS NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_ai_traces_actor ON ai_traces (actor_id, created_at DESC) WHERE actor_id IS NOT NULL`)).catch(() => {});
  console.log("[core-tables] ai_traces OK");

  // ─── support_knowledge_items (needed by cs-pa0 and ALL cs-* seeds) ────────
  // Creating here so that cs-pa0 (which only creates support_cases and support_case_notes)
  // can reference support_knowledge_items in its seed step even before cs-pa0 runs.
  // cs-pa0's own CREATE TABLE IF NOT EXISTS for support_knowledge_items is idempotent.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS support_knowledge_items (
      id                TEXT        PRIMARY KEY,
      item_type         TEXT        NOT NULL,
      scope             TEXT        NOT NULL DEFAULT 'global',
      category          TEXT        NOT NULL,
      feature           TEXT,
      title             TEXT        NOT NULL,
      content           TEXT        NOT NULL,
      question          TEXT,
      answer            TEXT,
      affected_roles    TEXT[]      NOT NULL DEFAULT '{}',
      affected_modes    TEXT[]      NOT NULL DEFAULT '{}',
      frontend_screen_id TEXT,
      source_type       TEXT        NOT NULL DEFAULT 'CODE_POLICY',
      source_ref        TEXT,
      solution_steps    JSONB,
      status            TEXT        NOT NULL DEFAULT 'pending',
      revision          INTEGER     NOT NULL DEFAULT 1,
      pool_id           TEXT,
      answer_mode       TEXT,
      metadata          JSONB,
      priority          INTEGER     NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_ski_status_category ON support_knowledge_items (status, category)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_ski_scope_status    ON support_knowledge_items (scope, status)`)).catch(() => {});
  console.log("[core-tables] support_knowledge_items OK");

  // ─── support_cases (referenced by support_case_notes and wp8 routes) ─────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS support_cases (
      id                    TEXT PRIMARY KEY,
      pool_id               TEXT REFERENCES swimming_pools(id),
      ticket_id             TEXT,
      actor_role            TEXT NOT NULL,
      mode                  TEXT,
      state                 TEXT NOT NULL DEFAULT 'NEW',
      title                 TEXT,
      category              TEXT,
      subject_type          TEXT,
      subject_id            TEXT,
      assigned_operator     TEXT,
      resolution            TEXT,
      ops_status            TEXT DEFAULT 'OPEN',
      created_by_admin      TEXT,
      resolved_at           TIMESTAMPTZ,
      ai_response_count     INTEGER NOT NULL DEFAULT 0,
      human_response_count  INTEGER NOT NULL DEFAULT 0,
      escalation_reason     TEXT,
      resolution_source     TEXT,
      llm_used              BOOLEAN NOT NULL DEFAULT false,
      turn_count            INT NOT NULL DEFAULT 0,
      last_message_at       TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS sc_pool_status_idx  ON support_cases(pool_id, ops_status)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS sc_pool_created_idx ON support_cases(pool_id, created_at DESC)`)).catch(() => {});
  console.log("[core-tables] support_cases OK");

  // ─── support_case_notes ───────────────────────────────────────────────────
  // Column name: support_case_id (matches super.ts INSERT route)
  // wp8-support-case-crm.ts also uses support_case_id — must be consistent.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS support_case_notes (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      support_case_id TEXT NOT NULL,
      pool_id         TEXT,
      actor_id        TEXT,
      event_type      TEXT NOT NULL DEFAULT 'NOTE_ADDED',
      note            TEXT,
      before_state    TEXT,
      after_state     TEXT,
      operator_id     TEXT,
      metadata        JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS scn_case_idx ON support_case_notes(support_case_id, created_at)`)).catch(() => {});
  console.log("[core-tables] support_case_notes OK");

  // ─── diary_entries ────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS diary_entries (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      student_id      TEXT        NOT NULL,
      class_group_id  TEXT,
      pool_id         TEXT,
      teacher_id      TEXT,
      lesson_date     TEXT,
      content         TEXT,
      ai_generated    BOOLEAN     NOT NULL DEFAULT false,
      ai_trace_id     TEXT,
      is_published    BOOLEAN     NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_diary_entries_student ON diary_entries(student_id, created_at DESC)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_diary_entries_class   ON diary_entries(class_group_id, created_at DESC) WHERE class_group_id IS NOT NULL`)).catch(() => {});
  console.log("[core-tables] diary_entries OK");

  // ─── curriculum_items ────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_items (
      id                    TEXT        PRIMARY KEY DEFAULT ('ci_' || replace(gen_random_uuid()::text,'-','')),
      curriculum_version_id TEXT        NOT NULL,
      swimming_pool_id      TEXT        NOT NULL,
      sort_order            INTEGER     NOT NULL DEFAULT 0,
      title                 TEXT        NOT NULL,
      description           TEXT,
      is_active             BOOLEAN     NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_curriculum_items_version ON curriculum_items(curriculum_version_id, sort_order)`)).catch(() => {});
  console.log("[core-tables] curriculum_items OK");

  // ─── x_monthly_operational_snapshots ─────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS x_monthly_operational_snapshots (
      id                              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      swimming_pool_id                TEXT        NOT NULL REFERENCES swimming_pools(id),
      year                            SMALLINT    NOT NULL,
      month                           SMALLINT    NOT NULL,
      ai_diary_count                  INTEGER     NOT NULL DEFAULT 0,
      ai_diary_teacher_count          INTEGER     NOT NULL DEFAULT 0,
      parent_curriculum_search_count  INTEGER     NOT NULL DEFAULT 0,
      parent_curriculum_user_count    INTEGER     NOT NULL DEFAULT 0,
      assigned_student_count          INTEGER,
      unassigned_student_count        INTEGER,
      curriculum_version_id           UUID,
      growth_report_target_count      INTEGER     NOT NULL DEFAULT 0,
      growth_report_generated_count   INTEGER     NOT NULL DEFAULT 0,
      growth_report_failed_count      INTEGER     NOT NULL DEFAULT 0,
      growth_report_sent_count        INTEGER     NOT NULL DEFAULT 0,
      active_student_count            INTEGER,
      active_teacher_count            INTEGER,
      connected_parent_count          INTEGER,
      x_plan_key                      TEXT,
      x_plan_member_limit             INTEGER,
      snapshot_finalized_at           TIMESTAMPTZ,
      created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (swimming_pool_id, year, month)
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_xmos_period ON x_monthly_operational_snapshots(year, month)`)).catch(() => {});
  console.log("[core-tables] x_monthly_operational_snapshots OK");

  // ─── x_setup_submissions ─────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS x_setup_submissions (
      id                          TEXT PRIMARY KEY,
      pool_id                     TEXT NOT NULL UNIQUE REFERENCES swimming_pools(id),
      setup_status                TEXT NOT NULL DEFAULT 'NOT_STARTED',
      curriculum_status           TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      website_status              TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      logo_status                 TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      photos_status               TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
      curriculum_template_version TEXT,
      website_template_version    TEXT,
      submitted_at                TIMESTAMPTZ,
      submitted_by                TEXT,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  console.log("[core-tables] x_setup_submissions OK");

  // ─── x_setup_files ───────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS x_setup_files (
      id                    TEXT PRIMARY KEY,
      pool_id               TEXT NOT NULL REFERENCES swimming_pools(id),
      file_type             TEXT NOT NULL,
      r2_key                TEXT NOT NULL,
      original_filename     TEXT NOT NULL,
      mime_type             TEXT NOT NULL,
      file_size_bytes       BIGINT,
      submission_version    INT  NOT NULL DEFAULT 1,
      is_current            BOOLEAN NOT NULL DEFAULT true,
      photo_order           INT,
      photo_title           TEXT,
      photo_category        TEXT,
      template_version      TEXT,
      uploaded_by           TEXT NOT NULL,
      uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at            TIMESTAMPTZ
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_x_setup_files_pool_type ON x_setup_files(pool_id, file_type) WHERE deleted_at IS NULL`)).catch(() => {});
  console.log("[core-tables] x_setup_files OK");

  // ─── x_curriculum_class_assignments ──────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS x_curriculum_class_assignments (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id         TEXT        NOT NULL,
      class_group_id  TEXT        NOT NULL,
      package_id      TEXT,
      assigned_by     TEXT,
      is_active       BOOLEAN     NOT NULL DEFAULT true,
      assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      deactivated_at  TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_x_cca_pool  ON x_curriculum_class_assignments(pool_id, is_active)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_x_cca_class ON x_curriculum_class_assignments(class_group_id, is_active)`)).catch(() => {});
  console.log("[core-tables] x_curriculum_class_assignments OK");

  // ─── parent_ai_daily_usage ────────────────────────────────────────────────
  // Prerequisite for initXModeSchema Group 8 (which adds feature_unique constraint).
  // Created here so that Group 8 finds the table on first run → Group 8 becomes
  // a no-op → pool-db-init §1 does NOT throw → post-Group8 boot migrations
  // (idx_parent_accounts_pool_phone, uq_notifications_gr_published) run on 1st run.
  // initXModePart2Schema (§3a2) also creates this table with IF NOT EXISTS → no-op.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_ai_daily_usage (
      id                    TEXT            PRIMARY KEY DEFAULT gen_random_uuid()::text,
      parent_account_id     TEXT            NOT NULL,
      feature               TEXT            NOT NULL DEFAULT 'parent_curriculum_search',
      usage_date            DATE            NOT NULL,
      reserved_count        INTEGER         NOT NULL DEFAULT 0,
      completed_count       INTEGER         NOT NULL DEFAULT 0,
      failed_count          INTEGER         NOT NULL DEFAULT 0,
      intent_blocked_count  INTEGER         NOT NULL DEFAULT 0,
      prompt_tokens         INTEGER         NOT NULL DEFAULT 0,
      completion_tokens     INTEGER         NOT NULL DEFAULT 0,
      estimated_cost_krw    NUMERIC(10,2)   NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
      UNIQUE (parent_account_id, feature, usage_date)
    )
  `));
  // The UNIQUE(parent_account_id, feature, usage_date) above generates the implicit
  // constraint name parent_ai_daily_usage_parent_account_id_feature_usage_date_key.
  // Group 8 also adds parent_ai_daily_usage_feature_unique (a named explicit constraint
  // on the same columns). Ensure it exists so Group 8 is fully idempotent on 1st run.
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class tbl ON tbl.oid = con.conrelid
        JOIN pg_namespace ns  ON ns.oid = tbl.relnamespace
        WHERE con.conname = 'parent_ai_daily_usage_feature_unique'
          AND tbl.relname = 'parent_ai_daily_usage'
          AND ns.nspname  = 'public'
      )
      AND to_regclass('public.parent_ai_daily_usage_feature_unique') IS NULL
      THEN
        ALTER TABLE public.parent_ai_daily_usage
          ADD CONSTRAINT parent_ai_daily_usage_feature_unique
          UNIQUE (parent_account_id, feature, usage_date);
      END IF;
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_parent_ai_usage_date
      ON parent_ai_daily_usage (parent_account_id, feature, usage_date DESC)
  `)).catch(() => {});
  console.log("[core-tables] parent_ai_daily_usage OK");

  console.log("[core-tables] initCoreTablesSchema — DONE");
}
