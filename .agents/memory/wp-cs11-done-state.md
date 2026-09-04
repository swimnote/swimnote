---
name: WP-CS11 완료 상태
description: Support Coverage Gap Classification — 75개 coverage record 전수 분류, gap-registry 생성
---

## WP-CS11: Support Coverage Gap Classification

**SHA:** 6ee1a0ce  
**완료일:** 2026-08-18

### 생성 파일
- `artifacts/api-server/src/config/support/support-gap.v1.ts` — 75개 GapRecord 레지스트리
- `artifacts/api-server/src/routes/__tests__/gap-registry.test.ts` — GAP-01~GAP-15, 61TC

### 분류 결과
| Readiness | Count |
|---|---|
| COVERED_ACTIVE | 7 |
| COVERED_PENDING | 1 |
| PARTIAL | 46 |
| MISSING | 21 |

### 핵심 통계
- TOTAL_GAP_RECORDS: 75
- P0_MISSING_COUNT: 10
- FM_EXACT_COVERED_COUNT: 43
- NEEDS_FM_UPDATE_COUNT: 18
- NEEDS_FAQ_CANDIDATE_COUNT: 53
- NEEDS_SOLUTION_CANDIDATE_COUNT: 29
- NEEDS_KNOWN_ISSUE_CANDIDATE_COUNT: 4
- DB_STATE_PRIMARY_ACTIVE_COUNT: 3 (BILLING_SUBSCRIPTION_STATUS, BILLING_CANCELLED_BUT_ACTIVE, X_ACTIVATION_CHECK)
- ACTIVE_INCIDENTS: 0

### 설계 원칙
- COVERED_ACTIVE: active_sources 비어있지 않고 gap_reasons = []
- COVERED_PENDING: pending_sources 있고 active_sources = []
- PARTIAL: WHERE_IS(FM) 또는 STATE_CHECK(DB_STATE) 보조 카테고리만 커버, primary intent MISSING
- MISSING: 어떤 ACTIVE 소스도 없음

### 테스트 결과
- 2104/2104 전체 통과 (gap-registry.test.ts 61TC 추가)

### 배포/OTA
- Render 재배포: 없음 (audit only)
- OTA: 없음

### 주의사항
- COVERED_ACTIVE 레코드의 gap_reasons는 반드시 [] 이어야 함
- DB_STATE_PRIMARY_ACTIVE_COUNT: 처음 2로 기록했으나 X_ACTIVATION_CHECK(ki_x_mode_intro + DB_STATE:x_mode)가 3번째로 추가됨
- FM_EXACT_COVERED_COUNT: 분류 후 실제 계산값(43)이 초기 추정(39)보다 많았음 — 통계는 항상 registry에서 재계산 확인 필수
