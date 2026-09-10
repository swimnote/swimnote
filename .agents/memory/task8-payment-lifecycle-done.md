---
name: Task8 결제 정지 라이프사이클 완료
description: BILLING_ISSUE→GRACE→PAYMENT_SUSPENDED→RECOVERY 구현 완료 상태 및 핵심 결정
---

## 완료 상태 (FIX 포함 최종)
- main HEAD: 42104ef7
- Render LIVE: 42104ef7 ✅
- iOS OTA: 01a08867 (production-v2)
- 11TC (L~Q) PASS

## 핵심 아키텍처 결정

### 상태 전이
- BILLING_ISSUE(non-X) → subscription_status='grace', payment_failed_at=now() (is_readonly 미설정)
- BILLING_ISSUE(X) → handleXEntitlementEvent가 xmode_payment_failed_at=now() 설정 (기존, 변경 없음)
- EXPIRATION(non-X) → payment_failed_at 있으면: subscription_status='payment_suspended', payment_suspended_at=now(), is_readonly=true / 없으면: 기존 cancelled flow
- EXPIRATION(X) → xmode_payment_failed_at 있으면: subscription_status='payment_suspended', payment_suspended_at=now(), is_readonly=true 추가
- RENEWAL → subscriptionService.resetReadonly가 payment_suspended_at=NULL 포함 클리어
- X RENEWAL → x-entitlement.ts UPDATE에 payment_suspended_at=NULL 포함

### readonlyGuard 응답 코드
- payment_suspended → 402 POOL_SUBSCRIPTION_SUSPENDED (재결제로 복구 가능)
- is_readonly / payment_failed / pending_deletion / deleted → 403 READONLY_MODE (기존)

### 앱 진입 게이트
- ModeContext: payment_suspended/payment_grace boolean 필드 (GET /pools/x-mode 응답)
- Admin layout: payment_suspended → /(admin)/payment-suspended 리다이렉트
- Admin layout: payment_grace → 빨간 경고 배너 (관리자만)
- Teacher layout: payment_suspended → /(admin)/payment-suspended 리다이렉트
- Parent layout: payment_suspended → 인라인 PaymentSuspendedParent 컴포넌트

### payment-suspended 화면
- pool_admin/sub_admin: "구독 갱신하기" CTA → /(admin)/subscription
- teacher(리다이렉트): 관리자 문의 안내만
- 공통: 로그아웃 버튼, 데이터 보존/즉시복구 안내

### DB 컬럼
- swimming_pools.payment_suspended_at TIMESTAMPTZ (ADD COLUMN IF NOT EXISTS)
- index.ts에 마이그레이션 자동 실행 등록

### FIX: 만료 원인 무관 정책 (42104ef7)
- billing.ts CANCELLATION: pending_tier='free' 예약 제거 (EXPIRATION이 처리)
- billing.ts EXPIRATION(non-X): payment_failed_at 조건 제거 → 항상 PAYMENT_SUSPENDED / 데이터 삭제 예약 제거
- x-entitlement.ts SELECT: x_management_override, subscription_status, subscription_tier 추가
- x-entitlement.ts EXPIRATION: xmode_payment_failed_at 조건 제거 → 항상 PAYMENT_SUSPENDED
  - 예외: x_manual_entitlement=true OR x_management_override=true → 정지 스킵
  - 예외: subscription_status='active' AND tier≠'free' (X→SWIMNOTE 예약 다운그레이드) → 정지 스킵
- billing cron: pending_tier 다운그레이드 시 payment_suspended 풀 제외 가드
- admin layout: usePathname으로 /payment-suspended,/subscription 화면 redirect gate 제외

**Why:** RC 스토어 유예기간 동안 즉시 차단하면 안 됨; BILLING_ISSUE=GRACE(정상운영), EXPIRATION=PAYMENT_SUSPENDED(정지).
만료 원인(결제 실패 vs 정상 취소)과 무관하게 모든 유료 만료 → PAYMENT_SUSPENDED (데이터 삭제 금지).
