---
name: WP2B 완료 상태
description: Parent Curriculum Search WP2B (Monthly Quota + Conversation/Message Persistence) 구현 완료 상태
---

## WP2B 완료 상태

**SHA**: 38efafab
**TC**: 26 TC PASS + 1042 전체 PASS
**배포**: 미배포 (WP1+WP1.1 ENGINE 배포 선행 필요)

## 구현 내용

### Quota (기존 테이블 재사용)
- `parent_ai_daily_usage.usage_date` = 해당 월 첫날 (YYYY-MM-01) — monthly period key
- 월 10회 제한 (parent_account_id + calendar month Asia/Seoul)
- 원자성: `UPDATE ... WHERE (completed + reserved) < 10 RETURNING ...` — 0 rows = limit reached
- 아이디팟: request_id PK가 중복 예약 차단
- 실패(ENGINE/validation) 시 rollback: reserved_count -1, failed_count +1

### 신규 파일
- `lib/parent-curriculum-quota.ts` — tryReserveMonthlyQuota / finalizeQuotaSuccess / rollbackQuotaReservation / getMonthlyUsageInfo
- `lib/parent-curriculum-conversation.ts` — getOrCreateConversation / saveUserMessage / saveAssistantMessage / getConversationMessages

### 신규 Migration (Group 7, initXModeSchema)
- `parent_curriculum_conversations` (id, parent_account_id, student_id, swimming_pool_id, UNIQUE(parent_account_id, student_id))
- `parent_curriculum_messages` (id, conversation_id, request_id, role, content, metadata JSONB, UNIQUE(request_id, role))

### Route 변경
- POST: quota 예약 → ENGINE → 성공 시 finalize + ASSISTANT message / 실패 시 rollback
- GET `/parent/students/:studentId/curriculum-search/history` — quota 차감 없음

### Response 변경 (additive)
```json
{ "request_id": "...", "result": {...}, "meta": {...}, "usage": { "limit": 10, "used": 4, "remaining": 6, "period": "2026-08", "resets_at": "..." } }
```

## Why
- 단발 검색 → GPT-like 채팅 상담 구조로 전환
- 월 10회 제한으로 서버 비용 통제
