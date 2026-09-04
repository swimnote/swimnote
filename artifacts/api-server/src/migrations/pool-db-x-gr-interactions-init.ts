/**
 * Growth Report Interaction Tables (reactions + comments)
 *
 * 테이블: growth_report_reactions, growth_report_comments
 * 기존 diary_reactions / diary_messages와 완전 격리 — 기존 테이블 무수정
 *
 * Startup fire-and-forget migration (CS 패턴).
 * 멱등: CREATE TABLE IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

let ran = false;

export async function runGrInteractionsMigration(db: MigrationDb): Promise<void> {
  if (ran) return;
  ran = true;

  // ── growth_report_reactions ────────────────────────────────────────────────
  // 기존 diary_reactions와 동일한 컬럼 타입/naming convention 사용.
  // reaction_type CHECK: 현재 'like'만 허용 (향후 확장 시 ALTER TABLE ADD CHECK 필요).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS growth_report_reactions (
      id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      growth_report_id text     NOT NULL,
      parent_id     text        NOT NULL,
      reaction_type text        NOT NULL CHECK (reaction_type IN ('like')),
      created_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE(growth_report_id, parent_id, reaction_type)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_grr_growth_report_id
      ON growth_report_reactions(growth_report_id)
  `);

  // ── growth_report_comments ─────────────────────────────────────────────────
  // 기존 diary_messages와 동일한 컬럼 타입/naming convention 사용.
  // root  : parent_comment_id IS NULL
  // reply : parent_comment_id = root comment id
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS growth_report_comments (
      id                  text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      growth_report_id    text        NOT NULL,
      sender_id           text        NOT NULL,
      sender_name         text        NOT NULL DEFAULT '',
      sender_role         text        NOT NULL DEFAULT 'parent',
      content             text        NOT NULL,
      parent_comment_id   text,
      student_id          text,
      is_deleted          boolean     NOT NULL DEFAULT false,
      deleted_at          timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_grc_report_created
      ON growth_report_comments(growth_report_id, created_at)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_grc_parent_comment_id
      ON growth_report_comments(parent_comment_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_grc_sender
      ON growth_report_comments(sender_id, growth_report_id)
  `);

  console.log("[gr-interactions] growth_report_reactions + growth_report_comments 초기화 완료");
}
