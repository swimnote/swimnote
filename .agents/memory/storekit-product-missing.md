---
name: StoreKit 신규 상품 NOT FOUND 조사 결과
description: com.swimnote.*.monthly 신규 product IDs가 StoreKit에서 반환되지 않아 구독 화면에 표시 안 되는 원인 조사 완료 상태
---

## 확정 상태 (2026-09-18)

### 정상 확인 항목
- APP CODE: 정상 (subscription.tsx purchase flow, offering mapping, product identifiers)
- REVENUECAT CONFIG: 정상 (swimnote_monthly, x_monthly, data_monthly offering/package/product 모두 연결)
- PRODUCTION RC KEY: 정상 (IOS_API_KEY hash 16ab48a7f7e66e8a, 모든 출처 일치)
- RC project: 동일 (REST 조사 = runtime, SAME project)

### 문제 항목
- STOREKIT: com.swimnote.swimnote.monthly, com.swimnote.x300/x500/x1000.monthly, com.swimnote.data100/300.monthly → NOT FOUND
- 결과: swimnote_monthly / x_monthly / data_monthly offering이 device runtime에서 completely removed

### Root Cause
App Store Connect에서 com.swimnote.*.monthly 형식 신규 product ID들이 StoreKit 가용 상태 아님.
legacy product IDs (solo_30, center_200 등 단순 문자열)는 ASC에 정상 존재 → solo_monthly/center_monthly는 정상 노출.

### 진단 도구
- subscription.tsx 하단 "구독 상품 진단" 버튼 (OTA 01a0b3de 적용됨) — ASC 정상화 확인 후 별도 지시로 제거

### 성공 기준 (ASC 정상화 후)
진단 버튼 결과:
- Offerings에 swimnote_monthly, x_monthly 출현
- Direct getProducts: SWIMNOTE = FOUND, X300 = FOUND
- subscription.tsx SWIMNOTE 버튼 "구독 신청 준비 중" → "구독 시작" 자동 전환

### 보류 항목
- TEST_API_KEY 불일치: Replit/.env `test_` key (c24...) ≠ eas.json `appl_` key (16ab...) — production 무관, 향후 dev 환경 정리 시 처리
- X300/X500/X1000 버튼 UX 불일치 (항상 Pressable로 렌더) — StoreKit 정상화 후 별도 WP

**Why:** 신규 구독 상품은 RC에 먼저 등록해도 ASC product 승인 전까지 StoreKit이 반환하지 않아 RC SDK가 offering 전체를 runtime에서 제거함. legacy 단순ID는 이미 승인됨.

**How to apply:** 신규 product ID 추가 시 ASC 생성→가격설정→심사제출→승인까지 완료해야 device에서 offering이 노출됨.
