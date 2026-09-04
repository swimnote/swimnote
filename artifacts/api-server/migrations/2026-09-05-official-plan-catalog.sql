-- ============================================================
-- Migration: 신규 공식 플랜 카탈로그 (2026-09-05)
-- ============================================================
--
-- 목적:
--   1. 신규 6개 공식 플랜을 subscription_plans에 upsert (정확한 가격)
--   2. Legacy Coach/Premier 플랜을 is_active=false로 비활성화
--   3. DATA ADD-ON 플랜(data100/data300) 추가
--
-- 실행 조건:
--   - Staging에서 검증 후 Production 수동 실행
--   - Runtime boot에서 자동 실행 금지
--
-- Rollback:
--   UPDATE subscription_plans SET is_active=true WHERE tier IN ('starter','basic','standard','center_200','advance','pro','max');
--   DELETE FROM subscription_plans WHERE tier IN ('data100','data300');
--   UPDATE subscription_plans SET price_per_month=129000 WHERE tier='x300';
--   UPDATE subscription_plans SET price_per_month=199000 WHERE tier='x500';
--   UPDATE subscription_plans SET price_per_month=359000 WHERE tier='x1000';
-- ============================================================

BEGIN;

-- ── 1. 신규 BASE 플랜 upsert ────────────────────────────────────────────────
-- swimnote: 이미 존재하나 is_active 보장
INSERT INTO subscription_plans (tier, plan_id, name, price_per_month, member_limit, storage_gb, storage_mb, display_storage, is_active)
VALUES ('swimnote', 'swimnote', 'SWIMNOTE', 9900, 999999, 100, 100000, '100GB', true)
ON CONFLICT (tier) DO UPDATE SET
  name           = EXCLUDED.name,
  price_per_month = EXCLUDED.price_per_month,
  is_active      = true;

-- ── 2. 신규 X 플랜 upsert (확정 가격 적용) ─────────────────────────────────
INSERT INTO subscription_plans (tier, plan_id, name, price_per_month, member_limit, storage_gb, storage_mb, display_storage, is_active)
VALUES
  ('x300',  'x300',  'SWIMNOTE X300',  119000, 300,  100, 100000, '100GB', true),
  ('x500',  'x500',  'SWIMNOTE X500',  189000, 500,  100, 100000, '100GB', true),
  ('x1000', 'x1000', 'SWIMNOTE X1000', 349000, 1000, 100, 100000, '100GB', true)
ON CONFLICT (tier) DO UPDATE SET
  name            = EXCLUDED.name,
  price_per_month = EXCLUDED.price_per_month,
  member_limit    = EXCLUDED.member_limit,
  is_active       = true;

-- ── 3. DATA ADD-ON 플랜 upsert ─────────────────────────────────────────────
INSERT INTO subscription_plans (tier, plan_id, name, price_per_month, member_limit, storage_gb, storage_mb, display_storage, is_active)
VALUES
  ('data100', 'data100', 'DATA100', 7900,  999999, NULL, NULL, NULL, true),
  ('data300', 'data300', 'DATA300', 22900, 999999, NULL, NULL, NULL, true)
ON CONFLICT (tier) DO UPDATE SET
  name            = EXCLUDED.name,
  price_per_month = EXCLUDED.price_per_month,
  is_active       = true;

-- ── 4. Legacy Coach/Premier 비활성화 ────────────────────────────────────────
-- 기존 row는 보존 (historical data), 신규 선택 불가로만 처리
UPDATE subscription_plans
SET is_active = false
WHERE tier IN ('free', 'starter', 'basic', 'standard', 'center_200', 'advance', 'pro', 'max');

-- ── 5. 검증 ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_active_count   INT;
  v_inactive_count INT;
  v_x300_price     INT;
  v_x500_price     INT;
  v_x1000_price    INT;
BEGIN
  SELECT COUNT(*) INTO v_active_count   FROM subscription_plans WHERE is_active = true;
  SELECT COUNT(*) INTO v_inactive_count FROM subscription_plans WHERE is_active = false;
  SELECT price_per_month INTO v_x300_price  FROM subscription_plans WHERE tier = 'x300';
  SELECT price_per_month INTO v_x500_price  FROM subscription_plans WHERE tier = 'x500';
  SELECT price_per_month INTO v_x1000_price FROM subscription_plans WHERE tier = 'x1000';

  -- 신규 활성 플랜 6개 이상
  IF v_active_count < 6 THEN
    RAISE EXCEPTION 'MIGRATION FAIL: active plans = % (expected >= 6)', v_active_count;
  END IF;

  -- 가격 검증
  IF v_x300_price  != 119000 THEN RAISE EXCEPTION 'MIGRATION FAIL: x300 price = % (expected 119000)', v_x300_price; END IF;
  IF v_x500_price  != 189000 THEN RAISE EXCEPTION 'MIGRATION FAIL: x500 price = % (expected 189000)', v_x500_price; END IF;
  IF v_x1000_price != 349000 THEN RAISE EXCEPTION 'MIGRATION FAIL: x1000 price = % (expected 349000)', v_x1000_price; END IF;

  -- Legacy 비활성화 검증
  IF v_inactive_count < 8 THEN
    RAISE EXCEPTION 'MIGRATION FAIL: inactive plans = % (expected >= 8, legacy Coach/Premier)', v_inactive_count;
  END IF;

  RAISE NOTICE 'Migration OK: active=%, inactive=%, x300=%, x500=%, x1000=%',
    v_active_count, v_inactive_count, v_x300_price, v_x500_price, v_x1000_price;
END $$;

COMMIT;
