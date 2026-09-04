-- ============================================================
-- Migration: subscription_plans nullable columns (2026-09-05)
-- ============================================================
--
-- 목적:
--   BASE/X 플랜과 DATA ADD-ON을 동일 테이블(subscription_plans)에 저장 시,
--   각 타입에 맞지 않는 필드는 NULL 허용이 가능하도록 설계 교정.
--
-- 변경 컬럼:
--   member_limit   : plan_type=data_addon에서 NULL (회원 한도 개념 없음)
--   storage_mb     : plan_type=data_addon에서 NULL (별도 extra_storage_gb SoT 사용)
--   storage_gb     : 동일
--   display_storage: 동일
--
-- runtime 영향:
--   subscriptionResolver.ts: plan?.member_limit ?? 10  → NULL-safe ✅
--   subscriptionResolver.ts: plan?.storage_gb ?? 0.49  → NULL-safe ✅
--   storageQuota.ts:         COALESCE(sp.storage_gb, 0.1) → NULL-safe ✅
--
-- Production 실행: 금지 (Staging 검증 후 수동 승인)
-- runtime boot DDL: 금지
-- ============================================================

BEGIN;

-- ── 1. NOT NULL 제약 해제 ───────────────────────────────────────────────────
ALTER TABLE subscription_plans ALTER COLUMN member_limit    DROP NOT NULL;
ALTER TABLE subscription_plans ALTER COLUMN storage_mb      DROP NOT NULL;
ALTER TABLE subscription_plans ALTER COLUMN storage_gb      DROP NOT NULL;
ALTER TABLE subscription_plans ALTER COLUMN display_storage DROP NOT NULL;

-- ── 2. 검증 ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 컬럼이 nullable인지 확인
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_plans'
      AND column_name = 'member_limit'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'DDL FAIL: member_limit still NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_plans'
      AND column_name = 'storage_gb'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'DDL FAIL: storage_gb still NOT NULL';
  END IF;

  RAISE NOTICE 'DDL OK: member_limit, storage_mb, storage_gb, display_storage are now nullable';
END $$;

COMMIT;
