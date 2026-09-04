/**
 * diary-template-sync-migration.ts
 *
 * Standalone DDL for diary-template → curriculum_items sync feature.
 *
 * 실행 방법 (Render 배포 전 별도 실행):
 *   pnpm --filter @workspace/api-server exec tsx src/migrations/diary-template-sync-migration.ts
 *
 * 자동 startup 실행 금지: super-db-init.ts에 포함하지 않는다.
 *
 * idempotent: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 사용.
 */

import { sql }          from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function run(db: MigrationDb): Promise<void> {
  console.log("[diary-template-sync-migration] 시작");

  // ── 1. source_template_id 컬럼 추가 (nullable) ───────────────────────────
  //    기존 curriculum_items rows에 영향 없음 (NULL default).
  try {
    await db.execute(sql`
      ALTER TABLE curriculum_items
        ADD COLUMN IF NOT EXISTS source_template_id text
    `);
    console.log("[diary-template-sync-migration] ✅ source_template_id 컬럼 추가 완료");
  } catch (e: any) {
    console.error("[diary-template-sync-migration] ❌ source_template_id 컬럼 추가 실패:", e.message);
    throw e;
  }

  // ── 2. Partial unique index 생성 ─────────────────────────────────────────
  //
  //    목표:
  //      - 동일 pool + 동일 source_template_id 중복 0
  //      - 다른 pool의 동일 source_template_id 허용
  //      - NULL rows (legacy 포함) 영향 없음 (WHERE source_template_id IS NOT NULL)
  //      - repeated sync idempotent (ON CONFLICT inference 가능)
  //
  //    ON CONFLICT semantics:
  //      PostgreSQL은 ON CONFLICT (col_a, col_b) WHERE condition 구문에서
  //      matching partial unique index를 찾아 inference한다.
  //      index 조건과 ON CONFLICT WHERE 절이 정확히 일치해야 inference 성공.
  //
  //    IF NOT EXISTS: PostgreSQL 9.5+ 지원.
  try {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_items_pool_source_uniq
        ON curriculum_items (swimming_pool_id, source_template_id)
        WHERE source_template_id IS NOT NULL
    `);
    console.log("[diary-template-sync-migration] ✅ partial unique index 생성 완료");
  } catch (e: any) {
    console.error("[diary-template-sync-migration] ❌ index 생성 실패:", e.message);
    throw e;
  }

  console.log("[diary-template-sync-migration] 완료 — source_template_id 컬럼 + partial unique index 준비됨");
}

if (import.meta.url === String(new URL(process.argv[1], "file:"))) {
  const { runWithMigrationDb } = await import("../lib/migration-db.js");
  runWithMigrationDb("diary-template-sync-migration", run).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
