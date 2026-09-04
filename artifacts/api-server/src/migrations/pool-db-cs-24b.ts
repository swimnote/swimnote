/**
 * pool-db-cs-24b.ts — WP-CS24: Support Knowledge Candidates
 *
 * support_knowledge_candidates:
 *   실사용 Query Log에서 추출한 Knowledge Candidate를 관리.
 *   AUTO_ACTIVATE = 완전 금지.
 *   모든 status 변경은 Human Approval 경유.
 *
 * 절대 원칙:
 *   - status: PENDING → APPROVED/REJECTED/MERGED only (시스템 AUTO → ACTIVE 금지)
 *   - raw PII (학생명/전화/이메일) canonical field 저장 금지
 *   - additive only — 기존 테이블 변경 없음
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

let ran = false;

export async function runCs24bMigration(db: MigrationDb): Promise<void> {
  if (ran) return;
  ran = true;

  // ── support_knowledge_candidates ──────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS support_knowledge_candidates (
      id                    TEXT PRIMARY KEY,

      candidate_type        TEXT NOT NULL
        CHECK (candidate_type IN ('UTTERANCE_EXTENSION', 'NEW_CANONICAL')),

      classification        TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (classification IN (
          'NORMAL', 'DYNAMIC_DATA_REQUIRED', 'POLICY_REQUIRED',
          'AMBIGUOUS', 'HUMAN_JUDGMENT_REQUIRED'
        )),

      source_type           TEXT NOT NULL
        CHECK (source_type IN ('NO_MATCH', 'GPT_FALLBACK', 'HUMAN', 'ADMIN_CREATED')),

      representative_query  TEXT NOT NULL,
      normalized_query      TEXT NOT NULL,

      suggested_intent_id   TEXT,
      suggested_knowledge_id TEXT REFERENCES support_knowledge_items(id) ON DELETE SET NULL,

      suggested_answer      TEXT,

      occurrence_count      INTEGER NOT NULL DEFAULT 1,
      gpt_fallback_count    INTEGER NOT NULL DEFAULT 0,
      human_request_count   INTEGER NOT NULL DEFAULT 0,

      first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      affected_roles        JSONB NOT NULL DEFAULT '[]'::jsonb,
      affected_modes        JSONB NOT NULL DEFAULT '[]'::jsonb,
      pool_scope            TEXT NOT NULL DEFAULT 'global'
        CHECK (pool_scope IN ('global', 'pool')),
      pool_id               TEXT,

      risk                  TEXT NOT NULL DEFAULT 'LOW'
        CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),

      status                TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'MERGED')),

      source_refs           JSONB NOT NULL DEFAULT '[]'::jsonb,

      approved_by           TEXT,
      approved_at           TIMESTAMPTZ,
      rejected_by           TEXT,
      rejected_at           TIMESTAMPTZ,
      reject_reason         TEXT,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // 인덱스: Review Console 정렬 + Candidate Engine 그루핑
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_skc_normalized_query
      ON support_knowledge_candidates (normalized_query)
      WHERE status = 'PENDING'
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_skc_status
      ON support_knowledge_candidates (status)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_skc_occurrence
      ON support_knowledge_candidates (occurrence_count DESC, human_request_count DESC)
      WHERE status = 'PENDING'
  `));

  console.log("[cs24b] migration complete — support_knowledge_candidates created");
}
