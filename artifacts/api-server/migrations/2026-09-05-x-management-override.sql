-- ── Super Admin Management Override Column ──────────────────────────────────
-- 목적: Toykids 등 본사 관리용 풀을 일반 X 진입 조건(paid/config/curriculum)과
--       완전히 분리하여 영구 X1000 테넌트로 고정하는 DB 컬럼.
--
-- 설계 원칙:
--   - DB 컬럼이 권위 소스. 클라이언트에서 활성화 불가.
--   - Super Admin 전용 PATCH /super/operators/:id/management-override 로만 설정.
--   - computeMode() 최우선 분기: x_management_override=true → 즉시 mode="x".
--   - x_force_disabled, xmode_config_status, paid/manual entitlement 모두 무시.
--   - DEFAULT false: 기존 모든 pool은 영향 없음.
--
-- 실행 순서: 이 migration은 단독 실행 가능 (의존 migration 없음).
-- Idempotent: IF NOT EXISTS 조건 사용.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE swimming_pools
  ADD COLUMN IF NOT EXISTS x_management_override BOOLEAN NOT NULL DEFAULT false;

-- 관리자 운영 조회용 인덱스 (override=true인 풀 목록 빠르게 조회)
CREATE INDEX IF NOT EXISTS idx_swimming_pools_x_management_override
  ON swimming_pools (x_management_override)
  WHERE x_management_override = true;

-- Verification query (migration 후 확인용):
-- SELECT COUNT(*) FROM swimming_pools WHERE x_management_override = true;
-- Expected before Toykids UPDATE: 0
