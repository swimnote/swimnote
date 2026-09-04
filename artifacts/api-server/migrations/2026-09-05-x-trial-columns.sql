-- ── WP2B X Trial Columns — Production Backfill ────────────────────────────────
-- 목적: swimming_pools에 x_trial_* 3개 컬럼 추가.
--       wp2b-x-trial.ts 마이그레이션이 Production에 미적용된 상태에서
--       resolvePoolMode() SQL이 해당 컬럼을 SELECT하여 500 에러가 발생.
--       이 파일은 Production 직접 적용분을 SQL로 기록한 것.
--
-- Root cause of P0 (TOYKIDS X MODE 500):
--   artifacts/api-server/src/lib/xmode.ts resolvePoolMode() 가
--   x_trial_started_at / x_trial_ends_at / x_trial_used_at 를 SELECT하는데
--   Production DB에 해당 컬럼이 없었음 → column does not exist → 500.
--
-- Applied to Production (Supabase): 2026-09-05
-- Applied to Staging (TEST_DATABASE_URL): 2026-09-05
-- Idempotent: IF NOT EXISTS 사용.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE swimming_pools
  ADD COLUMN IF NOT EXISTS x_trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS x_trial_ends_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS x_trial_used_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_swimming_pools_x_trial_ends_at
  ON swimming_pools (x_trial_ends_at)
  WHERE x_trial_ends_at IS NOT NULL;

-- Verification:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='swimming_pools'
--   AND column_name IN ('x_trial_started_at','x_trial_ends_at','x_trial_used_at');
-- Expected: 3 rows
