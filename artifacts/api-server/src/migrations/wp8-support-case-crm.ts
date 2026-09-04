/**
 * wp8-support-case-crm.ts — WP8 Support Case CRM schema migration
 *
 * 목적:
 *   WP8 Control Center CRM에 필요한 컬럼/테이블/인덱스를 추가한다.
 *
 * 실행 방법 (Render 배포 전 별도 실행):
 *   pnpm --filter @workspace/api-server exec tsx src/migrations/wp8-support-case-crm.ts
 *
 * 자동 startup 실행 금지:
 *   server boot 시 이 파일을 import하거나 호출하지 않는다.
 *   Production에 적용하려면 반드시 명시적 release step으로 실행해야 한다.
 *
 * Idempotent:
 *   IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 사용 — 재실행 안전.
 *
 * Production 현황 (2026-09-04):
 *   이미 Replit dev server boot 시 schema가 적용되었음.
 *   재실행해도 안전하지만 Production에서는 사용자 승인 후에만 실행할 것.
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function runMigration(db: MigrationDb): Promise<void> {
  console.log("[wp8-migration] 시작");

  // ── 1. support_cases: WP8 operational tracking columns ──────────────────
  const sc_columns: Array<[string, string]> = [
    ["title",             "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS title TEXT"],
    ["category",          "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS category TEXT"],
    ["subject_type",      "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS subject_type TEXT"],
    ["subject_id",        "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS subject_id TEXT"],
    ["assigned_operator", "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS assigned_operator TEXT"],
    ["resolution",        "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS resolution TEXT"],
    ["ops_status",        "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS ops_status TEXT DEFAULT 'OPEN'"],
    ["created_by_admin",  "ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS created_by_admin TEXT"],
  ];

  for (const [col, ddl] of sc_columns) {
    try {
      await (db as any).execute(sql.raw(ddl));
      console.log(`[wp8-migration] ✅ support_cases.${col} 추가 완료`);
    } catch (e: any) {
      console.error(`[wp8-migration] ❌ support_cases.${col}:`, e?.message);
      throw e;
    }
  }

  // ── 2. support_case_notes: 신규 child table ──────────────────────────────
  try {
    await (db as any).execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS support_case_notes (
        id              TEXT PRIMARY KEY,
        support_case_id TEXT NOT NULL,
        pool_id         TEXT NOT NULL,
        actor_id        TEXT NOT NULL,
        event_type      TEXT NOT NULL,
        note            TEXT,
        before_state    TEXT,
        after_state     TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    console.log("[wp8-migration] ✅ support_case_notes 테이블 생성 완료");
  } catch (e: any) {
    console.error("[wp8-migration] ❌ CREATE support_case_notes:", e?.message);
    throw e;
  }

  // ── 3. Indexes ────────────────────────────────────────────────────────────
  const indexes: Array<[string, string]> = [
    ["sc_pool_status_idx",   "CREATE INDEX IF NOT EXISTS sc_pool_status_idx  ON support_cases(pool_id, ops_status)"],
    ["sc_pool_created_idx",  "CREATE INDEX IF NOT EXISTS sc_pool_created_idx ON support_cases(pool_id, created_at DESC)"],
    ["sc_ticket_idx",        "CREATE INDEX IF NOT EXISTS sc_ticket_idx       ON support_cases(ticket_id)"],
    ["sc_subject_idx",       "CREATE INDEX IF NOT EXISTS sc_subject_idx      ON support_cases(subject_type, subject_id)"],
    ["scn_case_id_idx",      "CREATE INDEX IF NOT EXISTS scn_case_id_idx     ON support_case_notes(support_case_id, created_at)"],
    ["al_pool_created_idx",  "CREATE INDEX IF NOT EXISTS al_pool_created_idx  ON audit_logs(pool_id, created_at DESC)"],
    ["al_actor_created_idx", "CREATE INDEX IF NOT EXISTS al_actor_created_idx ON audit_logs(actor_id, created_at DESC)"],
    ["al_entity_idx",        "CREATE INDEX IF NOT EXISTS al_entity_idx        ON audit_logs(entity_type, entity_id)"],
  ];

  for (const [name, ddl] of indexes) {
    try {
      await (db as any).execute(sql.raw(ddl));
      console.log(`[wp8-migration] ✅ index ${name} 생성 완료`);
    } catch (e: any) {
      console.error(`[wp8-migration] ❌ index ${name}:`, e?.message);
      // non-fatal for indexes
    }
  }

  console.log("[wp8-migration] ✅ 완료");
}

if (import.meta.url === String(new URL(process.argv[1], "file:"))) {
  const { runWithMigrationDb } = await import("../lib/migration-db.js");
  runWithMigrationDb("wp8-support-case-crm", runMigration).catch(e => { console.error(e); process.exit(1); });
}
