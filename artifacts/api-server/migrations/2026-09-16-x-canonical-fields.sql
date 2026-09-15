-- ── X Canonical Fields Migration ─────────────────────────────────────────────
-- 목적: swimming_pools에 X 모드 관련 canonical field 추가.
--       이 컬럼들은 computeMode(), resolvePoolMode(), xmode.ts, GR scheduler 등
--       APP/API 전반에서 실제 사용 중인 canonical field이며,
--       Production DB에만 적용이 누락된 상태였음.
--
-- 적용 이력:
--   Production: 2026-09-16 (수동 적용)
--   Idempotent: IF NOT EXISTS 사용
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE swimming_pools
  -- X entitlement (canonical — computeMode()의 x_paid/x_manual/x_force 판정에 사용)
  ADD COLUMN IF NOT EXISTS x_paid_entitlement      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS x_manual_entitlement    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS x_force_disabled        BOOLEAN NOT NULL DEFAULT false,
  -- x_management_override: 별도 migration 파일(2026-09-05-x-management-override.sql) 존재
  -- x_plan_key: X 플랜 식별자 (officialPlanCatalog.ts)
  ADD COLUMN IF NOT EXISTS x_plan_key              TEXT,
  -- xmode_config_status: X 설정 완료 여부 (isXModeConfigReady())
  ADD COLUMN IF NOT EXISTS xmode_config_status     TEXT,
  -- member_limit: 수영장별 회원 한도 override (member-limit.ts)
  ADD COLUMN IF NOT EXISTS member_limit            INTEGER;

-- 인덱스: X 활성 pool 목록 빠른 조회
CREATE INDEX IF NOT EXISTS idx_swimming_pools_x_paid
  ON swimming_pools (x_paid_entitlement)
  WHERE x_paid_entitlement = true;

CREATE INDEX IF NOT EXISTS idx_swimming_pools_x_manual
  ON swimming_pools (x_manual_entitlement)
  WHERE x_manual_entitlement = true;
