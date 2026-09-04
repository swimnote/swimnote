---
name: WP-CS-08R 완료 상태
description: Support AI Engine / LLM Last Fallback 구현 완료 기록
---

## 완료 항목

- SHA: 1e2026a6
- Branch: deploy-photo-clone → Render 자동 배포 트리거됨
- iOS OTA: production 01a00fb3-b5c7-7478-842c-89066c0bb394

## 구현 내용

### 신규 파일
- `src/lib/support-resolver.ts` — 공유 resolution chain
  - `runResolutionChain(ctx)`: 7-layer (RULE→DB_STATE→SOLUTION→FRONTEND_MAP→FAQ→KNOWN_ISSUE→NO_MATCH)
  - `gatherEvidence(ctx, maxK)`: LLM 프롬프트용 근거 자료 수집
  - `tokenize()`, `roleMatches()`, `modeMatches()`, `scoreText()` export

- `src/routes/support-respond.ts` — POST /support/respond
  - user msg → support_ticket_replies (author_role=user)
  - AI_PROCESSING 전환
  - runResolutionChain → deterministic: AI_RESPONDED, llm_used=false
  - NO_MATCH: gatherEvidence → evidence=[] → LOW+HUMAN_REQUIRED (no OpenAI)
  - NO_MATCH + evidence: OpenAI gpt-4o-mini → HIGH/MEDIUM→AI_RESPONDED, LOW→HUMAN_REQUIRED
  - saveAiTrace(feature=support_ai, sub_feature=SUPPORT_RESPONSE) — 양쪽 path 모두
  - logSupportEvent(AI_RESPONDED | HUMAN_REQUESTED)

### 수정 파일
- `src/routes/resolution-router.ts` — lib/support-resolver 임포트로 교체 (route wrapping만 유지)
- `src/routes/index.ts` — supportRespondRouter 등록
- `components/support/SupportChatScreen.tsx` — handleSend → POST /support/respond

### 테스트
- `src/routes/__tests__/cs-08r.test.ts` — 28 TCs 전체 통과
- 전체 suite: 1653/1653 통과

## 핵심 패턴

- **getOpenAI() mock**: `vi.mock("../ai.js")` 로 직접 mock; `vi.mock("openai")` 사용 시 OPENAI_API_KEY 체크로 throw됨
- **vi.hoisted**: `mockCreate`, `traceCalls`, `mockRunResolutionChain`, `mockGatherEvidence` 모두 vi.hoisted 사용
- **evidence=0 → no OpenAI**: 근거 없으면 OpenAI 호출 없이 LOW confidence + HUMAN_REQUIRED 즉시 반환
- **saveAiTrace**: deterministic path와 LLM path 양쪽 모두 호출 (generation_mode=deterministic|llm_grounded|no_evidence)

## 미배포
- Render 자동 빌드 진행 중 (push 트리거됨)
- Android OTA: 없음 (정책: 최종 검증 단계에서 누적)
