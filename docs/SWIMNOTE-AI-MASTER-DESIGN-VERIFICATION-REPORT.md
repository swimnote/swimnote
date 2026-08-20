# [SWIMNOTE AI MASTER DESIGN VERIFICATION REPORT]

작성일: 2026-08-21  
Branch: `deploy-photo-clone` / HEAD: `cfe4fe86`  
작업 범위: 읽기/확인/의견 정리만. 코드 수정 없음.

---

## 1. Design Verdict

**PASS with 4 GAPs**

설계도 전체는 현재 repository 구조와 충돌하지 않는다.  
단 아래 4개 Gap은 WP-AI-01 구현 전에 명확히 처리해야 한다.  
어느 것도 헌법 수정을 요구하지 않는다.

| GAP | 항목 | 현황 | WP |
|-----|------|------|-----|
| G1 | trigger_type 전체 누락 | AiTraceContext에 필드 없음 | AI01-01 |
| G2 | 모델명 route별 하드코딩 | 공통 model config 없음 | AI01-03 |
| G3 | request_id 외부엔진 미전파 | APP→Engine 경계에서 단절 | AI01-04 |
| G4 | retry_count 미기록 | saveAiTrace에 필드 없음 | AI01-01 |

---

## 2. Existing Reusable Infrastructure

### A. Usage Event (Section 28A)

**CONFIRMED: event_logs JSONB로 전체 contract 구현 가능. 신규 테이블 불필요.**

현재 `ai-trace-service.ts` `buildTraceMetadata()`가 event_logs.metadata에 저장하는 필드:

| Contract 필드 | 현재 저장 여부 | 비고 |
|-------------|------------|------|
| provider | ✅ JSONB metadata.provider | 'openai' |
| service | ✅ metadata.generation_mode / error_stage | 간접 |
| model_or_api | ✅ metadata.model | |
| feature | ✅ event_logs.actor_type 또는 AI_FEATURE enum | |
| **trigger_type** | ❌ 없음 | G1 — 추가 필요 |
| pool_id | ✅ event_logs.pool_id column | |
| request_id | ✅ event_logs.request_id column | |
| timestamp | ✅ event_logs.created_at | |
| input_tokens | ✅ metadata.input_tokens | |
| **cached_input_tokens** | ⚠️ metadata.cached_tokens (이름 불일치) | AI01-03에서 통일 |
| output_tokens | ✅ metadata.output_tokens | |
| audio_seconds | ❌ 없음 | Whisper용, AI01-02에서 추가 |
| request_count | ❌ 명시 없음 | JSONB 추가 가능 |
| units | ❌ 없음 | SMS/R2용, AI01-05/06 |
| estimated_cost_usd | ✅ metadata.cost (있을 때) | |
| **cost_source** | ❌ 없음 | G1 — 추가 필요 |
| latency_ms | ✅ metadata.latency_ms | support-cases line 659 버그 제외 |
| **retry_count** | ❌ 없음 | G4 — 추가 필요 |
| success | ✅ AiTraceSuccess / AiTraceFailed 분기 | |
| error_type | ✅ metadata.error_code | |

### B. Cost Controls (Section 28B)

**CONFIRMED: feature_flags 테이블 (global + pool override) 이미 존재.**

| Control 종류 | 현재 가능 여부 | 방법 |
|------------|------------|------|
| Feature disable | ✅ POSSIBLE | feature_flags.global_enabled = false |
| Pool-specific override | ✅ POSSIBLE | feature_flag_overrides 테이블 |
| Provider/model switch | ⚠️ PARTIAL | 모델명 각 route 하드코딩 (G2) |
| Worker pause | ⚠️ PARTIAL | GROWTH_REPORT_ENGINE_URL 공백으로 disable 가능. cron 자체 pause 없음 |
| Batch size | ✅ env `GROWTH_REPORT_MAX_RETRY_COUNT` 존재. BATCH_LIMIT=10 hardcoded |
| Quota | ✅ monthly_quota 테이블 존재 (curriculum/support용) |
| Emergency kill | ✅ feature_flag global_enabled=false로 즉시 disable |

### C. Request Tracking (Section 28C)

**CONFIRMED: APP→API 경계는 동작. API→Engine 경계는 PARTIAL.**

| 구간 | request_id 전파 | 비고 |
|------|---------------|------|
| Mobile → API Server | ✅ externalRequestId + internalId 쌍 | ai.ts E1 Contract |
| API Server → event_logs | ✅ request_id column | |
| API Server → Growth Engine | ❌ 미전파 | engine client가 request_id 파라미터 없음 |
| API Server → Curriculum Engine | ❌ 미전파 | INFERRED from client signature |
| Growth Engine → provider | ❌ 불명 | engine 내부 구조 미확인 |

**설계 목표인 end-to-end request_id 추적을 위해서는 외부 engine client에 request_id 파라미터 추가 필요 (AI01-04).**

### D. Retry 구조 (Section 28D)

**CONFIRMED: Growth Engine에 retry 정책 존재. 그러나 retry_count 비기록.**

| Route / Client | Retry 구조 | retry_count 기록 |
|---------------|-----------|----------------|
| ai.ts (direct OpenAI) | ❌ 없음 (AbortController timeout만) | ❌ |
| ai-v1.ts (direct OpenAI) | ❌ 없음 | ❌ |
| support-respond.ts (direct OpenAI) | ❌ 없음 | ❌ |
| growth-report-engine-client.ts | ✅ RETRYABLE/NON_RETRYABLE 분류, analysis_retry_count DB 저장 | ❌ saveAiTrace에 없음 |
| parent-curriculum-engine-client.ts | ✅ retryable 플래그 존재, 실제 retry는 route에서 | ❌ |

**logical request (1건) vs actual API calls (1+retry) 구분은 현재 불가.**  
`saveAiTrace`에 `retry_count` 추가하면 Dashboard에서 보이게 됨.

### E. Model Routing (Section 28E)

**CONFIRMED: 현재 모든 route에 model명 하드코딩.**

| 파일 | 모델 | 형태 |
|------|------|------|
| `ai.ts` | `'gpt-4o-mini'`, `'whisper-1'` | string literal (여러 곳) |
| `ai-v1.ts` | `'gpt-4o-mini'` | string literal (6곳) |
| `support-respond.ts` | `LLM_MODEL = "gpt-4o-mini"` | 파일 상단 const → **유일하게 나은 패턴** |
| `story.ts` | `'gpt-4o-mini'` | string literal (3곳) |

**단기 수정**: `ai-pricing.ts` 옆에 `ai-model-config.ts` 생성 (model명 상수만), 각 route에서 import.  
대규모 리팩터링 없이 model 교체 시 한 파일만 수정 가능하게.

### F. Bottleneck Applicability (Section 28F)

| Feature | 현재 병목 | 설계 적용 가능 여부 |
|---------|---------|----------------|
| Support | regex/facet 한계 → 헌법 §9 구조로 대체 예정 | ✅ PHASE 2 |
| Curriculum | 외부 engine (내부 구조 미확인) | ✅ API adapter로 연결 |
| AI Diary | template only, Professional Knowledge 미연결 | ✅ PHASE 5에서 engine 연결 |
| Growth Report | 외부 engine, background worker | ✅ PHASE 6에서 완성 |
| Professional Retrieval | 별도 AI Engine DB (20k) | ✅ PHASE 3 audit |

---

## 3. Architecture Agreement

현재 실제 구조와 Master Blueprint 설계도 일치 여부:

| Blueprint 항목 | 현재 구조 | 판정 |
|-------------|---------|------|
| APP = Auth/Permission/Pool | requireAuth + JWT poolId 검증 | ✅ MATCH |
| APP = Usage Logging | saveAiTrace → event_logs | ✅ MATCH (불완전) |
| Professional Engine = Knowledge/Retrieval | Growth/Curriculum 외부 engine | ✅ MATCH |
| 기존 engine 기능 APP에서 복제 금지 | 복제 없음 | ✅ MATCH |
| Fallback 추적 (fallback_used, pipeline_mode) | generation_mode 기록 중 | ✅ PARTIAL |
| AI output ≠ Source of Truth | server-side validator 존재 | ✅ MATCH |
| Dashboard = local SQL (외부 API 호출 없음) | CONFIRMED: 미구현이나 설계 충돌 없음 | ✅ MATCH |
| best-effort telemetry | void saveAiTrace().catch() | ✅ MATCH |
| PII 저장 금지 | message 본문 저장 금지 명시됨 | ✅ MATCH |

---

## 4. Risks (코드에서 확인된 것만)

| Risk | 심각도 | 현황 |
|------|--------|------|
| Growth Worker cron 하드코딩 (*/5 * * * *) | MEDIUM | pause 기능 없음. feature_flag disable로 우회 가능 |
| 모델명 각 route 하드코딩 | LOW | 모델 교체 시 다수 파일 수정 필요 |
| Whisper 비용 전혀 미기록 | HIGH | 유료 호출이 event_logs에 없음 |
| support-cases.ts latency_ms=0 버그 | MEDIUM | 기록 데이터 신뢰 훼손 |
| cached_tokens vs cached_input_tokens 필드명 불일치 | LOW | 집계 시 혼용 위험 |
| request_id 외부 engine 미전파 | MEDIUM | logical request 추적 불가 |
| retry_count 미기록 | MEDIUM | retry 비용 폭증 감지 불가 |
