---
name: WP1.2 완료 상태
description: Parent Curriculum Search ENGINE — Recent Conversation Context Support 구현 완료
---

## WP1.2: Recent Conversation Context Support

**SHA**: 47831611  
**TC**: 1071 → 1094 (+23: 12 unit + 11 route)  
**상태**: IMPLEMENTED / 미배포 (WP1+WP1.1 Render 배포 선행 필요)

### 변경 파일
- `parent-curriculum-engine-client.ts`: `PcRecentMessage` 타입, `recent_conversation?` in context, `conversation_context_used?` in meta
- `parent-curriculum-conversation.ts`: `buildRecentConversationContext(conversationId, excludeRequestId, maxMessages?)` 추가
- `parent-curriculum.ts`: step 11 context fetch → ENGINE request 포함 → response meta `conversation_context_used`

### 핵심 구현 원칙
- `recent_conversation` 최대 6 messages (RECENT_CONTEXT_MAX_MESSAGES=6)
- 현재 query (`excludeRequestId`) 제외
- DB: `ORDER BY created_at DESC LIMIT 6` → app-level `.reverse()` → oldest→newest
- 유효 role: USER/ASSISTANT만 허용 (SYSTEM 등 차단)
- 빈 content (trim 후 empty) 차단
- content 최대 500자 truncation (RECENT_CONTEXT_MAX_CONTENT_CHARS=500)
- `conversation_context_used`: ENGINE meta 값 우선, fallback = `recentConversation.length > 0`
- fetch 실패 시 `[]` 폴백 → 기존 WP1 동작 유지 (502 없음)
- COMPLETED replay 경로: `buildRecentConversationContext` 미호출

**Why:** 후속 질문("그 다음은?", "왜 그래요?") 해석을 ENGINE이 할 수 있도록 이전 3 turn 전달.  
recent_conversation은 질문 이해 보조용 — Grounding source 승격 금지.

### 테스트 파일
- `parent-curriculum-wp1-2.test.ts` — 11 TC (route-level: A,B,C,D,H,I,J,K)
- `parent-curriculum-wp1-2-context.test.ts` — 12 TC (unit: E,F,G + 상수/순서/trim)
