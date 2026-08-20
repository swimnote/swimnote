# [WP-AI-01 COST OBSERVABILITY DESIGN REPORT]

생성일: 2026-08-21  
분기: deploy-photo-clone  
상태: DESIGN AUDIT ONLY — 코드 수정 없음, DB write 없음

---

## 1. Existing Logging Structures (현재 계측 구조 전수조사)

### 1-A. event_logs (superAdminDb)

```sql
-- 현재 실제 사용 컬럼
id          TEXT PRIMARY KEY
pool_id     TEXT
category    TEXT  -- 'AI', 'SUPPORT', 'BILLING', ...
actor_id    TEXT
target      TEXT  -- request_id가 들어감
description TEXT
metadata    JSONB
created_at  TIMESTAMPTZ
```

AI trace는 `category = 'AI'`로 이미 이 테이블에 저장 중.  
JSONB metadata에 아래 필드가 실제로 존재함:

| 필드 | 저장 여부 | 비고 |
|------|-----------|------|
| request_id | ✅ | |
| internal_id | ✅ | |
| status | ✅ | SUCCESS/FAILED |
| feature | ✅ | AI_FEATURE enum 값 |
| model | ✅ (nullable) | 외부엔진 경유 시 null |
| pool_mode | ✅ | |
| generation_mode | ✅ | |
| latency_ms | ✅ | |
| input_tokens | ✅ (nullable) | |
| output_tokens | ✅ (nullable) | |
| total_tokens | ✅ (nullable) | |
| cost.total_cost_usd | ✅ (nullable) | calculateAiCost() 계산값 |
| cost.input_cost_usd | ✅ | |
| cost.output_cost_usd | ✅ | |
| cost.pricing_source | ✅ | |
| provider | ✅ | "openai" 또는 null |
| cached_tokens | ✅ (nullable) | |
| user_role | ✅ | |
| error_stage / error_code | ✅ | FAILED 시 |
| **trigger_type** | ❌ MISSING | USER_ACTION 등 없음 |
| **audio_seconds** | ❌ MISSING | Whisper STT 없음 |
| **request_count** | ❌ MISSING | 외부엔진용 |
| **units** | ❌ MISSING | SMS/R2용 |
| **estimated_cost_usd** | ❌ MISSING | 외부엔진 unknown 시 |
| **cost_source** | ❌ MISSING | TOKEN_PRICING/UNKNOWN 등 |

### 1-B. saveAiTrace — 현재 호출처

| 파일 | feature | trigger_type | 비고 |
|------|---------|-------------|------|
| routes/ai.ts | TEACHER_AI_DIARY | ❌ 없음 | 응답 후 void (best-effort) |
| routes/ai-v1.ts | TEACHER_AI_DIARY | ❌ 없음 | parser_v1 파이프라인 |
| routes/support-respond.ts | SUPPORT_AI | ❌ 없음 | LLM 호출 시만 |
| routes/support-cases.ts | SUPPORT_AI | ❌ 없음 | **latency_ms=0 버그** |
| routes/story.ts | STORY_SUMMARY | ❌ 없음 | void (best-effort) |
| routes/parent-curriculum.ts | PARENT_CURRICULUM_AI | ❌ 없음 | |
| jobs/growth-report-analysis-worker.ts | GROWTH_REPORT_AI | ❌ 없음 | worker job |

**결론**: saveAiTrace는 6개 feature에서 호출됨. `trigger_type` 필드 자체가 AiTraceContext에 없음.

### 1-C. ai-pricing.ts (현재)

```typescript
// 지원 모델: gpt-4o-mini만
MODEL_PRICING = {
  "gpt-4o-mini": {
    input_per_token_usd:  0.00000015,  // $0.15/1M
    output_per_token_usd: 0.00000060,  // $0.60/1M
  }
}
// 누락:
// - cached_input_per_token_usd (gpt-4o-mini: $0.075/1M = 50% 할인)
// - gpt-4o 가격
// - whisper-1 가격 ($0.006/min)
// - 다른 모델 없음
```

### 1-D. AiGateway (lib/runtime/ai-gateway.ts)

- **완전히 구현됨**: timeout, retry, structured output, token usage 추출 (cached_tokens 포함)
- **현재 production import: 0개** — 주석에 "기존 route에서 import 금지 (RT2 이후 단계적 연결)" 명시
- AiGateway 자체에 saveAiTrace 호출 없음

### 1-E. Whisper STT (routes/ai.ts `handleWhisper`)

```typescript
// 현재 로깅: console.log만
console.log(`[AI/whisper:${internalId}] 완료 elapsed=${elapsedMs}ms len=${transcript.length}chars`);
// saveAiTrace: ❌ 전혀 없음
// audio_seconds: ❌ 측정 안 함
// file.size(bytes)는 있지만 duration 없음
```

**Whisper 가격**: $0.006/분 (OpenAI 공식, 2024-11 기준)  
현재 audio duration을 측정하지 않아서 비용 계산 불가. file.size로 추정도 신뢰 불가 (압축률 차이).

### 1-F. Growth Report Engine Client

```typescript
// 응답 타입 GrowthReportAnalysisResponse:
// - model: 없음 (ENGINE 내부에서 사용하는 모델 불명)
// - input_tokens: 없음
// - output_tokens: 없음
// - cost: 없음
// 있는 것: request_id, analysis_status, latency 없음 (HTTP fetch 시작~종료로만 측정)
```

현재 worker에서 saveAiTrace 호출 시 `model: null, input_tokens: null, output_tokens: null` → cost 자동으로 null.

### 1-G. Parent Curriculum Engine Client

```typescript
// 응답 타입 ParentCurriculumEngineResponse:
meta?: {
  model?:      string;     // ENGINE이 제공하면 있을 수 있음 (optional)
  latency_ms?: number;     // ENGINE 내부 latency (optional)
  // input_tokens, output_tokens: 없음
}
```

`meta.model`이 있더라도 token usage가 없어서 비용 계산 불가.

### 1-H. SMS Providers

| Provider | 현재 로깅 |
|----------|-----------|
| SENS (Naver) | console.log 발송 시도만 (`phone.slice(0,3)****`) |
| CoolSMS | 미확인 (별도 파일) |
| Aligo | 미확인 (별도 파일) |
| **성공 로그** | ❌ 없음 (모두) |
| **비용 기록** | ❌ 없음 |
| **실패 기록** | console.error 정도만 |

SENS 요금: 건당 약 ₩8~10 (단문), CoolSMS/Aligo 유사.  
SMS는 event_logs에 아무것도 기록되지 않음.

### 1-I. Cloudflare R2

```typescript
// objectStorage.ts
export async function uploadToR2(key, buffer, contentType, type)
export async function downloadFromR2(key, type)
export async function deleteFromR2(key, type)
// 모두: try-catch + console.error만, 비용 기록 없음
// photo_assets_meta / video_assets_meta 테이블에 파일 수/크기는 별도 저장됨
```

R2 요금: 저장 $0.015/GB/월, 쓰기 $0.0036/만 작업, 읽기 $0.00036/만 작업.  
현재 infra-usage.ts가 `photo_assets_meta`, `video_assets_meta`에서 파일 수/크기 집계하지만 **API call 횟수는 기록하지 않음**.

### 1-J. Super Admin 기존 Analytics/Log UI

```
GET /super/infra-usage/summary     → DB 크기, 저장소 용량 (비용 없음)
GET /super/infra-usage/storage     → R2 파일 수, 사용량 (API call 수 없음)
GET /super/analytics-overview      → analytics_events 기반 MAU proxy
GET /super/platform-metrics        → 플랫폼 실사용량 지표
GET /super/ai-traces (추정)        → listAiTraces() 있지만 route 미확인
```

현재 AI 비용 집계 전용 엔드포인트: **없음**.

---

## 2. event_logs 재사용 YES/NO

**YES** — 조건부

`event_logs` 단일 테이블로 Super Admin AI/API 비용 dashboard를 만들 수 있음.

**근거**:
- 이미 AI 호출이 `category='AI'`로 저장되고 있음
- JSONB metadata에 `feature`, `model`, `total_cost_usd`, `pool_id`, `created_at` 저장됨
- `metadata->>'feature'`로 GROUP BY 집계 이미 가능 (listAiTraces에 WHERE 구조 존재)

**단, 2가지 조건이 필요**:
1. `trigger_type` 필드를 metadata JSONB에 추가 (column 추가 없이 JSONB 확장만으로 가능)
2. SMS/R2/Whisper를 `category='USAGE'`(또는 `'API_USAGE'`)로 같은 테이블에 기록

새 테이블 불필요. Migration 최소화 가능.

---

## 3. Required Fields (누락 필드 목록)

현재 AiTraceContext에서 추가해야 할 최소 필드:

| 필드 | 타입 | 현재 | 필요 |
|------|------|------|------|
| trigger_type | enum | ❌ | USER_ACTION / SYSTEM_MAINTENANCE / ADMIN_MANUAL / BATCH_JOB |
| audio_seconds | number? | ❌ | Whisper STT용 |
| request_count | number | ❌ | 외부엔진 1회=1 |
| units | number | ❌ | SMS 건수, R2 작업 수 |
| estimated_cost_usd | number? | nullable | 외부엔진 unknown 시 null |
| cost_source | enum | ❌ | TOKEN_PRICING / CONFIGURED_UNIT_PRICE / PROVIDER_REPORTED / UNKNOWN |

**JSONB metadata 확장만으로 추가 가능** → DB column 추가 없음 → Migration 없음.

---

## 4. Common UsageEvent Contract (설계)

모든 유료 API 호출에서 공통으로 남길 최소 contract:

```typescript
interface UsageEvent {
  // ── 식별 ──────────────────────────────────────────
  provider:        string;        // "openai" | "naver_sens" | "cloudflare_r2" | "growth_report_engine" | "curriculum_engine"
  service:         string;        // "gpt" | "whisper" | "sms" | "r2_put" | "r2_delete" | "analysis"
  model_or_api:    string | null; // "gpt-4o-mini" | "whisper-1" | null (외부엔진 미제공 시)
  feature:         AiFeature;     // AI_FEATURE enum 값
  trigger_type:    TriggerType;   // USER_ACTION | SYSTEM_MAINTENANCE | ADMIN_MANUAL | BATCH_JOB

  // ── 컨텍스트 ──────────────────────────────────────
  pool_id:         string | null;
  request_id:      string;
  timestamp:       string;        // ISO 8601

  // ── Usage ──────────────────────────────────────────
  input_tokens:          number | null;  // OpenAI GPT
  cached_input_tokens:   number | null;  // OpenAI cached prompt
  output_tokens:         number | null;  // OpenAI GPT
  audio_seconds:         number | null;  // Whisper STT
  request_count:         number;         // 외부엔진 call 수 (항상 1)
  units:                 number | null;  // SMS: 건수, R2: 작업 수

  // ── Cost ───────────────────────────────────────────
  estimated_cost_usd:    number | null;  // 계산 불가 시 null (추정 금지)
  cost_source:           CostSource;     // TOKEN_PRICING | CONFIGURED_UNIT_PRICE | PROVIDER_REPORTED | UNKNOWN

  // ── Runtime ────────────────────────────────────────
  latency_ms:   number;
  retry_count:  number;   // 0 = 재시도 없음
  success:      boolean;
  error_type:   string | null;
}

type TriggerType = "USER_ACTION" | "SYSTEM_MAINTENANCE" | "ADMIN_MANUAL" | "BATCH_JOB";
type CostSource  = "TOKEN_PRICING" | "CONFIGURED_UNIT_PRICE" | "PROVIDER_REPORTED" | "UNKNOWN";
```

**PII 저장 금지**: prompt 내용, 학생 이름, 학부모 이름, 전화번호, 응답 원문 — 전부 미포함.

---

## 5. OpenAI GPT 비용 계산

### 현재 (ai-pricing.ts)

```typescript
gpt-4o-mini: input $0.15/1M, output $0.60/1M
// 누락: cached input ($0.075/1M), gpt-4o 별도
```

### 필요한 확장 (코드 한 군데만 수정)

```typescript
// ai-pricing.ts에 추가할 내용 (설계안, 실행 금지)
const MODEL_PRICING = {
  "gpt-4o-mini": {
    input_per_token_usd:         0.00000015,   // $0.15/1M
    cached_input_per_token_usd:  0.000000075,  // $0.075/1M (50% 할인)
    output_per_token_usd:        0.00000060,   // $0.60/1M
  },
  "gpt-4o": {
    input_per_token_usd:         0.0000025,    // $2.50/1M
    cached_input_per_token_usd:  0.00000125,   // $1.25/1M
    output_per_token_usd:        0.000010,     // $10/1M
  },
}
```

**원칙**: 가격 변경 시 `ai-pricing.ts` 한 파일만 수정. route 코드에 하드코딩 금지. 현재 구조 올바름.

---

## 6. Whisper STT 비용 계산

### 현재 상태

```typescript
// handleWhisper: saveAiTrace 없음, audio_seconds 없음
// file.size(bytes) 있음 → duration 추정 불가 (압축률 가변)
```

### 설계안

```typescript
// WHISPER_PRICING (ai-pricing.ts에 추가 — 설계)
WHISPER_PRICING = {
  "whisper-1": {
    per_second_usd: 0.0001,  // $0.006/min → $0.0001/sec
  }
}
// audio_seconds를 알아야 비용 계산 가능
// audio_seconds를 모르면 → estimated_cost_usd=null, cost_source=UNKNOWN
```

**문제**: OpenAI Whisper API 응답에 duration 정보가 없음. 클라이언트가 duration을 전송하거나, 서버에서 ffprobe 등으로 측정해야 함.

**현실적 방안**:
- 단기: `audio_seconds = null`, `cost_source = UNKNOWN`으로 call 횟수만 기록
- 중기: 클라이언트에서 `duration_ms`를 multipart form에 추가로 전송

---

## 7. External Engine Handling (Growth Report / Curriculum)

### 원칙

**비용을 모르면 null — 추정값 생성 금지** (WP-AI-01 §5)

```typescript
// Growth Report Engine 응답에 token/model/cost 없음 → 설계
{
  provider:           "growth_report_engine",
  service:            "analysis",
  model_or_api:       null,                  // 엔진이 제공 안 함
  trigger_type:       "SYSTEM_MAINTENANCE",  // worker가 실행
  request_count:      1,
  estimated_cost_usd: null,                  // 계산 불가
  cost_source:        "UNKNOWN",
  latency_ms:         (HTTP fetch 시작~종료),
}

// Curriculum Engine 응답에 meta.model이 있을 수 있음
// 있어도 token usage 없으면 비용 계산 불가 → null
{
  provider:           "curriculum_engine",
  service:            "search",
  model_or_api:       meta?.model ?? null,   // 있으면 기록, 없으면 null
  trigger_type:       "USER_ACTION",          // 학부모가 질문
  estimated_cost_usd: null,
  cost_source:        "UNKNOWN",
}
```

### 운영자 단가 입력 구조 (선택적 제안)

운영자가 "건당 계약단가"를 설정할 수 있는 구조가 합리적함:

```typescript
// swimming_pools 또는 별도 config 테이블에 (migration 필요 — 현재 단계에서 실행 금지)
GROWTH_ENGINE_UNIT_PRICE_KRW = 50;      // 건당 ₩50 예시
CURRICULUM_ENGINE_UNIT_PRICE_KRW = 30;  // 건당 ₩30 예시
```

cost_source = `"CONFIGURED_UNIT_PRICE"` 로 명시. 단, 현재 단계에서 구현 대상 아님 — 먼저 call 횟수만 기록.

---

## 8. SMS Handling

```typescript
// SMS 비용 계측 설계
{
  provider:           "naver_sens",  // 또는 "coolsms" | "aligo"
  service:            "sms",
  model_or_api:       null,
  feature:            "AUTH_SMS",    // AI_FEATURE에 추가 필요
  trigger_type:       "USER_ACTION",  // 사용자가 인증번호 요청
  units:              1,              // 발송 건수
  estimated_cost_usd: 0.000007,       // ₩8 / KRW→USD 환율 기준 (CONFIGURED_UNIT_PRICE)
  cost_source:        "CONFIGURED_UNIT_PRICE",  // provider 청구서로만 실비 확인
  success:            (HTTP 200 응답 여부),
  latency_ms:         (발송 API 응답 시간),
}
```

**현재 SMS 비용**: provider별 청구서 기준. SENS는 단문 건당 약 ₩8.  
dashboard에서는 `units` (발송 건수) 집계로 운영자가 개략 비용 추산 가능.

---

## 9. R2 Handling

```typescript
// R2 비용 계측 설계
{
  provider:           "cloudflare_r2",
  service:            "r2_put",   // 또는 "r2_get" | "r2_delete"
  model_or_api:       null,
  feature:            "PHOTO_UPLOAD",  // 또는 "VIDEO_UPLOAD"
  trigger_type:       "USER_ACTION",
  units:              1,               // 작업 건수
  estimated_cost_usd: 0.00000036,      // $0.0036/만 = $0.00000036/건 (PUT)
  cost_source:        "TOKEN_PRICING", // 실제로는 공개 요금표 기준
  latency_ms:         (S3 send() 응답 시간),
}
```

**현재 photo_assets_meta / video_assets_meta에 파일 메타가 저장되므로**  
R2 PUT 이벤트는 해당 테이블에서 이미 집계 가능 (infra-usage.ts 참조).  
R2 GET (다운로드) 횟수는 현재 어디에도 기록 없음.

**현실적 판단**: R2 PUT은 photo_assets_meta로 이미 추적 가능. GET/DELETE의 별도 event_logs 기록이 필요한지는 운영자 우선순위에 따라 결정.

---

## 10. Trigger Type Classification (분류 기준)

| trigger_type | 해당 상황 |
|---|---|
| USER_ACTION | 교사 AI 일지 생성, 학부모 커리큘럼 질문, Story 요약, STT, 사용자 인증SMS |
| SYSTEM_MAINTENANCE | Growth Report Analysis Worker (5분마다), background retry, OTA 자동 처리 |
| ADMIN_MANUAL | Super Admin이 수동으로 실행하는 분석, 지식 검토 승인 트리거 |
| BATCH_JOB | 정기 scheduled job (현재 makeup-expiry 1시간, retry-queue 5분) |

**Growth Report Worker**: `SYSTEM_MAINTENANCE` — 사용자가 직접 실행하지 않음.  
이 분류가 가장 중요 — 사용자가 야기한 비용 vs 시스템 자체 비용을 명확히 구분.

---

## 11. AiGateway 통합 전략

### 질문: A. AiGateway 내부에 usage logging을 넣는 것이 좋은가, B. 별도 UsageRecorder가 좋은가?

**추천: B — 별도 UsageRecorder (recordUsageEvent)**

**이유**:
- AiGateway의 책임: OpenAI HTTP 전송 + retry + timeout + structured output. 순수 transport layer.
- usage logging은 비즈니스 컨텍스트(feature, pool_id, trigger_type)가 필요 — route 레벨에서만 알 수 있음.
- AiGateway에 saveAiTrace를 넣으면 route 수준의 컨텍스트(pool_id, trigger_type, feature)를 Gateway에 전달해야 함 → 결합도 증가.
- 별도 `recordUsageEvent()`로 분리하면 GPT 외 SMS/R2/외부엔진도 동일 함수로 처리 가능 (provider-neutral).

**설계안**:

```typescript
// lib/usage-recorder.ts (신규 — 현재 코드 수정 금지, 설계만)
export async function recordUsageEvent(event: UsageEvent): Promise<void> {
  // event_logs에 category='USAGE' (또는 'AI'를 확장해서 모든 provider 수용)
  // 실패해도 throw하지 않음 — best-effort telemetry
  // await superAdminDb.execute(INSERT...) .catch(err => console.error(...))
}
```

**사용 패턴**:
```typescript
// Route에서: (AiGateway 호출 후)
const gwResult = await callGateway(req);
// res.json(...) 전송 후:
void recordUsageEvent({
  provider:        "openai",
  feature:         AI_FEATURE.TEACHER_AI_DIARY,
  trigger_type:    "USER_ACTION",
  pool_id:         poolId,
  input_tokens:    gwResult.usage.input_tokens,
  ...
});

// Worker에서:
void recordUsageEvent({
  provider:        "growth_report_engine",
  trigger_type:    "SYSTEM_MAINTENANCE",
  estimated_cost_usd: null,
  cost_source:     "UNKNOWN",
  ...
});
```

---

## 12. External API 공통 계측 (provider-neutral 구조)

**YES — `recordExternalUsage()` 단일 함수로 통일**이 적합함.

```typescript
// lib/usage-recorder.ts
export async function recordExternalUsage({
  provider,        // "naver_sens" | "cloudflare_r2" | "growth_report_engine" | ...
  service,         // "sms" | "r2_put" | "analysis" | ...
  feature,         // AI_FEATURE enum 또는 INFRA_FEATURE enum
  triggerType,     // TriggerType
  units,           // 건수, 작업 수
  estimatedCostUsd, // null if unknown
  costSource,
  latencyMs,
  success,
  errorType,
  poolId,
  requestId,
}: ExternalUsageParams): Promise<void>
```

**재사용 가능 범위**: GPT, Whisper, SMS, R2, Growth Engine, Curriculum Engine, 향후 Video API, Document API.  
OpenAI 전용 구조로 만들지 않음 — AI_FEATURE enum을 FEATURE enum으로 확장하면 모든 provider 통합 가능.

---

## 13. Super Admin Aggregation Queries

### Q: 최근 1시간/24시간 집계가 event_logs 성능상 가능한가?

**YES** — 조건:
- `created_at` 인덱스가 있어야 함 (event_logs에 인덱스 존재 여부 미확인 — 권장)
- `category = 'AI'` 또는 `'USAGE'` 필터 + `created_at` 범위 필터 조합
- `metadata->>'feature'` 로 GROUP BY (JSONB 연산이므로 GIN 인덱스 추가 시 성능 개선)

**1시간/24시간 집계 SQL 패턴** (설계):

```sql
-- feature별 오늘 비용 집계
SELECT
  metadata->>'feature'                          AS feature,
  metadata->>'trigger_type'                     AS trigger_type,  -- 추가 후
  COUNT(*)                                       AS call_count,
  COUNT(*) FILTER (WHERE metadata->>'status' = 'FAILED') AS error_count,
  SUM((metadata->'cost'->>'total_cost_usd')::float)      AS total_cost_usd,
  AVG((metadata->'cost'->>'total_cost_usd')::float)      AS avg_cost_usd,
  SUM((metadata->>'input_tokens')::int)                  AS total_input_tokens,
  SUM((metadata->>'output_tokens')::int)                 AS total_output_tokens
FROM event_logs
WHERE category = 'AI'
  AND created_at >= NOW() - INTERVAL '24 hours'
GROUP BY feature, trigger_type
ORDER BY total_cost_usd DESC NULLS LAST;

-- provider/model별 집계
SELECT
  metadata->>'provider'                         AS provider,
  metadata->>'model'                            AS model,
  COUNT(*)                                       AS call_count,
  SUM((metadata->'cost'->>'total_cost_usd')::float) AS total_cost_usd
FROM event_logs
WHERE category IN ('AI', 'USAGE')
  AND created_at >= date_trunc('month', NOW())
GROUP BY provider, model;

-- 비용 미확인 외부 API
SELECT
  metadata->>'provider'                         AS provider,
  COUNT(*)                                       AS call_count
FROM event_logs
WHERE category IN ('AI', 'USAGE')
  AND metadata->>'cost_source' = 'UNKNOWN'
  AND created_at >= date_trunc('month', NOW())
GROUP BY provider;
```

---

## 14. Super Admin UI 위치

현재 Super Admin 구조 (`routes/super.ts`):

```
/super/operators            — 운영자 목록
/super/platform-metrics     — 플랫폼 지표
/super/analytics-overview   — 앱 사용 분석
/super/infra-usage/*        — DB/Storage 인프라
/super/knowledge/*          — CS Knowledge Review
```

**추천 위치**: `/super/ai-cost-overview` 신규 엔드포인트 + 웹 탭 추가

```
현재 Super Admin 탭 구조:
[대시보드] [운영자] [플랫폼지표] [분석] [인프라] [CS지식]
                                                     ↓ 여기 추가
                                                  [AI비용]
```

**최소 화면 구성**:
```
AI/API COST DASHBOARD

[오늘] [이번달] 탭

▶ TRIGGER TYPE 별
  USER ACTION         $X.XX (N건)
  SYSTEM MAINTENANCE  $X.XX (N건)  ← 가장 중요
  ADMIN MANUAL        $X.XX (N건)
  BATCH JOB           $X.XX (N건)

▶ 기능별
  Feature | Calls | Cost | Avg/Call | Input Tokens | Output Tokens | Errors

▶ Provider/Model별
  Provider | Model/API | Calls | Cost

▶ 비용 미확인 외부 API
  Provider | Calls | Cost=UNKNOWN
```

**이미 있는 listAiTraces() 활용** — 집계 쿼리만 추가하면 됨.

---

## 15. Performance Impact

### event_logs INSERT 방식 현재

```typescript
// saveAiTrace: async INSERT, 응답 후 void — 이미 best-effort
void saveAiTrace({...}).catch(err => console.error(...));
// res.json() 이후에 호출 → 사용자 응답 지연 없음
```

**현재 구조가 이미 올바름**. best-effort telemetry.

### transaction coupling 여부

- 현재: AI 응답 트랜잭션과 saveAiTrace INSERT는 완전히 분리됨
- 설계: 동일 원칙 유지 — usage log INSERT는 별도 non-transactional

### 성능 추정

- event_logs INSERT 1건: ~1-5ms (Supabase PostgreSQL, 정상 레이턴시)
- 사용자 요청과 무관(async void) → production latency 증가 없음
- JSONB metadata 크기: 현재 ~500bytes/트레이스 → 용량 문제 없음

---

## 16. Failure Policy

**결론: best-effort telemetry 원칙 적합 — 현재 구조 그대로 유지 권장**

```
AI/API 본 호출 성공 + usage log 실패
→ 사용자 요청: 성공 유지 ✅
→ 로그 실패: console.error로 operational warning ✅
→ 사용자 에러 응답: 없음 ✅
```

**근거**:
- usage log 실패는 관찰가능성 저하이지, 서비스 결함 아님
- 사용자는 비용 추적 실패를 알 필요가 없음
- transactional usage logging은 DB 부하 증가, 사용자 응답 latency 위험

단, **critical하게 비용이 큰 SYSTEM_MAINTENANCE 호출**은 로그 실패 시 별도 metric 카운터(in-memory)로 최소한의 "이번 서버 프로세스에서 N건 로깅 실패" 집계를 남기는 것을 중기 개선으로 제안.

---

## 17. DB Migration Required YES/NO

### 현재 단계: **NO**

- `AiTraceContext` interface에 `trigger_type` 등 필드 추가 → TypeScript 코드 변경만
- `event_logs.metadata` JSONB에 새 키 추가 → Schema migration 불필요
- `category='USAGE'` 신규 카테고리 사용 → 코드 레벨 상수만 추가

### 향후 성능 인덱스 (optional — 나중에 판단)

```sql
-- JSONB 필드 집계 성능 개선 시 (지금 당장 불필요)
CREATE INDEX idx_event_logs_category_created ON event_logs (category, created_at DESC);
CREATE INDEX idx_event_logs_ai_feature ON event_logs USING gin((metadata->>'feature') gin_trgm_ops)
  WHERE category = 'AI';
```

---

## 18. Exact Files to Modify (구현 시)

| 우선순위 | 파일 | 변경 내용 |
|----------|------|-----------|
| 1 | `src/config/ai-pricing.ts` | cached_input 가격 추가, Whisper 가격 추가 |
| 2 | `src/lib/ai-trace-service.ts` | AiTraceContext에 trigger_type, audio_seconds, cost_source 추가 |
| 3 | `src/lib/usage-recorder.ts` (신규) | recordExternalUsage() — provider-neutral |
| 4 | `src/routes/ai.ts` | handleWhisper에 saveAiTrace 추가 (trigger_type 포함) |
| 5 | `src/routes/support-cases.ts` | latency_ms=0 버그 수정 + trigger_type 추가 |
| 6 | `src/jobs/growth-report-analysis-worker.ts` | trigger_type=SYSTEM_MAINTENANCE + cost_source=UNKNOWN |
| 7 | `src/lib/sms/sendSms.ts` | SMS 발송 후 recordExternalUsage() |
| 8 | `src/routes/super.ts` | GET /super/ai-cost-overview 신규 엔드포인트 |
| 9 | `artifacts/swimnote-web/...` | Super Admin 탭 추가 (UI) |

---

## 19. Minimal Implementation Steps (5~10단계)

### Step 1: ai-pricing.ts 확장
- cached_input 가격, Whisper 가격, gpt-4o 가격 추가
- `calculateAiCost()`에 cached_tokens 파라미터 추가
- **영향**: 모든 기존 saveAiTrace 호출에서 cached cost 반영

### Step 2: AiTraceContext에 trigger_type + cost_source 추가
- `AiTraceContext`에 `trigger_type?: TriggerType` 추가
- `buildTraceMetadata()`에 trigger_type 직렬화 추가
- 기존 호출처는 `trigger_type` 생략 가능 (optional) → 하위 호환

### Step 3: Whisper STT usage 기록
- `handleWhisper()` 끝에 `void saveAiTrace(...)` 추가
- `trigger_type: "USER_ACTION"`, `audio_seconds: null` (단기), `cost_source: "UNKNOWN"`
- 파일: `routes/ai.ts`

### Step 4: support-cases.ts latency_ms=0 버그 수정
- 에스컬레이션 saveAiTrace 호출에 실제 latency 측정 후 전달

### Step 5: Growth Report Worker trigger_type 추가
- `trigger_type: "SYSTEM_MAINTENANCE"` 추가
- `cost_source: "UNKNOWN"`, `estimated_cost_usd: null` 명시

### Step 6: lib/usage-recorder.ts 신규 (SMS/R2용)
- `recordExternalUsage()` 함수 구현
- event_logs category='USAGE'로 INSERT

### Step 7: SMS에 usage 기록
- `sendSms()` 성공/실패 후 `recordExternalUsage()` 호출

### Step 8: GET /super/ai-cost-overview 엔드포인트
- feature별, trigger_type별, provider/model별 집계 SQL 구현
- 오늘/이번달 필터 지원

### Step 9: Super Admin 웹 AI Cost 탭
- 기존 Super Admin 탭에 [AI비용] 탭 추가
- Step 8 API 소비

---

## 20. Risks

| 위험 | 심각도 | 완화 방안 |
|------|--------|-----------|
| Whisper audio_seconds 측정 불가 | 중 | 단기: null/UNKNOWN. 중기: 클라이언트 duration 전송 |
| Growth/Curriculum Engine 비용 완전 불투명 | 높 | call 횟수 기록 + 운영자 단가 입력 구조 향후 추가 |
| event_logs JSONB 집계 성능 | 중 | created_at 인덱스 이미 있으면 문제없음. GIN 인덱스 선택적 추가 |
| SMS provider 성공 응답 구조 (provider마다 다름) | 낮 | success 판정을 HTTP 200으로만 → 실제 발송 실패 일부 누락 가능 |
| R2 GET 횟수 미추적 | 낮 | PUT은 photo_assets_meta로 추적. GET은 우선순위 낮음 |
| trigger_type 누락된 기존 레코드 | 낮 | metadata->>'trigger_type' IS NULL로 필터 가능. 새 레코드부터 적용 |
| Payment provider fee (RevenueCat/Apple/Google) | 낮 | AI/API 비용과 성격 다름. 별도 수익 대시보드에서 처리 권장 |

### Payment Provider Fee 별도 판단

RevenueCat/Apple/Google 결제 수수료(15~30%)는 AI/API usage dashboard에 합칠 필요 없음.  
**이유**: 비용 성격이 다름 (API 호출 단가 vs 매출 수수료), 이미 `revenue_logs` / `revenuecat_webhook_events`에서 별도 추적 중.  
→ **별도 Revenue 대시보드** 또는 수동 청구서 확인으로 충분.

---

## [RECOMMENDED WP-AI-01 IMPLEMENTATION PLAN]

```
PHASE 1 — 즉시 가능 (코드만, migration 없음, 1~2일)
  Step 1: ai-pricing.ts cached_input + Whisper 가격 추가
  Step 2: AiTraceContext에 trigger_type + cost_source 추가
  Step 4: support-cases.ts latency_ms=0 버그 수정
  Step 5: Growth Worker trigger_type=SYSTEM_MAINTENANCE 추가

PHASE 2 — Whisper + SMS 기록 (1~2일)
  Step 3: Whisper STT saveAiTrace 추가
  Step 6: usage-recorder.ts 신규 (provider-neutral)
  Step 7: SMS recordExternalUsage 추가

PHASE 3 — Super Admin Dashboard (2~3일)
  Step 8: GET /super/ai-cost-overview (집계 API)
  Step 9: Super Admin 웹 [AI비용] 탭 (UI)

총 예상 구현: 5~7일 (병렬 작업 시 단축 가능)
```

**P0 선행 조건**: Phase 1 → Phase 2 → Phase 3 순으로 배포. 각 Phase 독립 배포 가능.

---

*Report generated: WP-AI-01 Design Audit Only. No code changes, DB writes, or migrations performed.*
