---
name: Standby-sync swimming_pools schema mismatch fix
description: standby DB(POOL_DATABASE_URL) swimming_pools 컬럼 불일치 root cause + fix 패턴
---

# Standby-sync swimming_pools Schema Mismatch

## 근본 원인
모든 production 마이그레이션은 `superAdminDb`(SUPABASE_DATABASE_URL)에만 실행됨.
`backupDb`(POOL_DATABASE_URL, standby)는 같은 마이그레이션을 받지 않아 컬럼 불일치 발생.

누락 컬럼 분류:
- `pool-db-x-init.ts` → `xmode_entitlement`, `xmode_config_status`, `xmode_purchased_at`, `xmode_subscription_end_at`, `xmode_payment_failed_at`
- `pool-db-x-payment-init.ts` → `x_slot_id`(FK없이 bigint), `x_paid_entitlement`, `x_manual_entitlement`, `x_force_disabled`
- `pool-db-x-lifecycle.ts` → `x_auto_renew_cancelled`
- `super-db-init.ts` → `homepage_slug`, `homepage_enabled`

## Fix 패턴
`repairStandbySwimmingPoolsSchema(backupDb)` in `standby-sync.ts`:
- `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL END $$` — ENUM 멱등 생성
- `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS ...` — 12개 컬럼 멱등 추가
- `x_slot_id bigint` — FK 없이 (standby에 x_subscription_slots 미존재)
- `runHotStandbySync`에서 swimming_pools 포함 시 TRUNCATE 전 repair 먼저 호출

## 에러 로깅 개선
`replicateTable` catch: drizzle가 `e.message`에 "Failed query: INSERT INTO..."만 포함.
실제 PG 오류는 `e.cause.message`에 있음. 개선: `| PG: ${e.cause?.message}` 추가.

**Why:** 향후 신규 컬럼을 swimming_pools에 추가할 때 standby도 같이 업데이트해야 함.
`repairStandbySwimmingPoolsSchema`에 `ADD COLUMN IF NOT EXISTS` 라인 추가 필요.

**How to apply:** swimming_pools에 production 컬럼 추가 시 반드시 repairStandby에도 동일 컬럼 추가.
