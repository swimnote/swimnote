/**
 * pool-db-cs-24a.ts — WP-CS24: Support Query Log
 *
 * 왜 새 테이블이 필요한가 (중복 금지 원칙 §3 근거):
 *   - 기존 flushSupportTrace()는 event_logs.metadata.stages JSONB 배열로 저장.
 *   - normalized_query가 어디에도 저장되지 않음 (raw message/PII 금지 원칙).
 *   - resolution_source, matched_knowledge_id, match_confidence는 stages[] 안에
 *     중첩되어 있어 빠른 집계/그루핑 쿼리 불가 (JSONB 연산 + unnest 필요).
 *   - llm_called, human_requested 필드가 별도 저장 없음.
 *   - Candidate Engine이 "동일 normalized_query 반복 횟수" 같은 집계를
 *     실시간으로 쿼리할 수 없음.
 *   → additive 신규 테이블 필요 (기존 event_logs 변경 없음).
 *
 * 절대 원칙:
 *   - normalized_query 만 저장 (raw user message 금지)
 *   - 학생명/전화/이메일/결제정보 복사 금지
 *   - additive only — 기존 테이블 변경 없음
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

let ran = false;

export async function runCs24aMigration(): Promise<void> {
  if (ran) return;
  ran = true;

  // ── support_query_log ──────────────────────────────────────────────────────
  await superAdminDb.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS support_query_log (
      id                  TEXT PRIMARY KEY,
      case_id             TEXT NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      role                TEXT,
      mode                TEXT,
      pool_id             TEXT,

      normalized_query    TEXT NOT NULL,

      resolution_source   TEXT NOT NULL,
      matched_knowledge_id TEXT,
      match_confidence    NUMERIC,

      llm_called          BOOLEAN NOT NULL DEFAULT FALSE,
      human_requested     BOOLEAN NOT NULL DEFAULT FALSE,

      final_case_state    TEXT
    )
  `));

  // 인덱스: Candidate Engine이 normalized_query 그루핑 쿼리에 사용
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_sql_normalized_query
      ON support_query_log (normalized_query)
  `));
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_sql_resolution_source
      ON support_query_log (resolution_source)
  `));
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_sql_created_at
      ON support_query_log (created_at DESC)
  `));

  console.log("[cs24a] migration complete — support_query_log created");
}
