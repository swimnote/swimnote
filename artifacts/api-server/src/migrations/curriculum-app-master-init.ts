/**
 * curriculum-app-master-init.ts
 *
 * SWIMNOTE X — Curriculum APP MASTER Import 스키마 확장
 *
 * 1. curriculum_versions  — import_status, source_r2_key, import_meta JSONB 추가
 * 2. curriculum_items     — level_order, sequence_in_level, display_no, stroke,
 *                           domain, skill_group, atomic_skill, node_data JSONB,
 *                           is_test_item, source_trace, is_master_import 추가
 * 3. curriculum_drills    — 신규 테이블
 * 4. curriculum_node_relations — 신규 테이블
 *
 * 기존 curriculum_versions / curriculum_items 행은 그대로 유지.
 * 신규 컬럼은 모두 nullable (기존 행 호환).
 */

import { sql } from "drizzle-orm";

type Db = { execute: (q: { queryChunks?: any; sql?: string; params?: any[] } | any) => Promise<any> };

export async function runCurriculumAppMasterMigration(db: Db): Promise<void> {
  // ── 1. curriculum_versions 컬럼 추가 ──────────────────────────────────────

  await db.execute(sql.raw(`
    ALTER TABLE curriculum_versions
      ADD COLUMN IF NOT EXISTS import_status  text DEFAULT 'LEGACY',
      ADD COLUMN IF NOT EXISTS source_r2_key  text,
      ADD COLUMN IF NOT EXISTS import_meta    jsonb;
  `));

  // import_status CHECK
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE curriculum_versions
        ADD CONSTRAINT chk_cv_import_status
          CHECK (import_status IN (
            'LEGACY','DRAFT','VALIDATED','IMPORTED','ACTIVE','ARCHIVED','FAILED'
          ));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `));

  // ── 2. curriculum_items 컬럼 추가 ────────────────────────────────────────

  await db.execute(sql.raw(`
    ALTER TABLE curriculum_items
      ADD COLUMN IF NOT EXISTS level_order          integer,
      ADD COLUMN IF NOT EXISTS sequence_in_level    integer,
      ADD COLUMN IF NOT EXISTS display_no           text,
      ADD COLUMN IF NOT EXISTS stroke               text,
      ADD COLUMN IF NOT EXISTS domain               text,
      ADD COLUMN IF NOT EXISTS skill_group          text,
      ADD COLUMN IF NOT EXISTS atomic_skill         text,
      ADD COLUMN IF NOT EXISTS node_data            jsonb,
      ADD COLUMN IF NOT EXISTS is_test_item         boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS source_trace         text,
      ADD COLUMN IF NOT EXISTS is_master_import     boolean DEFAULT false;
  `));

  // level_order + sequence 인덱스
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_ci_level_seq
      ON curriculum_items (curriculum_version_id, level_order, sequence_in_level);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_ci_display_no
      ON curriculum_items (curriculum_version_id, display_no)
      WHERE display_no IS NOT NULL;
  `));

  console.log("[curriculum-app-master] curriculum_versions/items extended OK");

  // ── 3. curriculum_drills 신규 테이블 ──────────────────────────────────────

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_drills (
      id                    text        PRIMARY KEY
                              DEFAULT ('cd_' || replace(gen_random_uuid()::text,'-','')),
      curriculum_version_id text        NOT NULL
                              REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
      curriculum_item_id    text        NOT NULL
                              REFERENCES curriculum_items(id) ON DELETE RESTRICT,
      swimming_pool_id      text        NOT NULL,

      title                 text        NOT NULL,
      target_aspect         text,
      movement_sequence     text,
      repetitions           text,
      immediate_feedback    text,
      integration           text,
      sprint_validation     text,
      failure_return_display_no  text,   -- 실패 복귀 대상 노드 display_no

      sort_order            integer     NOT NULL DEFAULT 0,
      created_at            timestamptz NOT NULL DEFAULT now()
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_drills_item
      ON curriculum_drills (curriculum_item_id);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_drills_version
      ON curriculum_drills (curriculum_version_id, sort_order);
  `));

  console.log("[curriculum-app-master] curriculum_drills OK");

  // ── 4. curriculum_node_relations 신규 테이블 ──────────────────────────────

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_node_relations (
      id                    text        PRIMARY KEY
                              DEFAULT ('cnr_' || replace(gen_random_uuid()::text,'-','')),
      curriculum_version_id text        NOT NULL
                              REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
      swimming_pool_id      text        NOT NULL,

      from_node_display_no  text        NOT NULL,
      to_node_display_no    text        NOT NULL,
      relation_type         text        NOT NULL,

      created_at            timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_cnr_relation_type
        CHECK (relation_type IN (
          'prerequisite','next_skill','related','correction','test'
        )),

      CONSTRAINT uq_cnr_unique
        UNIQUE (curriculum_version_id, from_node_display_no, to_node_display_no, relation_type)
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cnr_version
      ON curriculum_node_relations (curriculum_version_id);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cnr_from_node
      ON curriculum_node_relations (curriculum_version_id, from_node_display_no);
  `));

  console.log("[curriculum-app-master] curriculum_node_relations OK");
}
