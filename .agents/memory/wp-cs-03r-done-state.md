---
name: WP-CS-03R 완료 상태
description: Super Admin Support Inbox / Human Message E2E — 완료 기록
---

# WP-CS-03R 완료

**SHA**: c636c253  
**완료일**: 2026-08-17

## 구현 내용

### 서버 (api-server)
- `super-support.ts` 신규 — 7개 엔드포인트
  - `GET /super/support/cases` — 케이스 목록 (status_group/role/mode/pool_id 필터)
  - `GET /super/support/stats` — badge 카운트 (agent_requested/agent_active/total_open)
  - `GET /super/support/cases/:id` — 케이스 상세 + messages + pool_name
  - `POST /super/support/cases/:id/agent-reply` — 상담사 답변 (author_role='agent')
  - `POST /super/support/cases/:id/resolve` — RESOLVED 전환
  - `POST /super/support/cases/:id/phone-required` — PHONE_REQUIRED 전환 (reason 필수)
  - `POST /super/support/cases/:id/reopen` — REOPENED 전환
- `index.ts` — superSupportRouter 등록

### 웹 (swimnote-web)
- `SuperSupport.tsx` 전체 재작성
  - 탭 구조 (상담 | future tabs 비활성)
  - 케이스 목록 (300px) + 3컬럼 상세
  - LEFT: 대화 이력 (user/ai/agent/system 스타일 구분)
  - CENTER: Resolution Assistant (준비중 placeholder)
  - RIGHT: User Context (수영장/역할/모드/앱버전 등)
  - 답변 전송 + 해결 완료 + 전화 필요 + 재오픈 액션
  - 상담사 요청 badge, 대기시간 표시

## 테스트
- `cs-03r.test.ts` — 43TC 전체 통과
- 전체 회귀: 1483/1483

## 상태 전환 규칙
- agent-reply → HUMAN_REQUIRED이면 자동으로 HUMAN_RESPONDED 전환
- agent-reply → 그 외 상태이면 state 유지 (추가 답변)
- resolve → RESOLVED (human path) 또는 AI_RESOLVED (AI-only)
- phone-required → reason: billing/refund/privacy_safety/complex_case/other 필수

## 배포
- Render: `c636c253` push → 자동 빌드 트리거됨
- iOS OTA: NO (앱 변경 없음)
- Android OTA: NO

## 보안
- 모든 /super/support/* 엔드포인트 `requireRole("super_admin")` 적용
- event_logs에 raw 메시지 본문 저장 없음 (privacy 준수)
- VALID_TRANSITIONS 기반 state machine 우회 금지
