/**
 * growth-report-gr-eligibility-columns.ts
 *
 * Additive migration — growth_reports 테이블에 eligibility 판정 컬럼 추가.
 *
 * 추가 컬럼:
 *   exclusion_code      TEXT     — 발급 제외 사유 코드 (null = ELIGIBLE)
 *                                   NOT_REREGISTERED / INSUFFICIENT_ATTENDANCE /
 *                                   NO_SOURCE_DATA / INSUFFICIENT_SOURCE_DATA
 *   attendance_count    INTEGER  — 분석월 출석 횟수 (present + late, DISTINCT row 기준)
 *   eligibility_version INTEGER  — 판정 정책 버전 (정책 변경 추적용)
 *
 * ENUM 확장:
 *   gr_product_status_enum += 'EXCLUDED'
 *   (ALTER TYPE ADD VALUE는 트랜잭션 외부 auto-commit 필요 — DB가 이미 존재하면 무시됨)
 *
 * 안전 규칙:
 *   - ADD COLUMN IF NOT EXISTS 사용 → 재실행 안전
 *   - DEFAULT NULL / DEFAULT 0 — 기존 row 영향 없음
 *   - source_event_count 컬럼은 pool-db-x-init.ts에서 이미 추가됨 (중복 없음)
 *   - 기존 컬럼(discard_reason 등) 변경 없음
 *   - EXCLUDED는 lifecycle 상 terminal state — worker가 PREANALYZING → EXCLUDED 직접 UPDATE
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runGrEligibilityColumnsMigration(): Promise<void> {
  console.log("[migration] growth-report-gr-eligibility-columns: START");

  // Step 1: ENUM 확장 (ADD VALUE IF NOT EXISTS — auto-commit, idempotent)
  // PostgreSQL은 동일 값이 이미 존재하면 에러가 아닌 no-op.
  // "IF NOT EXISTS" 지원은 PG 9.3+; Supabase PG 15 지원됨.
  try {
    await superAdminDb.execute(
      sql.raw(`ALTER TYPE gr_product_status_enum ADD VALUE IF NOT EXISTS 'EXCLUDED'`),
    );
    console.log("[migration] gr_product_status_enum: EXCLUDED added (or already existed)");
  } catch (e: any) {
    // 일부 PG 버전에서 IF NOT EXISTS 미지원 → duplicate error 무시
    if (!e.message?.includes("already exists")) throw e;
    console.log("[migration] gr_product_status_enum: EXCLUDED already existed, skipping");
  }

  // Step 2: 컬럼 추가
  await superAdminDb.execute(sql`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS exclusion_code       TEXT    DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS attendance_count     INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS eligibility_version  INTEGER DEFAULT 0
  `);

  console.log("[migration] growth-report-gr-eligibility-columns: DONE");
}

// ─── CLI entry ─────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runGrEligibilityColumnsMigration()
    .then(() => { console.log("Migration complete."); process.exit(0); })
    .catch((err) => { console.error("Migration failed:", err); process.exit(1); });
}
