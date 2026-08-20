# [SWIMNOTE AI PRE-IMPLEMENTATION ALIGNMENT REPORT]

작성일: 2026-08-21  
Branch: `deploy-photo-clone`  
HEAD: `cfe4fe86`  
작업 범위: 읽기/확인/의견 정리만. 코드 수정 없음.

---

## 1. Constitution Agreement

| Section | 제목 | 판정 |
|---------|------|------|
| 1-1 | 작업 순서 | **AGREE** |
| 1-2 | 각 WP 작업 방식 | **AGREE** |
| 1-3 | 작업 범위 확대 금지 | **AGREE** |
| 1-4 | Replit 크레딧 절약 | **AGREE** |
| 2 | AI 사용 철학 LOCK | **AGREE** |
| 3 | Verified Data First 원칙 | **AGREE** |
| 4 | GPT Nano 역할 LOCK | **AGREE** |
| 5 | AI가 사실을 창작하면 안 됨 | **AGREE** |
| 6 | Deterministic Authority LOCK | **AGREE** |
| 7 | 앱과 AI Engine 역할 분리 | **AGREE WITH NOTE** (아래 §9 충돌 참조) |
| 8 | AI Engine을 앱에서 다시 만들지 않음 | **AGREE** |
| 9 | Support 최종 Architecture | **AGREE** |
| 10 | Professional Retrieval LOCK | **AGREE** |
| 11 | Parent Curriculum 목표 Architecture | **AGREE** |
| 12 | AI Diary 목표 Architecture | **AGREE WITH NOTE** (아래 §9 충돌 참조) |
| 13 | Growth Report 목표 Architecture | **AGREE** |
| 14 | AI/API COST OBSERVABILITY | **AGREE** |
| 15 | trigger_type 원칙 | **AGREE** |
| 16 | 비용 불명 Provider 처리 | **AGREE** |
| 17 | Usage Logging 실패 정책 | **AGREE** |
| 18 | Dashboard 원칙 | **AGREE** |
| 19 | Production / Deployment 헌법 | **AGREE** |
| 20 | 완료된 작업 재오픈 금지 | **AGREE** |
| 21 | 현재 ROADMAP | **AGREE** |
| 22 | AI 기능별 완료 판정 | **AGREE** |
| 23 | Feature Flag / Fallback 원칙 | **AGREE** |
| 24 | Source of Truth 원칙 | **AGREE** |
| 25 | 보고서 작성 방식 | **AGREE** |

---

## 2. Current Repository Reality

### A. Branch / HEAD

```
Branch : deploy-photo-clone
HEAD   : cfe4fe86  "Update mockup components and add AI API cost observability design audit documentation"
```

### B. AI Routes (Production 경로)

| Route | 파일 | Call Target |
|-------|------|------------|
| `POST /ai/whisper/transcribe` | `routes/ai.ts` | direct OpenAI (Whisper) |
| `POST /ai/transcribe` | `routes/ai.ts` | direct OpenAI (Whisper) — alias |
| `POST /ai/diary/generate` | `routes/ai.ts` | direct OpenAI (gpt-4o-mini), DIARY_PIPELINE_MODE=legacy|parser_v1 |
| `POST /api/v1/ai/diary/generate` | `routes/ai-v1.ts` | direct OpenAI (gpt-4o-mini), always parser_v1 |
| `POST /support/respond` (내부) | `routes/support-respond.ts` | direct OpenAI (gpt-4o-mini) |
| `POST /parent/students/:id/curriculum-search` | `routes/parent-curriculum.ts` | **external engine** (PARENT_CURRICULUM_ENGINE_URL) |
| Growth Report Worker | `jobs/growth-report-analysis-worker.ts` | **external engine** (GROWTH_REPORT_ENGINE_URL) |
| `POST /story/...` | `routes/story.ts` | direct OpenAI (추정, saveAiTrace 존재) |

### C. External Engines

| Engine | Env var | 비고 |
|--------|---------|------|
| Parent Curriculum Engine | `PARENT_CURRICULUM_ENGINE_URL` + `PARENT_CURRICULUM_ENGINE_SECRET` | token/cost 미반환 |
| Growth Report Engine | `GROWTH_REPORT_ENGINE_URL` | token/cost 미반환 |

두 엔진 모두 URL 미설정 시 `ENGINE_URL_NOT_CONFIGURED` 오류로 즉시 reject. 프로덕션에서 env 설정 필요.

### D. saveAiTrace / Usage Logging 경로

| 파일 | saveAiTrace 존재 | trigger_type |
|------|----------------|--------------|
| `routes/ai.ts` | ✅ (best-effort void) | ❌ 없음 |
| `routes/ai-v1.ts` | ✅ (best-effort void) | ❌ 없음 |
| `routes/support-respond.ts` | ✅ (await, 별도) | ❌ 없음 |
| `routes/support-cases.ts` | ✅ (await) | ❌ 없음 + **latency_ms=0 버그 line 659** |
| `routes/story.ts` | ✅ (best-effort void) | ❌ 없음 |
| `routes/parent-curriculum.ts` | ✅ (best-effort void) | ❌ 없음 |
| `jobs/growth-report-analysis-worker.ts` | ✅ (best-effort void) | ❌ 없음 |
| `routes/ai.ts` handleWhisper | ❌ **없음** | — |

`AiTraceContext` interface에 `trigger_type` 필드 자체가 정의되어 있지 않음.  
`buildTraceMetadata()` 에도 해당 필드 없음.

### E. AI Diary Production 실제 호출 path — 확정

`routes/ai.ts` → `POST /ai/diary/generate`  
내부적으로 `DIARY_PIPELINE_MODE` env var를 읽어 `effectiveMode` 결정:

```
DIARY_PIPELINE_MODE=legacy   → template 방식 (기본값, 현재 production)
DIARY_PIPELINE_MODE=parser_v1 → parser_v1 pipeline (ai-v1.ts와 동일 로직, ai.ts 내부에서 분기)
```

`/api/v1/ai/diary/generate` (ai-v1.ts)는 항상 parser_v1.  
앱이 어느 경로를 실제로 호출하는지는 app-side 코드에서 확인 필요 (swim-app 디렉터리 구조 확인 불가).  
**양쪽 모두 direct OpenAI. 외부 AI Engine 호출 없음. Professional Knowledge Retrieval 미연결 (헌법 §12 목표 구조 기준으로는 미완성).**

### F. Parent Curriculum Engine 실제 호출 위치

```
routes/parent-curriculum.ts
  → lib/parent-curriculum-engine-client.ts
    → HTTP POST PARENT_CURRICULUM_ENGINE_URL
```

saveAiTrace: ✅ 있음. 단 `trigger_type` 없음. 엔진이 `meta.model` 선택적으로 반환하나 token/cost 없음.

### G. Growth Engine 실제 호출 위치

```
jobs/growth-report-analysis-worker.ts
  → lib/growth-report-engine-client.ts
    → HTTP POST GROWTH_REPORT_ENGINE_URL
```

saveAiTrace: ✅ 있음. `trigger_type` 없음. token/cost 미반환.

### H. AI 관련 Feature Flags

DB-driven `feature_flags` 테이블 (super admin 관리).  
코드에서 하드코딩된 AI on/off 플래그는 없음.  
관련 env var 기반 flag:

| Flag | 위치 | 설명 |
|------|------|------|
| `DIARY_PIPELINE_MODE` | env var | `legacy` \| `parser_v1` |
| `GROWTH_REPORT_ENGINE_URL` | env var | 미설정 시 Growth AI 비활성 |
| `PARENT_CURRICULUM_ENGINE_URL` | env var | 미설정 시 Curriculum AI 비활성 |

DB feature_flags 테이블에 AI 관련 항목이 등록됐는지는 런타임 DB 확인 필요 (현재 확인 불가).

### I. Render/Expo 자동 배포 연결 코드 확인

`src/scripts/` 에 Render URL 참조 스크립트 2개 존재하나, 이는 prod verify / debug용 스크립트이며 서버 런타임 코드가 아님.  
`app.ts`에 `*.onrender.com` CORS 허용 pattern만 존재.  
**자동 배포를 트리거하는 코드: 없음. ✅**

---

## 3. Architecture Agreement

### APP responsibility (현재 실제 구조 기준)

- 인증 (`requireAuth`, JWT, role 검증): ✅
- pool/tenant 격리 (JWT poolId ↔ context pool_id): ✅
- 사용자 입력 수집 및 DB CRUD: ✅
- quota 관리: ✅
- 결제/구독 (RevenueCat webhook): ✅
- AI response validation (support grounding validator, diary output validator): ✅
- 비용 계측 (saveAiTrace → event_logs): ✅ (불완전, trigger_type 누락)
- UI 결과 저장: ✅

### AI ENGINE responsibility (현재 실제 구조 기준)

- Parent Curriculum Engine: Professional Knowledge Retrieval + Grounded 답변 생성 → ✅ 외부 분리됨
- Growth Report Engine: 분석 AI pipeline → ✅ 외부 분리됨
- Support AI: **현재 API server 내부 직접 OpenAI 호출** (external engine 없음) → §9 헌법과 일치 (Support Nano는 내부 구조가 맞음)
- AI Diary: **현재 API server 내부 직접 OpenAI 호출** → §12 목표 구조(Professional Knowledge Retrieval 연결)는 미구현

### Shared contract boundary

- 앱 → API server: JWT Bearer, poolId, student context
- API server → 외부 engine: Bearer Secret, student/pool context, raw input
- 외부 engine → API server: generated output (token/cost 없음)
- API server → event_logs: saveAiTrace

---

## 4. Retrieval Architecture Agreement

| Feature | 현재 실제 구조 | 헌법 목표 구조 | 충돌 여부 |
|---------|--------------|--------------|---------|
| Support | Direct OpenAI + Support DB Retrieval (Layer0 direct match → GPT nano) | §9: DB Broad Retrieval → Candidate → Nano | ✅ 일치 |
| Curriculum | external engine (Broad Retrieval 내부) | §11: Broad Retrieval → Candidate → Nano → Grounded | ✅ 일치 (engine 내부에서 처리) |
| AI Diary | Direct OpenAI (template 방식) | §12: Professional Knowledge Retrieval 포함 | ⚠️ **미완성** — Professional Knowledge 미연결이나 헌법은 "향후" 목표로 명시, 현 단계는 CONFLICT 아님 |
| Professional | 별도 AI Engine (Professional DB 20k) | §10: Broad 50~100 → Top 15~30 → Nano | ✅ 구조 맞음 (엔진 내부에서 처리) |
| Growth Report | external engine | §13: Evidence Pack → Analysis AI | ✅ 일치 |

---

## 5. AI Model Usage Agreement

- **Nano 역할**: Support 내부 (gpt-4o-mini), AI Diary (gpt-4o-mini) → 헌법 §4와 일치
- **상위 모델 역할**: 현재 production에서 gpt-4o-mini 이상 호출 없음 (gpt-4o는 pricing 파일에만 존재)
- **Grounding 정책**: Support에 server-side grounding validator 존재 ✅. Diary에 output validator 존재 ✅. Curriculum/Growth는 외부 엔진 담당 ✅.
- `ai-pricing.ts` 현재 상태: gpt-4o-mini input/output 가격만 정의. `cached_input_tokens`, Whisper 가격, gpt-4o 가격 **누락** → WP-AI-01 Phase 1 수정 대상.

---

## 6. Cost Observability Agreement

### 현재 상태 vs 헌법 요구사항

| 항목 | 헌법 요구 | 현재 구현 |
|------|---------|---------|
| provider | ✅ | ✅ `openai` |
| service | ✅ | ✅ `chat_completion` 등 |
| model_or_api | ✅ | ✅ model 필드 |
| feature | ✅ | ✅ `AI_FEATURE` enum |
| **trigger_type** | ✅ **필수** | ❌ **전체 누락** |
| pool_id | ✅ | ✅ |
| request_id | ✅ | ✅ |
| timestamp | ✅ | ✅ (DB 자동) |
| input_tokens | ✅ | ✅ |
| cached_input_tokens | ✅ | ❌ pricing + 저장 누락 |
| output_tokens | ✅ | ✅ |
| audio_seconds | ✅ | ❌ Whisper 전체 미계측 |
| request_count | ✅ | 암묵적 1/row (명시 없음) |
| units | ✅ | ❌ SMS/R2 미구현 |
| estimated_cost_usd | ✅ | ✅ (gpt-4o-mini 일부) |
| cost_source | ✅ | ❌ 없음 |
| latency_ms | ✅ | ✅ (support-cases line 659 버그 제외) |
| retry_count | ✅ | ❌ 없음 |
| success | ✅ | ✅ |
| error_type | ✅ | ✅ |

### trigger_type — SYSTEM_MAINTENANCE 분리

Growth Report Worker는 백그라운드 자동 실행임에도 `trigger_type` 없음.  
USER_ACTION과 섞여 집계되는 구조 → 헌법 §15 위반 상태.  
수정: `AiTraceContext`에 `trigger_type` 필드 추가 + 모든 callsite에서 명시 (JSONB 확장, migration 없음).

### 비용 불명 Provider

Curriculum Engine / Growth Engine: `estimated_cost_usd = null`, `cost_source = UNKNOWN`으로 기록하는 것 확정. ✅

### best-effort logging

현재 `void saveAiTrace(...).catch(...)` 패턴 사용 중 → 헌법 §17 일치. ✅  
`support-respond.ts`는 `await saveAiTrace()`로 구현되어 있으나 내부에서 catch 처리됨 — 허용.

### retry counting

현재 production 경로에서 retry 없음 (AiGateway는 zero production import).  
AiGateway 도입 시 `retry_count`를 `AiTraceParams`에 추가 예정.

---

## 7. Security / Authority Agreement

| 항목 | 현재 구현 | 헌법 §6 |
|------|---------|--------|
| Authentication | JWT requireAuth middleware | ✅ |
| Role/Permission | server-side role enum 검증 | ✅ |
| Pool isolation | JWT poolId ↔ DB poolId 비교 | ✅ |
| Payment/Subscription | RevenueCat webhook + server-side entitlement | ✅ |
| Quota | DB-driven quota (monthly_quota table) | ✅ |
| AI Validator | Support grounding validator, Diary output validator | ✅ |
| AI output = NOT authority | AI JSON → server-side deterministic validation | ✅ |

---

## 8. Deployment Agreement

| 항목 | 헌법 | 현재 상태 |
|------|------|---------|
| Render deploy | 운영자 수동 | ✅ (RENDER_API_KEY 사용 안 함) |
| Expo OTA | 운영자 승인 후 | ✅ |
| DB migration | 명시적 승인 후 | ✅ |
| startup migration | 금지 | ✅ (없음) |
| Production DB write | 명시 승인 없이 금지 | ✅ |
| 여러 수정 묶어 배포 | commit chain 유지 | ✅ |

---

## 9. Existing Conflicts

### CONFLICT 1 — trigger_type 전체 누락 (헌법 §14, §15)

**실제 코드**: `AiTraceContext` interface에 `trigger_type` 필드 없음. 모든 `saveAiTrace` callsite에서 전달 없음.  
**헌법 요구**: `trigger_type`은 필수 공통 필드. SYSTEM_MAINTENANCE vs USER_ACTION 분리 필수.  
**해결 가능 여부**: YES — `AiTraceContext`에 필드 추가 + JSONB metadata 확장 (DB migration 없음).  
**헌법 수정 불필요**.

### CONFLICT 2 — Whisper saveAiTrace 누락 (헌법 §14 "반드시 추적할 호출 종류")

**실제 코드**: `handleWhisper` 함수에 saveAiTrace 없음. OpenAI Whisper 호출 비용 전혀 기록 안 됨.  
**헌법 요구**: Whisper/STT를 반드시 추적.  
**해결 가능 여부**: YES — handleWhisper에 saveAiTrace 추가. audio_seconds는 현재 null (클라이언트에서 duration_ms를 보내야 정확).  
**헌법 수정 불필요**.

### CONFLICT 3 — ai-pricing.ts 불완전 (헌법 §6 OpenAI 비용 계산)

**실제 코드**: gpt-4o-mini input/output 가격만 존재. `cached_input_tokens` 가격, Whisper 가격, gpt-4o 가격 누락.  
**헌법 요구**: "가격을 route 코드에 hard-code하지 않는다. 모델 가격 변경 시 한 군데만 수정."  
**해결 가능 여부**: YES — `ai-pricing.ts` 확장 (code 변경, 단일 파일).  
**헌법 수정 불필요**.

### CONFLICT 4 — support-cases.ts latency_ms=0 버그 (헌법 §14)

**실제 코드**: line 659에서 latency_ms 계산 오류 → 항상 0 기록.  
**헌법 요구**: 정확한 runtime metrics 기록.  
**해결 가능 여부**: YES — 단순 버그 수정.  
**헌법 수정 불필요**.

---

## 10. Decisions Needed Before AI Implementation

### D1. AI Diary Production 경로 확정 (필수)

현재 두 경로 존재: `/ai/diary/generate` (ai.ts) + `/api/v1/ai/diary/generate` (ai-v1.ts).  
앱이 실제로 어느 경로를 호출하는지 확인 필요.  
→ 수영 앱 소스 코드에서 diary generate API URL 검색으로 확정 가능.

### D2. PARENT_CURRICULUM_ENGINE_URL / GROWTH_REPORT_ENGINE_URL production 설정 여부

env 미설정 시 해당 기능 즉시 `ENGINE_URL_NOT_CONFIGURED` 오류 → cost=UNKNOWN 기록.  
현재 production 실제 연결 상태: 운영자 확인 필요.

### D3. Support Nano 전환 시점 (PHASE 2 시작 조건)

현재 Support는 direct OpenAI + Layer0 direct DB match 구조 이미 동작 중.  
"Support Nano" 작업의 실제 변경 범위가 무엇인지 운영자 확인 필요 (이미 Nano gpt-4o-mini 사용 중이므로).

---

## 11. Recommended Locked Architecture

앞으로 모든 AI WP가 따를 최종 아키텍처 요약 (10~20줄):

```
[모든 AI 호출 공통 원칙]

1. API Server = Auth + Pool isolation + Context + Validation + Usage Logging
2. AI Engine = Professional Knowledge + Retrieval + Grounded Pipeline
3. 모든 유료 호출 → saveAiTrace (또는 recordExternalUsage) → event_logs category='AI'
4. 반드시 기록: provider, service, feature, trigger_type, pool_id, request_id
5. trigger_type: USER_ACTION | SYSTEM_MAINTENANCE | ADMIN_MANUAL | BATCH_JOB
6. 외부 엔진이 token/cost 미반환 → estimated_cost_usd=null, cost_source=UNKNOWN
7. Usage logging 실패 → 사용자 기능 정상 유지 (best-effort void .catch)
8. ai-pricing.ts가 유일한 가격 정의 소스 (route에 하드코딩 금지)
9. Dashboard = SQL aggregate on event_logs. 외부 API 재호출 금지.
10. Fallback 사용 시 fallback_used + pipeline_mode 반드시 기록
11. DB migration 없이 JSONB metadata 확장으로 신규 필드 추가
12. Retrieval: Verified DB → Broad (~50~100) → Candidate (15~30) → Nano → Validated Output
```

---

## 12. READY / NOT READY

**NOT READY**

Blockers (구현 시작 전 해결 필요):

1. **trigger_type 미구현** — 헌법 §15 핵심 요구사항. WP-AI-01 Phase 1 필수 선행.
2. **Whisper saveAiTrace 누락** — 유료 호출 미기록. WP-AI-01 Phase 1 필수 선행.
3. **ai-pricing.ts 불완전** — cached_input, Whisper 가격 누락. 비용 계산 신뢰 불가.
4. **cost_source 필드 없음** — CONFIGURED_UNIT_PRICE vs TOKEN_PRICING vs UNKNOWN 구분 불가.
5. **latency_ms=0 버그** (support-cases.ts line 659) — 기록 데이터 신뢰 훼손.

위 5개 항목(WP-AI-01 Phase 1)이 완료되면:

**READY FOR AI IMPLEMENTATION** (PHASE 2 Support Nano → PHASE 3 이후 순서대로 진행 가능)

---

*이 보고서는 코드 수정 없이 현재 repository 상태를 읽고 헌법과 대조한 결과입니다.*  
*모든 실제 구현은 운영자 승인 후 별도 WP로 진행합니다.*
