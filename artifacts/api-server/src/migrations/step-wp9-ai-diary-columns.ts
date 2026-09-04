/**
 * STEP WP9 — AI Diary Columns
 *
 * class_diaries에 AI 일지 식별 컬럼 추가.
 *
 * 목적:
 *   WP9 이전에는 AI 일지와 일반 일지를 class_diaries에서 구분할 수 없었음.
 *   이번 migration으로:
 *     - ai_generated: AI generation flow에서 저장된 일지를 TRUE로 마킹
 *     - ai_trace_id:  AI generation 시 서버가 반환한 request_id 보관 (FK 없음)
 *
 * 과거 데이터 처리:
 *   기존 row: DEFAULT FALSE → "tracking 이전 / 식별 불가" (AI로 추정 backfill 금지)
 *   WP9 적용 이후 저장된 일지부터 정확한 KPI 집계 시작.
 *
 * ai_trace_id FK 없는 이유:
 *   - AI trace는 event_logs.metadata JSONB에 저장됨 (별도 테이블 아님)
 *   - event_logs.id는 fire-and-forget으로 삽입 → diary save 시점에 미존재 가능
 *   - 교차 삭제 위험 → 동일 타입 TEXT로만 보관, 참조 정합성 불필요
 *
 * Index:
 *   partial composite index on (swimming_pool_id, lesson_date)
 *   WHERE ai_generated = TRUE AND is_deleted = FALSE
 *   → AI 일지피드 조회 + 월별 KPI recount 모두 커버
 *
 * Additive only — DROP / RENAME / 기존 data rewrite 없음.
 * 재실행 안전: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 *
 * UP:  class_diaries 컬럼 2개 추가 + partial index 1개
 * DOWN: DROP INDEX → DROP COLUMN × 2
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function up(): Promise<void> {
  // ai_generated: AI flow에서 저장된 일지 마킹
  await superAdminDb.execute(sql`
    ALTER TABLE class_diaries
      ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE
  `);

  // ai_trace_id: AI generation request_id 보관 (correlation key, NOT FK)
  await superAdminDb.execute(sql`
    ALTER TABLE class_diaries
      ADD COLUMN IF NOT EXISTS ai_trace_id TEXT
  `);

  // partial composite index: AI 일지피드 + KPI recount 전용
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_class_diaries_ai_pool_date
      ON class_diaries (swimming_pool_id, lesson_date)
      WHERE ai_generated = TRUE AND is_deleted = FALSE
  `);
}

export async function down(): Promise<void> {
  await superAdminDb.execute(sql`
    DROP INDEX IF EXISTS idx_class_diaries_ai_pool_date
  `);
  await superAdminDb.execute(sql`
    ALTER TABLE class_diaries
      DROP COLUMN IF EXISTS ai_trace_id
  `);
  await superAdminDb.execute(sql`
    ALTER TABLE class_diaries
      DROP COLUMN IF EXISTS ai_generated
  `);
}
