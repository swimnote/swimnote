---
name: WP-X02-D2 X 구독 생명주기 완료
description: Restore / 구독 상태 UI / 구독 관리 deep-link / CANCELLED_BUT_ACTIVE / 중복보호 감사
---

# WP-X02-D2 완료

**SHA**: 4be61202  
**브랜치**: deploy-photo-clone  
**변경 파일**: 5개 (migration 1, server 2, client 2)

---

## A. 핵심 구현

| 항목 | 구현 방식 |
|---|---|
| x_auto_renew_cancelled 컬럼 | migrations/pool-db-x-lifecycle.ts, startup migration |
| CANCELLATION → x_auto_renew_cancelled=true | x-entitlement.ts CANCELLATION case |
| RENEWAL/UNCANCELLATION → false | x-entitlement.ts |
| GET /billing/x-subscription-status | billing.ts (pool_admin, billingEnabled 이전) |
| POST /billing/restore-x-subscription | billing.ts (RC V2 server 확인 후 활성화) |
| subscription_status 계산 | ACTIVE/CANCELLED_BUT_ACTIVE/BILLING_ISSUE/EXPIRED/UNKNOWN |
| CANCELLED_BUT_ACTIVE UI | 노란 안내박스 + 종료 예정일 |
| BILLING_ISSUE UI | 빨간 안내박스 |
| 구독 관리 deep-link | itms-apps://apps.apple.com/account/subscriptions |
| 구매 복원 | RC restorePurchases → server confirm → refreshMode |
| x-mode-hub 구독 관리 진입점 | "X 구독 관리" 항목 → x-subscription 화면 |

## B. Restore 흐름 (spec §5~6)

```
Purchases.restorePurchases()
→ RC entitlements에 x_mode 있음? 없으면 §6B 안내
→ POST /billing/restore-x-subscription (server RC V2 재확인)
→ 서버 422 RC_ENTITLEMENT_INACTIVE → §6D 안내
→ 서버 500 → §6E 안내 (retry)
→ 성공 → refreshMode() → mode 업데이트
```

## C. subscription_status 계산 로직

```
x_force_disabled=true         → UNKNOWN
x_paid_entitlement=true:
  xmode_payment_failed_at≠null → BILLING_ISSUE
  x_auto_renew_cancelled=true  → CANCELLED_BUT_ACTIVE
  else                         → ACTIVE
x_manual_entitlement=true      → ACTIVE
xmode_purchased_at 있음        → EXPIRED
else                           → UNKNOWN
```

## D. 정책 준수 확인

- CANCELLATION → x_paid_entitlement 불변 (만료일까지 X 유지) ✅
- 직접 cancel API 없음 (Apple native flow만) ✅
- UNKNOWN != NORMAL (transient failure) ✅
- X data 삭제 없음 ✅
- pool_admin only (server requireRole) ✅

## E. 미검증 (물리 기기)

- X-D2-05~07 Restore 실제 흐름
- X-D2-11 auto-renew cancellation (App Store에서 직접)
- X-D2-13 expiration confirmed

OTA:
- PRODUCTION: 01a00c03-03b4-714c-b7c1-191360090551
- PREVIEW: 01a00c03-3a7d-7886-9a70-d878fdbc18b0
