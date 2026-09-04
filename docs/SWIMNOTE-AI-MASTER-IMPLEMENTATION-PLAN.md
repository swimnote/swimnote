# [SWIMNOTE AI MASTER IMPLEMENTATION PLAN]

작성일: 2026-08-21  
Branch: `deploy-photo-clone`  
작업 범위: 계획 문서만. 코드 수정 없음.

---

## 1. Design Verdict

**PASS** — 전체 Blueprint와 현재 repository 구조 충돌 없음.  
4개 Gap(trigger_type, 모델 하드코딩, request_id 미전파, retry_count) 모두 WP-AI-01 내에서 해결.

---

## 2. Existing Reusable Infrastructure

| 인프라 | 파일 | 재사용 방식 |
|--------|------|-----------|
| event_logs + JSONB | `lib/ai-trace-service.ts` | 모든 usage event의 저장소. 신규 테이블 불필요. |
| saveAiTrace() | `lib/ai-trace-service.ts` | JSONB 필드 확장으로 공통 contract 충족 |
| buildTraceMetadata() | `lib/ai-trace-service.ts` | trigger_type/cost_source/retry_count 추가 |
| feature_flags + overrides | `lib/featureFlags.ts`, super.ts | Feature kill switch, pool override |
| AI_FEATURE enum | `lib/ai-feature-enum.ts` | feature 분류 기준 유지 |
| ai-pricing.ts | `config/ai-pricing.ts` | 확장하여 cached_input, Whisper 추가 |
| growth-report-engine-client | `lib/growth-report-engine-client.ts` | retry 분류 이미 존재 |
| parent-curriculum-engine-client | `lib/parent-curriculum-engine-client.ts` | retryable 플래그 존재 |
| monthly_quota 테이블 | DB (기존) | Pool/feature quota |
| LLM_MODEL const 패턴 | `routes/support-respond.ts` | 파일상단 const 패턴 → model-config로 확장 |

---

## 3. Required New Infrastructure (최소한)

| 신규 항목 | 위치 | 이유 |
|-----------|------|------|
| `config/ai-model-config.ts` | 신규 파일 | 모델명 단일 소스 (route 하드코딩 제거) |
| `lib/usage-recorder.ts` | 신규 파일 | SMS/R2/외부엔진 provider-neutral 공통 recorder |
| GET `/super/ai-cost-overview` endpoint | `routes/super.ts` 확장 | AI/API 비용 집계 API |
| Super Admin [AI비용] 탭 | `artifacts/swimnote-web/` | 대시보드 UI |

신규 DB 테이블: **없음**. event_logs JSONB 확장으로 충분.

---

## 4. WP Roadmap

### PHASE 1 — WP-AI-01: Cost Observability + Cost Control Foundation

**목표**: 모든 유료 호출의 Usage Event 기록 + Super Admin Dashboard  
**DB 변경**: 없음 (JSONB 확장만)  
**Render 배포**: 필요 (서버 변경 포함)  
**OTA**: 필요 없음 (서버 전용)

상세 Steps는 §5 참조.

---

### PHASE 2 — Support Nano

**목표**: Support Broad Retrieval → Candidate → Nano 1회(context+선택+종합+answer) → Validator  
**변경 파일**: `routes/support-respond.ts`, `lib/runtime/` (RT1/RT2 기반 활용)  
**신규 파일**: 없음 (기존 Layer0 retrieval 확장)  
**외부 API**: direct OpenAI (gpt-4o-mini 유지)  
**DB 변경**: 없음  
**Feature flag**: `support_nano` (feature_flags 테이블)  
**Usage logging**: trigger_type=USER_ACTION, provider=openai, feature=SUPPORT_AI  
**Validator**: 기존 grounding validator 유지  
**Test**: 기존 CS test suite 확장  
**Production validation**: 실제 질문 5개 이상 Evidence 선택 확인

현재 direct OpenAI 사용 ≠ Support Nano 완료. 이 PHASE에서 Broad Retrieval → Candidate → 단일 Nano 1회 구조로 전환.

---

### PHASE 3 — Professional Retrieval Audit

**목표**: Professional DB(약 20k) Broad Retrieval → Top 50~100 → Light Ranking → Top 15~30 → Nano Evidence Selection 검증  
**변경 파일**: `lib/growth-report-engine-client.ts`, `lib/parent-curriculum-engine-client.ts` (INFERRED)  
**외부 API**: Professional AI Engine (내부 구조 별도 확인)  
**DB 변경**: 없음 (engine 측 변경)  
**Usage logging**: cost_source=UNKNOWN (engine이 token/cost 미반환)  
**Audit 방식**: INDEX_MISSING → NORMALIZATION_MISS → KEYWORD_MISS → SEMANTIC_MISS → FILTER_DROP → THRESHOLD_DROP → RANKING_DROP 순 1회 분류  
**무한 tuning 금지**

---

### PHASE 4 — Parent Curriculum AI

**목표**: pool curriculum_items + Professional Evidence → Broad Retrieval → Candidate → Nano → Grounded Parent Answer  
**현재 구조**: 외부 engine이 이미 처리 중 (PARENT_CURRICULUM_ENGINE_URL)  
**변경 파일**: `routes/parent-curriculum.ts` (trigger_type 추가, request_id 전파)  
**Usage logging**: trigger_type=USER_ACTION, cost_source=UNKNOWN  
**Feature flag**: 기존 engine URL 기반 (env 미설정 시 disable)

---

### PHASE 5 — AI Diary

**목표**: Teacher memo + diary_templates + Professional Knowledge → Retrieval → Nano(이해+선택) → 생성 모델 → Validator → Draft  
**사전 확인**: AI Diary WP 시작 시 앱 실제 호출 endpoint 1회 read-only trace  
**현재 구조**: direct OpenAI (template only, Professional Knowledge 미연결)  
**Professional Engine 연결**: 기존 Grounded Teacher Diary Pipeline이 engine에 존재하면 APP에서 복제 금지  
**변경 파일**: `routes/ai.ts` 또는 `routes/ai-v1.ts` (결정 후)  
**Feature flag**: `ai_diary_grounded` (신규, feature_flags)  
**Usage logging**: trigger_type=USER_ACTION, Nano + 생성모델 각각 별도 event

---

### PHASE 6 — Growth Report

**목표**: Student Evidence Pack → Analysis AI → Validator → Report → PPT/PDF → Parent  
**현재 구조**: growth-report-engine-client + worker (5분 cron)  
**변경 파일**: `jobs/growth-report-analysis-worker.ts` (trigger_type=SYSTEM_MAINTENANCE 추가)  
**Usage logging**: trigger_type=SYSTEM_MAINTENANCE, request_count, retry_count  
**Validator**: 기존 DB상태 기반 (QUEUED→PROCESSING→COMPLETED)  
**비동기 UX**: Generate → queued → 앱 종료 가능 → 완료 → "리포트 확인하기"

---

### PHASE 7 — Real Unit Economics

실제 누적 데이터 기반:
- AI 일지 1건 평균 비용
- Support 질문 1건 평균 비용
- Curriculum 질문 1건 평균 비용
- Growth Report 1건 평균 비용
- STT 1회 평균 비용
- Pool별 비용

event_logs SQL aggregate로 계산. 외부 API 호출 없음.

---

### PHASE 8 — Cost Optimization / Threshold / Alert

실제 baseline 확보 후:
- 비정상 call 급증 탐지
- 평균 cost/call 급증 탐지
- SYSTEM_MAINTENANCE 급증 탐지
- 필요 시 threshold alert 추가

"측정 없이 제한" 금지. 먼저 Observability → baseline → 판단 순.

---

## 5. WP-AI-01 Detailed Steps

### AI01-01 — AiTraceContext 공통 Contract 확장

**목적**: trigger_type, cost_source, retry_count, cached_input_tokens(이름 통일), audio_seconds를 AiTraceContext에 추가.  
**변경 파일**: `artifacts/api-server/src/lib/ai-trace-service.ts`  
**변경 함수**: `AiTraceContext` interface, `AiTraceSuccess` interface, `buildTraceMetadata()`  
**DB 영향**: 없음 (JSONB metadata 확장)  
**비용 영향**: 없음  
**테스트**: 기존 `wp10-ai-trace.test.ts` 확장 + 신규 TC (trigger_type 필드 존재 확인, cost_source JSONB 저장 확인)  
**완료 증거**: commit SHA + `buildTraceMetadata()` 반환 객체에 trigger_type, cost_source, retry_count 존재 TC PASS  
**Rollback**: 인터페이스 추가이므로 기존 callsite에 영향 없음 (optional 필드)

---

### AI01-02 — ai-pricing.ts 확장

**목적**: cached_input_tokens 가격, Whisper 가격(per second), gpt-4o 가격 추가. 모든 가격은 단일 파일 관리.  
**변경 파일**: `artifacts/api-server/src/config/ai-pricing.ts`  
**변경 함수**: 가격 상수 추가  
**DB 영향**: 없음  
**비용 영향**: 없음 (가격 정보만 추가)  
**테스트**: 신규 TC (가격 계산 함수 단위 테스트)  
**완료 증거**: commit SHA + pricing 함수 반환값 확인 TC PASS

---

### AI01-03 — ai-model-config.ts 생성 + 모델명 hardcoding 제거

**목적**: 모든 route의 모델명을 단일 config 파일에서 관리. 모델 교체 시 한 파일만 수정.  
**신규 파일**: `artifacts/api-server/src/config/ai-model-config.ts`  
**변경 파일**: `routes/ai.ts`, `routes/ai-v1.ts`, `routes/story.ts`  
(support-respond.ts는 이미 LLM_MODEL const 패턴 → import로 교체)  
**변경 함수**: 모델명 string literal → `AI_MODEL.DIARY`, `AI_MODEL.SUPPORT`, `AI_MODEL.STT` 상수 import  
**DB 영향**: 없음  
**비용 영향**: 없음 (모델 변경 없음, 이름 통일만)  
**테스트**: 기존 TC 영향 없음 (상수값 동일)  
**완료 증거**: commit SHA + `grep -r "gpt-4o-mini"` 결과가 config 파일에만 존재

---

### AI01-04 — 전체 saveAiTrace callsite trigger_type 명시

**목적**: 모든 saveAiTrace 호출에 trigger_type을 명시. SYSTEM_MAINTENANCE가 USER_ACTION에 섞이지 않도록.  
**변경 파일**:  
- `routes/ai.ts` → trigger_type: 'USER_ACTION'  
- `routes/ai-v1.ts` → trigger_type: 'USER_ACTION'  
- `routes/support-respond.ts` → trigger_type: 'USER_ACTION'  
- `routes/support-cases.ts` → trigger_type: 'USER_ACTION' + latency_ms=0 버그 수정  
- `routes/story.ts` → trigger_type: 'USER_ACTION'  
- `routes/parent-curriculum.ts` → trigger_type: 'USER_ACTION'  
- `jobs/growth-report-analysis-worker.ts` → trigger_type: 'SYSTEM_MAINTENANCE'  
**DB 영향**: 없음 (JSONB 필드 추가)  
**비용 영향**: 없음  
**테스트**: 각 callsite별 trigger_type 값 TC + latency_ms 버그 수정 TC  
**완료 증거**: commit SHA + trigger_type 필드가 event_logs JSONB에 저장되는 TC PASS  
**Rollback**: 필드 추가이므로 기존 데이터 영향 없음

---

### AI01-05 — Whisper saveAiTrace 추가

**목적**: handleWhisper에 saveAiTrace 추가. Whisper 유료 호출 기록.  
**변경 파일**: `artifacts/api-server/src/routes/ai.ts` (`handleWhisper` 함수)  
**변경 함수**: `handleWhisper`  
**Usage Event**:
```
provider: 'openai'
service: 'speech_to_text'
feature: AI_FEATURE.STT
trigger_type: 'USER_ACTION'
model_or_api: AI_MODEL.STT  (= 'whisper-1')
audio_seconds: null  (클라이언트 duration_ms 미전송, 단기 null)
cost_source: 'UNKNOWN'  (audio_seconds 없으면 비용 계산 불가)
estimated_cost_usd: null
```
**DB 영향**: 없음  
**비용 영향**: 없음 (logging 추가)  
**테스트**: 신규 TC (saveAiTrace 호출 확인, UNKNOWN 비용 확인)  
**완료 증거**: commit SHA + TC PASS + Whisper 호출 시 event_logs에 AI record 생성 확인

---

### AI01-06 — lib/usage-recorder.ts 신규 + SMS usage logging

**목적**: provider-neutral `recordExternalUsage()` 구현. SMS 호출 기록.  
**신규 파일**: `artifacts/api-server/src/lib/usage-recorder.ts`  
**변경 파일**: `lib/sms/providers/sens.ts` (또는 공통 sendSms 레이어)  
**Usage Event (SMS)**:
```
provider: 'naver_sens'
service: 'sms'
feature: AI_FEATURE.SMS_NOTIFICATION  (enum 추가 필요)
trigger_type: 'USER_ACTION' | 'SYSTEM_MAINTENANCE'
units: <수신자 수>
estimated_cost_usd: null
cost_source: 'UNKNOWN'
```
**DB 영향**: 없음  
**테스트**: 신규 TC (recordExternalUsage 계약 확인)  
**완료 증거**: commit SHA + TC PASS

---

### AI01-07 — R2 usage logging

**목적**: uploadToR2 / deleteFromR2 호출 기록.  
**변경 파일**: `lib/objectStorage.ts`  
**Usage Event (R2)**:
```
provider: 'cloudflare_r2'
service: 'object_storage'
feature: AI_FEATURE.R2_STORAGE  (enum 추가 필요)
trigger_type: 상황에 따라
units: <bytes>
estimated_cost_usd: null
cost_source: 'UNKNOWN'
```
**DB 영향**: 없음  
**테스트**: 신규 TC  
**완료 증거**: commit SHA + TC PASS

---

### AI01-08 — GET /super/ai-cost-overview API

**목적**: event_logs category='AI' 기반 SQL aggregate. 외부 API 호출 없음.  
**변경 파일**: `routes/super.ts` (신규 endpoint 추가)  
**집계 쿼리**:
- 오늘/이달 총비용 (trigger_type별)
- Feature별: calls, known_cost, unknown_calls, avg_cost/call, input/output tokens, errors
- Provider/Model별: calls, known_cost, unknown_calls
- Pool별: calls, cost
- Unit economics: feature별 평균 cost/call  
**DB 영향**: 없음 (READ ONLY)  
**테스트**: TC (응답 구조 확인, trigger_type 분리 확인)  
**완료 증거**: commit SHA + TC PASS + curl 결과

---

### AI01-09 — Super Admin [AI비용] 탭 UI

**목적**: AI01-08 API 기반 Super Admin 웹 UI.  
**변경 파일**: `artifacts/swimnote-web/src/` (Super Admin 페이지)  
**화면 구성**:
- TODAY / MONTH 요약
- Trigger 분류 (USER_ACTION / SYSTEM_MAINTENANCE / ADMIN_MANUAL / BATCH)
- Feature 테이블 (Calls / Known Cost / Unknown Calls / Avg/Call / Input / Output / Errors)
- Provider/Model 테이블
- Pool 테이블
- Unit Economics 섹션  
**DB 영향**: 없음  
**테스트**: 수동 확인 (웹 UI)  
**완료 증거**: 실제 화면 캡처 또는 curl 응답 + UI 정상 렌더링 확인

---

## 6. Support Nano Plan (구현 전 계획만)

**현재 상태**: direct OpenAI + Layer0 direct match + RT2 scoring 존재.  
**목표 구조**:
```
Support DB Broad Retrieval (utterance + KI)
→ Candidate KI (score 상위)
→ gpt-4o-mini 1회
  → query 이해 + follow-up context
  → Evidence 선택 + irrelevant 제거
  → 여러 KI 종합
  → grounded final answer
→ Server Validator (HUMAN_ONLY, inactive, permission 등)
```
**변경 파일**: `routes/support-respond.ts`, `lib/runtime/` 기반 활용  
**Feature flag**: `support_nano_v2` (feature_flags)  
**단일 Nano 1회 원칙**: classification + reranking + answer 분리 금지  
**regex/facet 무한 튜닝 금지**  
**Usage logging**: trigger_type=USER_ACTION, retry_count 포함  
**Render 배포**: 필요 / OTA: 불필요

---

## 7. Professional Retrieval Plan (구현 전 계획만)

**목표**:
```
Professional DB (~20k)
→ Broad Retrieval (~50~100)
→ Light Ranking
→ Top 15~30
→ Nano Evidence Selection
→ Feature output
```
**Audit 방법**: INDEX_MISSING / NORMALIZATION_MISS / KEYWORD_MISS / SEMANTIC_MISS / FILTER_DROP / THRESHOLD_DROP / RANKING_DROP 1회 분류 후 수정. 무한 tuning 금지.  
**참고**: Professional DB는 별도 AI Engine에 존재. APP에서 복제 금지.

---

## 8. Curriculum Plan (구현 전 계획만)

**현재**: 외부 engine (PARENT_CURRICULUM_ENGINE_URL) 이미 연결됨.  
**필요 작업**:
1. request_id 외부 engine 전파 (AI01-04 이후)
2. trigger_type=USER_ACTION 명시 (AI01-04에서 완료)
3. cost_source=UNKNOWN, estimated_cost_usd=null 확인 (이미 설계 일치)
4. Curriculum quota 정상 동작 확인  
**Source of Truth**: diary_templates (authoring) / curriculum_items (search index)

---

## 9. AI Diary Plan (구현 전 계획만)

**사전 확인**: WP 시작 시 앱 실제 호출 endpoint 1회 read-only trace (INFERRED: /ai/diary/generate).  
**목표**:
```
Teacher memo + diary_templates + Professional Knowledge
→ Retrieval
→ Nano (memo 이해 + 학생별 분리 + template 선택 + Evidence 선택)
→ 생성 모델
→ Validator
→ Diary Draft
```
**원칙**: Professional Engine에 기존 Grounded Diary Pipeline 존재 시 APP에서 복제 금지.  
**Feature flag**: `ai_diary_grounded` (feature_flags, 신규)  
**Usage logging**: Nano call + 생성 모델 call 각각 별도 event, trigger_type=USER_ACTION

---

## 10. Growth Report Plan (구현 전 계획만)

**현재**: growth-report-engine-client + 5분 cron worker 존재.  
**필요 작업**:
1. trigger_type=SYSTEM_MAINTENANCE (AI01-04에서 완료)
2. retry_count 기록 (AI01-01에서 추가)
3. Worker frequency / batch 조정을 위한 env var 문서화
4. request_id engine 전파 (AI01-04 이후 별도)
5. PPT/PDF 생성 단계 usage logging  
**비동기 UX**: Generate → queued → 앱 종료 가능 → 완료 → push notification

---

## 11. Cost Control Plan

현재 코드 재사용 기준:

| Control 종류 | 현재 구조 | 구현 방법 |
|------------|---------|---------|
| Feature kill switch | feature_flags.global_enabled | Super Admin에서 toggle → 즉시 반영 |
| Pool-level override | feature_flag_overrides | 이미 존재 |
| Provider/model switch | AI01-03 model-config → | ai-model-config.ts 수정 후 Render 재배포 |
| Worker pause | env GROWTH_REPORT_ENGINE_URL 공백 설정 | 즉시 ENGINE_URL_NOT_CONFIGURED로 disable |
| Batch/frequency | GROWTH_REPORT_MAX_RETRY_COUNT 존재 | BATCH_LIMIT env화 필요 (AI01-04 또는 별도) |
| Quota | monthly_quota 테이블 | feature별 quota 기존 구조 활용 |
| Emergency kill | feature_flags.global_enabled=false | Super Admin → 1클릭 |
| Future threshold alert | PHASE 8 | baseline 수집 후 결정 |

**자동 hard shutdown은 현재 단계에서 활성화하지 않는다.** (§13 원칙)

---

## 12. Cost/Performance Decision Framework

향후 model/API 선택 시 판단 기준:

| 지표 | 측정 방법 | 판단 역할 |
|------|---------|---------|
| quality | 실제 output 평가 (5점 척도) | 기본 요건 충족 여부 |
| latency_ms | event_logs 집계 (avg, p95) | SLA 충족 여부 |
| cost/call | event_logs 집계 (avg known cost) | 단가 비교 |
| error_rate | event_logs error count / total | 안정성 |
| retry_rate | retry_count / request_count | 실제 호출 배수 |

**판단 원칙**: 충분한 quality + 낮은 단가 + 빠른 응답 우선.  
"Model B가 2점 더 좋지만 8배 비싸면 A를 기본 사용."  
승격은 실제 테스트 결과로만 결정.

---

## 13. Verification Matrix

| WP | 완료 증거 |
|----|---------|
| AI01-01 | TC PASS: trigger_type/cost_source/retry_count buildTraceMetadata 반환 확인 |
| AI01-02 | TC PASS: cached_input 가격, Whisper 가격 계산 정확 |
| AI01-03 | `grep -r "gpt-4o-mini" src/routes/` → 0 lines |
| AI01-04 | TC PASS: 모든 callsite trigger_type 확인. support-cases latency_ms 비0 확인 |
| AI01-05 | TC PASS: Whisper 호출 후 event_logs AI record 존재 |
| AI01-06 | TC PASS: recordExternalUsage 계약 확인 |
| AI01-07 | TC PASS: R2 upload 후 usage event 존재 |
| AI01-08 | TC PASS: /super/ai-cost-overview 응답 구조 확인. trigger_type 분리 확인 |
| AI01-09 | 수동: Super Admin [AI비용] 탭 렌더링 확인 |
| Support Nano | 실제 질문 5개 Evidence 선택 확인 + validator 통과 확인 |
| Curriculum | request_id 전파 확인 + cost_source=UNKNOWN 기록 확인 |
| AI Diary | 모바일 실기기 draft 생성 확인 + usage event 기록 확인 |
| Growth Report | trigger_type=SYSTEM_MAINTENANCE 기록 확인 + retry_count 확인 |

---

## 14. Risks (코드에서 확인된 것만)

| Risk | 심각도 | 비고 |
|------|--------|------|
| Whisper audio_seconds null | MEDIUM | 클라이언트 duration_ms 전송 없이는 비용 계산 불가 — UNKNOWN으로 처리 |
| Growth Worker cron hardcoded (*/5 분) | MEDIUM | pause 없음. feature_flag disable로 우회 |
| 외부 engine이 token/cost 미반환 | LOW (설계 반영됨) | cost_source=UNKNOWN 원칙 준수 |
| request_id 외부 engine 미전파 | MEDIUM | AI01-04 또는 별도 단계에서 해결 |
| support-cases.ts line 659 latency_ms=0 | MEDIUM | AI01-04에서 수정 |
| DB feature_flags에 AI 관련 항목 미등록 가능 | LOW | AI01-09 전에 등록 필요 |

---

## 15. First Implementation Step

**AI01-01 — AiTraceContext 공통 Contract 확장**

`lib/ai-trace-service.ts`에서:
1. `AiTraceContext` interface에 `trigger_type?: 'USER_ACTION' | 'SYSTEM_MAINTENANCE' | 'ADMIN_MANUAL' | 'BATCH_JOB'` 추가
2. `AiTraceContext` interface에 `cost_source?: 'TOKEN_PRICING' | 'CONFIGURED_UNIT_PRICE' | 'PROVIDER_REPORTED' | 'PUBLIC_PRICING' | 'UNKNOWN'` 추가
3. `AiTraceSuccess` interface에 `retry_count?: number`, `audio_seconds?: number | null` 추가
4. `buildTraceMetadata()`에서 신규 필드를 JSONB에 포함
5. `cached_tokens` → `cached_input_tokens`로 이름 통일

**아직 실행하지 않는다.** 운영자 Step 승인 후 구현.

---

*이 문서는 코드 수정 없이 현재 repository 상태를 기반으로 작성된 설계 계획입니다.*  
*모든 구현은 Step별 운영자 승인 후 진행합니다.*
