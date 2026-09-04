/**
 * WP2B — X Trial DB Migration
 *
 * swimming_pools에 x_trial_* 컬럼 3개 추가.
 *
 * UP:
 *   x_trial_started_at TIMESTAMPTZ  — 현재 Trial 시작시각
 *   x_trial_ends_at    TIMESTAMPTZ  — Trial 만료시각 (= started_at + 72h)
 *   x_trial_used_at    TIMESTAMPTZ  — 센터당 1회 제한 SoT (절대 초기화 금지)
 *
 * DOWN: DROP COLUMN (rollback)
 *
 * Production 실행 금지 (WP2B scope).
 */
import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

export async function up(db: MigrationDb): Promise<void> {
  await db.execute(sql`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS x_trial_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS x_trial_ends_at    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS x_trial_used_at    TIMESTAMPTZ
  `);

  // cleanup job / 만료 스캔 최적화 인덱스 (실제 quota 판단은 lazy expiration으로 처리)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_swimming_pools_x_trial_ends_at
      ON swimming_pools (x_trial_ends_at)
      WHERE x_trial_ends_at IS NOT NULL
  `);
}

export async function down(db: MigrationDb): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS idx_swimming_pools_x_trial_ends_at
  `);
  await db.execute(sql`
    ALTER TABLE swimming_pools
      DROP COLUMN IF EXISTS x_trial_started_at,
      DROP COLUMN IF EXISTS x_trial_ends_at,
      DROP COLUMN IF EXISTS x_trial_used_at
  `);
}
