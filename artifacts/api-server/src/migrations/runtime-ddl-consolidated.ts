/**
 * runtime-ddl-consolidated.ts — WP8-P2: Consolidated Runtime DDL Migration
 *
 * 목적:
 *   이전에 서버 boot-time / request-time에 자동 실행되던 DDL을
 *   명시적 idempotent migration으로 통합.
 *
 * 적용 대상 DB:
 *   MigrationDb — 모든 운영 테이블
 *
 * 실행:
 *   pnpm tsx src/migrations/runtime-ddl-consolidated.ts
 *   또는 staging-bootstrap.ts 경유
 *
 * 제약:
 *   - 모든 DDL은 IF NOT EXISTS / IF EXISTS 조건 포함 (멱등)
 *   - DROP 없음
 *   - Production에 적용 시 별도 승인 필요
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function run(db: MigrationDb) {
  const exec = async (label: string, statement: string) => {
    try {
      await db.execute(sql.raw(statement));
      console.log(`  ✓ ${label}`);
    } catch (e: any) {
      console.warn(`  ⚠ ${label}: ${e.message}`);
    }
  };

  console.log("\n[runtime-ddl-consolidated] Starting migration...\n");

  // ════════════════════════════════════════════════════════════════
  // 1. members table
  // Source: src/routes/members.ts (module-level ALTER)
  // ════════════════════════════════════════════════════════════════
  console.log("§1 members");
  await exec("members.status column", `
    ALTER TABLE members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  // ════════════════════════════════════════════════════════════════
  // 2. inquiries tables
  // Source: src/routes/inquiries.ts ensureTables()
  // ════════════════════════════════════════════════════════════════
  console.log("§2 inquiries");
  await exec("CREATE inquiries", `
    CREATE TABLE IF NOT EXISTS inquiries (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      sender_uuid TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL DEFAULT '',
      pool_id     TEXT,
      pool_name   TEXT,
      target      TEXT NOT NULL DEFAULT 'super',
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'unread',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await exec("CREATE inquiry_replies", `
    CREATE TABLE IF NOT EXISTS inquiry_replies (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      inquiry_id   TEXT NOT NULL,
      replier_uuid TEXT NOT NULL,
      replier_role TEXT NOT NULL,
      replier_name TEXT,
      content      TEXT NOT NULL,
      is_read      BOOLEAN DEFAULT FALSE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ════════════════════════════════════════════════════════════════
  // 3. parent_request_messages + parent_student_requests columns
  // Source: src/routes/parent-requests.ts ensureMessagesTable() + inline ALTERs
  // ════════════════════════════════════════════════════════════════
  console.log("§3 parent-requests");
  await exec("CREATE parent_request_messages", `
    CREATE TABLE IF NOT EXISTS parent_request_messages (
      id                   TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
      request_id           TEXT NOT NULL,
      swimming_pool_id     TEXT NOT NULL,
      sender_type          TEXT NOT NULL,
      sender_id            TEXT,
      message_type         TEXT NOT NULL DEFAULT 'message',
      content              TEXT NOT NULL,
      is_read_by_teacher   BOOLEAN DEFAULT false,
      is_read_by_parent    BOOLEAN DEFAULT false,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec("parent_student_requests.is_read_by_teacher", `
    ALTER TABLE parent_student_requests
    ADD COLUMN IF NOT EXISTS is_read_by_teacher BOOLEAN DEFAULT false
  `);

  // ════════════════════════════════════════════════════════════════
  // 4. support_ticket_replies + support_tickets columns
  // Source: src/routes/support-tickets.ts ensureTicketTables()
  // ════════════════════════════════════════════════════════════════
  // NOTE: support_tickets.image_urls/consultation_requested/submitter_user_id ALTERs
  // are placed AFTER "CREATE support_tickets" below so they run after table creation
  // on fresh databases. (Moving them up would silently fail on first run.)
  console.log("§4 support-tickets");
  await exec("CREATE support_ticket_replies", `
    CREATE TABLE IF NOT EXISTS support_ticket_replies (
      id              TEXT PRIMARY KEY,
      ticket_id       TEXT,
      case_id         TEXT,
      author_user_id  TEXT,
      author_name     TEXT NOT NULL DEFAULT '',
      author_role     TEXT NOT NULL DEFAULT 'user',
      message_type    TEXT,
      content         TEXT NOT NULL DEFAULT '',
      image_urls      TEXT[] DEFAULT '{}',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await exec("support_ticket_replies.ticket_id nullable", `
    ALTER TABLE support_ticket_replies ALTER COLUMN ticket_id DROP NOT NULL
  `);
  await exec("support_ticket_replies.author_user_id nullable", `
    ALTER TABLE support_ticket_replies ALTER COLUMN author_user_id DROP NOT NULL
  `);
  await exec("support_ticket_replies.case_id", `
    ALTER TABLE support_ticket_replies ADD COLUMN IF NOT EXISTS case_id TEXT
  `);
  await exec("support_ticket_replies.message_type", `
    ALTER TABLE support_ticket_replies ADD COLUMN IF NOT EXISTS message_type TEXT
  `);
  await exec("INDEX support_ticket_replies_case_id_idx", `
    CREATE INDEX IF NOT EXISTS support_ticket_replies_case_id_idx ON support_ticket_replies(case_id)
  `);

  // ════════════════════════════════════════════════════════════════
  // 5. support_cases + cs01r schema
  // Source: src/lib/support-case-service.ts ensureCs01rSchema()
  // ════════════════════════════════════════════════════════════════
  console.log("§5 support-cases cs01r");
  await exec("support_cases.waiting_for", `
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS waiting_for TEXT
  `);
  await exec("support_cases.context_json", `
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS context_json JSONB
  `);
  await exec("support_cases.actor_id", `
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS actor_id TEXT
  `);
  await exec("INDEX support_cases_actor_id_idx", `
    CREATE INDEX IF NOT EXISTS support_cases_actor_id_idx ON support_cases(actor_id)
  `);

  // ════════════════════════════════════════════════════════════════
  // 6. revenue_logs + billing tables
  // Source: src/routes/billing.ts ensureBillingTables()
  // ════════════════════════════════════════════════════════════════
  console.log("§6 billing/revenue");
  await exec("CREATE revenue_logs", `
    CREATE TABLE IF NOT EXISTS revenue_logs (
      id                      TEXT PRIMARY KEY,
      pool_id                 TEXT NOT NULL,
      pool_name               TEXT,
      plan_id                 TEXT NOT NULL,
      plan_name               TEXT,
      event_type              TEXT NOT NULL DEFAULT 'new_subscription',
      gross_amount            INTEGER NOT NULL DEFAULT 0,
      intro_discount_amount   INTEGER NOT NULL DEFAULT 0,
      charged_amount          INTEGER NOT NULL DEFAULT 0,
      refunded_amount         INTEGER NOT NULL DEFAULT 0,
      store_fee               INTEGER NOT NULL DEFAULT 0,
      net_revenue             INTEGER NOT NULL DEFAULT 0,
      payment_provider        TEXT NOT NULL DEFAULT 'store',
      provider_transaction_id TEXT,
      is_sandbox              BOOLEAN NOT NULL DEFAULT FALSE,
      occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const [col, def] of [
    ["pool_name", "TEXT"],
    ["plan_name", "TEXT"],
    ["event_type", "TEXT NOT NULL DEFAULT 'new_subscription'"],
    ["gross_amount", "INTEGER NOT NULL DEFAULT 0"],
    ["intro_discount_amount", "INTEGER NOT NULL DEFAULT 0"],
    ["charged_amount", "INTEGER NOT NULL DEFAULT 0"],
    ["refunded_amount", "INTEGER NOT NULL DEFAULT 0"],
    ["payment_provider", "TEXT NOT NULL DEFAULT 'store'"],
    ["provider_transaction_id", "TEXT"],
    ["occurred_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["store_fee", "INTEGER NOT NULL DEFAULT 0"],
    ["net_revenue", "INTEGER NOT NULL DEFAULT 0"],
    ["is_sandbox", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ]) {
    await exec(`revenue_logs.${col}`, `ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS ${col} ${def}`);
  }
  await exec("pool_subscriptions.pending_tier", `
    ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS pending_tier TEXT
  `);
  await exec("pool_subscriptions.downgrade_at", `
    ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS downgrade_at DATE
  `);
  await exec("subscription_plans.plan_id", `
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT ''
  `);
  await exec("subscription_plans.storage_mb", `
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS storage_mb INTEGER NOT NULL DEFAULT 0
  `);
  await exec("subscription_plans.display_storage", `
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_storage TEXT NOT NULL DEFAULT ''
  `);
  await exec("subscription_plans.is_active", `
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
  `);
  await exec("swimming_pools.first_payment_used", `
    ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS first_payment_used BOOLEAN NOT NULL DEFAULT FALSE
  `);

  // ════════════════════════════════════════════════════════════════
  // 7. super extra tables (ensureExtraTables)
  // Source: src/routes/super.ts ensureExtraTables()
  // ════════════════════════════════════════════════════════════════
  console.log("§7 super-extra");
  for (const [col, def] of [
    ["pool_type", "TEXT DEFAULT 'swimming_pool'"],
    ["used_storage_bytes", "BIGINT DEFAULT 0"],
    ["base_storage_gb", "FLOAT8 DEFAULT 5"],
    ["extra_storage_gb", "FLOAT8 DEFAULT 0"],
    ["credit_balance", "INTEGER DEFAULT 0"],
    ["is_readonly", "BOOLEAN DEFAULT FALSE"],
    ["upload_blocked", "BOOLEAN DEFAULT FALSE"],
    ["readonly_reason", "TEXT"],
    ["rejection_reason", "TEXT"],
    ["subscription_end_at", "TIMESTAMPTZ"],
    ["trial_end_at", "TIMESTAMPTZ"],
    ["subscription_tier", "TEXT DEFAULT 'free'"],
    ["subscription_status", "TEXT DEFAULT 'trial'"],
  ]) {
    await exec(`swimming_pools.${col}`, `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS ${col} ${def}`);
  }
  await exec("swimming_pools.base_storage_gb TYPE FLOAT8", `
    ALTER TABLE swimming_pools ALTER COLUMN base_storage_gb TYPE FLOAT8 USING base_storage_gb::FLOAT8
  `);
  await exec("swimming_pools.extra_storage_gb TYPE FLOAT8", `
    ALTER TABLE swimming_pools ALTER COLUMN extra_storage_gb TYPE FLOAT8 USING extra_storage_gb::FLOAT8
  `);
  await exec("users.last_login_at", `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
  `);
  await exec("CREATE support_tickets", `
    CREATE TABLE IF NOT EXISTS support_tickets (
      id             TEXT PRIMARY KEY,
      ticket_type    TEXT NOT NULL DEFAULT 'other',
      requester_type TEXT NOT NULL DEFAULT 'operator',
      requester_name TEXT,
      pool_id        TEXT,
      subject        TEXT NOT NULL,
      description    TEXT,
      status         TEXT NOT NULL DEFAULT 'open',
      assignee       TEXT,
      sla_hours      INTEGER DEFAULT 24,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW(),
      resolved_at    TIMESTAMPTZ
    )
  `);
  // These ALTERs run right after CREATE so they succeed on first run.
  // (Moved from before the CREATE to ensure the table exists when they execute.)
  await exec("support_tickets.image_urls", `
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}'
  `);
  await exec("support_tickets.consultation_requested", `
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS consultation_requested BOOLEAN DEFAULT FALSE
  `);
  await exec("support_tickets.submitter_user_id", `
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS submitter_user_id TEXT
  `);
  await exec("CREATE policy_versions", `
    CREATE TABLE IF NOT EXISTS policy_versions (
      id         TEXT PRIMARY KEY,
      policy_key TEXT NOT NULL,
      version    TEXT NOT NULL,
      value      TEXT NOT NULL,
      is_active  BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT
    )
  `);
  await exec("policy_versions.is_active", `
    ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE
  `);
  await exec("UNIQUE INDEX uidx_policy_versions_active_key", `
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_policy_versions_active_key
    ON policy_versions (policy_key)
    WHERE is_active = TRUE
  `);
  await exec("CREATE policy_consents", `
    CREATE TABLE IF NOT EXISTS policy_consents (
      id         TEXT PRIMARY KEY,
      pool_id    TEXT NOT NULL,
      policy_key TEXT NOT NULL,
      version    TEXT NOT NULL,
      agreed_at  TIMESTAMPTZ DEFAULT NOW(),
      ip_address TEXT,
      UNIQUE(pool_id, policy_key, version)
    )
  `);
  await exec("CREATE feature_flags", `
    CREATE TABLE IF NOT EXISTS feature_flags (
      key            TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      description    TEXT,
      category       TEXT DEFAULT 'general',
      global_enabled BOOLEAN DEFAULT FALSE,
      updated_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_by     TEXT,
      reason         TEXT
    )
  `);
  await exec("feature_flags.reason", `
    ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS reason TEXT
  `);
  await exec("CREATE feature_flag_overrides", `
    CREATE TABLE IF NOT EXISTS feature_flag_overrides (
      id         TEXT PRIMARY KEY,
      flag_key   TEXT NOT NULL,
      pool_id    TEXT NOT NULL,
      enabled    BOOLEAN DEFAULT FALSE,
      reason     TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT,
      UNIQUE(flag_key, pool_id)
    )
  `);
  await exec("CREATE event_logs", `
    CREATE TABLE IF NOT EXISTS event_logs (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      category   TEXT NOT NULL,
      event_type TEXT NOT NULL,
      pool_id    TEXT,
      user_id    TEXT,
      payload    JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec("INDEX idx_event_logs_created_at", `
    CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at)
  `);
  await exec("INDEX idx_event_logs_category", `
    CREATE INDEX IF NOT EXISTS idx_event_logs_category ON event_logs(category)
  `);
  await exec("INDEX idx_event_logs_pool_id", `
    CREATE INDEX IF NOT EXISTS idx_event_logs_pool_id ON event_logs(pool_id)
  `);
  await exec("CREATE super_incidents", `
    CREATE TABLE IF NOT EXISTS super_incidents (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      title       TEXT NOT NULL,
      description TEXT,
      severity    TEXT NOT NULL DEFAULT 'medium',
      status      TEXT NOT NULL DEFAULT 'open',
      pool_id     TEXT,
      created_by  TEXT,
      resolved_by TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  // ════════════════════════════════════════════════════════════════
  // 8. super plans tables (ensurePlansTables)
  // Source: src/routes/super.ts ensurePlansTables()
  // ════════════════════════════════════════════════════════════════
  console.log("§8 super-plans");
  await exec("CREATE subscription_plans", `
    CREATE TABLE IF NOT EXISTS subscription_plans (
      tier             TEXT PRIMARY KEY,
      plan_id          TEXT NOT NULL DEFAULT '',
      name             TEXT NOT NULL,
      price_per_month  INTEGER NOT NULL DEFAULT 0,
      member_limit     INTEGER NOT NULL DEFAULT 9999,
      storage_gb       NUMERIC NOT NULL DEFAULT 5,
      storage_mb       INTEGER NOT NULL DEFAULT 5120,
      display_storage  TEXT NOT NULL DEFAULT '',
      is_active        BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await exec("CREATE platform_backups", `
    CREATE TABLE IF NOT EXISTS platform_backups (
      id           TEXT PRIMARY KEY,
      operator_id  TEXT,
      operator_name TEXT,
      backup_type  TEXT NOT NULL DEFAULT 'operator',
      status       TEXT NOT NULL DEFAULT 'pending',
      is_snapshot  BOOLEAN NOT NULL DEFAULT FALSE,
      size_bytes   BIGINT,
      note         TEXT,
      created_by   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  for (const [col, def] of [
    ["file_path", "TEXT"],
    ["file_name", "TEXT"],
    ["storage_type", "TEXT DEFAULT 'database'"],
    ["backup_type_v2", "TEXT DEFAULT 'manual'"],
    ["backup_data", "TEXT"],
    ["super_db_tables", "INT"],
    ["pool_db_tables", "INT"],
    ["total_tables", "INT"],
  ]) {
    await exec(`platform_backups.${col}`, `ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS ${col} ${def}`);
  }
  await exec("CREATE backup_settings", `
    CREATE TABLE IF NOT EXISTS backup_settings (
      id             TEXT PRIMARY KEY DEFAULT 'default',
      auto_enabled   BOOLEAN NOT NULL DEFAULT true,
      schedule_type  TEXT NOT NULL DEFAULT 'daily',
      run_hour       INT NOT NULL DEFAULT 3,
      run_minute     INT NOT NULL DEFAULT 0,
      retention_days INT NOT NULL DEFAULT 7,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ════════════════════════════════════════════════════════════════
  // 9. system_policies (ensurePoliciesTable)
  // Source: src/routes/super.ts ensurePoliciesTable()
  // ════════════════════════════════════════════════════════════════
  console.log("§9 system-policies");
  await exec("CREATE system_policies", `
    CREATE TABLE IF NOT EXISTS system_policies (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);

  // ════════════════════════════════════════════════════════════════
  // 10. pool_credits (ensureCreditTable)
  // Source: src/routes/super.ts ensureCreditTable()
  // ════════════════════════════════════════════════════════════════
  console.log("§10 pool-credits");
  await exec("CREATE pool_credits", `
    CREATE TABLE IF NOT EXISTS pool_credits (
      pool_id    TEXT PRIMARY KEY,
      balance    INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ════════════════════════════════════════════════════════════════
  // 11. parent_v2_pending (initV2PendingTable)
  // Source: src/lib/auto-link-v2.ts initV2PendingTable() — called at boot
  // WP8-P3: moved here; initV2PendingTable() is now a no-op
  // ════════════════════════════════════════════════════════════════
  console.log("§11 parent_v2_pending");
  await exec("CREATE parent_v2_pending", `
    CREATE TABLE IF NOT EXISTS parent_v2_pending (
      id                      TEXT PRIMARY KEY,
      parent_id               TEXT NOT NULL,
      pool_id                 TEXT NOT NULL,
      child_name_raw          TEXT NOT NULL,
      child_name_normalized   TEXT NOT NULL,
      parent_phone_normalized TEXT NOT NULL,
      status                  TEXT NOT NULL DEFAULT 'pending',
      matched_student_id      TEXT,
      matched_at              TIMESTAMP,
      retry_count             INT NOT NULL DEFAULT 0,
      last_retry_at           TIMESTAMP,
      pending_reason          TEXT,
      rejection_reason        TEXT,
      created_at              TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await exec("parent_v2_pending.status column",         `ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await exec("parent_v2_pending.matched_student_id",    `ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS matched_student_id text`);
  await exec("parent_v2_pending.matched_at",            `ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS matched_at timestamp`);
  await exec("parent_v2_pending.pending_reason",        `ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS pending_reason text`);
  await exec("parent_v2_pending.rejection_reason",      `ALTER TABLE parent_v2_pending ADD COLUMN IF NOT EXISTS rejection_reason text`);

  console.log("\n[runtime-ddl-consolidated] ✅ Complete\n");
}

if (import.meta.url === String(new URL(process.argv[1], "file:"))) {
  const { runWithMigrationDb } = await import("../lib/migration-db.js");
  runWithMigrationDb("runtime-ddl-consolidated", run).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
