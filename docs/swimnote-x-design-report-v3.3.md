# SWIMNOTE X — V3.3 구현 직전 최종 변경분
> 작성일: 2026-08-02 | V3.2 대비 변경분만 기록. 전체 재작성 아님.

---

## 1. 변경 요약

| # | 항목 | V3.2 | V3.3 |
|---|------|------|------|
| 1 | Global Template ACTIVE 전환 | 순서 미정의, 충돌 위험 | 단일 Transaction 내 ARCHIVED→ACTIVE 순서 확정 |
| 2 | AI Candidate 식별자 | candidate_index: number | candidate_id: string ("cand_xxxxxx") |
| 3 | Confidence 설정 파일명 | growth-config.ts | growth-confidence-config.ts (GrowthConfidenceConfig 인터페이스) |
| 4 | Evidence 저장 | evidence JSONB 단일 컬럼 | 분리 컬럼 4개 + validation |
| 5 | 학생 비식별화 | SHA-256 해시 치환 | NULL / '삭제된 회원' 처리 |
| 6 | ai_request_traces | 없음 | provider_name, model_name, model_version, pricing_config_version, confidence_config_version 추가 |
| 7 | growth_reports | 기본 컬럼만 | 버전 추적 컬럼 8개 추가 |
| 8 | job_queue | idempotency_key만 | payload_hash 추가 |
| 9 | audit_logs | 기본 구조만 | entity_version, correlation_id 추가 |
| 10 | Growth Event 중간 신뢰도 | event_role만으로 모호 | growth_match_status 5단계 추가 |
| 11 | Parent AI 월간 집계 | 별도 테이블 없음 | daily_usage 집계 쿼리만 (테이블 추가 없음) |
| 12 | contract_version / schema_version | 역할 미분리 | API 계약 vs 내부 IR 역할 확정 |
| 13 | Global Template 활성화 API | 미정의 | PATCH /admin/global-template-sets/:id/activate 추가 |

---

## 2. 수정 Migration

V3.2 WP1 Migration에 아래 항목을 추가/수정한다.

```sql
-- ▶ M-A. growth_events evidence 컬럼 분리 (V3.2 M-3의 evidence JSONB 제거, 분리 컬럼으로 대체)
-- V3.2 M-3에서 ADD COLUMN evidence JSONB 는 포함하지 않는다.
-- 대신 아래 분리 컬럼만 추가한다.

ALTER TABLE growth_events
  ADD COLUMN IF NOT EXISTS evidence_source_type TEXT
    CHECK (evidence_source_type IS NULL OR
           evidence_source_type IN ('teacher_input','generated_content')),
  ADD COLUMN IF NOT EXISTS evidence_sentence_index INTEGER
    CHECK (evidence_sentence_index IS NULL OR evidence_sentence_index >= 0),
  ADD COLUMN IF NOT EXISTS evidence_text TEXT
    CHECK (evidence_text IS NULL OR length(evidence_text) <= 300),
  ADD COLUMN IF NOT EXISTS evidence_metadata JSONB,
  ADD COLUMN IF NOT EXISTS evidence_validation TEXT
    CHECK (evidence_validation IS NULL OR
           evidence_validation IN ('PASS','FAIL','SKIPPED')),
  ADD COLUMN IF NOT EXISTS confidence_config_version TEXT,
  ADD COLUMN IF NOT EXISTS growth_match_status TEXT
    CHECK (growth_match_status IS NULL OR
           growth_match_status IN (
             'AUTO_ACCEPTED','PENDING_REVIEW',
             'TEACHER_ACCEPTED','TEACHER_REJECTED','DISCARDED'
           )),
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- ▶ M-B. ai_request_traces 추가 컬럼
ALTER TABLE ai_request_traces
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS model_name TEXT,
  ADD COLUMN IF NOT EXISTS model_version TEXT,
  ADD COLUMN IF NOT EXISTS pricing_config_version TEXT,
  ADD COLUMN IF NOT EXISTS confidence_config_version TEXT;

-- ▶ M-C. growth_reports 버전 추적
ALTER TABLE growth_reports
  ADD COLUMN IF NOT EXISTS report_schema_version TEXT NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS report_template_version TEXT,
  ADD COLUMN IF NOT EXISTS analysis_version TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_version TEXT,
  ADD COLUMN IF NOT EXISTS ppt_template_version TEXT,
  ADD COLUMN IF NOT EXISTS source_data_cutoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_event_count INTEGER;

-- ▶ M-D. job_queue payload_hash
ALTER TABLE job_queue
  ADD COLUMN IF NOT EXISTS payload_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_job_queue_payload_hash
  ON job_queue (job_type, payload_hash)
  WHERE payload_hash IS NOT NULL;

-- ▶ M-E. audit_logs entity_version, correlation_id
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS entity_version INTEGER,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- ▶ M-F. global_template_sets (V3.2와 동일, 명시 재확인)
-- V3.2 M-1 그대로 유지. UNIQUE INDEX on status='ACTIVE' 포함.

-- ▶ M-G. diary_templates global_template_set_id constraint 확정
-- 기존 rows: template_scope 컬럼 없음, 신규 컬럼 추가 후 기존 rows 기본값 = 'pool'
-- → pool rows: set_id = NULL → 정합성 OK
-- scope='global' rows: set_id NOT NULL 검증은 신규 삽입 시부터 적용
ALTER TABLE diary_templates
  ADD CONSTRAINT IF NOT EXISTS chk_template_scope_set_id
    CHECK (
      (template_scope = 'pool' AND global_template_set_id IS NULL) OR
      (template_scope = 'global' AND global_template_set_id IS NOT NULL)
    );
```

---

## 3. AI Contract — candidate_id 변경

### V3.2 → V3.3 변경 지점

```typescript
// ▶ 변경 전 (V3.2)
interface CurriculumMatchV12 {
  candidate_index: number;   // ← 제거
  ...
}

// ▶ 변경 후 (V3.3)
interface CurriculumMatchV12 {
  candidate_id: string;      // ← "cand_7f3a2c" 형식
  curriculum_item_id: string;
  curriculum_version_id: string;
  confidence: number;
  evidence: EvidenceSpan;
  match_method: string;
}
```

### candidate_id 생성 규칙

```typescript
// artifacts/api-server/src/lib/curriculum-candidate-search.ts
function generateCandidateId(): string {
  // "cand_" + 6자리 랜덤 hex
  return 'cand_' + crypto.randomBytes(3).toString('hex');
}

// request 단위 Map (요청 처리 중 메모리에만 존재)
const candidateMap = new Map<string, {
  candidateId: string;
  curriculumItemId: string;
  curriculumVersionId: string;
  poolId: string;
  similarityScore: number;
}>();
```

### GPT 전달 구조 (V3.3 확정)

```json
{
  "curriculum_candidates": [
    {
      "candidate_id": "cand_7f3a2c",
      "skill_name": "자유형 측면 호흡",
      "description": "호흡 시 머리를 과도하게 들지 않고 옆으로 회전"
    },
    {
      "candidate_id": "cand_b191d4",
      "skill_name": "자유형 팔 리커버리",
      "description": "팔꿈치를 부드럽게 들어 앞으로 이동"
    }
  ]
}
```

### GPT 반환 구조 (V3.3 확정)

```json
{
  "curriculum_matches": [
    {
      "candidate_id": "cand_7f3a2c",
      "evidence_text": "호흡 타이밍이 좋아졌어요."
    }
  ]
}
```

### 서버 후처리 규칙

```
candidate_id 수신
  → candidateMap.get(candidate_id) 조회
  → 없으면 즉시 폐기 (GPT 창작 ID)
  → pool_id, curriculum_version_id 재검증
  → student assignment version 일치 확인
  → curriculum_item.is_active 확인
  → evidence 검증
  → confidence 계산
  → 최종 CurriculumMatch 조립

candidate_id 정책:
  - 요청마다 신규 생성 (재사용 금지)
  - request_id와 함께 검증
  - candidate_id에 학생명, DB ID 포함 금지
  - AI Trace에 candidate_id 목록 및 선택 여부 기록 가능
```

---

## 4. Confidence Config 설정 파일

### 파일명 확정

```typescript
// artifacts/api-server/src/config/growth-confidence-config.ts
// (V3.2의 growth-config.ts를 이 파일로 대체)

export interface GrowthConfidenceConfig {
  config_version: string;
  weights: {
    curriculum_similarity: number;  // 합계 = 1.0
    concept_overlap: number;
    evidence_coverage: number;
    parser_confidence: number;
    candidate_rank_score: number;
  };
  thresholds: {
    auto_progress: number;      // 이상: AUTO_ACCEPTED
    review_required: number;    // 이상~미만: PENDING_REVIEW
    // 미만: DISCARDED
  };
}

export const DEFAULT_CONFIDENCE_CONFIG: GrowthConfidenceConfig = {
  config_version: "confidence_v1",
  weights: {
    curriculum_similarity: 0.35,
    concept_overlap:       0.25,
    evidence_coverage:     0.20,
    parser_confidence:     0.10,
    candidate_rank_score:  0.10,
  },
  thresholds: {
    auto_progress:    0.75,
    review_required:  0.55,
  },
};

// 로딩 함수 (실패 시 기본값 반환)
export function loadConfidenceConfig(): GrowthConfidenceConfig {
  // 환경변수 또는 DB override 가능
  // 로딩 실패 → DEFAULT_CONFIDENCE_CONFIG 반환
  // 검증: weights 합계 = 1.0 ± 0.001
  //        auto_progress > review_required
  return DEFAULT_CONFIDENCE_CONFIG;
}
```

### 설정 변경 정책

```
- 파일럿 50개 결과 후 수치 조정 → config_version = "confidence_v2"
- 변경은 신규 요청부터만 적용
- growth_events.confidence_config_version에 당시 버전 저장
- 기존 이벤트 자동 재계산 금지
- 재계산이 필요하면 별도 job_queue 'recalculate_growth_events' 사용
```

---

## 5. Evidence 구조 (분리 컬럼 확정)

### 컬럼 구조

```
growth_events:
  evidence_source_type    TEXT  -- 'teacher_input' | 'generated_content' | NULL
  evidence_sentence_index INTEGER  -- 0-based, NULL 허용
  evidence_text           TEXT  -- 최대 300자, NULL 허용
  evidence_metadata       JSONB -- 확장 메타 (start_offset 등 미래 추가)
  evidence_validation     TEXT  -- 'PASS' | 'FAIL' | 'SKIPPED' | NULL
```

### 검증 흐름

```
1. GPT evidence_text 수신
2. source_type 결정:
   - teacher_input   → req.input.text 원문
   - generated_content → 해당 student content
3. 원본 텍스트를 문장 분리 (마침표/느낌표/물음표 기준)
4. evidence_text가 sentences[] 중 하나에 포함되는지 확인
5. PASS → sentence_index 기록
6. FAIL → match 폐기, evidence_validation='FAIL'
           progress event 생성 금지
7. SKIPPED → template-only 경로 등 evidence 불필요한 경우
```

### 로그·개인정보 정책

```
- 운영 로그: evidence_text 전체 출력 금지
- ai_request_traces: source_type, sentence_index, evidence_validation만 저장
                     (evidence_text 원문 저장 금지)
- 개인정보 삭제 요청 시: evidence_text = NULL (비식별화)
- Debug 환경(NODE_ENV=development)만: 앞 5자 + *** + 뒤 5자 마스킹 출력 허용
```

---

## 6. Growth Event Pending Review 구조

### growth_match_status 5단계

```
AUTO_ACCEPTED
  - 조건: confidence >= auto_progress threshold
  - event_role = 'progress'
  - 성장판 집계 포함
  - 교사 화면: 확인용 표시 (변경 불가 — 정책 미결)

PENDING_REVIEW
  - 조건: review_required <= confidence < auto_progress
  - event_role = 'observation' (성장판 미반영)
  - 교사 UI에 "확인 필요" 항목 표시
  - 48시간 미응답 시 DISCARDED 자동 처리 (job_queue)

TEACHER_ACCEPTED
  - 교사가 PENDING_REVIEW를 승인
  - event_role = 'progress' (성장판 집계 포함)
  - reviewed_by, reviewed_at, review_reason 기록
  - Audit Log 기록

TEACHER_REJECTED
  - 교사가 PENDING_REVIEW를 거절
  - event_role = 'observation' (성장판 미반영)
  - reviewed_by, reviewed_at, review_reason 기록
  - Audit Log 기록

DISCARDED
  - confidence < review_required 또는 검증 실패
  - 저장하거나 저장하지 않음 (파일럿 후 결정)
  - 저장 시: event_role = 'observation', 성장판 미반영
```

### 성장판 집계 조건

```sql
-- 성장판 포함 조건
WHERE growth_match_status IN ('AUTO_ACCEPTED','TEACHER_ACCEPTED')
  AND event_role = 'progress'
  AND is_invalidated = FALSE
```

### 교사 승인 API

```
PATCH /api/v1/pools/:poolId/growth-events/:eventId/review
  Auth: teacher, pool_admin (해당 diary_note 권한 검증 필수)
  Body: { action: 'accept' | 'reject', reason?: string }
  → reviewed_by, reviewed_at, review_reason 기록
  → TEACHER_ACCEPTED: event_role = 'progress'
  → TEACHER_REJECTED: event_role = 'observation' 유지
  → Audit Log INSERT
```

### 미결 정책

```
- AUTO_ACCEPTED 항목을 일반 교사가 변경할 수 있는지: NEEDS_VERIFICATION
  (pool_admin은 가능, 일반 teacher는 불가 권장)
- 일지 삭제 시: 모든 growth_match_status의 관련 event → is_invalidated=true
```

---

## 7. Global Template ACTIVE 전환 Transaction

### 확정된 Transaction 순서

```sql
BEGIN;

-- 1. 기존 ACTIVE → ARCHIVED (없어도 정상)
UPDATE global_template_sets
  SET status = 'ARCHIVED', archived_at = NOW()
  WHERE status = 'ACTIVE';

-- 2. 대상 DRAFT/ARCHIVED → ACTIVE
UPDATE global_template_sets
  SET status = 'ACTIVE', activated_at = NOW(), archived_at = NULL
  WHERE id = $newSetId
    AND status IN ('DRAFT', 'ARCHIVED');

-- UPDATE 결과가 0건이면 ROLLBACK (존재하지 않거나 이미 ACTIVE)

-- 3. audit_logs INSERT
INSERT INTO audit_logs (actor_type, actor_id, pool_id, action, entity_type, entity_id,
  before_data, after_data, reason, request_id, ip_hash)
VALUES ('super_admin', $actorId, NULL, 'activate_global_template_set',
  'global_template_sets', $newSetId,
  $beforeData, $afterData, $reason, $requestId, $ipHash);

COMMIT;
```

### 활성화 API

```
PATCH /api/v1/admin/global-template-sets/:id/activate
  Auth: super_admin only

  사전 검증:
  - 대상 세트 존재 여부
  - 유효 template 수 >= 1
  - status IN ('DRAFT', 'ARCHIVED')

  동작: 위 Transaction 수행

  응답:
  {
    "active_set_id": "gts_xxx",
    "version_name": "global_v1",
    "previous_set_id": "gts_yyy" | null,
    "activated_at": "2026-08-02T..."
  }

  실패 시: 전체 Rollback, 상세 오류 반환

  롤백 API:
  PATCH /api/v1/admin/global-template-sets/:id/activate
    → 이전 ARCHIVED 세트 id로 동일하게 호출
```

### 검색 쿼리 확정

```sql
-- 항상 ACTIVE 세트의 template만 조회
SELECT dt.*
FROM diary_templates dt
JOIN global_template_sets gts ON gts.id = dt.global_template_set_id
WHERE dt.template_scope = 'global'
  AND dt.is_active = TRUE
  AND gts.status = 'ACTIVE';
```

---

## 8. 학생 비식별화 정책

### V3.2 수정 (SHA-256 제거)

```typescript
// 기존 (V3.2): name = SHA256(name), phone = SHA256(phone)  ← 제거
// 변경 (V3.3):

async function anonymizeStudent(studentId: string, db: DB): Promise<void> {
  await db.query(`
    UPDATE students SET
      name             = '삭제된 회원',
      phone            = NULL,
      parent_phone     = NULL,
      parent_phone2    = NULL,
      parent_phone3    = NULL,
      birth_date       = NULL,
      memo             = NULL,
      notes            = NULL,
      invite_code      = NULL,
      deleted_at       = NOW(),
      status           = 'deleted',
      class_group_id   = NULL,
      assigned_class_ids = '[]'::jsonb,
      updated_at       = NOW()
    WHERE id = $1
  `, [studentId]);
  // student_id(PK)는 참조 무결성 위해 유지
  // growth_events, attendance: student_id 유지 (비식별화된 상태)
  // parent_students: 연결 유지 (parent 화면에서 '삭제된 회원'으로 표시)
  // parent_accounts: 다른 활성 학생 없으면 is_active=false
}
```

### 중복 표시 처리

```
UI에서 동일 이름 구분이 필요한 경우:
  → '삭제된 회원'만 표시 (기록번호 노출 금지)
  → 슈퍼어드민 감사 화면: student_id 앞 8자리만 표시
```

### 삭제 영향 분석 `REPOSITORY_VERIFIED`

```
[현재 코드 분석 결과]
- attendance: student_id TEXT (FK 없음) → 삭제 후 레코드 유지됨, 비식별 이름은 JOIN 시 '삭제된 회원' 표시
- class_diary_student_notes: is_deleted 필터는 있으나 students.deleted_at 필터 없음
    → class_group_id=NULL이 되면 관련 일지 조회 블록이 실행 안 됨 (간접 차단)
    → 직접 학생별 노트 조회 API는 별도 students.deleted_at IS NULL 필터 추가 필요 (WP7)
- parent_accounts: is_active=false 처리 (현재 코드:1338-1341)
- parent_students: 연결 유지 (현재 코드:1321 명시)
```

### 법적 보존 구분

```
비식별화 후 보존:
  - growth_events (student_id 기준, 이름 없음)
  - attendance (student_id 기준)
  - 결제/정산 기록 (법적 5년)
  - deep_report_orders (student_id 기준)

삭제 가능 (요청 시):
  - parent_ai_conversations/messages (CASCADE)
  - 프로필 이미지 (R2 30일 후 정리)

Audit Log에 비식별화 이전 원본 저장 금지.
```

---

## 9. 추가 버전 추적 컬럼 확정

### contract_version vs schema_version 역할 분리

```
contract_version (API 계약):
  - 클라이언트↔서버 응답 필드 계약
  - 필드 추가·삭제·타입 변경 시 증가
  - 클라이언트 호환성 판단 기준
  - 예: "1.0", "1.1", "1.2"

schema_version (서버 내부 IR):
  - Parser Meaning 구조
  - Candidate 내부 구조
  - Evidence 내부 구조
  - LLM 출력 검증 구조
  - 서버 내부만 사용
  - 예: "curriculum_match_schema_v1", "meaning_schema_v1"

응답 예시:
{
  "contract_version": "1.2",
  "schema_version": "curriculum_match_schema_v1"
}
```

### ai_request_traces 모델/비용 추적

```typescript
// 요청 시 기록
provider_name:          "openai"
model_name:             "gpt-4o-mini"  // 실제 API model identifier
model_version:          null           // API response에서 확인 가능 시 기록
pricing_config_version: "pricing_2026_08_v1"  // ai-pricing.ts 버전
confidence_config_version: "confidence_v1"    // growth-confidence-config.ts 버전

// 정책:
// - estimated_cost는 요청 당시 pricing config 기준으로 계산 후 고정
// - 모델 가격 변경 시 pricing_config_version bump
// - 과거 estimated_cost를 새 가격으로 덮어쓰지 않음
```

### growth_reports 버전 추적

```typescript
// 리포트 생성 시 고정
report_schema_version:    "1.0"
report_template_version:  "report_template_v1"
analysis_version:         "analysis_v1"
prompt_version:           "p_report_v1"
knowledge_version:        null   // 미구현
ppt_template_version:     null   // NEEDS_VERIFICATION (PPT 구현 없음)
source_data_cutoff_at:    NOW()  // 데이터 집계 기준 시점
source_event_count:       42     // 집계된 growth_events 수

// 정책:
// - 리포트 재다운로드 시 재분석 금지
// - 재생성은 새 growth_reports row 생성 (기존 row 덮어쓰기 금지)
// - 이전/신규 리포트 비교 가능
```

### job_queue payload_hash

```typescript
// canonical JSON → SHA-256
function computePayloadHash(jobType: string, payload: object): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(jobType + ':' + canonical).digest('hex');
}

// 사용: 중복 탐지 및 운영 디버깅용
// 실제 중복 차단: idempotency_key 기준 (payload_hash만으로 차단 금지)
```

### audit_logs entity_version + correlation_id

```typescript
// entity_version: 동일 entity 변경 횟수 (1씩 증가)
// Transaction 안에서:
const nextVersion = await db.query(`
  SELECT COALESCE(MAX(entity_version), 0) + 1
  FROM audit_logs
  WHERE entity_type = $1 AND entity_id = $2
  FOR UPDATE
`, [entityType, entityId]);

// correlation_id: 여러 서비스·Job·AI 요청을 묶는 흐름 추적
// request_id: 단일 HTTP 요청
// correlation_id: diary 생성 → growth_event → report 생성 전체 흐름

// 단순 조회·파일 다운로드: entity_version = NULL 허용
```

---

## 10. Repository 확인 결과 `REPOSITORY_VERIFIED`

| § | 항목 | 결과 |
|---|------|------|
| §15.1 | growth_events evidence JSONB 중복 여부 | V3.2 M-3에 evidence JSONB 계획 → V3.3에서 분리 컬럼으로 대체. 단일 evidence JSONB는 추가하지 않는다. |
| §15.2 | 앱이 curriculum_matches를 안전하게 무시하는지 | ✅ `diary.tsx`는 `common`, `students[].content`만 처리. `curriculum_matches` 없어도 crash 없음. 새 필드는 undefined로 무시됨. |
| §15.3 | 교사 match 승인 UI 위치 | `(teacher)/diary.tsx`에 PENDING_REVIEW 항목 표시 섹션 추가. 별도 화면 불필요 (인라인 처리). |
| §15.4 | Global Template 활성화 슈퍼어드민 화면 | `(super)/pools.tsx` 또는 신규 `(super)/template-sets.tsx`. 기존 화면 중 적합한 위치 없음 → 신규 화면 권장 (WP4). |
| §15.5 | Growth Report PPT 저장 경로와 파일 테이블 | `photo_assets_meta`, `video_assets_meta` 존재. PPT 생성 코드 **없음**. PPT 저장용 `report_files` 테이블 별도 설계 필요. → `NEEDS_VERIFICATION` (WP18에서 설계) |
| §15.6 | Audit Log DB 레벨 DELETE/UPDATE 제한 가능 여부 | migration에 REVOKE 없음. Render.com/Supabase 설정에서 별도 적용 필요. 현재는 애플리케이션 레벨만 가능. → `NEEDS_VERIFICATION` |
| §15.7 | 학생 삭제 시 부모·출결·일지 영향 | 출결: FK 없음, 레코드 유지. 일지 노트: class_group_id=NULL이 간접 필터 역할. `deleted_at IS NULL` 필터는 코드 전체에 없음 → WP7에서 명시적 필터 추가 필요. |

---

## 11. 변경 파일

| 파일 | 변경 내용 | WP |
|------|---------|----|
| `artifacts/api-server/src/config/growth-confidence-config.ts` | 신규 (V3.2 growth-config.ts 대체) | WP6 |
| `artifacts/api-server/src/config/ai-pricing.ts` | 신규 (V3.2와 동일, 파일명 확정) | WP10 |
| `artifacts/api-server/src/lib/curriculum-candidate-search.ts` | candidate_id 방식으로 수정 (V3.2 candidate_index 제거) | WP6 |
| `artifacts/api-server/src/lib/curriculum-confidence.ts` | GrowthConfidenceConfig 사용으로 수정 | WP6 |
| `artifacts/api-server/src/routes/ai-v1.ts` | candidate_id 방식, schema_version 분리, contract 1.2 | WP6 |
| `artifacts/api-server/src/lib/ai-diary-utils.ts` | curriculum_matches 검증 → candidate_id 기반 | WP6 |
| `artifacts/api-server/src/routes/diary.ts` | growth_event 저장 시 growth_match_status 포함, deleted_at 필터 추가 | WP7 |
| `artifacts/api-server/src/routes/students.ts` | 학생 삭제 시 SHA-256 제거 → NULL/'삭제된 회원' | WP13 |
| `artifacts/api-server/src/migrations/pool-db-init.ts` | M-A~M-G 추가 | WP1 |
| `artifacts/api-server/src/routes/xmode.ts` | global-template-sets activate API 추가 | WP4 |
| `artifacts/swim-app/app/(teacher)/diary.tsx` | PENDING_REVIEW 표시 + 승인/거절 UI | WP13 |
| `artifacts/swim-app/app/(super)/template-sets.tsx` | 신규 — Global Template Set 활성화 화면 | WP4 |
| `render.yaml` | worker service 추가 (V3.2와 동일) | WP11 |

---

## 12. 테스트

| WP | 추가 테스트 항목 |
|----|----------------|
| WP1 | evidence 분리 컬럼 INSERT, growth_match_status CHECK CONSTRAINT |
| WP4 | Global Template ACTIVE 전환 Transaction — 중간에 rollback 시 기존 ACTIVE 유지 확인 |
| WP4 | ACTIVE 세트 없는 상태에서 검색 → 빈 결과 (crash 없음) |
| WP6 | candidate_id 범위 밖 값 반환 시 폐기 확인 |
| WP6 | confidence_config_version이 growth_events에 저장되는지 확인 |
| WP7 | confidence 0.74 → PENDING_REVIEW, 0.75 → AUTO_ACCEPTED |
| WP7 | 교사 승인 API → TEACHER_ACCEPTED + 성장판 포함 확인 |
| WP7 | 일지 삭제 → PENDING_REVIEW, AUTO_ACCEPTED 모두 is_invalidated=true |
| WP7 | 삭제 학생의 diary_student_notes 조회 → 결과 없음 (deleted_at 필터) |
| WP13 | 학생 삭제 후 name='삭제된 회원', phone=NULL 확인 |
| WP13 | 삭제 학생 조회 API → 결과에서 제외 또는 비식별 표시 확인 |

---

## 13. Rollback

| WP | Rollback |
|----|---------|
| WP1 | M-A: `ALTER TABLE growth_events DROP COLUMN IF EXISTS evidence_source_type, ...` (분리 컬럼 DROP) |
| WP1 | M-B: `ALTER TABLE ai_request_traces DROP COLUMN IF EXISTS provider_name, ...` |
| WP1 | M-C: `ALTER TABLE growth_reports DROP COLUMN IF EXISTS report_schema_version, ...` |
| WP1 | M-D: `ALTER TABLE job_queue DROP COLUMN IF EXISTS payload_hash` |
| WP1 | M-E: `ALTER TABLE audit_logs DROP COLUMN IF EXISTS entity_version, correlation_id` |
| WP4 | `(super)/template-sets.tsx` 삭제, activate API 라우트 제거 |
| WP6 | `candidate_id` → `candidate_index`로 원복, `growth-confidence-config.ts` 삭제 |
| WP7 | `growth_match_status` 관련 로직 제거, diary.ts growth_event 연동 원복 |

---

## 14. 남은 NEEDS_VERIFICATION (V3.3 추가)

| # | 항목 |
|---|------|
| V3.2-1 | RevenueCat webhook payload의 정확한 transaction ID 필드명 |
| V3.2-2 | RevenueCat consumable 상품 webhook 이벤트 타입 목록 |
| V3.2-7 | Render.com starter plan Worker 추가 과금 여부 |
| V3.3-1 | Growth Report PPT 저장 구조 (report_files 테이블 설계, WP18) |
| V3.3-2 | Audit Log DB 레벨 DELETE/UPDATE 실제 제한 방법 (Render/Supabase 설정) |
| V3.3-3 | AUTO_ACCEPTED 항목을 일반 teacher가 변경할 수 있는지 정책 확정 |
| V3.3-4 | 삭제 학생 diary_student_notes 직접 조회 API 전체 목록 및 필터 추가 범위 (WP7에서 확정) |
| V3.3-5 | PENDING_REVIEW 48시간 미응답 자동 DISCARDED 정책 (파일럿 후 확정) |
