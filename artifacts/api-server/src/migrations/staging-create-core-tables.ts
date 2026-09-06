/**
 * staging-create-core-tables.ts
 *
 * raw pg.Pool (TEST_DATABASE_URL)로 모든 누락 테이블을 직접 생성.
 * @workspace/db 완전 우회 — Replit secret 주입 문제 없음.
 *
 * 실행:
 *   ALLOW_TEST_DB_MUTATIONS=true npx tsx src/migrations/staging-create-core-tables.ts
 */

import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
const allow = process.env.ALLOW_TEST_DB_MUTATIONS;

if (!url) { console.error("🚫 TEST_DATABASE_URL not set"); process.exit(1); }
if (allow !== "true") { console.error("🚫 ALLOW_TEST_DB_MUTATIONS must be true"); process.exit(1); }

// Safety: verify staging project ref
const username = new URL(url).username;
const ref = username.replace(/^postgres\./, "");
const STAGING_REFS = new Set(["cbpaxrvrqczqefjoykge"]); // swimnote-staging-free
if (!STAGING_REFS.has(ref)) {
  console.error(`🚫 URL does not point to known staging (ref=${ref})`);
  process.exit(1);
}

console.log(`✅ Staging ref: ${ref}`);

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });

async function exec(label: string, sql: string): Promise<void> {
  try {
    await pool.query(sql);
    console.log(`  ✅ ${label}`);
  } catch (e: any) {
    if (e.code === "42P07" || e.message?.includes("already exists")) {
      console.log(`  ⏩ ${label} (already exists)`);
    } else {
      console.error(`  ❌ ${label}: ${e.message}`);
    }
  }
}

async function main() {
  console.log("\n═══ STAGING CORE TABLE CREATION ═══\n");

  // ── ENUMs ────────────────────────────────────────────────────────────────
  console.log("[1] ENUMs");
  await exec("approval_status", `DO $$ BEGIN CREATE TYPE approval_status AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await exec("subscription_status", `DO $$ BEGIN CREATE TYPE subscription_status AS ENUM ('trial','active','expired','suspended','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await exec("user_role", `DO $$ BEGIN CREATE TYPE user_role AS ENUM ('super_admin','pool_admin','parent','teacher'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await exec("gr_cycle_status_enum", `DO $$ BEGIN CREATE TYPE gr_cycle_status_enum AS ENUM ('PENDING','OPEN','ANALYZING','CLOSED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // ── swimming_pools ────────────────────────────────────────────────────────
  console.log("\n[2] swimming_pools");
  await exec("swimming_pools table", `
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
      -- WP8 / X columns (additive)
      xmode_entitlement               BOOLEAN     DEFAULT false,
      xmode_config_status             TEXT        DEFAULT 'INACTIVE',
      x_slot_id                       BIGINT,
      member_limit                    INTEGER,
      subscription_source             TEXT,
      base_manual_entitlement         BOOLEAN     NOT NULL DEFAULT false,
      -- GR1 columns
      gr_enabled                      BOOLEAN     DEFAULT false,
      gr_auto_send_enabled            BOOLEAN     DEFAULT false,
      gr_parent_input_enabled         BOOLEAN     DEFAULT false,
      created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // ── users ─────────────────────────────────────────────────────────────────
  console.log("\n[3] users");
  await exec("users table", `
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
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await exec("users.swimming_pool_id FK", `
    ALTER TABLE users ADD CONSTRAINT fk_users_pool FOREIGN KEY (swimming_pool_id) REFERENCES swimming_pools(id) NOT VALID
  `).catch(() => {});

  // ── push_logs ─────────────────────────────────────────────────────────────
  console.log("\n[4] push_logs");
  await exec("push_logs table", `
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
  `);

  // ── audit_logs ────────────────────────────────────────────────────────────
  console.log("\n[5] audit_logs");
  await exec("audit_logs table", `
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
  `);
  await exec("idx_audit_logs_entity", `CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, entity_version)`);
  await exec("idx_audit_logs_actor", `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC) WHERE actor_id IS NOT NULL`);
  await exec("idx_audit_logs_pool", `CREATE INDEX IF NOT EXISTS idx_audit_logs_pool ON audit_logs (pool_id, created_at DESC) WHERE pool_id IS NOT NULL`);

  // ── ai_traces (minimal — columns inferred from usage) ────────────────────
  console.log("\n[6] ai_traces");
  await exec("ai_traces table", `
    CREATE TABLE IF NOT EXISTS ai_traces (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      pool_id         TEXT,
      actor_id        TEXT,
      actor_type      TEXT,
      trace_type      TEXT,
      model           TEXT,
      prompt_tokens   INTEGER,
      completion_tokens INTEGER,
      total_tokens    INTEGER,
      duration_ms     INTEGER,
      success         BOOLEAN     NOT NULL DEFAULT true,
      error_message   TEXT,
      request_meta    JSONB,
      response_meta   JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await exec("idx_ai_traces_pool", `CREATE INDEX IF NOT EXISTS idx_ai_traces_pool ON ai_traces (pool_id, created_at DESC) WHERE pool_id IS NOT NULL`);
  await exec("idx_ai_traces_actor", `CREATE INDEX IF NOT EXISTS idx_ai_traces_actor ON ai_traces (actor_id, created_at DESC) WHERE actor_id IS NOT NULL`);

  // ── support_cases ─────────────────────────────────────────────────────────
  console.log("\n[7] support_cases");
  await exec("support_cases table", `
    CREATE TABLE IF NOT EXISTS support_cases (
      id               TEXT PRIMARY KEY,
      pool_id          TEXT REFERENCES swimming_pools(id),
      ticket_id        TEXT,
      actor_role       TEXT NOT NULL,
      mode             TEXT,
      state            TEXT NOT NULL DEFAULT 'NEW',
      title            TEXT,
      category         TEXT,
      subject_type     TEXT,
      subject_id       TEXT,
      assigned_operator TEXT,
      resolution       TEXT,
      ops_status       TEXT DEFAULT 'OPEN',
      created_by_admin TEXT,
      resolved_at      TIMESTAMPTZ,
      ai_response_count INTEGER NOT NULL DEFAULT 0,
      human_response_count INTEGER NOT NULL DEFAULT 0,
      escalation_reason TEXT,
      last_message_at  TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await exec("sc_pool_status_idx", `CREATE INDEX IF NOT EXISTS sc_pool_status_idx ON support_cases(pool_id, ops_status)`);
  await exec("sc_pool_created_idx", `CREATE INDEX IF NOT EXISTS sc_pool_created_idx ON support_cases(pool_id, created_at DESC)`);

  // ── support_case_notes ────────────────────────────────────────────────────
  console.log("\n[8] support_case_notes");
  await exec("support_case_notes table", `
    CREATE TABLE IF NOT EXISTS support_case_notes (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      case_id      TEXT NOT NULL REFERENCES support_cases(id),
      note         TEXT NOT NULL,
      event_type   TEXT NOT NULL DEFAULT 'NOTE_ADDED',
      operator_id  TEXT,
      metadata     JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await exec("scn_case_idx", `CREATE INDEX IF NOT EXISTS scn_case_idx ON support_case_notes(case_id, created_at)`);

  // ── diary_entries (minimal — inferred from usage in super.ts) ─────────────
  console.log("\n[9] diary_entries");
  await exec("diary_entries table", `
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
  `);
  await exec("idx_diary_entries_student", `CREATE INDEX IF NOT EXISTS idx_diary_entries_student ON diary_entries(student_id, created_at DESC)`);
  await exec("idx_diary_entries_class", `CREATE INDEX IF NOT EXISTS idx_diary_entries_class ON diary_entries(class_group_id, created_at DESC) WHERE class_group_id IS NOT NULL`);

  // ── curriculum_items (depends on curriculum_versions — must already exist) ─
  console.log("\n[10] curriculum_items");
  await exec("curriculum_items table", `
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
  `);
  await exec("idx_curriculum_items_version", `CREATE INDEX IF NOT EXISTS idx_curriculum_items_version ON curriculum_items(curriculum_version_id, sort_order)`);

  // ── growth_report_cycles ───────────────────────────────────────────────────
  console.log("\n[11] growth_report_cycles");
  await exec("growth_report_cycles table", `
    CREATE TABLE IF NOT EXISTS growth_report_cycles (
      id                    TEXT        PRIMARY KEY DEFAULT ('grc_' || replace(gen_random_uuid()::text,'-','')),
      swimming_pool_id      TEXT        NOT NULL REFERENCES swimming_pools(id),
      report_period         TEXT        NOT NULL,
      analysis_from         TIMESTAMPTZ,
      analysis_cutoff_at    TIMESTAMPTZ NOT NULL,
      parent_input_open_at  TIMESTAMPTZ NOT NULL,
      parent_input_close_at TIMESTAMPTZ NOT NULL,
      timezone              TEXT        NOT NULL DEFAULT 'Asia/Seoul',
      cycle_status          TEXT        NOT NULL DEFAULT 'PENDING',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chk_grc_report_period_format CHECK (report_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    )
  `);
  await exec("uq_growth_report_cycles_pool_period", `CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_cycles_pool_period ON growth_report_cycles(swimming_pool_id, report_period)`);
  await exec("idx_growth_report_cycles_pool_status", `CREATE INDEX IF NOT EXISTS idx_growth_report_cycles_pool_status ON growth_report_cycles(swimming_pool_id, cycle_status)`);

  // ── growth_report_batch_jobs ───────────────────────────────────────────────
  console.log("\n[12] growth_report_batch_jobs");
  await exec("growth_report_batch_jobs table", `
    CREATE TABLE IF NOT EXISTS growth_report_batch_jobs (
      id                TEXT        PRIMARY KEY DEFAULT ('grb_' || replace(gen_random_uuid()::text,'-','')),
      swimming_pool_id  TEXT        NOT NULL,
      year              SMALLINT    NOT NULL,
      month             SMALLINT    NOT NULL,
      job_type          TEXT        NOT NULL DEFAULT 'MONTHLY_AUTO',
      status            TEXT        NOT NULL DEFAULT 'PENDING',
      target_count      INT         NOT NULL DEFAULT 0,
      completed_count   INT         NOT NULL DEFAULT 0,
      failed_count      INT         NOT NULL DEFAULT 0,
      attempts          INT         NOT NULL DEFAULT 0,
      worker_id         TEXT,
      locked_at         TIMESTAMPTZ,
      next_attempt_at   TIMESTAMPTZ,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      admin_push_sent_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT growth_report_batch_jobs_status_chk CHECK (status IN ('PENDING','RUNNING','COMPLETED','PARTIAL','FAILED')),
      CONSTRAINT growth_report_batch_jobs_year_chk CHECK (year >= 2024 AND year <= 2100),
      CONSTRAINT growth_report_batch_jobs_month_chk CHECK (month >= 1 AND month <= 12)
    )
  `);
  await exec("uq_growth_report_batch_jobs_pool_period", `CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_batch_jobs_pool_period ON growth_report_batch_jobs(swimming_pool_id, year, month, job_type)`);
  await exec("idx_growth_report_batch_jobs_pending", `CREATE INDEX IF NOT EXISTS idx_growth_report_batch_jobs_pending ON growth_report_batch_jobs(status, next_attempt_at) WHERE status IN ('PENDING','RUNNING')`);

  // ── x_monthly_operational_snapshots ───────────────────────────────────────
  console.log("\n[13] x_monthly_operational_snapshots");
  await exec("x_monthly_operational_snapshots table", `
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
  `);
  await exec("idx_xmos_period", `CREATE INDEX IF NOT EXISTS idx_xmos_period ON x_monthly_operational_snapshots(year, month)`);

  // ── x_setup_submissions ────────────────────────────────────────────────────
  console.log("\n[14] x_setup_submissions");
  await exec("x_setup_submissions table", `
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
  `);

  // ── x_setup_files ─────────────────────────────────────────────────────────
  console.log("\n[15] x_setup_files");
  await exec("x_setup_files table", `
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
  `);
  await exec("idx_x_setup_files_pool_type", `CREATE INDEX IF NOT EXISTS idx_x_setup_files_pool_type ON x_setup_files(pool_id, file_type) WHERE deleted_at IS NULL`);

  // ── x_curriculum_class_assignments (inferred from super.ts usage) ──────────
  console.log("\n[16] x_curriculum_class_assignments");
  await exec("x_curriculum_class_assignments table", `
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
  `);
  await exec("idx_x_cca_pool", `CREATE INDEX IF NOT EXISTS idx_x_cca_pool ON x_curriculum_class_assignments(pool_id, is_active)`);
  await exec("idx_x_cca_class", `CREATE INDEX IF NOT EXISTS idx_x_cca_class ON x_curriculum_class_assignments(class_group_id, is_active)`);

  // ── Final table count check ────────────────────────────────────────────────
  console.log("\n[✓] Verifying...");
  const result = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  const tables = result.rows.map((r: any) => r.table_name);
  const required = ['swimming_pools','users','push_logs','support_cases','support_case_notes','audit_logs','ai_traces','growth_report_cycles','growth_report_batch_jobs','x_monthly_operational_snapshots','x_setup_submissions','x_setup_files','x_curriculum_class_assignments','diary_entries','curriculum_items'];
  const missing = required.filter(t => !tables.includes(t));
  console.log(`\nTotal tables: ${tables.length}`);
  if (missing.length === 0) {
    console.log("✅ ALL required tables present!");
  } else {
    console.log(`❌ Still missing: ${missing.join(', ')}`);
  }

  await pool.end();
}

main().catch(e => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
