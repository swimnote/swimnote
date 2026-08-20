# [CORRECTED SWIMNOTE AI MASTER IMPLEMENTATION PLAN]

작성일: 2026-08-21  
Branch: `deploy-photo-clone`  
작업 범위: 설계 수정만. 코드 수정 없음.

---

## 1. Corrected Gap List

| Gap | 항목 | 현황 | 수정 내용 |
|-----|------|------|---------|
| G1 | trigger_type / cost_source / retry_count / audio_seconds / cached_input_tokens | AiTraceContext 누락 | AI01-01에서 해결 |
| G2 | 모델명 route별 하드코딩 | 공통 model control point 없음 | AI01-03에서 해결 |
| G3 | request_id 외부 engine 미전파 | Curriculum/Growth engine client에 request_id 파라미터 없음 | **AI01-05 신규 Step 추가** |
| G4 | retry_count / actual_call_count 미기록 | logical request ≠ actual provider call 구분 불가 | AI01-01 + AI01-05에서 해결 |
| G5 | service 필드 정식 미구현 | generation_mode/error_stage로 간접 추정됨 | AI01-01에서 해결 |

---

## 2. Corrected Common Usage Contract

### 필드 정의 (Migration 없음 — 전체 JSONB metadata 확장)

```typescript
interface UsageEvent {
  // ── Provider Identity ──────────────────────────────
  provider:           string;   // 'openai' | 'naver_sens' | 'cloudflare_r2' | 'curriculum_engine' | ...
  service:            string;   // 'gpt' | 'whisper' | 'sms' | 'r2_put' | 'r2_get' | 'r2_delete' | 'search' | 'analysis'
  model_or_api:       string | null;  // 'gpt-4o-mini' | 'whisper-1' | null (SMS/R2)

  // ── Feature Classification ─────────────────────────
  feature:            string;   // AI_FEATURE 값 or ExternalUsageCategory 값 (§7 참조)
  trigger_type:       'USER_ACTION' | 'SYSTEM_MAINTENANCE' | 'ADMIN_MANUAL' | 'BATCH_JOB';

  // ── Request Tracking ──────────────────────────────
  pool_id:            string | null;
  request_id:         string;        // logical request ID (APP 생성)
  timestamp:          Date;          // DB auto

  // ── Request Count (명확히 분리) ──────────────────────
  logical_request_count: number;     // 기능 단위 요청 수 (보통 1)
  actual_call_count:     number;     // provider에 실제 전송된 호출 수 (retry 포함)
  retry_count:           number;     // actual_call_count - logical_request_count

  // ── Usage ─────────────────────────────────────────
  input_tokens:       number | null;
  cached_input_tokens: number | null;   // 기존 cached_tokens 이름 통일
  output_tokens:      number | null;
  audio_seconds:      number | null;   // Whisper용. 클라이언트 미전송 시 null
  units:              number | null;   // SMS 수신자 수 등 (operation 단위)

  // ── R2 전용 ──────────────────────────────────────
  bytes:              number | null;   // R2 PUT/GET 데이터 크기. operation count는 actual_call_count 사용

  // ── Cost ──────────────────────────────────────────
  estimated_cost_usd: number | null;
  cost_source:        'TOKEN_PRICING' | 'CONFIGURED_UNIT_PRICE' | 'PROVIDER_REPORTED' | 'PUBLIC_PRICING' | 'UNKNOWN';

  // ── Runtime ───────────────────────────────────────
  latency_ms:         number;
  success:            boolean;
  error_type:         string | null;
}
```

### logical_request_count vs actual_call_count 원칙

```
Growth Report 1건 생성:
  logical_request_count = 1    (사용자/시스템 요청 단위)
  actual_call_count     = 3    (최초 1 + retry 2)
  retry_count           = 2

Dashboard 비용 계산: actual_call_count × 단위 비용
Dashboard "호출 횟수": actual_call_count 기준
Dashboard "기능 요청": logical_request_count 기준
```

**기존 `request_count` 필드는 `actual_call_count`로 명칭 통일. JSONB 확장이므로 migration 없음.**

---

## 3. Corrected WP-AI-01 Steps

### AI01-01 — AiTraceContext 공통 Contract 확장

**목적**: service, trigger_type, cost_source, retry_count, audio_seconds, cached_input_tokens(이름 통일), logical_request_count, actual_call_count를 AiTraceContext에 추가.

**변경 파일**: `artifacts/api-server/src/lib/ai-trace-service.ts`  
**변경 함수**: `AiTraceContext`, `AiTraceSuccess`, `buildTraceMetadata()`  
**DB 영향**: 없음 (JSONB 확장)  
**비용 영향**: 없음  

**테스트**:
```bash
pnpm --filter @workspace/api-server test wp10-ai-trace
# 신규 TC: trigger_type, service, cost_source, actual_call_count, logical_request_count가 buildTraceMetadata() 반환 객체에 존재
```

**완료 증거 요구**:
- commit SHA
- 변경 파일: `lib/ai-trace-service.ts`
- 변경 함수: `AiTraceContext`, `buildTraceMetadata`
- 정확한 test command + PASS/FAIL + TC count
- 분류: **UNIT TEST CONFIRMED** (Production 연결 확인은 AI01-02 이후)

**Rollback**: 인터페이스 optional 필드 추가이므로 기존 callsite 영향 없음

---

### AI01-02 — ai-pricing.ts + ai-model-config.ts

**목적 (pricing)**: cached_input_tokens 가격, Whisper 가격(per second), gpt-4o 가격 추가. 단일 파일 관리.  
**목적 (model-config)**: 모델명 단일 control point. Quality/Latency/Cost 비교 후 빠른 교체를 위한 구조.

```typescript
// config/ai-model-config.ts
export const AI_MODEL = {
  // 현재 사용 모델 (gpt-4o-mini)
  // 향후 Quality/Latency/Cost 비교 후 교체 시 이 파일만 수정
  DIARY:      'gpt-4o-mini',   // TODO: 실제 WP 시작 시 저비용 모델부터 테스트
  SUPPORT:    'gpt-4o-mini',   // TODO: 실제 WP 시작 시 저비용 모델부터 테스트
  STORY:      'gpt-4o-mini',
  STT:        'whisper-1',
} as const;

// 현재 모델이 최적이라고 가정하지 않음.
// 각 AI WP 시작 시: 저비용/고속 후보 → 품질 테스트 → 부족 시 상위 승격
```

**변경 파일**: `config/ai-pricing.ts` (확장), 신규 `config/ai-model-config.ts`  
**변경 파일 (route 수정)**: `routes/ai.ts`, `routes/ai-v1.ts`, `routes/story.ts`, `routes/support-respond.ts`  
→ string literal `'gpt-4o-mini'` → `AI_MODEL.DIARY` 등 import  
**DB 영향**: 없음  

**완료 증거 요구**:
- commit SHA
- `grep -r "'gpt-4o-mini'" src/routes/` → 0 lines (모두 config import로 교체됨)
- pricing TC PASS + TC count
- 분류: **UNIT TEST CONFIRMED**

---

### AI01-03 — 전체 saveAiTrace callsite trigger_type + service 명시

**목적**: 모든 saveAiTrace 호출에 trigger_type과 service를 명시. SYSTEM_MAINTENANCE가 USER_ACTION에 섞이지 않도록.

**변경 파일 및 할당 값**:

| 파일 | trigger_type | service |
|------|-------------|---------|
| `routes/ai.ts` (diary) | USER_ACTION | 'gpt' |
| `routes/ai.ts` (whisper) | USER_ACTION | 'whisper' |
| `routes/ai-v1.ts` | USER_ACTION | 'gpt' |
| `routes/support-respond.ts` | USER_ACTION | 'gpt' |
| `routes/support-cases.ts` | USER_ACTION | 'gpt' |
| `routes/story.ts` | USER_ACTION | 'gpt' |
| `routes/parent-curriculum.ts` | USER_ACTION | 'search' |
| `jobs/growth-report-analysis-worker.ts` | SYSTEM_MAINTENANCE | 'analysis' |

**추가**: `support-cases.ts` line 659 `latency_ms=0` 버그 수정 포함.

**DB 영향**: 없음 (JSONB)  

**테스트**:
```bash
pnpm --filter @workspace/api-server test
# 신규 TC: growth-worker saveAiTrace trigger_type=SYSTEM_MAINTENANCE 확인
# 신규 TC: diary saveAiTrace trigger_type=USER_ACTION, service='gpt' 확인
# 신규 TC: support-cases latency_ms > 0 확인
```

**완료 증거 요구**:
- commit SHA, 변경 파일 목록
- trigger_type=SYSTEM_MAINTENANCE TC PASS
- latency_ms 버그 수정 TC PASS
- 분류: **UNIT TEST CONFIRMED** (event_logs 실제 저장 확인은 Production 배포 후)

---

### AI01-04 — Whisper saveAiTrace 추가

**목적**: handleWhisper에 saveAiTrace 추가. Whisper 유료 호출 기록.

**변경 파일**: `routes/ai.ts` (`handleWhisper` 함수)

**Usage Event**:
```
provider:             'openai'
service:              'whisper'
model_or_api:         AI_MODEL.STT   (= 'whisper-1')
feature:              AI_FEATURE.STT  (STT 추가 필요 — ai-feature-enum.ts)
trigger_type:         'USER_ACTION'
logical_request_count: 1
actual_call_count:    1
retry_count:          0
audio_seconds:        null   (클라이언트 duration_ms 미전송 — short-term null)
cost_source:          'UNKNOWN'   (audio_seconds null이면 계산 불가)
estimated_cost_usd:   null
```

**DB 영향**: 없음  
**ai-feature-enum.ts 변경**: `STT: "stt"` 추가 (AI 기능이므로 AI_FEATURE에 추가 적합)

**완료 증거 요구**:
- commit SHA
- TC: handleWhisper 호출 시 saveAiTrace 실행 확인, cost_source=UNKNOWN 확인
- 분류: **UNIT TEST CONFIRMED**

---

### AI01-05 — request_id 외부 Engine 전파

**목적**: Curriculum Engine / Growth Engine 호출에 APP의 request_id를 전파. End-to-end 동일 logical request 추적.

**변경 파일**:
- `lib/parent-curriculum-engine-client.ts` — HTTP 요청에 `X-Request-Id: {request_id}` 헤더 추가
- `lib/growth-report-engine-client.ts` — HTTP 요청에 `X-Request-Id: {request_id}` 헤더 추가
- `routes/parent-curriculum.ts` — engine client 호출 시 request_id 전달
- `jobs/growth-report-analysis-worker.ts` — engine client 호출 시 internal request_id 전달

**각 엔진 응답에서 request_id echo-back 여부**: UNKNOWN (engine 내부 구조 미확인).  
engine이 돌려주지 않아도 APP의 request_id 기준으로 usage log 작성 가능.

**Usage Event (Curriculum)**:
```
provider:              'curriculum_engine'
service:               'search'
feature:               AI_FEATURE.PARENT_CURRICULUM_AI
trigger_type:          'USER_ACTION'
request_id:            APP의 request_id 그대로 사용
logical_request_count: 1
actual_call_count:     1 (또는 retry 포함)
retry_count:           0 (또는 실제 retry)
cost_source:           'UNKNOWN'
estimated_cost_usd:    null
```

**Usage Event (Growth)**:
```
provider:              'growth_engine'
service:               'analysis'
feature:               AI_FEATURE.GROWTH_REPORT_AI
trigger_type:          'SYSTEM_MAINTENANCE'
request_id:            worker internal ID
logical_request_count: 1
actual_call_count:     analysis_retry_count + 1
retry_count:           analysis_retry_count
cost_source:           'UNKNOWN'
estimated_cost_usd:    null
```

**DB 영향**: 없음  

**완료 증거 요구**:
- commit SHA, 변경 파일
- TC: engine client 호출 시 X-Request-Id 헤더 존재 확인
- TC: growth saveAiTrace에 retry_count=analysis_retry_count 확인
- 분류: **UNIT TEST CONFIRMED**

---

### AI01-06 — lib/usage-recorder.ts + SMS usage logging

**목적**: provider-neutral `recordExternalUsage()` 구현 + SMS 호출 기록.

#### SMS Provider 현황 (CONFIRMED)

```
sendSms.ts 공통 dispatcher 존재 — 단일 계층
  ├── sens.ts      (Naver SENS) — env: NAVER_SENS_ACCESS_KEY 등
  ├── coolsms.ts   (CoolSMS)   — env: SMS_API_KEY / SMS_API_SECRET
  ├── aligo.ts     (Aligo)     — 코드 존재
  └── dev.ts       (개발용)    — production에서 차단됨 (NODE_ENV=production 시 오류)
```

**Active provider 결정**: `getActiveProvider()` in `sendSms.ts` — SMS_PROVIDER env var 또는 설정된 env key 기준으로 런타임 결정.  
**Production에서 활성 provider**: INFERRED = Naver SENS (NAVER_SENS_ACCESS_KEY 시크릿 존재).  
**CoolSMS / Aligo**: 코드 존재하나 Production 활성 여부 NOT CONFIRMED.

**계측 위치**: `sendSms.ts`의 공통 `sendSms()` 함수 — provider별 파일에 중복 계측하지 않음.

**Usage Event (SMS)**:
```
provider:              getActiveProvider()  (예: 'naver_sens')
service:               'sms'
feature:               ExternalUsageCategory.SMS  (§7 참조)
trigger_type:          상황에 따라 (인증 = USER_ACTION, 알림 = SYSTEM_MAINTENANCE 또는 USER_ACTION)
logical_request_count: 1
actual_call_count:     1
retry_count:           0 (SMS는 현재 retry 없음)
units:                 수신자 수
estimated_cost_usd:    null
cost_source:           'UNKNOWN'   (계약 단가 코드에 없음)
```

**비용 계산 원칙**: 코드/config에서 SMS 계약 단가 CONFIRMED되지 않음 → `estimated_cost_usd=null`, `cost_source=UNKNOWN`. 운영자가 계약 단가 설정 시 `CONFIGURED_UNIT_PRICE` 적용 가능.

**신규 파일**: `lib/usage-recorder.ts`  
**변경 파일**: `lib/sms/sendSms.ts` (sendSms 함수 끝에 void recordExternalUsage(...).catch(...) 추가)

**완료 증거 요구**:
- commit SHA
- TC: recordExternalUsage 계약 확인 (cost_source=UNKNOWN, estimated_cost_usd=null)
- 분류: **UNIT TEST CONFIRMED**

---

### AI01-07 — R2 usage logging

**목적**: R2 실제 operation 호출 기록.

#### R2 Operation 범위 및 계측 필요성 판단

| Operation | 함수 | 빈도 예상 | 계측 필요성 | service |
|-----------|------|---------|-----------|---------|
| PUT (upload) | `uploadToR2` | 높음 (영상/사진 업로드마다) | HIGH ✅ | `r2_put` |
| GET (download) | `downloadFromR2` | 중간 (서버 측 다운로드 경로) | MEDIUM ✅ | `r2_get` |
| DELETE | `deleteFromR2` | 낮음 (정리 작업) | MEDIUM ✅ | `r2_delete` |

**모두 기록.** CloudFlare R2는 operation 수와 전송 바이트 모두 비용 요소.

**Usage Event (R2 PUT 예시)**:
```
provider:              'cloudflare_r2'
service:               'r2_put'
feature:               ExternalUsageCategory.R2_STORAGE
trigger_type:          USER_ACTION (또는 SYSTEM_MAINTENANCE)
actual_call_count:     1
bytes:                 업로드 파일 크기 (bytes)  ← operation count와 분리
estimated_cost_usd:    null
cost_source:           'UNKNOWN'
```

**units 필드**: R2에서는 사용하지 않음. `actual_call_count=1` + `bytes`로 분리.

**변경 파일**: `lib/objectStorage.ts`  

**완료 증거 요구**:
- commit SHA
- TC: uploadToR2 호출 시 r2_put usage event, bytes 확인
- 분류: **UNIT TEST CONFIRMED**

---

### AI01-08 — GET /super/ai-cost-overview API

**목적**: event_logs category='AI' 기반 SQL aggregate. Dashboard 조회 자체는 외부 API 호출 없음.

**변경 파일**: `routes/super.ts` (신규 endpoint 추가)

**집계 항목**:

```
TODAY / MONTH summary:
  trigger_type별: USER_ACTION / SYSTEM_MAINTENANCE / ADMIN_MANUAL / BATCH_JOB
    - logical_requests (SUM logical_request_count)
    - actual_calls     (SUM actual_call_count)
    - retries          (SUM retry_count)
    - known_cost_usd   (SUM estimated_cost_usd WHERE cost_source != 'UNKNOWN')
    - unknown_calls    (COUNT WHERE cost_source = 'UNKNOWN')

Feature 테이블:
  feature | logical_requests | actual_calls | known_cost | unknown_calls | avg_cost/call | input_tokens | output_tokens | errors

Provider/Service/Model 테이블:
  provider | service | model_or_api | actual_calls | known_cost | unknown_calls

Pool 테이블:
  pool_id | actual_calls | known_cost

Unit Economics:
  feature별 avg known_cost / logical_request (where cost_source != UNKNOWN)
```

**DB 영향**: READ ONLY  

**완료 증거 요구**:
- commit SHA
- TC: /super/ai-cost-overview 응답 구조 확인 (trigger_type 분리, logical vs actual 분리)
- curl 예시 응답 첨부 (민감정보 제외)
- 분류: **UNIT TEST CONFIRMED**

---

### AI01-09 — Super Admin [AI비용] 탭 UI

**목적**: AI01-08 API 기반 Super Admin 웹 UI.

**변경 파일**: `artifacts/swimnote-web/src/`

**화면 구성**:
- TODAY / MONTH 요약 카드 (trigger_type별 분리)
- Feature 테이블 (Calls actual/logical / Known Cost / Unknown Calls / Avg/Call / Input / Output / Errors)
- Provider/Service/Model 테이블
- Pool 테이블
- Unit Economics 섹션

**완료 증거 요구**:
- commit SHA
- 수동 확인: 화면 렌더링 캡처 또는 스크린샷
- 분류: **PRODUCTION CONFIRMED** (실제 Super Admin 화면 렌더링)

---

## 4. Corrected Cost Control Plan

### Feature Kill Switch (현재 가능)

```
feature_flags 테이블 (기존 인프라 재사용)
  global_enabled = false → 즉시 해당 AI 기능 비활성화
  pool-level override → feature_flag_overrides 테이블

대상 flag 예:
  'growth_report_worker'    — Growth 백그라운드 비용 통제
  'support_ai'              — Support AI 비활성
  'parent_curriculum_ai'    — Curriculum AI 비활성
  'ai_diary'                — AI 일지 비활성
```

### Worker Pause (수정)

**기존 계획 (URL 제거 방식) → 폐기.**  
GROWTH_REPORT_ENGINE_URL 공백은 emergency workaround로만 취급.

**정상 pause 방법**: feature_flags 테이블의 `growth_report_worker` 플래그.  
Growth Worker cron tick 시작 시 `await isFeatureEnabled('growth_report_worker')`를 체크하고 false이면 해당 tick 건너뜀.  
→ Super Admin에서 1클릭으로 pause 가능. Engine URL 자체는 건드리지 않음.

**AI01-03 또는 별도 Step에서 구현.**

### Worker Frequency / Batch / Retry 통제 현황

**현재 hardcoded 위치** (`jobs/growth-report-analysis-worker.ts`):

| 항목 | 현재 값 | 위치 |
|------|--------|------|
| cron interval | `*/5 * * * *` (5분) | line ~380 |
| BATCH_LIMIT | `10` | const BATCH_LIMIT = 10 |
| max retry | `GROWTH_REPORT_MAX_RETRY_COUNT` env var 이미 존재 | line ~65 |

**WP-AI-01에서**: Observability 확보 + feature_flag pause 구현까지.  
**BATCH_LIMIT env화**: WP-AI-01 또는 별도 Step에서 `GROWTH_REPORT_BATCH_LIMIT` env var로 추출.  
**interval env화**: PHASE 8 (실제 baseline 데이터 확보 후 조정).  
**자동 threshold/alert**: PHASE 8.

### Model Control Point

`ai-model-config.ts`가 단순 하드코딩 제거가 아닌 **Quality/Latency/Cost 비교 후 교체 단일 제어점** 역할.  
각 AI WP 시작 시 저비용/고속 후보 모델부터 실제 테스트 → 품질 부족 시 상위 승격.  
현재 gpt-4o-mini가 최적이라고 가정하지 않음.

---

## 5. Corrected Common Usage Feature Taxonomy (Item 7 수정)

### 문제: AI_FEATURE에 SMS/R2 추가 시 enum 의미 훼손

### 권장 방안: **Option B — AI_FEATURE + ExternalUsageCategory 분리 union**

```typescript
// lib/ai-feature-enum.ts — 기존 AI_FEATURE 유지
export const AI_FEATURE = {
  TEACHER_AI_DIARY: "teacher_diary",
  PARENT_CURRICULUM_AI: "parent_curriculum_search",
  GROWTH_REPORT_AI: "growth_report_ai",
  STORY_SUMMARY: "story_summary",
  SUPPORT_AI: "support_ai",
  STT: "stt",               // AI01-04에서 추가 (Whisper는 AI 기능)
  VIDEO_ANALYSIS: "video_analysis",
  // ... 기존 유지
} as const;

// lib/usage-recorder.ts 내부 — 신규 non-AI 카테고리
export const EXTERNAL_USAGE_CATEGORY = {
  SMS:        "sms",
  R2_STORAGE: "r2_storage",
  // future: VIDEO_PROCESSING, DOCUMENT_API, etc.
} as const;

// Common UsageEvent의 feature 필드 타입:
type UsageFeature = AiFeature | string;   // JSONB 저장이므로 runtime string 허용
// Dashboard 집계는 문자열 기준 GROUP BY — 타입 구분 불필요
```

**이유**:
- AI_FEATURE enum은 AI 기능 전용 유지 (기존 DB 값과 호환)
- SMS/R2는 EXTERNAL_USAGE_CATEGORY로 분리
- 대규모 리팩터링 없음
- Dashboard는 GROUP BY feature (string) — 양쪽 모두 동일 event_logs에서 집계 가능
- STT(Whisper)는 AI 기능이므로 AI_FEATURE에 추가 적합

---

## 6. Professional AI Engine 구분 (Item 13 수정)

다음 세 가지는 동일하다고 가정하지 않음:

| 항목 | 현황 |
|------|------|
| Parent Curriculum Engine | `PARENT_CURRICULUM_ENGINE_URL` — 별도 외부 서버. 내부 구조 NOT CONFIRMED |
| Growth Report Engine | `GROWTH_REPORT_ENGINE_URL` — 별도 외부 서버. 내부 구조 NOT CONFIRMED |
| SWIMNOTE Professional AI Engine (약 20k DB) | APP repository에 없음. 존재 여부 INFERRED (별도 AI 환경) |

이 세 엔진이 동일 infrastructure인지, 연결돼 있는지는 PHASE 3 Professional Retrieval Audit에서 별도 확인.  
APP repository만 보고 결론 내리지 않음.

---

## 7. Updated Verification Matrix

| Step | 완료 증거 | 분류 |
|------|---------|------|
| AI01-01 | commit SHA + buildTraceMetadata TC (trigger_type, service, cost_source, actual_call_count, logical_request_count 존재) + TC count PASS | UNIT TEST CONFIRMED |
| AI01-02 | commit SHA + pricing TC PASS + `grep 'gpt-4o-mini' src/routes/` → 0 lines | UNIT TEST CONFIRMED |
| AI01-03 | commit SHA + trigger_type=SYSTEM_MAINTENANCE TC PASS + latency_ms TC PASS + TC count | UNIT TEST CONFIRMED |
| AI01-04 | commit SHA + Whisper saveAiTrace TC (cost_source=UNKNOWN, audio_seconds=null) PASS | UNIT TEST CONFIRMED |
| AI01-05 | commit SHA + X-Request-Id 헤더 TC PASS + growth retry_count TC PASS | UNIT TEST CONFIRMED |
| AI01-06 | commit SHA + recordExternalUsage TC (cost_source=UNKNOWN) PASS | UNIT TEST CONFIRMED |
| AI01-07 | commit SHA + R2 PUT usage TC (actual_call_count=1, bytes 존재) PASS | UNIT TEST CONFIRMED |
| AI01-08 | commit SHA + /super/ai-cost-overview TC PASS + curl 응답 샘플 | UNIT TEST CONFIRMED |
| AI01-09 | Super Admin 화면 렌더링 확인 | PRODUCTION CONFIRMED |
| Render 배포 후 | event_logs에 실제 AI record 저장 확인 (trigger_type, service, actual_call_count 포함) | PRODUCTION CONFIRMED |

**UNIT TEST CONFIRMED ≠ PRODUCTION CONFIRMED.**  
Production 연결 완료 보고는 Render 배포 + 실제 event_logs 저장 확인 후에만 허용.

---

## 8. First Implementation Step

**AI01-01 — AiTraceContext 공통 Contract 확장**

`lib/ai-trace-service.ts`에서:
1. `AiTraceContext` interface에 아래 optional 필드 추가:
   - `trigger_type?: 'USER_ACTION' | 'SYSTEM_MAINTENANCE' | 'ADMIN_MANUAL' | 'BATCH_JOB'`
   - `service?: string`
   - `cost_source?: 'TOKEN_PRICING' | 'CONFIGURED_UNIT_PRICE' | 'PROVIDER_REPORTED' | 'PUBLIC_PRICING' | 'UNKNOWN'`
2. `AiTraceSuccess` interface에:
   - `retry_count?: number`
   - `audio_seconds?: number | null`
   - `logical_request_count?: number`
   - `actual_call_count?: number`
3. `cached_tokens` → `cached_input_tokens` 이름 통일 (기존 callsite backward-compat 유지)
4. `buildTraceMetadata()`에서 신규 필드를 metadata JSONB에 포함

**아직 실행하지 않는다.** 운영자 Step 승인 후 구현.

---

*이 문서는 SWIMNOTE-AI-MASTER-IMPLEMENTATION-PLAN.md의 수정본입니다.*  
*코드 수정 없음. 운영자 승인 후 AI01-01부터 순서대로 진행합니다.*
