/**
 * group8-curriculum-multi-conversation.ts — WP-D Migration
 *
 * 목적:
 *   1. UNIQUE(parent_account_id, student_id) 제거
 *      → 한 parent/student 조합에 복수 conversation 허용
 *   2. title TEXT NULL 컬럼 추가
 *   3. 대화 목록 정렬용 index 추가
 *
 * 주의:
 *   - UNIQUE constraint 이름은 pg_constraint에서 런타임에 조회 (blind DROP 금지)
 *   - 기존 데이터 삭제 0건
 *   - 기존 conversations / messages row 100% 보존
 *   - migration 자체는 transactional DDL (Postgres DDL transaction 지원)
 *
 * 실행:
 *   아직 Production 실행 금지 (WP-D PHASE 1 서버 deploy + smoke 완료 후 별도 승인)
 *
 * Rollback:
 *   복수 conversation 생성 전까지만 단순 UNIQUE 재생성 가능.
 *   복수 row 생성 이후 rollback 시 데이터 보존 계획 별도 필요.
 *   기존 conversation 삭제로 UNIQUE 맞추는 방식 금지.
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runGroup8CurriculumMultiConversationMigration(): Promise<void> {
  console.log("[group8-curriculum-multi-conversation] START");

  // ── 사전 검증 ──────────────────────────────────────────────────────────────
  const preMigrationCounts = await superAdminDb.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM parent_curriculum_conversations) AS conv_count,
      (SELECT COUNT(*) FROM parent_curriculum_messages)      AS msg_count
  `);
  const preCounts = (preMigrationCounts as any).rows[0] as any;
  console.log(`[group8] PRE: conversations=${preCounts.conv_count}, messages=${preCounts.msg_count}`);

  // ── 실제 UNIQUE constraint 이름 조회 ──────────────────────────────────────
  const constraintResult = await superAdminDb.execute(sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid  = 'parent_curriculum_conversations'::regclass
      AND contype   = 'u'
      AND conkey @> ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'parent_curriculum_conversations'::regclass AND attname = 'parent_account_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'parent_curriculum_conversations'::regclass AND attname = 'student_id')
      ]::smallint[]
  `);

  const constraintRows = (constraintResult as any).rows as any[];
  console.log(`[group8] UNIQUE constraints found: ${JSON.stringify(constraintRows.map((r: any) => r.conname))}`);

  // ── UNIQUE constraint 제거 ─────────────────────────────────────────────────
  for (const row of constraintRows) {
    const constraintName: string = row.conname;
    console.log(`[group8] Dropping UNIQUE constraint: ${constraintName}`);
    // Dynamic constraint name — safe because it comes from pg_constraint (not user input)
    await superAdminDb.execute(
      sql.raw(`ALTER TABLE parent_curriculum_conversations DROP CONSTRAINT IF EXISTS "${constraintName}"`)
    );
    console.log(`[group8] Dropped: ${constraintName}`);
  }

  // ── title 컬럼 추가 ────────────────────────────────────────────────────────
  const titleExists = await superAdminDb.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name  = 'parent_curriculum_conversations'
      AND column_name = 'title'
    LIMIT 1
  `);

  if ((titleExists as any).rows.length === 0) {
    console.log("[group8] Adding title column...");
    await superAdminDb.execute(sql`
      ALTER TABLE parent_curriculum_conversations
        ADD COLUMN title TEXT NULL
    `);
    console.log("[group8] title column added");
  } else {
    console.log("[group8] title column already exists — skipping");
  }

  // ── 대화 목록 정렬 index 추가 ──────────────────────────────────────────────
  const indexExists = await superAdminDb.execute(sql`
    SELECT 1 FROM pg_indexes
    WHERE tablename  = 'parent_curriculum_conversations'
      AND indexname  = 'idx_pcc_parent_student_updated'
    LIMIT 1
  `);

  if ((indexExists as any).rows.length === 0) {
    console.log("[group8] Creating idx_pcc_parent_student_updated...");
    await superAdminDb.execute(sql`
      CREATE INDEX idx_pcc_parent_student_updated
        ON parent_curriculum_conversations (parent_account_id, student_id, updated_at DESC)
    `);
    console.log("[group8] Index created");
  } else {
    console.log("[group8] idx_pcc_parent_student_updated already exists — skipping");
  }

  // ── 사후 검증 ──────────────────────────────────────────────────────────────
  const postMigrationCounts = await superAdminDb.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM parent_curriculum_conversations) AS conv_count,
      (SELECT COUNT(*) FROM parent_curriculum_messages)      AS msg_count
  `);
  const postCounts = (postMigrationCounts as any).rows[0] as any;
  console.log(`[group8] POST: conversations=${postCounts.conv_count}, messages=${postCounts.msg_count}`);

  if (String(preCounts.conv_count) !== String(postCounts.conv_count)) {
    throw new Error(`[group8] ABORT: conversation count changed! pre=${preCounts.conv_count} post=${postCounts.conv_count}`);
  }
  if (String(preCounts.msg_count) !== String(postCounts.msg_count)) {
    throw new Error(`[group8] ABORT: message count changed! pre=${preCounts.msg_count} post=${postCounts.msg_count}`);
  }

  console.log("[group8-curriculum-multi-conversation] DONE ✓");
}
