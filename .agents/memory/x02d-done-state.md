---
name: X02-D 완료 상태
description: iOS Purchase UI + RevenueCat Offering Connection 구현 완료 기록
---

## 완료 내용

SHA d867dc78; 2파일; TS오류 0; 서버 1152TC; OTA production f69df72e / preview 57be1c39

## 변경 파일

- `artifacts/swim-app/app/(admin)/x-subscription.tsx` — UI-only → 실제 결제 상태 머신
- `artifacts/swim-app/lib/revenuecat.tsx` — getXOffering() + X_OFFERING_ID + X_ENTITLEMENT

## 상태 머신

PurchasePhase: IDLE→RESERVING→RESERVED→LOADING_PRODUCT→READY_TO_PURCHASE
  →PURCHASING→SYNCING→X_ACTIVE/PURCHASED_X_PENDING
  (+ USER_CANCELLED / PURCHASE_FAILED / SYNC_FAILED / PRODUCT_NOT_AVAILABLE)

## 핵심 구현 원칙 (재발 방지)

- pool_admin only CTA; sub_admin/teacher는 lock 표시
- 예약 확인 카드에서 localizedPrice = pkg.product.priceString (RC source of truth)
- 하드코딩 금액(₩75,000 등) 완전 제거
- double tap: useRef inFlight
- 취소: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR (PurchasesErrorCode deprecated)
- SYNC_FAILED ≠ 결제 실패 (명시적 분리)
- 409 ALREADY_SUBSCRIBED → refreshMode()
- store_product_id는 반드시 서버 reserve 응답 기준 (클라이언트 계산 금지)

## 배포 상태

- 서버 변경: 없음 (Render 재배포 불필요)
- OTA production: f69df72e-ae47-4754-b7b8-aee5fd75a6d0
- OTA preview: 57be1c39-d562-4cd3-b9e7-67b53199cb0a
- 실기기 E2E: TESTFLIGHT_PURCHASE_E2E = NOT_YET_VERIFIED

## 다음 단계

X02-D2: Restore / Subscription management / TestFlight purchase E2E
