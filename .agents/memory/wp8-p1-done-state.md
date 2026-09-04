---
name: WP8-P1 완료 상태
description: WP8-P1 Release Gate 완료 — schema fixes + 71TC + iOS OTA
---

# WP8-P1 Final Release Gate

## Commit Chain
- f1afac08 — WP8 initial (53/53 TC)
- 1f0fa702 — WP8-P1 fixes (71/71 TC) ← FINAL HEAD

## Schema Findings (영구 기록)
- `pool_memberships` 테이블 존재하지 않음 → `notifyBatchComplete`는 `users WHERE role='pool_admin'` 사용
- `growth_report_cycles` 실제 컬럼: swimming_pool_id, report_period, analysis_cutoff_at (NOT NULL), parent_input_open/close_at (NOT NULL); `period_start/period_end/report_type` 없음
- `growth_report_cycles` unique index: `uq_growth_report_cycles_pool_period ON (swimming_pool_id, report_period)` → batch worker ON CONFLICT ✅
- `growth_report_batch_jobs` unique: `uq_growth_report_batch_jobs_pool_period ON (swimming_pool_id, year, month, job_type)` ✅
- `batch_job_id` column type: TEXT (not UUID) — swimming_pools.id가 text 형식

## P1 Fixes Applied
1. `notify.ts`: pool_memberships → users table
2. `growth-report-batch-worker.ts`: cycle INSERT 컬럼 수정 (wrong cols 제거)

## OTA
- iOS Update ID: 01a06b1f-3a91-7ef3-997c-7d46aecdb230
- OTA Group: 80ac8fd0-9b99-43bf-9497-e34f91a16b9e
- Branch: production-v2 / Runtime: 2.1.0
- Export Source SHA: 1f0fa702cc385b1f248b5ea405db3c0cf7aebd98 ✅ (matches FINAL HEAD)

## Test Coverage (71/71)
§1 Migration schema (14) + §2 autoValidate unit (5) + §3 ALLOWED_TRANSITIONS (10)
§4 fixture (3) + §5 transitionToRts (4) + §6 discard (3) + §7 regen (5)
§8 send (3) + §9 KPI (5) + §10 batch idempotency (2)
§11 multiple reissue v1→v2→v3 (7, SKIP if single-pool) 
§12 bulk send mixed + pool isolation (6)
§13 individual blocked states (3)
§14 notifyBatchComplete recipient schema (3)
§15 ON CONFLICT real DB (5)
§16 auto validation rules (4)

## Outstanding (사용자 승인 필요)
- Production DB migration (step-wp8-a-lifecycle + step-wp8-b-batch-jobs)
- Render production deploy (manual: SHA 1f0fa702)
- GROWTH_REPORT_BATCH_AUTO_ENABLED=true (fail-closed 유지 중)
