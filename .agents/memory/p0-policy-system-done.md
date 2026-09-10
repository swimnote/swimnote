---
name: P0 FINAL POLICY SYSTEM 완료 상태
description: PURCHASE_SUBSCRIPTION_REFUND v1.0 정책 시스템 전체 완료 상태 및 핵심 설계 결정
---

SHA main HEAD: 32bd8d35 (index.ts migration 연결)
iOS OTA: 01a08a6b (production-v2, runtime 2.1.0)
Render LIVE: 32bd8d35

**정책 키:** PURCHASE_SUBSCRIPTION_REFUND / version 1.0
**새 테이블:** purchase_policy_consents (audit history, UNIQUE 없음, 이벤트 이력 보존)
**정책 seed:** policy_versions INSERT ON CONFLICT DO NOTHING (멱등)

**서버 엔드포인트:**
- GET /admin/purchase-policy/consent — pool_admin, active 버전 + 동의 여부
- POST /admin/purchase-policy/consent — source(signup|trial|purchase) + platform + app_version 기록
- GET /super/purchase-policy/consent?pool_id=... — 슈퍼관리자 read-only + 이력 20건

**앱 동의 gate 흐름:**
1. 신규 pool_admin 가입: signup.tsx에서 AsyncStorage "swimnote:purchase_policy_gate"="1" 설정
2. SessionContext.computeLoginDest: 플래그 있으면 → purchase-policy-agreement.tsx (full-screen)
3. 기존 관리자 재로그인: 플래그 없음 → 게이트 없음
4. Trial 버튼: purchasePolicyConsent.agreed 없으면 PurchasePolicyModal(source=trial)
5. handleSwimnoteSubscribe/handleXPlanChange: 동의 없으면 PurchasePolicyModal(source=purchase)

**Why: 체크박스 기본 선택 금지 / 서버 저장 성공 후 진행 / 자동 동의 금지 (스펙 §0 절대 원칙)**

Teacher/Parent: 영향 없음
기존 refund-policy DB/동의 이력: 삭제 없음
Store billing entitlement ≠ policy consent (완전 분리)
