---
name: X02-C Billing Contract 완료
description: Server Purchase Contract (x-billing.ts + 신규 endpoints + 38 TC) 구현 상태
---

# X02-C Server Purchase Contract

**SHA:** `c8ee6a32` (branch: `deploy-photo-clone`)
**TC:** 1147/1147 (신규 38 TC)

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `artifacts/api-server/src/lib/x-billing.ts` | 핵심 비즈니스 로직 |
| `artifacts/api-server/src/migrations/pool-db-x-billing-contract.ts` | `revenuecat_webhook_events` 테이블 생성 |
| `artifacts/api-server/src/routes/billing.ts` | 신규 엔드포인트 + webhook 업데이트 |
| `artifacts/api-server/src/routes/__tests__/x02c-billing-contract.test.ts` | 38 TC |

## 주요 함수 (x-billing.ts)

- `resolveXProductForSequence(seq)` → `{ tierKey, storeProductId, discountPercent }`
  - seq 1~100: tier1 (50%), 101~300: tier2 (30%), 301~500: tier3 (10%), 501+: standard (0%)
- `formatFranchiseNumber(seq)` → `"x-0001"` (4자리 zero-pad, 1000+ unpadded)
- `reserveXSlot(poolId, userId)` → slot 예약 (PURCHASED시 ALREADY_SUBSCRIBED, 만료 RESERVED는 RELEASE 후 재발급)
- `syncXSubscription({ poolId, userId })` → RC API 검증 + slot binding
- `commitXPurchaseTransaction({...})` → idempotent slot PURCHASED + pool paid=true (alreadySynced 반환)
- `processXWebhookEvent({...})` → event dedup + cross-pool defense + INITIAL_PURCHASE/RENEWAL/EXPIRATION 처리
- `auditXEvent({...})` → audit_logs 기록 (actor_type='system')

## API 엔드포인트

- `POST /billing/x-reserve-slot` — pool_admin 전용, billingEnabled 우회
- `POST /billing/sync-x-subscription` — pool_admin 전용, billingEnabled 우회
- 기존 RC webhook: isXProduct → `processXWebhookEvent` (변경됨)

## 핵심 설계 결정

1. **INITIAL_PURCHASE webhook 처리 순서:**
   - RESERVED slot 있음: `commitXPurchaseTransaction` (slot+paid 처리) → audit
   - RESERVED slot 없음 (sync가 먼저 완료): `handleXEntitlementEvent` fallback (idempotent)
   - `handleXEntitlementEvent` 중복 호출 금지 (before-state 오염 방지)

2. **syncXSubscription:** `commitXPurchaseTransaction`만 호출, `handleXEntitlementEvent` 호출 없음

3. **cross-pool defense:** RENEWAL/CANCELLATION/EXPIRATION/REFUND — `resolvePoolIdByTransaction`으로 원래 pool 검증

4. **idempotency:** `revenuecat_webhook_events.event_id UNIQUE` (ON CONFLICT DO NOTHING) + slot status 기반 커밋 체크

## Render.com 미설정 환경 변수 (수동 추가 필요)
- `REVENUECAT_SECRET_API_KEY` — RevenueCat 대시보드에서 조회
- `REVENUECAT_X_PRODUCT_IDS=com.swimnote.x.monthly.tier1,com.swimnote.x.monthly.tier2,com.swimnote.x.monthly.tier3,com.swimnote.x.monthly.standard`

## 배포 상태

- Replit: `[x-billing-contract-migration] revenuecat_webhook_events OK` ✅
- Render.com: GitHub push 자동 배포 진행 중 (c8ee6a32)
- OTA: 앱 UI 없음 → 불필요
