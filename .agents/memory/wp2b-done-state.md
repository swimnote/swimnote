---
name: WP2B + WP2B.2 + WP2B.3 완료 상태
description: Parent Curriculum Search WP2B/WP2B.2/WP2B.3 구현 완료 상태
---

## WP2B 완료 상태 (SHA 38efafab)
- Monthly quota: parent_account_id + feature + calendar month (Asia/Seoul), 월 10회
- parent_curriculum_conversations + parent_curriculum_messages (Group 7 migration)
- GET history endpoint

## WP2B.2 완료 상태 (SHA 12597f11)
- CURRICULUM_SEARCH_FEATURE = 'parent_curriculum_search' 상수
- parent_ai_daily_usage: feature column + UNIQUE(parent_account_id, feature, usage_date)
- parent_ai_usage_reservations: feature column
- Group 8 migration: ALTER TABLE additive (기존 환경용) — initXModeSchema() 내 자동 실행
- getPriorReservationStatus(): COMPLETED 체크 → quota reservation 이전 실행
- FAILED retry: UPDATE WHERE status='FAILED' atomic + 경쟁 시 rollback
- COMPLETED retry: persisted result replay (ENGINE 재호출 금지, quota 차감 금지)
- AssistantMeta.result_payload: answer/current_progress/next_step 저장 및 replay 지원

## WP2B.3 완료 상태 (SHA 290a1fda)
- **TC**: 12 TC PASS + 1071 전체 PASS (34 파일)
- **배포**: 미배포 (WP1+WP1.1 ENGINE 배포 선행 필요)

### 핵심 변경
- `finalizeCurriculumSearchSuccess()` 신규 함수 (parent-curriculum-quota.ts)
  - drizzle `.transaction()` 사용 (단일 DB connection 보장)
  - 원자적 실행: ① ASSISTANT INSERT → ② reservation COMPLETED → ③ usage counters
  - 실패 시: drizzle 자동 rollback → reservation RESERVED 유지 → retry 가능
- Route step 14: `finalizeQuotaSuccess().catch()` + `saveAssistantMessage().catch()` 제거
  → `finalizeCurriculumSearchSuccess()` try/catch로 대체
  → 실패 시 502 FINALIZATION_FAILED retryable:true 반환

### 보장 (invariant)
- **COMPLETED + no persisted result 상태 불가능** (transaction rollback 보장)
- finalization 실패 → 200 반환 금지 (이전: `.catch()` 패턴이 에러 삼켜서 200 반환)
- 동일 request_id ASSISTANT INSERT: ON CONFLICT DO NOTHING (멱등)
- COMPLETED replay 경로: finalizeCurriculumSearchSuccess 미호출 (quota 차감 금지)

### 기존 Rollback 정책 유지
- ENGINE 실패/timeout/validation fail → rollbackQuotaReservation (reservation FAILED)
- finalization 실패 → reservation RESERVED 유지 (별도 rollback 불필요, tx auto-rollback)

### Route Import 변경
- 제거: `finalizeQuotaSuccess` (route 미사용, lib에는 유지)
- 제거: `saveAssistantMessage` (route 미사용, finalizeCurriculumSearchSuccess 내부 처리)
- 추가: `finalizeCurriculumSearchSuccess`

### Production Claim 정정
- "Production row = 0" 표현: 코드 grep + Production DB 미배포 확인 기반 추론.
  실제 Production SELECT 아님. Production 데이터는 별도 확인 필요.

## Production 배포 선행 조건
WP1+WP1.1 ENGINE 배포 완료 후 Render.com 재배포 필요.
Group 8 migration은 서버 시작 시 자동 실행 (initXModeSchema() 포함).
