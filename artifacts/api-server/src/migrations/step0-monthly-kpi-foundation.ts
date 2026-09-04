/**
 * STEP 0 — Monthly KPI Foundation
 *
 * x_monthly_operational_snapshots 테이블 신규 생성.
 *
 * 목적:
 *   - pool별 월 KPI snapshot 단일 저장소
 *   - pool 관리자 조회: WHERE swimming_pool_id = $pool AND year = $y AND month = $m
 *   - super_admin 전체 집계: WHERE year = $y AND month = $m → GROUP BY year, month
 *   - 500개 pool 전체 집계를 단일 DB 쿼리로 처리 (N+1 없음)
 *
 * KST 원칙:
 *   year / month 컬럼은 Asia/Seoul 기준 운영월.
 *   DB timestamp는 기존 TIMESTAMPTZ(UTC) 유지.
 *   월 집계 job에서 year/month 계산 시:
 *     const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
 *     year = kst.getFullYear(), month = kst.getMonth() + 1
 *   를 사용할 것.
 *
 * lesson_date 범위 query 원칙:
 *   class_diaries.lesson_date 는 TEXT 'YYYY-MM-DD' 형식.
 *   월 범위 query는 LEFT(lesson_date, 7) = 'YYYY-MM' 방식 금지.
 *   반드시:
 *     lesson_date >= 'YYYY-MM-01' AND lesson_date < 'NEXT-MONTH-01'
 *   lexicographic range 방식 사용 (ISO 형식 보장).
 *
 * UPSERT 원칙:
 *   월 집계 job은 raw source에서 현재 월 값을 재계산 후
 *   INSERT ... ON CONFLICT (swimming_pool_id, year, month) DO UPDATE 방식으로 overwrite.
 *   "+1 누적" 방식 금지. idempotent 구조 필수.
 *
 * pending_send 제외 이유:
 *   growth_report_pending_send_count 는 실시간 운영 상태이므로
 *   monthly snapshot 미포함. WP8 구현 시 live query로 처리.
 *
 * nullable 컬럼 정책:
 *   count류 (ai_diary_count 등): NOT NULL DEFAULT 0  (0과 미집계 구분 불필요)
 *   snapshot류 (active_student_count 등): nullable  (월말 snapshot 전 = NULL 의미 보존)
 *
 * UP:
 *   x_monthly_operational_snapshots 테이블 생성
 *   idx_xmos_period 인덱스 (super_admin aggregate query 전용)
 *   UNIQUE(swimming_pool_id, year, month) 이 pool scoped query 커버 → 중복 인덱스 없음
 *
 * DOWN: DROP INDEX → DROP TABLE
 *
 * Additive only — 기존 테이블/컬럼/enum 변경 없음.
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function up(db: MigrationDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS x_monthly_operational_snapshots (
      id                              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      swimming_pool_id                TEXT        NOT NULL REFERENCES swimming_pools(id),
      year                            SMALLINT    NOT NULL,
      month                           SMALLINT    NOT NULL,

      ai_diary_count                  INTEGER     NOT NULL DEFAULT 0,
      ai_diary_teacher_count          INTEGER     NOT NULL DEFAULT 0,

      parent_curriculum_search_count  INTEGER     NOT NULL DEFAULT 0,
      parent_curriculum_user_count    INTEGER     NOT NULL DEFAULT 0,
      assigned_student_count          INTEGER,
      unassigned_student_count        INTEGER,
      curriculum_version_id           UUID,

      growth_report_target_count      INTEGER     NOT NULL DEFAULT 0,
      growth_report_generated_count   INTEGER     NOT NULL DEFAULT 0,
      growth_report_failed_count      INTEGER     NOT NULL DEFAULT 0,
      growth_report_sent_count        INTEGER     NOT NULL DEFAULT 0,

      active_student_count            INTEGER,
      active_teacher_count            INTEGER,
      connected_parent_count          INTEGER,

      x_plan_key                      TEXT,
      x_plan_member_limit             INTEGER,

      snapshot_finalized_at           TIMESTAMPTZ,
      created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (swimming_pool_id, year, month)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_xmos_period
      ON x_monthly_operational_snapshots (year, month)
  `);
}

export async function down(db: MigrationDb): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS idx_xmos_period
  `);
  await db.execute(sql`
    DROP TABLE IF EXISTS x_monthly_operational_snapshots
  `);
}
