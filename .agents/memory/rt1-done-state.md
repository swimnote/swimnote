---
name: RT1 완료 상태
description: AI Data Runtime RT1 기반 파일 + 테스트 완료 상태
---

SHA 5ca35ced; lib/runtime/ 8파일 신규; 37TC; Production behavior 변경 없음; Render/OTA 없음

## 신규 파일
- lib/runtime/request-context.ts   — RequestContext + buildRequestContext() + normalizeQueryBase()
- lib/runtime/retrieval-result.ts  — RetrievalResult/RetrievalMatch 타입 + buildRetrievalResult() + isMatchTenantCompatible()
- lib/runtime/evidence-pack.ts     — EvidencePack + buildEvidencePack() + cross-tenant guard (fail closed)
- lib/runtime/answer-policy.ts     — AnswerPolicyDecision 4 states + POLICY_RESULTS + baselinePolicy()
- lib/runtime/ai-gateway.ts        — 공통 OpenAI singleton + timeout/retry/structured output + callGateway()
- lib/runtime/diagnostics.ts       — RuntimeDiagnostics + buildDiagnostics() + assertNoPiiInDiagnostics()
- lib/runtime/runtime-errors.ts    — RuntimeError + GatewayTimeout/RateLimit/Upstream/Invalid/CrossTenant 등
- lib/runtime/__tests__/rt1.test.ts — 37 TC 전체 통과

## 핵심 계약 확정
- AnswerPolicyDecision: DB_DIRECT / GROUNDED_AI / HUMAN_REQUIRED / INSUFFICIENT_EVIDENCE
- RetrievalSourceType: +PROFESSIONAL_KNOWLEDGE +STUDENT_EVIDENCE (GR용 선점)
- retry_attempts = 총 시도 횟수 (1 = 재시도 없음)
- retryable: 429/503/504/timeout only
- EvidencePack cross-tenant guard: match.tenant_id ≠ context.tenant_id → CrossTenantEvidenceError (global 예외)
- diagnostics raw_query/input_text/prompt 저장 금지 (assertNoPiiInDiagnostics guard)
- saveAiTrace → event_logs.metadata JSONB 재사용 (migration 없음)

## 다음 단계
- RT2: SupportRetriever (조사분리 tokenizer + concept synonym + KI text ILIKE fallback)
- RT3: CurriculumRetriever (query keyword pre-filter → top-K + order context)
