# SWIMNOTE X — 구현 전 설계 보고서 V3.2 최종
> 작성일: 2026-08-02 | V3.1 → V3.2 최종 보완 (구현 시작 전)

---

## 1. Repository 추가 조사 결과 `REPOSITORY_VERIFIED`

### AI Engine

| 항목 | 조사 결과 |
|------|----------|
| Candidate search 위치 | `diary-template-search.ts:212-291` `searchTemplates()` — 현재는 **template** 후보이지 curriculum_items 후보 아님. curriculum candidate search는 **신규 구현 필요** |
| GPT Prompt Builder | `ai-v1.ts:470-537` `buildPrompt(p: BuildPromptParams)`. 호출 위치 `:233-242` |
| 스키마 검증 방식 | `ai-diary-utils.ts:120-188` `validateDiaryOutput()` — Zod 미사용, 수동 런타임 검증. curriculum_matches 필드 **미존재** |
| Diary 최종 저장 | `diary.ts:455-583` `POST /diaries`. 수정은 `PUT /diaries/:id` `:677-713`. PATCH 없음 |
| Engine version 저장 | `ai-v1.ts:69-72` 코드 상수 `ENGINE_VERSION='grounded_v1'`, `PIPELINE_MODE='template_v1'` |
| Prompt version 저장 | 코드 리터럴 `'p_template_v2'` (로그에만 기록, 응답 meta에 없음) |
| Knowledge version | 미구현. `knowledge_count=0, note=template_v1_pipeline` 로그만 존재 |
| Knowledge Search | **미구현**. `knowledge_ids: []` 응답, 실제 knowledge DB 없음 |

### 인프라

| 항목 | 조사 결과 |
|------|----------|
| BullMQ/Redis | **없음** |
| 기존 jobs/ | 8개 파일: auto-attendance, backup-batch, deactivation-cleanup, parent-link, push-scheduler, readonly-trigger, standby-sync, video-expiry. 모두 **node-cron** 기반 |
| DB 기반 Queue | `diary_push_queue` PostgreSQL 테이블 사용 중 (push-scheduler.ts:262-266) |
| Render worker | `render.yaml`에 단일 web service만. `start:worker` 스크립트는 있음 (`WORKER_MODE=true node dist/index.mjs`) |
| Audit log | **없음** |
| Soft delete 패턴 | `students.deleted_at` ✅, `class_diaries.deleted_at` ✅, `class_diary_student_notes.deleted_at` ✅, `diary_messages.deleted_at` ✅, `diary_templates` ❌ (없음) |

### 데이터

| 항목 | 조사 결과 |
|------|----------|
| students 테이블 | `deleted_at` 있음 (`:82`), `status` 있음, FK 없음 |
| report 저장 테이블 | **없음** (growth_reports, reports DDL 미존재) |
| RC transaction ID | billing.ts에서 `transaction_id` 미수집. **신규 구현 필요** |
| parent_accounts FK | 현재 FK 없음. 추가 시 orphan 데이터 사전 검증 필수 |

---

## 2. 수정 ERD

```
swimming_pools
  ├── xmode_entitlement BOOLEAN DEFAULT FALSE
  ├── xmode_config_status TEXT DEFAULT 'NOT_CONFIGURED'
  │     CHECK IN ('NOT_CONFIGURED','CURRICULUM_PENDING','READY')
  ├── xmode_subscription_end_at TIMESTAMPTZ
  ├── xmode_purchased_at TIMESTAMPTZ
  ├── xmode_payment_failed_at TIMESTAMPTZ
  └── homepage_enabled BOOLEAN

global_template_sets                            ← 신규
  ├── id, version_name, status
  │     CHECK IN ('DRAFT','ACTIVE','ARCHIVED')
  ├── description, created_by
  ├── activated_at, archived_at, created_at
  └── UNIQUE INDEX (status='ACTIVE')            ← ACTIVE 최대 1개

diary_templates
  ├── template_scope TEXT CHECK IN ('pool','global')
  ├── swimming_pool_id NULLABLE
  ├── global_template_set_id NULLABLE → global_template_sets
  └── CONSTRAINT: scope=global → set_id NOT NULL
                  scope=pool  → set_id NULL

curriculum_versions (pool_id → swimming_pools RESTRICT)
  └── UNIQUE INDEX (pool_id) WHERE status='active'

curriculum_items (version_id → curriculum_versions RESTRICT)

student_curriculum_assignments (student_id, version_id)
  └── UNIQUE INDEX (student_id) WHERE status='active'

growth_events
  ├── diary_note_id → class_diary_student_notes SET NULL
  ├── curriculum_item_id → curriculum_items RESTRICT
  ├── confidence NUMERIC(4,3) CHECK 0.0~1.0
  ├── evidence JSONB                             ← structured
  ├── event_role CHECK IN ('progress','observation')
  ├── engine_version, prompt_version, knowledge_version
  ├── template_set_version, matching_algorithm_version
  ├── contract_version, request_id
  └── match_metadata JSONB

ai_request_traces (request_id UNIQUE)           ← 신규
parent_ai_daily_usage (parent_account_id, usage_date UNIQUE)  ← 신규

job_queue (DB-based PG worker)                  ← 신규

audit_logs (append-only)                        ← 신규

growth_reports                                  ← 신규 (기존 없음 확인)
deep_report_orders (rc_transaction_id UNIQUE)

pool_events, pool_event_attachments
curriculum_requests, curriculum_request_files
parent_ai_conversations, parent_ai_messages
```

---

## 3. AI Response Contract V1.2

```typescript
// POST /api/v1/teacher-diary/generate 응답
interface DiaryGenerateResponseV12 {
  contract_version: "1.2";          // 1.0→1.1(V3.1)→1.2(V3.2)
  request_id: string;               // diary_req_{uuid} — growth_event까지 전파
  schema_version: string;
  engine_version: string;           // "grounded_v1"
  prompt_version: string;           // "p_template_v2"  ← 응답에 신규 포함
  knowledge_version: string | null; // null (미구현)
  template_set_version: string | null; // global_template_sets.version_name
  feature: "teacher_diary";
  result: {
    common: string;
    students: StudentResultV12[];
  };
  meta: {
    generation_mode: "TEMPLATE_ASSISTED" | "INPUT_ONLY" | "POLISH_ONLY";
    parser_confidence: number;       // 기존 유지
    template_used: boolean;
    candidate_count: number;
    selected_candidate_count: number;
    grounding_validation: "pass" | "fail" | "skipped";
  };
}

interface StudentResultV12 {
  student_ref: string;
  content: string;
  curriculum_matches: CurriculumMatchV12[];
}

interface CurriculumMatchV12 {
  candidate_index: number;          // GPT가 반환한 인덱스
  curriculum_item_id: string;       // 서버가 매핑 (GPT가 직접 생성 금지)
  curriculum_version_id: string;    // 학생 배정 버전 ID
  confidence: number;               // 서버가 계산 (GPT 직접 생성 금지)
  evidence: EvidenceSpan;           // 구조화된 근거
  match_method: "curriculum_candidate_selection_v1";
}

interface EvidenceSpan {
  source_type: "teacher_input" | "generated_content";
  student_ref: string;
  sentence_index: number;           // 0-based
  text: string;                     // 실제 문장 (GPT 창작 금지)
  // start_offset, end_offset: 파일럿 결과 후 추가 여부 결정
}
```

### 서버 응답 전 재검증 체크리스트

```
□ student_ref가 요청 학생 목록에 존재
□ candidate_index가 제공된 candidates[] 범위 내
□ curriculum_item_id가 서버 매핑 테이블에 존재 (GPT 생성값 아님)
□ curriculum_item_id가 해당 pool 소속
□ curriculum_item_id가 학생 배정 curriculum version 소속
□ curriculum_item.is_active = true
□ curriculum_version.status = 'active'
□ candidate_index ↔ curriculum_item_id 매핑 일치
□ confidence 0.0~1.0 범위
□ evidence.text가 source (teacher_input 또는 generated_content) 안에 실존
□ 중복 curriculum_item_id 제거 (학생별)
□ grounding_validation ≠ fail (fail이면 match 전체 폐기)
```

---

## 4. Candidate Selection Sequence

### 핵심 원칙: GPT는 curriculum_item_id를 직접 생성하지 않는다

```
[ai-v1.ts: POST /v1/teacher-diary/generate]
  ↓
1. [신규] searchCurriculumCandidates(poolId, studentId, meaning)
   → student_curriculum_assignments WHERE student_id AND status='active'
       → curriculum_version_id 조회
   → curriculum_items WHERE version_id=assignedVersion AND is_active=true
       → conceptOverlap(meaning, item) 상위 N개 선별
   → candidate_index 0,1,2... 부여
   → Map<candidate_index → curriculum_item_id> 서버 메모리에 보관 (요청 범위)

2. buildPrompt() 변경: 실제 ID 대신 후보 목록 전달
   system: {
     "curriculum_candidates": [
       { "candidate_index": 0, "skill_name": "자유형 측면 호흡", "description": "..." },
       { "candidate_index": 1, "skill_name": "자유형 팔 리커버리", "description": "..." }
     ]
   }

3. GPT 반환 (신규 부분):
   "curriculum_matches": [
     { "candidate_index": 0, "evidence_text": "호흡 타이밍이 좋아졌어요." }
   ]
   ※ GPT는 curriculum_item_id 절대 사용 금지

4. 서버 후처리 (validateDiaryOutput 확장):
   a. candidate_index → curriculum_item_id 매핑 (서버 Map 사용)
   b. 범위 밖 index 즉시 폐기
   c. pool 소속 재검증
   d. 학생 배정 버전 소속 재검증
   e. curriculum_item.is_active 검증
   f. evidence 실존 검증 (source 텍스트에서 findIndex)
   g. confidence 계산 (아래 §5)
   h. grounding 검증

5. 최종 response V1.2 조립 + ai_request_traces INSERT
```

### 신규 구현 함수

```typescript
// artifacts/api-server/src/lib/curriculum-candidate-search.ts (신규 파일)
export async function searchCurriculumCandidates(
  poolId: string,
  studentId: string,
  meaning: ExtractedMeaning
): Promise<{ candidates: CurriculumCandidate[], indexMap: Map<number, string> }>

interface CurriculumCandidate {
  candidate_index: number;
  curriculum_item_id: string;
  skill_name: string;
  description: string;
  similarity_score: number;   // 내부용, GPT에 노출 안 함
}
```

---

## 5. Confidence 계산 설계

### 계산 위치: 서버 (GPT 계산 금지)

**위치**: `artifacts/api-server/src/lib/curriculum-confidence.ts` (신규)

### 입력 변수

| 변수 | 범위 | 설명 |
|------|------|------|
| `curriculum_similarity` | 0.0~1.0 | curriculum_item과 meaning의 개념 유사도 |
| `concept_overlap` | 0.0~1.0 | 키워드 집합 겹침 비율 |
| `evidence_coverage` | 0.0~1.0 | evidence 문장이 content에서 차지하는 의미 비중 |
| `parser_confidence` | 0.0~1.0 | TeacherInputParser 입력 신뢰도 (기존 `meaning.confidence`) |
| `candidate_rank_score` | 0.0~1.0 | 후보 내 순위 (1위=1.0, N위=(N-rank)/(N-1)) |
| `version_match` | 0 or 1 | 학생 배정 버전 일치 여부 (불일치=0, 즉시 탈락) |

### 계산 수식 (V1 — 파일럿 결과로 가중치 확정)

```typescript
const WEIGHTS = {
  curriculum_similarity: 0.35,
  concept_overlap:       0.25,
  evidence_coverage:     0.20,
  parser_confidence:     0.10,
  candidate_rank_score:  0.10,
};
// version_match = 0이면 confidence = 0 (계산 중단)
const raw =
  curriculum_similarity   * WEIGHTS.curriculum_similarity +
  concept_overlap         * WEIGHTS.concept_overlap +
  evidence_coverage       * WEIGHTS.evidence_coverage +
  parser_confidence       * WEIGHTS.parser_confidence +
  candidate_rank_score    * WEIGHTS.candidate_rank_score;

// normalization: 이미 0~1 가중합이므로 clamp만
const final_confidence = Math.min(1.0, Math.max(0.0, raw));
```

### Threshold (설정값으로 분리 — 코드 고정 금지)

```typescript
// artifacts/api-server/src/config/growth-config.ts (신규)
export const GROWTH_CONFIG = {
  AUTO_PROGRESS_THRESHOLD:    0.75,  // 이상: 자동 progress
  REVIEW_THRESHOLD:           0.55,  // 이상~미만: 교사 확인 필요
  // 미만: 폐기 (observation으로 저장 가능)
  CONFIDENCE_VERSION:         "v1",  // 산식 버전
  MATCHING_ALGORITHM_VERSION: "curriculum_candidate_selection_v1",
};
```

**C안 채택** (고신뢰 자동, 중간 교사 확인, 저신뢰 폐기)

| confidence | 처리 |
|-----------|------|
| ≥ 0.75 | 자동 progress event 생성 |
| 0.55~0.75 | 교사 확인 pending (UI에서 체크 요청) |
| < 0.55 | 폐기 (observation event만 저장 가능) |

**정확한 수치는 50개 파일럿 결과로 확정**

### 계산 실패 처리

```
score 계산 중 예외 → confidence = null
confidence = null → growth_event progress 생성 금지
match는 observation event로 저장 + trace에 error_code='confidence_calc_failed'
```

### 버전 추적

```typescript
// growth_events에 저장
matching_algorithm_version: GROWTH_CONFIG.MATCHING_ALGORITHM_VERSION,
// → "curriculum_candidate_selection_v1"
// 산식 변경 시 버전 bump → 이전 버전 이벤트 일괄 조회/재계산 가능
```

---

## 6. Evidence 검증 설계

### 구조

```typescript
interface EvidenceSpan {
  source_type: "teacher_input" | "generated_content";
  student_ref: string;
  sentence_index: number;   // 0-based
  text: string;             // 실제 문장 (≤200자 권장)
}
```

### 검증 흐름

```
1. GPT evidence_text 수신
2. source_type에 따라 원본 텍스트 결정:
   - teacher_input  → req.input.text (교사 입력 원문)
   - generated_content → StudentResult.content (생성된 일지)
3. 원본 텍스트를 문장 단위로 분리 (. / ! / ? 기준)
4. evidence.text가 sentences 중 하나와 실질적으로 일치하는지 확인
   - 정확 일치 또는 포함(includes) 검사
   - 일치하는 sentence_index 기록
5. 일치 실패 → match 폐기, trace에 error_code='evidence_not_found'
6. GPT가 새로 창작한 문장은 원본에 없으므로 자동 폐기
```

### 개인정보 보호

```
- ai_request_traces: evidence.text 전체 원문 저장 금지
- evidence는 sentence_index만 trace에 저장
- Debug 환경(NODE_ENV=development)에서만 마스킹된 text 확인 가능
  (앞 5자 + *** + 뒤 5자)
- 운영 로그에 교사 원문 전체 출력 금지
```

---

## 7. Growth Event 생성 안전 규칙 (10개 조건)

```
growth_event progress 생성 조건 (모두 통과 필수):

□ 1. curriculum_item이 학생 배정 버전(student_curriculum_assignments)에 포함
□ 2. curriculum_item.swimming_pool_id = 요청 pool_id
□ 3. confidence >= AUTO_PROGRESS_THRESHOLD (GROWTH_CONFIG 설정값)
□ 4. evidence 검증 통과 (§6)
□ 5. grounding_validation = 'pass'
□ 6. diary 최종 저장 트랜잭션 성공 (class_diary_student_notes.id 확정 후)
□ 7. 동일 (diary_note_id, student_id, curriculum_item_id, source) 미존재 (UNIQUE INDEX)
□ 8. event_role = 'progress'
□ 9. curriculum_item.is_active = true
□ 10. contract_version 지원 버전 ('1.1' 이상) + request_id 일치

조건 실패 시:
  - progress event 생성 금지
  - confidence ∈ [REVIEW_THRESHOLD, AUTO_PROGRESS_THRESHOLD) → pending_review event (별도 처리)
  - confidence < REVIEW_THRESHOLD 또는 기타 실패 → observation event 저장 가능
  - 실패 사유 ai_request_traces.error_code에 기록
```

---

## 8. Global Template Set 버전 구조

```sql
CREATE TABLE global_template_sets (
  id TEXT PRIMARY KEY DEFAULT ('gts_' || replace(gen_random_uuid()::text,'-','')),
  version_name TEXT NOT NULL UNIQUE,        -- "global_v1", "global_v2_pilot50"
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  description TEXT,
  total_templates INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ACTIVE는 최대 1개
CREATE UNIQUE INDEX idx_global_template_sets_active
  ON global_template_sets (status)
  WHERE status = 'ACTIVE';
```

### diary_templates 연결

```sql
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS template_scope TEXT NOT NULL DEFAULT 'pool'
    CHECK (template_scope IN ('pool','global')),
  ADD COLUMN IF NOT EXISTS global_template_set_id TEXT
    REFERENCES global_template_sets(id) ON DELETE RESTRICT;

ALTER TABLE diary_templates
  ADD CONSTRAINT chk_template_scope_pool_id
    CHECK ((template_scope='pool' AND swimming_pool_id IS NOT NULL AND global_template_set_id IS NULL) OR
           (template_scope='global' AND swimming_pool_id IS NULL AND global_template_set_id IS NOT NULL));
```

### 파일럿/전체 생성 워크플로우

```
1. DRAFT 세트 생성: INSERT global_template_sets (status='DRAFT')
2. 파일럿 50개 생성 → diary_templates INSERT (template_scope='global', set_id=DRAFT)
3. 품질 검증 통과 →
   UPDATE global_template_sets SET status='ACTIVE', activated_at=now()
     WHERE id=NEW_SET (이 시점에 UNIQUE INDEX로 기존 ACTIVE 있으면 실패 → 명시적 ARCHIVE 필요)
   UPDATE global_template_sets SET status='ARCHIVED', archived_at=now()
     WHERE status='ACTIVE' AND id != NEW_SET
4. searchTemplates는 ACTIVE 세트만 조회:
   WHERE template_scope='global'
     AND global_template_set_id = (SELECT id FROM global_template_sets WHERE status='ACTIVE')
5. 롤백: 이전 ARCHIVED 세트를 ACTIVE로 변경 (위 순서 반대)
```

### template_set_version 연결

```
growth_events.template_set_version = global_template_sets.version_name
→ 어떤 히든 템플릿 세트에서 생성된 결과인지 추적 가능
```

---

## 9. Parent AI Usage·Token·Cost 구조

### parent_ai_daily_usage (확장)

```sql
CREATE TABLE parent_ai_daily_usage (
  id TEXT PRIMARY KEY DEFAULT ('pau_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL REFERENCES parent_accounts(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,           -- Asia/Seoul 기준 날짜

  -- 질문 횟수
  question_count INTEGER NOT NULL DEFAULT 0,

  -- 토큰/비용 집계
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,  -- USD

  -- 차단/실패 집계
  rejected_count INTEGER NOT NULL DEFAULT 0,         -- 한도 초과 거부
  intent_blocked_count INTEGER NOT NULL DEFAULT 0,   -- Intent Guard 차단
  grounding_failed_count INTEGER NOT NULL DEFAULT 0, -- Grounding 검증 실패

  last_request_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_account_id, usage_date)
);
```

### 복합 한도 정책

```typescript
// artifacts/api-server/src/config/parent-ai-limits.ts (신규)
export const PARENT_AI_LIMITS = {
  daily_question_max:   20,
  per_question_max_chars: 1000,       // 요청당 최대 입력 글자수
  daily_input_token_max:  50000,      // 일일 총 입력 토큰 상한
  daily_cost_usd_max:     0.50,       // 일일 예상 비용 상한 (USD)
};
```

### 모델 가격 관리 (코드 고정 금지)

```typescript
// artifacts/api-server/src/config/ai-pricing.ts (신규)
export const AI_PRICING: Record<string, ModelPricing> = {
  "gpt-4o-mini": { input_per_1k: 0.00015, output_per_1k: 0.00060 },
  "gpt-4o":      { input_per_1k: 0.00250, output_per_1k: 0.01000 },
};
// DB 또는 환경변수로 오버라이드 가능하도록 설계
```

### 차감 정책 확정

| 상황 | question_count 차감 | 토큰/비용 기록 |
|------|-------------------|--------------|
| 정상 답변 | ✅ +1 | ✅ 기록 |
| Intent Guard 차단 | ❌ 미차감 | ✅ intent_blocked_count +1 |
| 생성 실패 (GPT 오류) | ❌ 미차감 | ✅ 소모된 토큰 기록 |
| 서버 오류 (GPT 호출 전) | ❌ 미차감 | ❌ 미기록 |
| 한도 초과 거부 | ❌ 미차감 | ✅ rejected_count +1 |

### 동시 요청 처리

```sql
-- Atomic increment (race condition 방지)
INSERT INTO parent_ai_daily_usage (parent_account_id, usage_date, question_count, ...)
VALUES ($id, $today, 1, ...)
ON CONFLICT (parent_account_id, usage_date)
DO UPDATE SET
  question_count = parent_ai_daily_usage.question_count + 1,
  input_tokens = parent_ai_daily_usage.input_tokens + $inputTokens,
  updated_at = now()
WHERE parent_ai_daily_usage.question_count < $daily_question_max
RETURNING question_count;
-- 반환행 없으면 한도 초과
```

### Asia/Seoul 날짜 경계

```typescript
import { toZonedTime, format } from 'date-fns-tz';
const seoulDate = format(toZonedTime(new Date(), 'Asia/Seoul'), 'yyyy-MM-dd');
```

---

## 10. AI Trace 구조

### ai_request_traces (운영 추적, 개인정보 제외)

```sql
CREATE TABLE ai_request_traces (
  id TEXT PRIMARY KEY DEFAULT ('art_' || replace(gen_random_uuid()::text,'-','')),
  request_id TEXT NOT NULL UNIQUE,      -- diary_req_{uuid}
  feature TEXT NOT NULL
    CHECK (feature IN ('teacher_diary','parent_ai_search')),
  pool_id TEXT NOT NULL,
  user_role TEXT NOT NULL,              -- 'teacher','pool_admin','parent_account'
  student_count INTEGER,                -- 학생 이름 저장 금지

  -- 파이프라인 메타
  generation_mode TEXT,
  candidate_count INTEGER,
  selected_candidate_count INTEGER,
  engine_version TEXT,
  prompt_version TEXT,
  knowledge_version TEXT,
  template_set_version TEXT,
  matching_algorithm_version TEXT,
  contract_version TEXT,

  -- 성능/비용
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd NUMERIC(10,6),

  -- 결과
  grounding_result TEXT,               -- 'pass','fail','skipped'
  intent_result TEXT,                  -- Parent AI: 'swim','non_swim','error'
  answer_status TEXT,                  -- Parent AI: 'answered','blocked','failed'

  -- 오류
  error_code TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 저장 금지: 학생 이름, 교사 원문, 학부모 질문 원문, JWT, LLM 전체 응답
```

### Parent AI 추가 컬럼

```sql
ALTER TABLE ai_request_traces
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS curriculum_item_ids TEXT[],   -- 검색된 항목 ID
  ADD COLUMN IF NOT EXISTS knowledge_ids TEXT[],         -- 미래 구현용 (NULL 허용)
  ADD COLUMN IF NOT EXISTS input_length INTEGER;         -- 원문 길이 (원문 아님)
```

### 테이블 분리 원칙

```
ai_request_traces   → 운영 추적, 집계, 비용 분석 (개인정보 없음)
parent_ai_messages  → 대화 원문 (개인정보, 별도 보존 정책)
growth_events       → 결과 저장 (request_id로 trace와 연결)
```

---

## 11. Background Job Queue 구조

### 조사 결론: A안 (PostgreSQL SKIP LOCKED) 채택

**이유**:
- 기존 인프라: `diary_push_queue` PostgreSQL 테이블 큐 이미 사용 중
- Render.com: `start:worker` 스크립트 이미 존재 (`WORKER_MODE=true node dist/index.mjs`)
- Redis 인프라 없음, BullMQ 미사용
- 현재 규모에서 PG 큐로 충분

### job_queue 테이블

```sql
CREATE TABLE job_queue (
  id TEXT PRIMARY KEY DEFAULT ('job_' || replace(gen_random_uuid()::text,'-','')),
  job_type TEXT NOT NULL
    CHECK (job_type IN (
      'generate_growth_report',
      'generate_deep_report',
      'generate_curriculum_templates',
      'generate_hidden_templates_batch',
      'generate_ppt',
      'send_bulk_notification',
      'recalculate_growth_events',
      'revalidate_ai_results'
    )),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','DEAD','CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 5,      -- 낮을수록 높은 우선순위
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 지수 백오프용
  locked_at TIMESTAMPTZ,
  locked_by TEXT,                               -- worker 인스턴스 ID
  last_error TEXT,
  idempotency_key TEXT UNIQUE,                  -- 중복 등록 방지
  result JSONB,                                 -- 완료 시 결과 요약
  related_entity_type TEXT,                     -- 'deep_report_order', 'growth_report_entitlement'
  related_entity_id TEXT,                       -- 연결된 order/entitlement ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_queue_pending ON job_queue (run_after, priority)
  WHERE status = 'PENDING';
CREATE INDEX idx_job_queue_related ON job_queue (related_entity_id)
  WHERE related_entity_id IS NOT NULL;
```

### Worker 실행 흐름

```typescript
// SKIP LOCKED으로 원자적 job 획득
SELECT * FROM job_queue
WHERE status = 'PENDING' AND run_after <= NOW()
ORDER BY priority, run_after
LIMIT 1
FOR UPDATE SKIP LOCKED;

// locked_by = 워커 인스턴스 ID, locked_at = now(), status = 'RUNNING'
```

### 지수 백오프

```typescript
const backoff = (attempt: number) => Math.min(300, 2 ** attempt) * 60; // 초 단위
// 1회 실패 → 2분 후
// 2회 실패 → 4분 후
// 3회 실패 → 8분 후
// max_attempts 초과 → status = 'DEAD'
```

### Render.com Worker 설정 (render.yaml 추가)

```yaml
# render.yaml에 추가
- type: worker
  name: swimnote-worker
  env: node
  buildCommand: npm install -g pnpm@10 && pnpm install --no-frozen-lockfile && pnpm --filter @workspace/api-server run build
  startCommand: WORKER_MODE=true node_modules/.bin/tsx artifacts/api-server/src/index.ts
  region: singapore
  plan: starter
```

### 기능 보장

| 기능 | 구현 |
|------|------|
| 중복 등록 방지 | idempotency_key UNIQUE |
| Worker 재시작 후 복구 | RUNNING 상태 locked_at이 10분 이상 → 자동 PENDING 복구 |
| 지수 백오프 | run_after = now() + backoff(attempt_count) |
| 최대 재시도 | attempt_count >= max_attempts → DEAD |
| DEAD 수동 재실행 | PATCH /admin/jobs/:id/retry (super_admin) |
| 작업 취소 | PATCH /admin/jobs/:id/cancel → CANCELLED |
| 결제 후 생성 실패 | rc_transaction_id로 재처리, 재결제 불필요 |

---

## 12. Audit Log 구조

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('super_admin','pool_admin','system')),
  actor_id TEXT,                      -- system이면 NULL
  pool_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_data JSONB,                  -- 허용 필드만, 민감정보 제외
  after_data JSONB,                   -- 허용 필드만
  reason TEXT,
  request_id TEXT,                    -- HTTP 요청 ID
  ip_hash TEXT,                       -- SHA-256(IP), 역추적용
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- UPDATE, DELETE 금지: 추가(INSERT)만 허용
);

-- 수정/삭제 금지 (애플리케이션 레벨 정책)
-- audit_logs에 대한 DELETE/UPDATE 권한 DB 레벨에서 제거 가능
```

### 필수 기록 작업

| 작업 | entity_type | 기록 조건 |
|------|------------|---------|
| xmode_config_status 변경 | swimming_pools | 항상 |
| xmode_entitlement 수동 변경 | swimming_pools | 항상 |
| curriculum_request 승인/반려 | curriculum_requests | 항상 |
| curriculum_version 활성화/보관 | curriculum_versions | 항상 |
| 학생 curriculum version 일괄 전환 | student_curriculum_assignments | 항상 |
| homepage_enabled 변경 | swimming_pools | 항상 |
| global_template_set 활성화/롤백 | global_template_sets | 항상 |
| deep_report_order 상태 수동 변경 | deep_report_orders | 항상 |
| growth_event 수동 무효화 | growth_events | 항상 |
| 데이터 삭제/복원 | 해당 엔티티 | 항상 |
| 슈퍼어드민 파일 다운로드 | 해당 파일 | 항상 |
| job DEAD → retry/cancel | job_queue | 항상 |

### 정책

```
- audit_log 수정·삭제 금지 (DB 레벨)
- before/after: 허용 필드만 (이름, 원문, 비밀번호, 토큰 제외)
- system 변경도 actor_type='system'으로 기록
- 보존기간: 최소 3년 (법적 요구사항 대응)
- 조회 API: super_admin만 접근 가능
- 일반 API와 완전 분리된 엔드포인트
```

---

## 13. Soft Delete·Archive 정책표

| 엔티티 | 정책 | 복원 가능 | 보존기간 | 비고 |
|--------|------|---------|---------|------|
| `swimming_pools` | Soft delete (`deactivated_at`) | ✅ (관리자) | 영구 | physical delete 금지 |
| `students` | Soft delete (`deleted_at`) + 비식별화 | ❌ (비식별화 후) | 5년 (결제 관련) | 이름/전화 SHA-256 치환 |
| `curriculum_versions` | Archive (`status='archived'`) | ✅ | 영구 | active는 1개 유지 |
| `curriculum_items` | Soft delete (`is_active=false`) | ✅ | 영구 | growth_events 참조 보호 |
| `student_curriculum_assignments` | Soft delete (`status='ended'`) | ❌ | 영구 | 이력 보존 |
| `curriculum_requests` | Status 전환 (cancelled) | ❌ | 5년 | physical delete 금지 |
| `diary_templates` | `is_active=false` 추가 필요 (`deleted_at` 현재 없음) | ✅ | 영구 | |
| `growth_events` | `is_invalidated=true` | 복원 가능 | 영구 | hard delete 절대 금지 |
| `pool_events` | Soft delete 불필요 (append-only 메시지) | — | 5년 | |
| `parent_ai_conversations` | 개인정보 정책 삭제 가능 | ❌ | 사용자 요청 시 | messages도 CASCADE 삭제 |
| `growth_reports` | Soft delete (`deleted_at`) | ✅ | 영구 | 리포트 원본 보존 |
| `deep_report_orders` | **hard delete 금지** | — | 영구 | 결제 기록 |
| `global_template_sets` | Archive (`status='ARCHIVED'`) | ✅ (ACTIVE 재전환) | 영구 | 롤백 대비 |
| `audit_logs` | **삭제 금지** | — | 3년+ | DB 레벨 삭제 불가 |

### 삭제 API 동작

```
DELETE /pools/:poolId/students/:id
  → students.deleted_at = now()
  → growth_events는 건드리지 않음 (student_id 보존, 통계 무결성)
  → 개인정보 비식별화: name → SHA-256(name), phone → SHA-256(phone)
  → FK ON DELETE CASCADE: student_curriculum_assignments, growth_report_entitlements
  → FK ON DELETE RESTRICT: growth_events, deep_report_orders (삭제 차단)
  → 차단 시 에러: "결제 기록 또는 성장 이벤트가 있는 학생은 삭제할 수 없습니다"

법적 삭제 요청 대응 (개인정보보호법 제36조):
  → 개인정보 비식별화 처리 (위와 동일)
  → parent_ai_conversations 삭제 (messages CASCADE)
  → 통계/결제/성장 데이터는 비식별화 상태로 보존
```

### R2 첨부파일 정책

```
DB soft delete → is_deleted=true (즉시)
R2 실제 삭제  → 30일 후 배치 정리 (deactivation-cleanup.ts 확장)
고아 객체 정리 → 월 1회 R2 Object List vs DB file_url 비교 배치
```

### FK와 soft delete 충돌

```
growth_events → curriculum_items ON DELETE RESTRICT
curriculum_items soft delete(is_active=false) 시 FK는 유지 → 충돌 없음
students physical delete 불가 → DELETE 전 is_invalidated로 growth_events 처리 후 비식별화
```

---

## 14. 수정 Phase/WP

```
WP0  Repository 재확인 및 Contract 확정
WP1  핵심 DB Migration
WP2  RevenueCat X모드 결제
WP3  X모드 상태·의뢰·이벤트 Backend
WP4  Global Template Set + 파일럿 50개
WP5  AI Diary 검색 분기 (xmode_config_status 기반)
WP6  Curriculum Candidate Search + AI Contract V1.2
WP7  Diary 최종 저장 + Growth Event 안전장치
WP8  Growth API
WP9  Parent AI Engine Backend
WP10 AI Usage/Trace/Cost 기록
WP11 Background Job Queue
WP12 무료 기본 Report Backend
WP13 App UI
WP14 Sample Pool E2E
WP15 Global Template 2,000개 확대
WP16 Homepage UI 완성
WP17 ToyKids 전환
WP18 Deep Report 결제·생성
```

---

## 15. 변경 파일 전체 목록

### 신규 파일

| 파일 | WP |
|------|----|
| `artifacts/api-server/src/lib/curriculum-candidate-search.ts` | 6 |
| `artifacts/api-server/src/lib/curriculum-confidence.ts` | 6 |
| `artifacts/api-server/src/config/growth-config.ts` | 6 |
| `artifacts/api-server/src/config/parent-ai-limits.ts` | 9 |
| `artifacts/api-server/src/config/ai-pricing.ts` | 10 |
| `artifacts/api-server/src/routes/xmode.ts` | 3 |
| `artifacts/api-server/src/routes/pool-events.ts` | 3 |
| `artifacts/api-server/src/routes/curriculum-requests.ts` | 3 |
| `artifacts/api-server/src/routes/growth.ts` | 8 |
| `artifacts/api-server/src/routes/growth-report.ts` | 12 |
| `artifacts/api-server/src/routes/parent-ai-search.ts` | 9 |
| `artifacts/api-server/src/lib/parent-ai-guard.ts` | 9 |
| `artifacts/api-server/src/jobs/job-worker.ts` | 11 |
| `artifacts/api-server/src/jobs/report-generator.ts` | 12 |
| `artifacts/swim-app/app/(super)/pool-xmode-detail.tsx` | 13 |
| `artifacts/swim-app/app/(admin)/xmode-curriculum.tsx` | 13 |
| `artifacts/swim-app/app/(parent)/growth.tsx` | 13 |
| `artifacts/swim-app/app/(parent)/ai-search.tsx` | 13 |
| `scripts/generate-pilot-templates.ts` | 4 |
| `scripts/generate-full-templates.ts` | 15 |

### 변경 파일

| 파일 | WP | 변경 내용 |
|------|----|----------|
| `artifacts/api-server/src/migrations/pool-db-init.ts` | 1 | 전체 신규 테이블 |
| `artifacts/api-server/src/routes/billing.ts` | 2 | xmode 분기, rc_transaction_id 수집 |
| `artifacts/api-server/src/lib/subscriptionService.ts` | 2 | applyXmodeState() |
| `artifacts/api-server/src/lib/diary-template-search.ts` | 5 | configStatus 파라미터, global set 필터 |
| `artifacts/api-server/src/routes/ai-v1.ts` | 6 | contract 1.2, candidate 매핑 |
| `artifacts/api-server/src/lib/ai-diary-utils.ts` | 6 | curriculum_matches 검증 추가 |
| `artifacts/api-server/src/routes/diary.ts` | 7 | growth_event 연동, student_assignment 트리거 |
| `artifacts/swim-app/app/(super)/pools.tsx` | 13 | X모드 필터 |
| `artifacts/swim-app/app/(teacher)/diary-write.tsx` | 13 | curriculum_matches UI, 확인/폐기 |
| `artifacts/swimnote-web/src/pages/PoolAdmin.tsx` | 16 | 홈페이지 5개 섹션 UI |
| `render.yaml` | 11 | worker service 추가 |

---

## 16. Migration 계획 (WP1 전체)

> V3.1 §10 Phase 1의 SQL을 다음 항목으로 추가 보완

```sql
-- WP1 추가 Migration

-- M-1. global_template_sets (§8)
CREATE TABLE IF NOT EXISTS global_template_sets (
  id TEXT PRIMARY KEY DEFAULT ('gts_' || replace(gen_random_uuid()::text,'-','')),
  version_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  description TEXT,
  total_templates INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_template_sets_active
  ON global_template_sets (status) WHERE status = 'ACTIVE';

-- M-2. diary_templates 변경 (global_template_set_id 추가)
ALTER TABLE diary_templates
  ADD COLUMN IF NOT EXISTS global_template_set_id TEXT
    REFERENCES global_template_sets(id) ON DELETE RESTRICT;
-- CHECK constraint는 기존 데이터 정리 후 추가
-- (기존 records: scope='pool', set_id=NULL → 정합성 문제 없음)

-- M-3. growth_events 추적 컬럼 추가 (§5)
ALTER TABLE growth_events
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_version TEXT,
  ADD COLUMN IF NOT EXISTS template_set_version TEXT,
  ADD COLUMN IF NOT EXISTS matching_algorithm_version TEXT,
  ADD COLUMN IF NOT EXISTS contract_version TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS match_metadata JSONB,
  ADD COLUMN IF NOT EXISTS evidence JSONB;  -- EvidenceSpan 구조체

-- M-4. ai_request_traces (§10)
CREATE TABLE IF NOT EXISTS ai_request_traces (
  id TEXT PRIMARY KEY DEFAULT ('art_' || replace(gen_random_uuid()::text,'-','')),
  request_id TEXT NOT NULL UNIQUE,
  feature TEXT NOT NULL CHECK (feature IN ('teacher_diary','parent_ai_search')),
  pool_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  student_count INTEGER,
  generation_mode TEXT,
  candidate_count INTEGER,
  selected_candidate_count INTEGER,
  engine_version TEXT,
  prompt_version TEXT,
  knowledge_version TEXT,
  template_set_version TEXT,
  matching_algorithm_version TEXT,
  contract_version TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd NUMERIC(10,6),
  grounding_result TEXT,
  intent_result TEXT,
  answer_status TEXT,
  conversation_id TEXT,
  curriculum_item_ids TEXT[],
  knowledge_ids TEXT[],
  input_length INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- M-5. job_queue (§11)
CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY DEFAULT ('job_' || replace(gen_random_uuid()::text,'-','')),
  job_type TEXT NOT NULL
    CHECK (job_type IN (
      'generate_growth_report','generate_deep_report',
      'generate_curriculum_templates','generate_hidden_templates_batch',
      'generate_ppt','send_bulk_notification',
      'recalculate_growth_events','revalidate_ai_results'
    )),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','DEAD','CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 5,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  idempotency_key TEXT UNIQUE,
  result JSONB,
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON job_queue (run_after, priority) WHERE status = 'PENDING';

-- M-6. audit_logs (§12)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('super_admin','pool_admin','system')),
  actor_id TEXT,
  pool_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  reason TEXT,
  request_id TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- M-7. growth_reports (신규)
CREATE TABLE IF NOT EXISTS growth_reports (
  id TEXT PRIMARY KEY DEFAULT ('gr_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  report_month TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('basic','deep')),
  curriculum_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  content JSONB NOT NULL,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('auto','manual')),
  engine_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- M-8. diary_templates is_active (soft delete 컬럼 추가, 현재 없음 확인)
ALTER TABLE diary_templates
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
```

---

## 17. API Contract 요약

```
WP3:
  GET  /api/v1/pools/:poolId/xmode/status
  PATCH /api/v1/admin/pools/:poolId/xmode/config-status  (super_admin)
  GET  /api/v1/admin/pools/:poolId/events
  POST /api/v1/admin/pools/:poolId/events
  POST /api/v1/pools/:poolId/curriculum-request
  PATCH /api/v1/admin/curriculum-request/:id

WP6:
  POST /api/v1/teacher-diary/generate  (contract_version=1.2)

WP8:
  GET  /api/v1/pools/:poolId/students/:studentId/growth
  GET  /api/v1/pools/:poolId/students/:studentId/growth/events

WP9:
  POST /api/v1/parent/ai-search

WP11:
  PATCH /api/v1/admin/jobs/:id/retry    (super_admin)
  PATCH /api/v1/admin/jobs/:id/cancel   (super_admin)

WP12:
  GET  /api/v1/pools/:poolId/students/:studentId/report-entitlement
  POST /api/v1/pools/:poolId/students/:studentId/report/generate
  GET  /api/v1/pools/:poolId/students/:studentId/report/:reportId
  POST /api/v1/parent/deep-report/purchase-confirm

WP18:
  POST /api/v1/parent/deep-report/purchase-confirm  (rc_transaction_id 포함)
```

---

## 18. 테스트 계획 요약

| WP | 핵심 테스트 |
|----|-----------|
| WP1 | UNIQUE INDEX 동작, CHECK CONSTRAINT, 기존 데이터 회귀 없음 |
| WP2 | INITIAL_PURCHASE → entitlement=true, EXPIRATION → false + homepage_enabled=false, 재결제 후 config_status 유지 |
| WP4 | DRAFT→ACTIVE 전환, ACTIVE 2개 시도 → 오류, 검색이 ACTIVE 세트만 조회 |
| WP6 | GPT 반환 잘못된 candidate_index → 폐기, 다른 pool curriculum_item → 폐기, 학생 배정 버전 불일치 → 폐기 |
| WP7 | confidence ≥ 0.75 → 자동 progress, 0.55~0.75 → pending, < 0.55 → 폐기, 중복 저장 → ON CONFLICT DO NOTHING |
| WP9 | 수영 질문 정상, 비수영 → 차단, 한도 초과 → 429, X모드 비활성 → 403 |
| WP11 | SKIP LOCKED 동시 2 worker → 같은 job 중복 처리 없음, 재시작 후 RUNNING 복구 |
| WP12 | growth_events < 3 → entitlement 소모 없음, 생성 실패 → available 복구 |
| WP14 | 전체 E2E: 결제→의뢰→커리큘럼→AI 일지→성장판→리포트→만료→재결제 후 READY 유지 |

---

## 19. Rollback 계획

```
WP1:  신규 테이블 DROP CASCADE (growth_reports, job_queue, audit_logs, ai_request_traces,
       global_template_sets), swimming_pools 신규 컬럼 DROP, diary_templates 롤백
WP2:  billing.ts xmode 분기 제거
WP4:  global_template_sets DRAFT 행 삭제, diary_templates scope/set_id 컬럼 DROP
WP6:  contract_version 1.1로 롤백, curriculum_candidate_search 파일 삭제
WP7:  diary.ts growth_event 연동 코드 제거
WP9:  parent-ai-search.ts 삭제
WP11: render.yaml worker service 제거, job_queue DROP
WP12: growth-report.ts, report-generator.ts 삭제
```

---

## 20. NEEDS_VERIFICATION 항목 (미확인)

| # | 항목 | 이유 |
|---|------|------|
| 1 | RevenueCat webhook payload의 정확한 transaction ID 필드명 | billing.ts에서 미수집. RC 문서에서 `transaction_identifier` 또는 `id` 확인 필요 |
| 2 | RevenueCat consumable 상품 webhook 이벤트 타입 | consumable은 INITIAL_PURCHASE만, RENEWAL 없음 확인 필요 |
| 3 | Knowledge Search 구현 계획 | 현재 미구현. WP9에서 설계 필요 (별도 vector DB 또는 PG pg_vector 확장 여부) |
| 4 | AI Engine에서 curriculum_items 유사도 계산 방식 | scoreTemplate()은 diary_templates 기준. curriculum_items에 적용 시 conceptOverlap 재사용 가능 여부 검증 필요 |
| 5 | parent_accounts FK 추가 전 orphan 데이터 검증 | 운영 DB에서 `SELECT ... LEFT JOIN ... WHERE sp.id IS NULL` 실행 필요 |
| 6 | students.status 값 목록 전체 | 'active', 'inactive', 'withdrawn' 외 값 존재 여부 |
| 7 | Render.com starter plan Worker 지원 여부 | worker service 추가 시 별도 과금 확인 필요 |
| 8 | WORKER_MODE=true 분기 로직 존재 여부 | `artifacts/api-server/src/index.ts`에서 WORKER_MODE 분기가 있는지 확인 필요 |
| 9 | growth_events 파일럿 후 confidence threshold 최종값 | 50개 파일럿 결과로 확정 (현재 0.75/0.55 잠정) |
| 10 | deep_report_orders RevenueCat consumable 상품 ID | RC 대시보드에서 생성 후 확인 필요 |
