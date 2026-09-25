/**
 * education-segment-columns.ts — Add suspended_at + education_started_at to students
 *
 * suspended_at timestamptz NULL
 *   - 연기 시작 시각 (즉시 연기 시 기록, 다음달 예약 적용 시 적용 시점에 기록)
 *   - active 복귀 시 clear
 *
 * education_started_at text NULL  (YYYY-MM-DD)
 *   - 현재 교육구간 시작일
 *   - NULL = 전체 이력이 현재 교육구간
 *   - 1개월 이상 연기 후 재등록 시 재등록일로 설정
 *   - 기존 회원 backfill 금지
 *
 * 실행:
 *   pnpm tsx src/migrations/education-segment-columns.ts
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

  console.log("\n[education-segment-columns] Starting migration...\n");

  await exec(
    "students.suspended_at",
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ NULL`,
  );

  await exec(
    "students.education_started_at",
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS education_started_at TEXT NULL`,
  );

  console.log("\n[education-segment-columns] Done.\n");
}

// standalone entry point
if (process.argv[1]?.endsWith("education-segment-columns.ts") ||
    process.argv[1]?.endsWith("education-segment-columns.js")) {
  (async () => {
    const { buildMigrationDb } = await import("../lib/migration-db.js");
    const db = await buildMigrationDb();
    await run(db);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
