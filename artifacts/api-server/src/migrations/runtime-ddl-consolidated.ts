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

  // ════════════════════════════════════════════════════════════════
  // §12 purchase_policy_consents — 구매·구독·환불 정책 동의 이력 테이블
  // 기존 policy_consents(UNIQUE upsert)와 별개: 이벤트 이력 보존 구조
  // ════════════════════════════════════════════════════════════════
  console.log("§12 purchase_policy_consents");
  await exec("CREATE purchase_policy_consents", `
    CREATE TABLE IF NOT EXISTS purchase_policy_consents (
      id                   TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL,
      swimming_pool_id     TEXT NOT NULL,
      role                 TEXT NOT NULL,
      policy_key           TEXT NOT NULL,
      policy_version       TEXT NOT NULL,
      policy_content_hash  TEXT,
      agreed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source               TEXT NOT NULL,
      platform             TEXT,
      app_version          TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec("IDX purchase_policy_consents pool_key", `
    CREATE INDEX IF NOT EXISTS idx_ppc_pool_key
    ON purchase_policy_consents (swimming_pool_id, policy_key, agreed_at DESC)
  `);
  await exec("IDX purchase_policy_consents user_key", `
    CREATE INDEX IF NOT EXISTS idx_ppc_user_key
    ON purchase_policy_consents (user_id, policy_key)
  `);

  // ── PURCHASE_SUBSCRIPTION_REFUND v1.0 정책 seed (멱등) ───────────────────────
  // 이미 해당 key의 active=true row가 없을 때만 insert
  {
    const POLICY_KEY = "PURCHASE_SUBSCRIPTION_REFUND";
    const POLICY_VERSION = "1.0";
    const POLICY_BODY = `SWIMNOTE 구매·구독·환불 정책

제1조 목적

본 정책은 SWIMNOTE 및 SWIMNOTE X 서비스에서 제공하는
유료 구독, 무료체험, 앱 내 구매, 플랜 변경, 자동갱신,
구독 해지, 결제 실패 및 환불에 관한 사항을 정합니다.

본 정책과 관계 법령 또는 Apple App Store 및 Google Play의
적용 정책이 충돌하는 경우 관계 법령 및 해당 결제 플랫폼의
강행 규정과 정책이 우선 적용될 수 있습니다.

제2조 서비스 및 상품

SWIMNOTE는 수영장 운영을 위한 회원관리, 수업관리,
출결, 일지, 사진·영상, 커리큘럼, AI 기능 등
디지털 서비스를 제공합니다.

현재 주요 월간 구독 상품은 다음과 같습니다.

SWIMNOTE
- 월 9,900원

SWIMNOTE X300
- 월 129,000원
- 최대 300명
- 약 300GB 저장공간
- X 제공 기능

SWIMNOTE X500
- 월 199,000원
- 최대 500명
- 약 500GB 저장공간
- X 제공 기능

SWIMNOTE X1000
- 월 359,000원
- 최대 1,000명
- 1TB 저장공간
- X 제공 기능

최종 결제금액, 세금, 통화 등은
Apple App Store 또는 Google Play 결제화면에 표시되는
금액을 기준으로 합니다.

제3조 자동갱신

SWIMNOTE 및 SWIMNOTE X 유료 구독은
월 단위 자동갱신 구독입니다.

사용자가 자동갱신을 해지하지 않는 경우
결제 플랫폼의 정책에 따라 다음 이용기간의 요금이
자동으로 결제될 수 있습니다.

다음 결제일, 결제수단, 실제 청구금액 및 자동갱신 상태는
Apple App Store 또는 Google Play의 구독관리 정보를 기준으로 합니다.

제4조 X 3일 무료체험

SWIMNOTE X의 3일 무료체험은
SWIMNOTE가 자체 제공하는 1회성 무료체험입니다.

- 시작 시점부터 정확히 72시간
- 수영장당 1회
- 결제정보 등록 불필요
- 체험 시작에 따른 자동결제 없음
- 체험 종료 후 X 유료구독으로 자동 전환되지 않음
- 계속 이용하려면 사용자가 직접 X 상품을 구매해야 함

무료체험 적용 후 앱의 상태를 정확히 갱신하기 위하여
앱 재시작 안내가 표시될 수 있습니다.

제5조 유료 구독 적용

App Store 또는 Google Play에서 결제가 정상적으로 완료되고
SWIMNOTE가 유효한 구독상태를 확인한 경우
해당 구독 상품의 이용권한이 적용됩니다.

X 상품 적용 후 앱 상태 갱신을 위해
앱 재시작을 요청할 수 있습니다.

앱 재시작은 추가 결제를 의미하지 않습니다.

제6조 플랜 업그레이드

SWIMNOTE에서 X300, X500, X1000으로 변경하거나
X 상품 간 상위 플랜으로 변경하는 경우
Apple 또는 Google의 구독 변경 정책에 따라 처리됩니다.

상위 플랜 변경은 결제 플랫폼 정책에 따라
즉시 적용될 수 있습니다.

실제 추가 결제금액, 적용일 및 잔여기간 처리는
구매 시 결제 플랫폼에서 표시되는 내용을 기준으로 합니다.

제7조 플랜 다운그레이드

X1000 → X500, X500 → X300, X300 → SWIMNOTE 등
하위 플랜으로의 변경은 결제 플랫폼의 구독 변경 정책에 따라
현재 결제기간 종료 후 다음 갱신일부터 적용될 수 있습니다.

하위 플랜 적용 전까지는 현재 유효한 상위 플랜을 계속 이용할 수 있습니다.

현재 이용 회원 수가 변경하려는 하위 플랜의 허용 인원을
초과하는 경우 변경이 제한될 수 있습니다.

플랜 한도 초과만을 이유로
기존 회원이나 운영 데이터를 임의로 삭제하지 않습니다.

제8조 구독 해지

사용자는 Apple App Store 또는 Google Play의
구독관리 기능에서 자동갱신을 해지할 수 있습니다.

구독 해지는 다음 자동결제를 중단하는 절차이며
이미 결제된 현재 이용기간을 즉시 종료하는 절차와는 다릅니다.

정상적으로 해지한 경우에도
현재 결제기간 종료일까지 해당 구독을 이용할 수 있습니다.

앱을 삭제하는 것만으로 구독이 해지되지 않습니다.

제9조 결제 실패와 유예기간

카드 승인 실패 또는 결제수단 문제 등으로
자동갱신 결제가 실패할 수 있습니다.

Apple 또는 Google에서 유예기간을 제공하며
유효한 구독권한이 유지되는 동안에는
서비스를 계속 이용할 수 있습니다.

관리자에게 결제수단 확인 또는 결제 문제 해결 안내가 표시될 수 있습니다.

결제 실패 발생만을 이유로 회원 및 운영 데이터를 즉시 삭제하지 않습니다.

제10조 결제 만료 및 서비스 이용 일시중지

유효한 유료 이용기간과 결제 플랫폼의 유예기간 등이
모두 종료되고 유효한 구독권한이 확인되지 않는 경우
해당 수영장의 SWIMNOTE 서비스 이용이 일시중지될 수 있습니다.

이 경우: 관리자는 구독 갱신에 필요한 기능을 이용할 수 있습니다.
선생님 및 학부모의 서비스 이용이 제한될 수 있습니다.
AI 호출이 제한됩니다. 신규 사진·영상 업로드가 제한됩니다.
기존 운영 데이터는 결제 만료만을 이유로 즉시 삭제되지 않습니다.

결제가 복구되면 기존 데이터를 유지한 상태로 서비스 이용이 다시 활성화될 수 있습니다.
결제 만료는 계정 삭제 또는 데이터 삭제 신청과 동일하지 않습니다.

제11조 환불

App Store 또는 Google Play를 통해 결제한 구매의
결제 취소 및 환불은 각 결제 플랫폼의 절차와 정책 및
관계 법령에 따라 처리됩니다.

Apple App Store 구매의 환불은 Apple이 제공하는 환불 절차를 통해 신청될 수 있습니다.
Google Play 구매의 환불은 Google Play가 제공하는 환불 절차 또는
필요한 경우 SWIMNOTE 고객문의 절차를 통해 처리될 수 있습니다.

환불 승인 여부는 실제 결제상태, 이용내역, 관계 법령 및 결제 플랫폼의 정책에 따라 달라질 수 있습니다.

환불이 승인되는 경우 해당 구매로 제공된 유료 이용권한이 회수 또는 변경될 수 있습니다.

본 정책은 관계 법령에서 보장하는
사용자의 환불, 청약철회 또는 기타 권리를 제한하지 않습니다.

제12조 디지털 서비스와 청약철회

SWIMNOTE의 유료 기능은 디지털 서비스 또는 디지털콘텐츠의 성격을 포함할 수 있습니다.

관계 법령에서 청약철회를 보장하는 경우 사용자는 해당 권리를 행사할 수 있습니다.

다만 디지털콘텐츠 제공이 시작되는 등 관계 법령에서 정한 사유가 있는 경우
청약철회가 제한될 수 있습니다.

청약철회 제한이 적용되는 경우 법령에서 요구하는 방식에 따라 관련 내용을 안내합니다.

제13조 해지와 환불의 차이

구독 해지는 향후 자동갱신을 중단하는 절차입니다.
환불은 이미 이루어진 결제의 금액 반환을 요청하는 절차입니다.
구독을 해지했다고 해서 이미 결제된 이용기간의 요금이 자동으로 환불되는 것은 아닙니다.

제14조 가격 변경

SWIMNOTE는 서비스 운영비용, 기능 변경 또는 기타 합리적 사유로 구독가격을 변경할 수 있습니다.

기존 구독자에게 인상된 가격을 적용하는 경우
관계 법령 및 Apple App Store / Google Play에서 요구하는
사전 고지 및 필요한 동의 절차를 따릅니다.

가격 변경 적용일 및 실제 청구가격은 결제 플랫폼에서 확인할 수 있습니다.

제15조 서비스 및 기능 변경

각 플랜의 기능, 최대 회원 수, 저장공간, AI 기능 범위 등은 구독관리 화면에 표시됩니다.

서비스의 주요 내용에 중대한 변경이 있는 경우 관련 법령 및 서비스 정책에 따라 필요한 안내를 제공합니다.

보안, 장애 대응, 관계 법령 준수 또는 서비스 보호를 위한 긴급 변경은
필요한 범위에서 즉시 적용될 수 있습니다.

제16조 AI 기능

SWIMNOTE X 등의 일부 기능에는 AI가 사용됩니다.

AI 결과는 수업 및 운영을 지원하기 위한 참고·보조 정보이며
사용자는 필요한 경우 결과를 확인하거나 수정하여 사용할 수 있습니다.

AI 처리와 개인정보 및 데이터 처리에 관한 사항은 SWIMNOTE 개인정보처리방침 등 관련 정책을 따릅니다.

제17조 추가 유료상품

DATA100, DATA300, AI Insight 등 별도 상품이 향후 판매될 수 있습니다.

실제 판매 활성화 시 가격, 제공내용, 결제방식, 자동갱신 여부 및 환불 관련 조건을 구매화면에서 별도로 안내합니다.

현재 판매가 활성화되지 않은 상품에 대해서는 사용자가 결제한 것으로 처리하지 않습니다.

제18조 데이터 보존

구독 해지 또는 결제 만료만으로 회원, 반, 출결, 일지 및 기타 운영 데이터를 즉시 삭제하지 않습니다.

사용자가 서비스 탈퇴 또는 데이터 삭제를 요청하는 경우에는
개인정보처리방침과 관계 법령 및 내부 보존정책에 따라 처리합니다.

결제 및 거래 증빙 등 법률상 보존이 필요한 정보는 정해진 기간 동안 보존될 수 있습니다.

제19조 결제 오류 및 중복 결제

구독 변경은 Apple 및 Google의 구독 변경 기능을 이용하여 처리합니다.

결제 오류 또는 중복 청구가 의심되는 경우
사용자는 구매 플랫폼의 구매내역 또는
SWIMNOTE 고객문의를 통해 확인을 요청할 수 있습니다.

SWIMNOTE는 확인 가능한 결제 및 구독 연동정보를 기준으로 문제 해결을 지원합니다.

제20조 정책 변경

본 정책은 관계 법령, Apple App Store 또는 Google Play 정책,
서비스 또는 상품 변경에 따라 개정될 수 있습니다.

사용자에게 중대한 영향을 미치는 변경은 시행 전에 앱 내 공지 등의 방법으로 안내합니다.

법령 또는 결제 플랫폼에서 별도 동의를 요구하는 사항은
본 정책의 일반 동의와 별도로 해당 절차를 따릅니다.`;

    const existing = await superAdminDb.execute(sql`
      SELECT id FROM policy_versions
      WHERE policy_key = ${POLICY_KEY} AND is_active = TRUE
      LIMIT 1
    `);
    if (existing.rows.length === 0) {
      const policyId = `pv_psr_${Date.now()}`;
      await superAdminDb.execute(sql`
        INSERT INTO policy_versions (id, policy_key, version, value, is_active, created_at)
        VALUES (${policyId}, ${POLICY_KEY}, ${POLICY_VERSION}, ${POLICY_BODY}, TRUE, NOW())
        ON CONFLICT DO NOTHING
      `);
      console.log(`  → PURCHASE_SUBSCRIPTION_REFUND v1.0 seeded (id=${policyId})`);
    } else {
      console.log(`  → PURCHASE_SUBSCRIPTION_REFUND v1.0 already exists, skip seed`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // growth_report_batch_jobs — scheduled_push_at 컬럼 추가
  // 푸시 알림 금지 시간대(KST 22:00~08:00) 완료 시 예약 발송용
  // ════════════════════════════════════════════════════════════════
  console.log("§ growth_report_batch_jobs scheduled_push_at");
  await exec(
    "growth_report_batch_jobs.scheduled_push_at",
    `ALTER TABLE growth_report_batch_jobs
     ADD COLUMN IF NOT EXISTS scheduled_push_at TIMESTAMPTZ`
  );

  console.log("\n[runtime-ddl-consolidated] ✅ Complete\n");
}

if (import.meta.url === String(new URL(process.argv[1], "file:"))) {
  const { runWithMigrationDb } = await import("../lib/migration-db.js");
  runWithMigrationDb("runtime-ddl-consolidated", run).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
