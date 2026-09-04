/**
 * wp6-wp7-additive-schema.ts — WP6 / WP7 Additive Schema Migration
 *
 * 귀속:
 *   WP6: logOperationalError 기능 — event_logs additive 컬럼 + push_logs additive 컬럼
 *   WP7: Notification Diagnostics — push_logs.notification_id + 인덱스
 *
 * 이 파일은 아래 컬럼/인덱스의 공식 migration source다.
 * 이 컬럼들이 Production에는 이미 존재하나(boot-time DDL로 적용됨),
 * 공식 migration chain에 귀속되지 않았음.
 * 이 migration을 chain에 추가하여 staging empty-DB 재현을 가능하게 한다.
 *
 * 실행 정책:
 *   - 멱등: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
 *   - Additive only: 기존 컬럼 변경·삭제 금지
 *   - 실패 즉시 throw
 *
 * Migration 대상:
 *   event_logs:
 *     - feature     TEXT          (WP6: 오류 발생 기능 영역)
 *     - level       TEXT DEFAULT 'ERROR' (WP6: 심각도)
 *     - error_code  TEXT          (WP6: 머신-리더블 코드)
 *     - safe_message TEXT         (WP6: 사용자 노출 메시지)
 *     - request_id  TEXT          (WP6: 요청 추적 ID)
 *     + idx_event_logs_pool_level (pool_id, level, created_at DESC)
 *
 *   push_logs:
 *     - pool_id         TEXT      (WP6: 수영장 연결)
 *     - error_message   TEXT      (WP6: 발송 실패 상세)
 *     - recipient_count INTEGER DEFAULT 1 (WP6: 실제 수신자 수)
 *     - notification_id TEXT      (WP7: notifications 테이블 연결)
 *     + idx_push_logs_pool_status     (pool_id, status, created_at DESC)
 *     + idx_push_logs_notification_id (notification_id) WHERE NOT NULL
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

type Db = MigrationDb;

async function runEventLogsWP6(db: Db): Promise<void> {
  const cols: Array<[string, string]> = [
    ["feature",      `ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS feature      TEXT`],
    ["level",        `ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS level        TEXT NOT NULL DEFAULT 'ERROR'`],
    ["error_code",   `ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS error_code   TEXT`],
    ["safe_message", `ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS safe_message TEXT`],
    ["request_id",   `ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS request_id   TEXT`],
  ];
  for (const [name, ddl] of cols) {
    await db.execute(sql.raw(ddl));
    console.log(`[wp6-wp7-schema] event_logs.${name} OK`);
  }
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_pool_level
      ON event_logs (pool_id, level, created_at DESC)
  `));
  console.log("[wp6-wp7-schema] idx_event_logs_pool_level OK");
}

async function runPushLogsWP6(db: Db): Promise<void> {
  const cols: Array<[string, string]> = [
    ["pool_id",         `ALTER TABLE push_logs ADD COLUMN IF NOT EXISTS pool_id         TEXT`],
    ["error_message",   `ALTER TABLE push_logs ADD COLUMN IF NOT EXISTS error_message   TEXT`],
    ["recipient_count", `ALTER TABLE push_logs ADD COLUMN IF NOT EXISTS recipient_count INTEGER NOT NULL DEFAULT 1`],
  ];
  for (const [name, ddl] of cols) {
    await db.execute(sql.raw(ddl));
    console.log(`[wp6-wp7-schema] push_logs.${name} OK`);
  }
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_push_logs_pool_status
      ON push_logs (pool_id, status, created_at DESC)
      WHERE pool_id IS NOT NULL
  `));
  console.log("[wp6-wp7-schema] idx_push_logs_pool_status OK");
}

async function runPushLogsWP7(db: Db): Promise<void> {
  await db.execute(sql.raw(`
    ALTER TABLE push_logs ADD COLUMN IF NOT EXISTS notification_id TEXT
  `));
  console.log("[wp6-wp7-schema] push_logs.notification_id OK");
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_push_logs_notification_id
      ON push_logs (notification_id)
      WHERE notification_id IS NOT NULL
  `));
  console.log("[wp6-wp7-schema] idx_push_logs_notification_id OK");
}

export async function runWp6Wp7AdditiveSchema(db: MigrationDb): Promise<void> {
  console.log("[wp6-wp7-schema] 시작");

  await runEventLogsWP6(db);
  await runPushLogsWP6(db);
  await runPushLogsWP7(db);

  console.log("[wp6-wp7-schema] ✅ 완료 (WP6 event_logs + push_logs, WP7 notification_id)");
}

// ── CLI standalone runner ────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { runWithMigrationDb } = await import("../lib/migration-db.js");
  runWithMigrationDb("wp6-wp7-additive-schema", runWp6Wp7AdditiveSchema)
    .catch(e => { console.error(e); process.exit(1); });
}
