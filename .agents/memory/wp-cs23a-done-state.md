---
name: WP-CS23A Done State
description: Direct DB Answer Engine & Human Escalation Completion — CS23A implementation status
---

## WP-CS23A 완료 상태

**SHA**: 12cb55e4
**Branch**: deploy-photo-clone
**TC**: 3035/3035 passing (+40 new)
**Render**: 배포 트리거 (GitHub push → 자동빌드)
**OTA**: 없음 (SupportChatScreen 앱 변경 있으나 OTA 별도 지시 시 배포)

## 구현 요약

### 신규 파일
- `support-direct-answer.ts`: matchDirectAnswer Layer 0 (exact/fuzzy 2-step)
- `pool-db-cs-23a.ts`: intent_id/answer_mode columns + support_intent_utterances table
- `cs23a.test.ts`: 40TC (§A~§N)

### 수정 파일
- `support-resolver.ts`: runChain Layer 0에 matchDirectAnswer 삽입 + source_type에 "DIRECT_DB" 추가
- `support-cases.ts`: agent-reply endpoint 신규 + request-human → sendPushToSuperAdmins + agent-reply → sendPushToUser
- `support-respond.ts`: 자기참조 fallback 텍스트 제거 (CIRCULAR_SUPPORT_FALLBACK=0)
- `SupportChatScreen.tsx`: "아직 안돼요" → "직접 문의하기" (직접 request-human 호출)

## 핵심 설계 결정

**Layer 0 삽입 위치**: runChain 내부 (support-resolver.ts)
- Why: RouterContext 이미 서버 권위적; support-respond.ts 무수정; trace 패턴 재사용

**pg_trgm**: Production Supabase 미지원 → exact match + JS-side token-overlap fuzzy scoring
- fuzzy 조건: bi-directional token overlap ≥ 70%, confidence ≥ 65

**HUMAN_ONLY answer_mode**: GPT 없이 CTA 문구 반환 (requires_human=true, llm_required=false)
- 자기참조 금지: "고객지원으로 문의" 아닌 "담당자 확인이 필요합니다. [직접 문의하기] 버튼"

**agent-reply 엔드포인트**: POST /support/cases/:id/agent-reply (슈퍼어드민 전용)
- 답변 후 actor에게 sendPushToUser → AGENT_REPLY_WITHOUT_USER_NOTIFICATION=0

## Production DB 상태

**2026-08-19 적용**:
- support_knowledge_items: intent_id TEXT, answer_mode TEXT CHECK(...) 추가
- support_intent_utterances: 신규 테이블 (rows=0 — fixtures는 서버 기동 시 runCs23aMigration으로 삽입)
- idx_ski_intent_id, idx_siu_normalized_utterance, idx_siu_intent_id, idx_siu_knowledge_id

## 메트릭 (테스트 검증)
- WRONG_DIRECT_MATCH = 0
- AMBIGUOUS_DIRECT_MATCH = 0
- DIRECT_ROLE_LEAKAGE = 0
- DIRECT_MODE_LEAKAGE = 0
- DIRECT_POOL_LEAKAGE = 0
- DIRECT_DB_LLM_CALLS = 0
- CIRCULAR_SUPPORT_FALLBACK = 0
- EXISTING_ACTIVE_CHANGED = 0
- RUNTIME_IMPORT_ERROR = 0

## 미완료 (향후 WP)

- iOS OTA: SupportChatScreen "직접 문의하기" UI 변경 — 별도 지시 시 배포
- Production 실 utterance 등록: TEST_ 접두어 fixture만 존재; 실제 운영 utterance는 별도 등록 필요
- WP-CS23B (향후): GROUNDED_GPT answer_mode — 기존 GPT chain 통해 처리됨 (현재 지원)
