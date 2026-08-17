---
name: WP-CS-01R 완료 상태
description: Support Core Reconciliation — state machine + conversation/message/ticket/event 모델 구현 완료
---

## 완료 상태
- **SHA**: a8282583
- **Branch**: deploy-photo-clone → Render 자동 배포 트리거됨
- **TC**: 67 신규 (CS01R-01~CS01R-21) | 전체 1372/1372 통과

## 구현 파일

| 파일 | 변경 |
|------|------|
| `lib/ai-feature-enum.ts` | WAITING/REOPENED/PHONE_REQUIRED 추가; MASTER_SUPPORT_STATE(7개); SUPPORT_EVENT_TYPE |
| `lib/support-case-service.ts` | **신규**: VALID_TRANSITIONS, getMasterState(), transitionSupportCase(), logSupportEvent(), messageThreadId(), ensureCs01rSchema() |
| `routes/support-cases.ts` | **신규**: POST /support/cases, GET /:id, POST /:id/messages, POST /:id/request-human, POST /:id/reopen |
| `routes/cs-pa0.ts` | GET /super/support/cases/:id, POST /super/support/cases/:id/transition 추가 |
| `routes/index.ts` | supportCasesRouter 등록 |
| `routes/__tests__/cs-01r.test.ts` | **신규**: 67 TC |

## 핵심 설계 결정

### DB 분리 전략
- `support_cases` → superAdminDb (Supabase) — TEXT state (CHECK 제약 없음)
- `support_tickets` + `support_ticket_replies` → db (pool DB)
- AI-only case: `ticket_id = null`, 메시지는 support_ticket_replies에서 `ticket_id = case_id` (soft ref)
- `messageThreadId(caseId, ticketId)` 헬퍼로 thread key 통일

### State Machine
VALID_TRANSITIONS 12개 상태, terminal = CLOSED (outgoing 없음).  
PHONE_REQUIRED: HUMAN_REQUIRED/ESCALATED에서만 전환 가능.

### MASTER state 매핑 (getMasterState)
- ESCALATED + (BILLING_REQUIRED|REFUND_REQUIRED|SAFETY_OR_PRIVACY) → PHONE_REQUIRED
- 나머지 ESCALATED → AGENT_ACTIVE
- CLOSED → RESOLVED (내부 terminal, 외부 표시는 RESOLVED)

### Schema 확장 (ensureCs01rSchema, idempotent)
- support_cases: `waiting_for TEXT`, `context_json JSONB`, `actor_id TEXT` (superAdminDb)
- support_ticket_replies: `message_type TEXT` (pool db)

### 보안
- Pool isolation: `sc.pool_id !== user.poolId` → 403
- Role isolation: `sc.actor_id !== user.userId` → 403 (super_admin 제외)
- ai/agent 메시지 작성: super_admin만
- event_logs(SUPPORT): PII 없음 (case_id/ticket_id/role/state/event_type만)

## HARDEN 완료 (WP-CS-01R-HARDEN, SHA 별도)

### 핵심 수정
- `support_ticket_replies.ticket_id` → nullable (DROP NOT NULL)
- `support_ticket_replies.case_id TEXT` 컬럼 추가 — case 기준 스레드 식별자
- AI-only 메시지: `ticket_id=null, case_id=caseId`
- 에스컬레이션 메시지: `ticket_id=ticketId, case_id=caseId` (둘 다 설정)
- GET 케이스 상세 쿼리: `WHERE case_id=caseId OR (ticket_id=ticketId AND case_id IS NULL)`
- `messageThreadId()` deprecated (하위호환 유지, 신규 코드 사용 금지)
- Super transition → `transitionSupportCase()` 서비스 통과 확인 (force override 없음)
- HARDEN 23 TC 추가 | 전체 1395/1395

### FINAL REPORT
- CASE_ID_STORED_IN_TICKET_ID_AFTER = NO
- THREAD_CONTINUITY = PASS
- LEGACY_TICKET_COMPATIBILITY = PASS
- SUPER_TRANSITION_USES_SERVICE = YES
- INVALID_TRANSITION_BLOCKED = YES
- DIRECT_STATE_UPDATE_EXISTS = NO
- FORCE_OVERRIDE_EXISTS = NO
- RAW_TEXT_IN_EVENT_LOG = NO
- MOBILE_CHANGED = NO

## 다음 WP 후보
- **CS-PE1**: Partner Evidence 차트 3개 + CSV export + Measurement Start Date (deferred)
- **PARTNER_REPORTING_MAP**: 내부 feature enum → Partner reporting enum 매핑
- **WP-SA0-B**: Super Admin 운영 데이터 연결 (PROPOSED 상태)
