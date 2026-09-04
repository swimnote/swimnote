---
name: WP15.5-B 완료 상태
description: SuperAdmin Analytics Dashboard + APP_SESSION 최소 수집 구현 현황
---

# WP15.5-B — SuperAdmin Analytics Dashboard 완료

**SHA:** `fc864a12`  
**완료일:** 2026-08-13

## 변경 파일

| 파일 | 내용 |
|---|---|
| `artifacts/api-server/src/routes/super.ts` | GET /super/analytics-overview 엔드포인트 추가 (+134 lines) |
| `artifacts/api-server/src/routes/auth.ts` | parent-login 성공 시 APP_SESSION logEvent hook |
| `artifacts/api-server/src/routes/__tests__/wp15-5b-analytics.test.ts` | 10 TC (DB mock 방식) |
| `artifacts/swimnote-web/src/pages/super/AnalyticsDashboard.tsx` | 신규 — KPI 카드 + MAU 프록시 + 광고 슬롯 Skeleton |
| `artifacts/swimnote-web/src/pages/SuperAdmin.tsx` | "광고 개요" 탭 추가 |

## 핵심 구현

**GET /super/analytics-overview (super_admin 전용):**
- platform: total/approved/active/x_mode/basic/pending_pools, total/active students, total/active parents
- subscription: active/trial/expired breakdown
- mau_proxy: event_logs 로그인 category COUNT (from/to 기간 파라미터)
  - parent 세션: description LIKE '%학부모%'
  - teacher 세션: description NOT LIKE '%학부모%' AND NOT LIKE '%실패%'

**APP_SESSION hook (auth.ts):**
- parent-login 성공 시 logEvent category='로그인', metadata.event_type='APP_SESSION'
- teacher는 기존 181~207번 줄에 이미 logEvent 있음

**AnalyticsDashboard.tsx:**
- api.get() 패턴 (@/lib/api) — 기존 super/ 컴포넌트 패턴 동일
- 광고 슬롯: WP15.5-C 대기 Skeleton 표시
- DEFERRED_AD_SYSTEM 지표: opacity-40 + pointer-events-none

## 테스트

- 10 TC (A-J), DB mock 방식 (PORT 불필요)
- 전체 381/381 통과

## 배포

- Render deploy: GitHub push → 자동 배포 (fc864a12)
- OTA: 없음 (앱 코드 변경 없음)

## 다음 WP (WP15.5-C)

- Parent 홈 `PARENT_HOME_BANNER` 슬롯 렌더링
- 광고 Creative 관리 API (super_admin)
- AD_IMPRESSION / AD_CLICK 최소 이벤트 구현
- 앱 코드 변경 → OTA 필요
