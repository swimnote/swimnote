/**
 * growth-report-gr1b-data-accumulating.ts
 *
 * Additive: gr_analysis_status_enum에 'DATA_ACCUMULATING' 추가.
 *
 * 배경:
 *   AI Engine이 데이터 부족 시 analysis_status = DATA_ACCUMULATING 반환.
 *   기존 enum (COMPLETE / COMPLETE_WITH_QUESTIONS_AVAILABLE /
 *   COMPLETE_WITH_PARENT_EVIDENCE / PARTIAL) 에 포함되지 않아
 *   DB 쓰기가 enum violation으로 실패하던 dead path를 해소.
 *
 * 원칙:
 *   - ADD VALUE IF NOT EXISTS — 멱등, 재실행 안전
 *   - enum value 제거/변경 없음 (non-destructive)
 *   - 기존 rows 변경 없음
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

let ran = false;

export async function runGr1bMigration(db: MigrationDb): Promise<void> {
  if (ran) return;
  ran = true;

  // ALTER TYPE … ADD VALUE IF NOT EXISTS는 트랜잭션 외부에서 실행해야 함.
  // Drizzle execute()는 autocommit 모드로 실행 — 안전.
  await db.execute(
    sql.raw(
      `ALTER TYPE gr_analysis_status_enum ADD VALUE IF NOT EXISTS 'DATA_ACCUMULATING'`,
    ),
  );

  console.log("[gr1b] gr_analysis_status_enum: DATA_ACCUMULATING 추가 완료");
}
