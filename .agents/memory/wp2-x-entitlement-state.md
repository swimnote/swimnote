---
name: WP2 X Entitlement Sync 구현 상태
description: RevenueCat X Mode 자동 동기화 WP2 구현 완료 현황 및 배포 체크리스트
---

## 현재 상태 (2026-08-11)

```
WP2 CODE:         IMPLEMENTED
WP2 TEST:         224/224 PASS (WP2 신규 18개 포함)
WP2 PRODUCTION:   NOT_DEPLOYED
WP2 EXTERNAL CONFIG: PENDING
```

## Commit 정보

- SHA: `07335f67b926d49a9f24b4452c9bc8c35fd19e2d`
- Branch: `deploy-photo-clone`
- Remote: `origin/deploy-photo-clone` push 완료
- Commit message: "Implement billing entitlement logic and associated webhook tests"

## 변경 파일 (코드 4개)

1. `artifacts/api-server/src/lib/x-entitlement.ts` [NEW]
2. `artifacts/api-server/src/routes/billing.ts` [MOD]
3. `artifacts/swim-app/app/(admin)/subscription.tsx` [MOD]
4. `artifacts/api-server/src/routes/__tests__/wp2-billing-webhook.test.ts` [NEW]

## Render env 상태

- `REVENUECAT_WEBHOOK_SECRET`: **EXISTS** → Render 배포 가능 조건 충족
- `REVENUECAT_X_PRODUCT_IDS`: **MISSING** → 정상 (App Store/Play/RC Dashboard에 X 상품 생성 전 설정 금지)

## 배포 전 필요 작업 (외부)

1. App Store Connect / Google Play Console에 X 전용 구독 상품 생성
2. RevenueCat Dashboard에 X Entitlement + Offering 생성
3. RevenueCat Dashboard → Webhook Authorization 헤더 값 확인 (REVENUECAT_WEBHOOK_SECRET 일치 여부)
4. Render env에 `REVENUECAT_X_PRODUCT_IDS` 설정 (실제 product ID)
5. 위 완료 후 → Render 서버 재배포 → OTA 앱 업데이트

## 설계 원칙 (재발 방지)

- `REVENUECAT_X_PRODUCT_IDS` 미설정 시 `isXProduct()` 항상 false → 일반 구독 완전 무영향
- `REVENUECAT_WEBHOOK_SECRET` 미설정 시 503 반환 (fail-closed)
- `xmode_config_status` webhook에서 절대 수정 안 함 (super admin 전용)
- CANCELLATION: subscription_end_at만 갱신, entitlement 즉시 false 금지
- BILLING_ISSUE: payment_failed_at 기록, entitlement 즉시 false 금지 (EXPIRATION에서 처리)
- audit_logs: entitlement 실제 변경 시에만 기록 (idempotency)
