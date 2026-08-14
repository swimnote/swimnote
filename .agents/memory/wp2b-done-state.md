---
name: WP2B + WP2B.2 완료 상태
description: Parent Curriculum Search WP2B (Monthly Quota + Conversation) + WP2B.2 (Feature Isolation + Idempotency Fix) 구현 완료 상태
---

## WP2B 완료 상태 (SHA 38efafab)
- Monthly quota: parent_account_id + calendar month (Asia/Seoul), 월 10회
- parent_curriculum_conversations + parent_curriculum_messages (Group 7 migration)
- GET history endpoint

## WP2B.2 완료 상태 (SHA 12597f11)
- **TC**: 17 TC PASS + 1059 전체 PASS (33 파일)
- **배포**: 미배포 (WP1+WP1.1 ENGINE 배포 선행 필요)

### Feature Isolation
- `CURRICULUM_SEARCH_FEATURE = 'parent_curriculum_search'` 상수
- `parent_ai_daily_usage`: feature TEXT NOT NULL DEFAULT 'parent_curriculum_search' 컬럼 추가
- UNIQUE 변경: `(parent_account_id, usage_date)` → `(parent_account_id, feature, usage_date)`
- `parent_ai_usage_reservations`: feature TEXT NOT NULL DEFAULT 'parent_curriculum_search' 컬럼 추가
- Group 4 CREATE TABLE 업데이트 (신규 환경용)
- Group 8 migration: ALTER TABLE additive (기존 환경용) — 서버 시작 시 자동

### FAILED Retry Fix
- INSERT ON CONFLICT DO NOTHING (잘못됨) → UPDATE SET status='RESERVED' WHERE status='FAILED' RETURNING
- 경쟁 상황: UPDATE 0 rows → quota increment rollback → ok:false
- 결과: 성공 시 reservation RESERVED → COMPLETED (finalizeQuotaSuccess 정상 작동)

### COMPLETED Retry Fix
- `getPriorReservationStatus()` 함수 추가 — route에서 quota reservation 이전에 COMPLETED 확인
- COMPLETED → ENGINE 재호출 금지, quota 차감 금지
- `getAssistantMessageByRequestId()` 함수 추가 — persisted ASSISTANT message 조회
- `AssistantMeta.result_payload` 추가 — answer/current_progress/next_step 저장
- saveAssistantMessage 시 result_payload 포함 → 이후 replay에서 완전한 응답 복원

### Route Flow (canonical order after WP2B.2)
```
auth → ownership → getPriorReservationStatus
IF COMPLETED → findConversation → getAssistantMessageByRequestId → replay → RETURN
ELSE → conversation upsert → tryReserveMonthlyQuota → pool/mode → scope → ENGINE → save
```

### Key Rules
- 10/10 한도 상태에서도 COMPLETED request_id는 replay 가능 (quota 체크 선행 없음)
- FAILED retry → saveUserMessage ON CONFLICT DO NOTHING (기존 USER message 재사용, 중복 없음)
- COMPLETED retry → saveUserMessage/saveAssistantMessage 호출 없음
- Production migration: Group 8이 initXModeSchema()에 포함됨 — Render 배포 시 자동 실행

## Why
- 기존 테이블에 feature 컬럼 없음 → 매월 1일 daily AI/curriculum search collision 가능성
- FAILED retry의 INSERT ON CONFLICT DO NOTHING이 FAILED row를 남겨 audit trail 불일치
- COMPLETED retry 시 ENGINE 재호출 + completed_count 이중 차감
