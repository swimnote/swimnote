# SWIMNOTE X — 구현 전 설계 보고서 V3.1 최종
> 작성일: 2026-08-02 | V3 → V3.1 보완 (구현 시작 전 최종 확정)

---

## 1. 수정 ERD

```
swimming_pools
  ├── xmode_entitlement        BOOLEAN  -- 결제 권한 (true = 유효 구독)
  ├── xmode_config_status      TEXT     -- 교육 준비 상태
  ├── xmode_subscription_end_at TIMESTAMPTZ
  ├── xmode_purchased_at       TIMESTAMPTZ
  ├── xmode_payment_failed_at  TIMESTAMPTZ
  └── homepage_enabled         BOOLEAN

curriculum_versions (pool_id → swimming_pools)
  └── UNIQUE PARTIAL INDEX: (pool_id) WHERE status='active'

curriculum_items (version_id → curriculum_versions)

student_curriculum_assignments (student_id, curriculum_version_id)
  ├── assigned_at
  ├── ended_at (nullable)
  └── status: active | ended

growth_events
  ├── diary_note_id → class_diary_student_notes (nullable)
  ├── curriculum_item_id → curriculum_items (required if event_role='progress')
  ├── confidence  NUMERIC(4,3) CHECK 0.0~1.0
  ├── event_role: progress | observation
  └── PARTIAL UNIQUE on diary_note_id (NOT NULL case)

curriculum_requests (pool_id → swimming_pools)
  └── PARTIAL UNIQUE INDEX: (pool_id) WHERE status IN ('pending','in_progress')

pool_events
  └── sender_role: super_admin | pool_admin | system

diary_templates
  ├── template_scope: pool | global
  └── swimming_pool_id (nullable)

growth_report_entitlements (student_id, report_month UNIQUE)
  └── status: available | generating | completed | failed
      ※ insufficient_data = 상태 아님, 생성 불가 사전 판단 (entitlement 소모 없음)

deep_report_orders
  └── rc_transaction_id UNIQUE

parent_ai_conversations → parent_ai_messages
parent_ai_daily_usage (parent_account_id, usage_date UNIQUE)
```

---

## 2. X모드 상태 분리 (A안 vs B안 비교)

### 배경 문제
현재 V3의 `xmode_status` 단일 컬럼에 **결제 상태**와 **교육 준비 상태** 두 의미가 혼재.
재결제 시 이미 완성된 커리큘럼을 다시 의뢰 상태(`CURRICULUM_PENDING`)로 되돌리는 문제 발생.

---

### A안 (권장): 두 컬럼 분리

```sql
ALTER TABLE swimming_pools
  ADD COLUMN xmode_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
    -- true  = RevenueCat 유효 구독 (INITIAL_PURCHASE, RENEWAL → true)
    -- false = 구독 없음 (EXPIRATION → false)
  ADD COLUMN xmode_config_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (xmode_config_status IN ('NOT_CONFIGURED','CURRICULUM_PENDING','READY')),
    -- NOT_CONFIGURED   = 커리큘럼 생성 전
    -- CURRICULUM_PENDING = 의뢰 접수 → 슈퍼어드민 생성 중
    -- READY            = 커리큘럼 완성, 기능 사용 가능
  ADD COLUMN xmode_subscription_end_at TIMESTAMPTZ,
  ADD COLUMN xmode_purchased_at TIMESTAMPTZ,
  ADD COLUMN xmode_payment_failed_at TIMESTAMPTZ;
```

**최종 사용 가능 조건**: `xmode_entitlement = true AND xmode_config_status = 'READY'`

**재결제 시 동작**:
```
EXPIRATION 이벤트 → xmode_entitlement = false  (config_status 건드리지 않음)
INITIAL_PURCHASE  → xmode_entitlement = true   (config_status 건드리지 않음)

결과:
  기존에 READY였던 수영장 → EXPIRATION 후 재결제 시 entitlement=true + READY → 즉시 ACTIVE
  처음 결제하는 수영장    → entitlement=true + NOT_CONFIGURED → 의뢰 필요
```

---

### B안: xmode_status 유지 + 재결제 시 ACTIVE 자동 복구

```
INITIAL_PURCHASE 이벤트 처리 시:
  active curriculum_versions 존재하면 → xmode_status = 'ACTIVE'
  없으면 → xmode_status = 'PURCHASED'
```

---

### 비교표

| 기준 | A안 (권장) | B안 |
|------|-----------|-----|
| 재결제 커리큘럼 보존 | ✅ 자동 (컬럼 분리로 독립) | ⚠️ curriculum 존재 검사 로직 추가 필요 |
| 상태 의미 명확성 | ✅ 결제 ≠ 교육 준비 명확히 분리 | ❌ 단일 컬럼에 혼재 |
| webhook 코드 단순성 | ✅ entitlement true/false 토글만 | ⚠️ 조건 분기 추가 |
| 마이그레이션 비용 | 컬럼 2개 추가, 기존 코드 수정 | 조건 분기 추가만 |
| 확장성 (config_status 추가) | ✅ 독립 상태 추가 가능 | ❌ status enum에 계속 혼재 |
| UI 표현 | ✅ "결제됨 + 설정 중" 동시 표현 가능 | ❌ 하나의 라벨만 |

**결론: A안 채택**

---

## 3. 상태 전이도

### X모드 entitlement (결제 권한)

```
FALSE ──[INITIAL_PURCHASE]──→ TRUE
TRUE  ──[EXPIRATION]─────────→ FALSE
TRUE  ──[CANCELLATION]───────→ TRUE (만료일까지 유지, EXPIRATION에서 FALSE로)
TRUE  ──[BILLING_ISSUE]──────→ TRUE + payment_failed_at=now()
FALSE ──[RENEWAL]────────────→ TRUE
```

### xmode_config_status (교육 준비 상태)

```
NOT_CONFIGURED
  ──[풀어드민: 의뢰 제출]──────→ CURRICULUM_PENDING
  
CURRICULUM_PENDING
  ──[슈퍼어드민: 커리큘럼 완성]──→ READY
  ──[슈퍼어드민: 의뢰 반려]────→ NOT_CONFIGURED

READY
  ──[변경 없음: EXPIRATION/재결제 무관]──→ READY (유지)
  ──[슈퍼어드민: 수동 초기화]──→ NOT_CONFIGURED (관리자 명시적 조작만)
```

### 최종 사용 가능 매트릭스

| entitlement | config_status | 선생님 AI 일지 | 학부모 성장판 | 학부모 AI 검색 |
|-------------|--------------|--------------|-------------|--------------|
| false | 무관 | X (기본 AI) | X | X |
| true | NOT_CONFIGURED | X (기본 AI) | X | X |
| true | CURRICULUM_PENDING | X (기본 AI) | X | X |
| true | READY | ✅ (ACTIVE) | ✅ | ✅ |

---

## 4. AI 응답 계약 (Response Contract) `REPOSITORY_VERIFIED 후 확장`

### 현재 구조 (REPOSITORY_VERIFIED)
```typescript
// 현재 ai-v1.ts:394-397 — curriculum_matches 없음
result: {
  common: finalResult.common,    // 공통 일지 텍스트
  students: finalResult.students // [{ student_ref, content }]
}
```

### 신규 계약 (V3.1)
```typescript
// POST /api/v1/teacher-diary/generate 응답
{
  contract_version: "1.1",         // 기존 1.0 → 1.1 bump
  request_id: string,
  schema_version: string,
  engine_version: string,
  feature: "TEMPLATE_ASSISTED" | "INPUT_ONLY",
  result: {
    common: string,
    students: StudentResult[]
  },
  meta: {
    generation_mode: string,
    parser_confidence: number,     // 기존 유지
    template_used: boolean
  }
}

interface StudentResult {
  student_ref: string,             // 기존 유지
  content: string,                 // 기존 유지
  curriculum_matches: CurriculumMatch[]  // 신규
}

interface CurriculumMatch {
  curriculum_item_id: string,      // curriculum_items.id
  confidence: number,              // 0.0~1.0 (소수점 3자리)
  evidence: string                 // GPT가 content에서 찾은 근거 문장
}
```

### growth_event 생성 정책

```
[AI 응답 반환] → 클라이언트가 Preview 표시
                       ↓ (growth_event 생성 금지)
[교사: 최종 저장 확정]
  → POST /diaries (또는 PATCH /diaries/:id/finalize)
      body: { students: [{ student_ref, content, curriculum_matches[] }] }
  → 서버: confidence >= 0.6 인 항목만 growth_event INSERT
           confidence < 0.6 이면 growth_event 생성 안 함
           diary_note_id 기준 partial unique → 저장 2회 호출해도 중복 없음
```

**confidence threshold**: 0.6 (성장판 자동 반영 기준)

**GPT 프롬프트 변경**:
```
기존: {"common":"...","students":[{"student_ref":"...","content":"..."}]}
신규: {
  "common": "...",
  "students": [{
    "student_ref": "...",
    "content": "...",
    "curriculum_matches": [
      { "item_id": "...", "confidence": 0.85, "evidence": "..." }
    ]
  }]
}
```

---

## 5. 학생별 커리큘럼 버전 관리

### student_curriculum_assignments 테이블

```sql
CREATE TABLE student_curriculum_assignments (
  id TEXT PRIMARY KEY DEFAULT ('sca_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,                          -- 조회 편의
  student_id TEXT NOT NULL,
  curriculum_version_id TEXT NOT NULL
    REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,                           -- NULL = 현재 배정 중
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','ended')),
  reason TEXT,                                    -- 'version_update', 'manual', 'graduation'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 학생별 현재 배정 버전 1개만 허용
CREATE UNIQUE INDEX idx_sca_student_active
  ON student_curriculum_assignments (student_id)
  WHERE status = 'active';
```

### 배정 Sequence

```
[신규 학생 등록]
  → active curriculum_versions WHERE pool_id = $poolId 조회
  → student_curriculum_assignments INSERT (version_id=active, status='active')

[커리큘럼 버전 변경 — 슈퍼어드민]
  → 새 curriculum_versions INSERT (status='active')
  → 기존 active version status='archived'
  → 기존 학생:
      policy = 'keep_current' (기본값)
        → student_curriculum_assignments 변경 없음 (기존 버전 그대로)
      policy = 'migrate_all' (명시적 선택 시)
        → 기존 assignments ended_at=now(), status='ended'
        → 새 assignments INSERT (version_id=new)
  → 신규 학생:
      → 새 active version으로 자동 배정

[성장판 계산 기준]
  → student_curriculum_assignments WHERE student_id=$sid AND status='active'
    → assigned_version_id 조회
  → growth_events WHERE student_id=$sid AND curriculum_item_id IN (
      SELECT id FROM curriculum_items WHERE version_id=$assignedVersionId
    )

[리포트 재현성]
  → growth_events는 curriculum_item_id(불변 id)로 연결
  → 과거 리포트: growth_events JOIN curriculum_items (버전 무관)
  → 리포트 생성 시 사용된 version_id를 deep_report_orders.curriculum_version_id로 저장
```

---

## 6. 무료 리포트 정책 수정

### 상태 재정의

```
[free report 생성 요청]
  ↓
사전 판단: growth_events 건수 >= 임계값? (예: 3건)
  ↓ NO
  → 클라이언트에 "데이터 부족" 안내 반환
  → entitlement.status 변경 없음 (available 유지)
  ↓ YES
  → entitlement.status = 'generating'
  → GPT 호출
      ↓ 성공
      → entitlement.status = 'completed', generated_report_id=xxx
          (이 시점에 무료권 사용 완료)
      ↓ 실패
      → entitlement.status = 'failed'
      → 재시도 가능 (failed는 소모 아님, available로 되돌림)
```

### growth_report_entitlements 수정

```sql
CREATE TABLE growth_report_entitlements (
  id TEXT PRIMARY KEY DEFAULT ('gre_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL
    REFERENCES students(id) ON DELETE CASCADE,
  report_month TEXT NOT NULL,             -- 'YYYY-MM'
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN (
      'available',    -- 미사용 (생성 가능)
      'generating',   -- 생성 중
      'completed',    -- 생성 완료 (사용 완료)
      'failed'        -- 생성 실패 → 자동으로 available 복구
    )),
    -- insufficient_data는 STATUS가 아님: 사전 판단 결과, entitlement 컬럼에 저장 안 함
  min_events_required INTEGER DEFAULT 3,  -- 데이터 충분 기준
  generated_report_id TEXT,
  reserved_at TIMESTAMPTZ,
  generating_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, report_month)
);
```

---

## 7. Parent AI 사용량 구조 (A안 vs B안)

### A안: parent_ai_daily_usage 테이블

```sql
CREATE TABLE parent_ai_daily_usage (
  id TEXT PRIMARY KEY DEFAULT ('pau_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- Asia/Seoul 기준
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_account_id, usage_date)
);
```

**사용 흐름**:
```
질문 도착 →
  SELECT question_count FROM parent_ai_daily_usage
  WHERE parent_account_id=$id AND usage_date=TODAY
  → count >= limit → 거부
  → count < limit →
      INSERT ... ON CONFLICT DO UPDATE SET question_count = question_count + 1
      → 질문 처리
```

---

### B안: parent_ai_messages 집계

```sql
-- parent_ai_messages의 role='user' 행을 날짜별 COUNT
SELECT COUNT(*) FROM parent_ai_messages pam
JOIN parent_ai_conversations pac ON pam.conversation_id = pac.id
WHERE pac.parent_account_id = $id
  AND pam.role = 'user'
  AND DATE(pam.created_at AT TIME ZONE 'Asia/Seoul') = CURRENT_DATE;
```

---

### 비교표

| 기준 | A안 (권장) | B안 |
|------|-----------|-----|
| 추가 테이블 | parent_ai_daily_usage 1개 | 없음 |
| 사용량 조회 속도 | ✅ O(1) (index로 즉시 조회) | ❌ O(n) (messages 집계) |
| 동시성 안전 | ✅ ON CONFLICT atomic increment | ❌ race condition 가능 |
| 데이터 보존 | 집계된 숫자만 | 전체 대화 이력 보존 |
| 구현 복잡도 | 낮음 | 낮음 (별도 쿼리만) |
| 제한 변경 유연성 | ✅ 분리된 컬럼으로 조정 용이 | ⚠️ 매번 쿼리 수정 |
| 사용량 리셋 | ✅ 행 삭제 또는 update | ⚠️ messages 삭제해야 함 |

**결론: A안 채택** (동시성 안전 + 조회 성능)

---

## 8. Constraint 목록 (전체)

### curriculum_versions: 수영장별 ACTIVE 1개

```sql
CREATE UNIQUE INDEX idx_curriculum_versions_active_one
  ON curriculum_versions (pool_id)
  WHERE status = 'active';
```

### growth_events: confidence 범위

```sql
ALTER TABLE growth_events
  ADD CONSTRAINT chk_growth_events_confidence
    CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0));
```

### growth_events: progress event curriculum_item_id 필수

```sql
ALTER TABLE growth_events
  ADD CONSTRAINT chk_growth_events_progress_item
    CHECK (
      event_role != 'progress' OR curriculum_item_id IS NOT NULL
    );
```

### growth_events: diary_note_id NOT NULL partial UNIQUE (멱등성)

```sql
CREATE UNIQUE INDEX idx_growth_events_diary_item
  ON growth_events (diary_note_id, student_id, curriculum_item_id, source)
  WHERE diary_note_id IS NOT NULL;
```

### growth_events: idempotency_key UNIQUE

```sql
CREATE UNIQUE INDEX idx_growth_events_idempotency
  ON growth_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### curriculum_requests: 활성 의뢰 1개

```sql
CREATE UNIQUE INDEX idx_curriculum_requests_active_one
  ON curriculum_requests (pool_id)
  WHERE status IN ('pending','in_progress');
```

### student_curriculum_assignments: 학생별 active 1개

```sql
CREATE UNIQUE INDEX idx_sca_student_active
  ON student_curriculum_assignments (student_id)
  WHERE status = 'active';
```

### diary_templates: scope + swimming_pool_id 정합성

```sql
ALTER TABLE diary_templates
  ADD CONSTRAINT chk_scope_pool_id
    CHECK (
      (template_scope = 'pool' AND swimming_pool_id IS NOT NULL) OR
      (template_scope = 'global' AND swimming_pool_id IS NULL)
    );
```

### growth_report_entitlements: 학생별 월 1개

```sql
UNIQUE (student_id, report_month)  -- CREATE TABLE에 inline
```

### deep_report_orders: transaction 중복 방지

```sql
rc_transaction_id TEXT NOT NULL UNIQUE
```

### parent_ai_daily_usage: 일별 1행

```sql
UNIQUE (parent_account_id, usage_date)  -- CREATE TABLE에 inline
```

---

### 신규 테이블 FK 삭제 정책 전체 목록

> 참고: 기존 테이블(swimming_pools, pool_subscriptions, parent_accounts)에는 DB 레벨 FK CONSTRAINT가 없음 (REPOSITORY_VERIFIED). 신규 테이블에만 명시적으로 정의.

| FK | 정책 | 이유 |
|----|------|------|
| `curriculum_versions.pool_id → swimming_pools.id` | `ON DELETE RESTRICT` | 버전이 있으면 수영장 삭제 불가 (데이터 보호) |
| `curriculum_items.version_id → curriculum_versions.id` | `ON DELETE RESTRICT` | 항목이 있으면 버전 삭제 불가 (진도 보호) |
| `curriculum_requests.pool_id → swimming_pools.id` | `ON DELETE RESTRICT` | 의뢰 진행 중 수영장 삭제 방지 |
| `curriculum_request_files.request_id → curriculum_requests.id` | `ON DELETE CASCADE` | 의뢰 삭제 시 첨부 파일도 삭제 |
| `growth_events.curriculum_item_id → curriculum_items.id` | `ON DELETE RESTRICT` | 진도 기록 보호 |
| `growth_events.diary_note_id → class_diary_student_notes.id` | `ON DELETE SET NULL` | 일지 삭제 시 이벤트는 유지 (is_invalidated=true로 처리) |
| `student_curriculum_assignments.curriculum_version_id → curriculum_versions.id` | `ON DELETE RESTRICT` | 배정된 버전 삭제 불가 |
| `student_curriculum_assignments.student_id → students.id` | `ON DELETE CASCADE` | 학생 삭제 시 배정도 삭제 |
| `pool_events.pool_id → swimming_pools.id` | `ON DELETE RESTRICT` | 이벤트 있으면 수영장 삭제 불가 |
| `pool_event_attachments.event_id → pool_events.id` | `ON DELETE CASCADE` | 이벤트 삭제 시 첨부도 삭제 |
| `growth_report_entitlements.student_id → students.id` | `ON DELETE CASCADE` | 학생 삭제 시 entitlement 삭제 |
| `deep_report_orders.student_id → students.id` | `ON DELETE RESTRICT` | 결제된 주문 보호 |
| `deep_report_orders.parent_account_id → parent_accounts.id` | `ON DELETE RESTRICT` | 결제 기록 보호 |
| `parent_ai_conversations.parent_account_id → parent_accounts.id` | `ON DELETE CASCADE` | 계정 삭제 시 대화 삭제 |
| `parent_ai_messages.conversation_id → parent_ai_conversations.id` | `ON DELETE CASCADE` | 대화 삭제 시 메시지 삭제 |
| `parent_ai_daily_usage.parent_account_id → parent_accounts.id` | `ON DELETE CASCADE` | 계정 삭제 시 사용량 삭제 |

---

## 9. 수정 Phase 순서 (V3.1)

```
Phase 1  DB Migration
Phase 2  RevenueCat + Webhook
Phase 3  Backend API (X모드 상태, Pool Events, Curriculum Requests)
Phase 4  AI Pipeline 분기 (xmode_config_status 기반)
Phase 5  Growth Event 연동 (diary 저장 → growth_event)
Phase 6  Growth API (성장판 조회)
Phase 7  Parent AI Backend (Intent Guard, Curriculum Search, GPT)
Phase 8  Report Backend (무료 entitlement, 심층 order)
Phase 9  App UI (슈퍼어드민 + 교사 + 학부모)
Phase 10 E2E 검증 (샘플 수영장 전체 흐름)
Phase 11 히든 템플릿 2,000개 (5-A 파일럿 → 5-B 전체)
Phase 12 홈페이지 웹 UI 완성 (PUT method, field name, 5개 섹션)
Phase 13 ToyKids 적용 → 전국 배포
```

---

## 10. Phase별 체크리스트

---

### Phase 1: DB Migration

**변경 파일**
- `artifacts/api-server/src/migrations/pool-db-init.ts` — 신규 ALTER + CREATE TABLE 추가

**Migration SQL**
```sql
-- 1-1. swimming_pools xmode 컬럼 (entitlement + config_status 분리)
ALTER TABLE swimming_pools
  ADD COLUMN IF NOT EXISTS xmode_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS xmode_config_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (xmode_config_status IN ('NOT_CONFIGURED','CURRICULUM_PENDING','READY')),
  ADD COLUMN IF NOT EXISTS xmode_subscription_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS xmode_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS xmode_payment_failed_at TIMESTAMPTZ;

-- 1-2. diary_templates scope 변경
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS template_scope TEXT NOT NULL DEFAULT 'pool'
    CHECK (template_scope IN ('pool','global'));
ALTER TABLE diary_templates
  ADD CONSTRAINT IF NOT EXISTS chk_scope_pool_id
    CHECK ((template_scope='pool' AND swimming_pool_id IS NOT NULL) OR
           (template_scope='global' AND swimming_pool_id IS NULL));

-- 1-3. curriculum_versions
CREATE TABLE IF NOT EXISTS curriculum_versions (
  id TEXT PRIMARY KEY DEFAULT ('cv_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  activated_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pool_id, version_number),
  FOREIGN KEY (pool_id) REFERENCES swimming_pools(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_versions_active_one
  ON curriculum_versions (pool_id) WHERE status = 'active';

-- 1-4. curriculum_items
CREATE TABLE IF NOT EXISTS curriculum_items (
  id TEXT PRIMARY KEY DEFAULT ('ci_' || replace(gen_random_uuid()::text,'-','')),
  version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  pool_id TEXT NOT NULL,
  level_number INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  stroke_code TEXT,
  skill_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-5. student_curriculum_assignments
CREATE TABLE IF NOT EXISTS student_curriculum_assignments (
  id TEXT PRIMARY KEY DEFAULT ('sca_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  curriculum_version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','ended')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sca_student_active
  ON student_curriculum_assignments (student_id) WHERE status = 'active';

-- 1-6. curriculum_requests
CREATE TABLE IF NOT EXISTS curriculum_requests (
  id TEXT PRIMARY KEY DEFAULT ('cr_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','rejected','cancelled')),
  level_description TEXT,
  stroke_notes TEXT,
  submitted_by TEXT NOT NULL,
  reviewed_by TEXT,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  generating_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_requests_active_one
  ON curriculum_requests (pool_id)
  WHERE status IN ('pending','in_progress');

-- 1-7. curriculum_request_files
CREATE TABLE IF NOT EXISTS curriculum_request_files (
  id TEXT PRIMARY KEY DEFAULT ('crf_' || replace(gen_random_uuid()::text,'-','')),
  request_id TEXT NOT NULL REFERENCES curriculum_requests(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-8. growth_events
CREATE TABLE IF NOT EXISTS growth_events (
  id TEXT PRIMARY KEY DEFAULT ('ge_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  diary_note_id TEXT REFERENCES class_diary_student_notes(id) ON DELETE SET NULL,
  curriculum_item_id TEXT REFERENCES curriculum_items(id) ON DELETE RESTRICT,
  stroke_code TEXT,
  observation_type TEXT,
  observation_text TEXT,
  change_direction TEXT,
  confidence NUMERIC(4,3),
  evidence TEXT,
  source TEXT NOT NULL DEFAULT 'teacher_ai'
    CHECK (source IN ('teacher_ai','teacher_manual','parent_ai','video_ai')),
  event_role TEXT NOT NULL DEFAULT 'progress'
    CHECK (event_role IN ('progress','observation')),
  idempotency_key TEXT,
  is_invalidated BOOLEAN DEFAULT FALSE,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_growth_events_confidence
    CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  CONSTRAINT chk_growth_events_progress_item
    CHECK (event_role != 'progress' OR curriculum_item_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_events_diary_item
  ON growth_events (diary_note_id, student_id, curriculum_item_id, source)
  WHERE diary_note_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_events_idempotency
  ON growth_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 1-9. pool_events
CREATE TABLE IF NOT EXISTS pool_events (
  id TEXT PRIMARY KEY DEFAULT ('pe_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id) ON DELETE RESTRICT,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('super_admin','pool_admin','system')),
  sender_id TEXT,
  event_type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  is_read_by_pool BOOLEAN DEFAULT FALSE,
  is_read_by_super BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-10. pool_event_attachments
CREATE TABLE IF NOT EXISTS pool_event_attachments (
  id TEXT PRIMARY KEY DEFAULT ('pea_' || replace(gen_random_uuid()::text,'-','')),
  event_id TEXT NOT NULL REFERENCES pool_events(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-11. growth_report_entitlements
CREATE TABLE IF NOT EXISTS growth_report_entitlements (
  id TEXT PRIMARY KEY DEFAULT ('gre_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  report_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','generating','completed','failed')),
  min_events_required INTEGER DEFAULT 3,
  generated_report_id TEXT,
  reserved_at TIMESTAMPTZ,
  generating_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, report_month)
);

-- 1-12. deep_report_orders
CREATE TABLE IF NOT EXISTS deep_report_orders (
  id TEXT PRIMARY KEY DEFAULT ('dro_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  parent_account_id TEXT NOT NULL REFERENCES parent_accounts(id) ON DELETE RESTRICT,
  rc_transaction_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid','generating','completed','generation_failed')),
  report_month TEXT NOT NULL,
  curriculum_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  generated_report_id TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generating_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-13. parent_ai_conversations
CREATE TABLE IF NOT EXISTS parent_ai_conversations (
  id TEXT PRIMARY KEY DEFAULT ('pac_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL REFERENCES parent_accounts(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-14. parent_ai_messages
CREATE TABLE IF NOT EXISTS parent_ai_messages (
  id TEXT PRIMARY KEY DEFAULT ('pam_' || replace(gen_random_uuid()::text,'-','')),
  conversation_id TEXT NOT NULL REFERENCES parent_ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  grounded_item_ids TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1-15. parent_ai_daily_usage
CREATE TABLE IF NOT EXISTS parent_ai_daily_usage (
  id TEXT PRIMARY KEY DEFAULT ('pau_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL REFERENCES parent_accounts(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_account_id, usage_date)
);
```

**테스트**
- [ ] migration 실행 후 `\d swimming_pools` xmode_entitlement, xmode_config_status 컬럼 확인
- [ ] 기존 수영장 레코드 xmode_entitlement=false, xmode_config_status='NOT_CONFIGURED' 기본값 확인
- [ ] 각 신규 테이블 INSERT 1건 확인
- [ ] UNIQUE INDEX 동작: curriculum_versions active 2개 INSERT 시 오류 발생 확인
- [ ] CHECK CONSTRAINT: growth_events progress에 curriculum_item_id NULL → 오류 확인

**Rollback**
```sql
ALTER TABLE swimming_pools
  DROP COLUMN IF EXISTS xmode_entitlement,
  DROP COLUMN IF EXISTS xmode_config_status,
  DROP COLUMN IF EXISTS xmode_subscription_end_at,
  DROP COLUMN IF EXISTS xmode_purchased_at,
  DROP COLUMN IF EXISTS xmode_payment_failed_at;
ALTER TABLE diary_templates
  DROP CONSTRAINT IF EXISTS chk_scope_pool_id,
  DROP COLUMN IF EXISTS template_scope;
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id SET NOT NULL;
DROP TABLE IF EXISTS parent_ai_daily_usage, parent_ai_messages,
  parent_ai_conversations, deep_report_orders, growth_report_entitlements,
  pool_event_attachments, pool_events, growth_events, curriculum_request_files,
  curriculum_requests, student_curriculum_assignments, curriculum_items,
  curriculum_versions CASCADE;
```

---

### Phase 2: RevenueCat + Webhook

**변경 파일**
- `artifacts/api-server/src/routes/billing.ts`
- `artifacts/api-server/src/lib/subscriptionService.ts`

**신규 함수**
```typescript
// subscriptionService.ts
async function applyXmodeState(
  poolId: string,
  action: 'purchase' | 'expire' | 'cancel' | 'billing_issue',
  expiresAt?: Date
): Promise<void>
```

**API Contract**
```
POST /revenuecat-webhook (기존 유지)
  xmode 상품 INITIAL_PURCHASE → entitlement=true, xmode_purchased_at=now()
  xmode 상품 RENEWAL         → entitlement=true
  xmode 상품 CANCELLATION    → entitlement 유지 (만료일까지), subscription_end_at=expiresAt
  xmode 상품 EXPIRATION      → entitlement=false, homepage_enabled=false
  xmode 상품 BILLING_ISSUE   → entitlement 유지, payment_failed_at=now()
```

**테스트**
- [ ] INITIAL_PURCHASE 이벤트 시뮬레이션 → xmode_entitlement=true 확인
- [ ] EXPIRATION 이벤트 → xmode_entitlement=false, homepage_enabled=false 확인
- [ ] EXPIRATION 후 INITIAL_PURCHASE (재결제) → xmode_config_status 변경 없음 확인
- [ ] CANCELLATION 후 xmode_subscription_end_at 날짜 설정 확인

**Rollback**
- billing.ts xmode 분기 제거, applyXmodeState 함수 삭제

---

### Phase 3: Backend API

**신규 파일**
- `artifacts/api-server/src/routes/xmode.ts`
- `artifacts/api-server/src/routes/pool-events.ts`
- `artifacts/api-server/src/routes/curriculum-requests.ts`

**API Contract**
```
GET  /api/v1/pools/:poolId/xmode/status
  → { entitlement, config_status, subscription_end_at, config_ready: entitlement && config_status==='READY' }

PATCH /api/v1/admin/pools/:poolId/xmode/config-status
  Body: { config_status: 'CURRICULUM_PENDING' | 'READY' | 'NOT_CONFIGURED' }
  Auth: super_admin only

GET  /api/v1/admin/pools/:poolId/events
POST /api/v1/admin/pools/:poolId/events
GET  /api/v1/pools/:poolId/events  (pool_admin용)

POST   /api/v1/pools/:poolId/curriculum-request
GET    /api/v1/pools/:poolId/curriculum-request
POST   /api/v1/curriculum-request/:id/files
PATCH  /api/v1/admin/curriculum-request/:id  { action: 'approve'|'reject', rejection_reason? }
```

**테스트**
- [ ] GET /xmode/status 반환값 검증
- [ ] 슈퍼어드민 config_status 변경 → READY 전환 확인
- [ ] pool_admin이 config_status 변경 시 403 확인
- [ ] curriculum_requests UNIQUE INDEX: 두 번째 의뢰 → 409 확인
- [ ] pool_events 메시지 발송 + 조회 확인

**Rollback**
- xmode.ts, pool-events.ts, curriculum-requests.ts 파일 삭제
- routes/index.ts에서 라우터 등록 제거

---

### Phase 4: AI Pipeline 분기

**변경 파일**
- `artifacts/api-server/src/lib/diary-template-search.ts`
- `artifacts/api-server/src/routes/ai-v1.ts`

**변경 사항**
```typescript
// ai-v1.ts: xmode_config_status 조회 후 searchTemplates에 전달
const pool = await getPoolXmodeStatus(poolId);
const searchResult = await searchTemplates(poolId, meaning, pool.xmode_config_status);

// diary-template-search.ts: 파라미터 추가
export async function searchTemplates(
  poolId: string,
  meaning: ExtractedMeaning,
  configStatus: string = 'NOT_CONFIGURED'
): Promise<TemplateSearchResult>

// 내부 분기:
// READY:               pool 먼저, score<0.30이면 global 보완
// CURRICULUM_PENDING:  global만
// NOT_CONFIGURED:      pool만 (기존 동작)
```

**AI 응답 계약 contract_version 1.0 → 1.1 bump**
- students[] 각 항목에 `curriculum_matches: []` 추가
- GPT 프롬프트 변경: curriculum_matches 포함 출력 요청
- 응답 검증 유틸(`ai-diary-utils.ts`) 스키마 확장

**테스트**
- [ ] READY 상태 수영장: global 템플릿 반영된 일지 생성 확인
- [ ] CURRICULUM_PENDING: global 템플릿만 사용 확인
- [ ] NOT_CONFIGURED: pool 템플릿만 사용 (기존 동작 회귀 없음)
- [ ] curriculum_matches 반환 확인
- [ ] confidence < 0.6인 항목은 growth_event 생성 안 됨 확인 (Phase 5에서 검증)

**Rollback**
- searchTemplates 파라미터 원복, ai-v1.ts xmode 조회 코드 제거
- contract_version 1.0으로 롤백

---

### Phase 5: Growth Event 연동

**변경 파일**
- `artifacts/api-server/src/routes/diary.ts` (또는 diary notes 저장 라우트)

**변경 사항**
- class_diary_student_notes 최종 저장 완료 시:
  ```typescript
  // curriculum_matches 중 confidence >= 0.6만 growth_event 생성
  for (const match of curriculumMatches.filter(m => m.confidence >= 0.6)) {
    await db.query(`
      INSERT INTO growth_events (pool_id, student_id, diary_note_id, curriculum_item_id,
        confidence, evidence, source, event_role)
      VALUES ($1, $2, $3, $4, $5, $6, 'teacher_ai', 'progress')
      ON CONFLICT DO NOTHING
    `, [poolId, studentId, noteId, match.curriculum_item_id, match.confidence, match.evidence]);
  }
  ```
- 일지 삭제 시: `UPDATE growth_events SET is_invalidated=true WHERE diary_note_id=$noteId`
- student_curriculum_assignments 신규 학생 자동 배정 트리거 추가

**테스트**
- [ ] 일지 저장 → growth_events INSERT 확인
- [ ] confidence 0.5 → INSERT 안 됨 확인
- [ ] 동일 일지 2회 저장 → ON CONFLICT DO NOTHING (중복 없음) 확인
- [ ] 일지 삭제 → is_invalidated=true 확인
- [ ] 신규 학생 등록 → student_curriculum_assignments INSERT 확인

**Rollback**
- diary.ts growth_event 연동 코드 제거

---

### Phase 6: Growth API

**신규 파일**
- `artifacts/api-server/src/routes/growth.ts`

**API Contract**
```
GET /api/v1/pools/:poolId/students/:studentId/growth
  → {
      curriculum_version_id,
      items: [{
        curriculum_item_id, skill_name, level_number,
        completion_count, is_completed
      }],
      total_items, completed_items, completion_rate
    }

GET /api/v1/pools/:poolId/students/:studentId/growth/events
  → [growth_events]
```

**테스트**
- [ ] growth_events 3건 → completion_count 반영 확인
- [ ] is_invalidated=true 이벤트 → 집계 제외 확인

**Rollback**
- growth.ts 파일 삭제

---

### Phase 7: Parent AI Backend

**신규 파일**
- `artifacts/api-server/src/routes/parent-ai-search.ts`
- `artifacts/api-server/src/lib/parent-ai-guard.ts`

**API Contract**
```
POST /api/v1/parent/ai-search
  Auth: parent_account
  Body: { question, student_id, pool_id, conversation_id? }
  Precondition: pool.xmode_entitlement=true AND xmode_config_status='READY'

  처리 흐름:
  1. 사용량 확인: parent_ai_daily_usage question_count >= limit → 429
  2. Intent Guard: 비수영 질문 → 400 with message
  3. Curriculum Search
  4. GPT 생성
  5. Grounding 검증
  6. parent_ai_messages 저장
  7. 사용량 +1

  Response:
  {
    answer: string,
    conversation_id: string,
    grounded_items: [{ curriculum_item_id, skill_name }],
    is_grounded: boolean
  }
```

**테스트**
- [ ] 수영 질문 → 정상 답변 확인
- [ ] 비수영 질문 → 400 차단 확인
- [ ] question_count >= 20 → 429 확인
- [ ] X모드 READY 아닌 수영장 → 403 확인
- [ ] 대화 기록 저장 확인

**Rollback**
- parent-ai-search.ts, parent-ai-guard.ts 삭제

---

### Phase 8: Report Backend

**신규 파일**
- `artifacts/api-server/src/routes/growth-report.ts`
- `artifacts/api-server/src/jobs/report-generator.ts`

**API Contract**
```
GET  /api/v1/pools/:poolId/students/:studentId/report-entitlement?month=YYYY-MM
  → { status, can_generate: status='available' AND sufficient_data }

POST /api/v1/pools/:poolId/students/:studentId/report/generate
  Body: { month: 'YYYY-MM' }
  Precondition: entitlement.status='available' AND growth_events >= min_events_required
  → 생성 시작, entitlement.status='generating'

GET  /api/v1/pools/:poolId/students/:studentId/report/:reportId
  → report 조회

POST /api/v1/parent/deep-report/purchase-confirm
  Body: { rc_transaction_id, student_id, pool_id, report_month }
  → deep_report_orders INSERT
```

**테스트**
- [ ] growth_events < 3건 → can_generate=false, entitlement 변화 없음 확인
- [ ] growth_events >= 3건 → 생성 시작, status='generating' 확인
- [ ] 생성 성공 → status='completed' 확인
- [ ] 생성 실패 → status='failed' 후 available 복구 확인
- [ ] rc_transaction_id 중복 INSERT → 409 확인

**Rollback**
- growth-report.ts, report-generator.ts 삭제

---

### Phase 9: App UI

**변경 파일**
- `artifacts/swim-app/app/(super)/pools.tsx` — X모드 수영장 필터
- `artifacts/swim-app/app/(super)/pool-xmode-detail.tsx` — 신규
- `artifacts/swim-app/app/(admin)/xmode-curriculum.tsx` — 신규
- `artifacts/swim-app/app/(teacher)/diary-write.tsx` — curriculum_matches Preview UI
- `artifacts/swim-app/app/(parent)/growth.tsx` — 신규 또는 기존 확장
- `artifacts/swim-app/app/(parent)/ai-search.tsx` — 신규

**테스트**
- [ ] 슈퍼어드민: X모드 수영장 목록 조회 확인
- [ ] 슈퍼어드민: config_status READY 전환 확인
- [ ] 교사: curriculum_matches Preview 표시 후 최종 저장 확인
- [ ] 학부모: 성장판 % 표시 확인
- [ ] 학부모: AI 검색 답변 + 대화 이력 확인

**Rollback**
- 신규 파일 삭제, 기존 파일 수정 롤백

---

### Phase 10: E2E 검증 (샘플 수영장)

**변경 파일**: 없음 (검증만)

**시나리오**
```
1. RevenueCat INITIAL_PURCHASE → entitlement=true, config_status=NOT_CONFIGURED
2. pool_admin 의뢰 제출 → config_status=CURRICULUM_PENDING
3. 슈퍼어드민 커리큘럼 생성 → config_status=READY
4. 교사 AI 일지 작성 → curriculum_matches 반환 확인
5. 최종 저장 → growth_events INSERT 확인
6. 학부모 성장판 % 확인
7. 학부모 AI 검색 → 수영 답변 확인
8. 무료 리포트 생성 확인
9. RevenueCat EXPIRATION → entitlement=false, homepage_enabled=false 확인
10. 재결제 INITIAL_PURCHASE → entitlement=true, config_status=READY (유지) 확인
```

---

### Phase 11: 히든 템플릿

**신규 파일**
- `scripts/generate-pilot-templates.ts` — 50개 파일럿
- `scripts/generate-full-templates.ts` — 2,000개

**파일럿 통과 기준**: 품질(교사 평가), latency < 200ms, 중복(유사도>0.95) < 5%

---

### Phase 12: 홈페이지 웹 UI 완성

**변경 파일**
- `artifacts/swimnote-web/src/pages/PoolAdmin.tsx` 또는 `PoolSettings.tsx`

**수정 사항** (`REPOSITORY_VERIFIED` 기반)
- HTTP method: `PATCH /pools/content` → `PUT /pools/content`
- 필드명: `intro` → `introduction`
- 5개 섹션 편집 UI 추가: introduction, tuition_info, level_test_info, event_info, equipment_info

---

## 변경 파일 전체 목록

### 신규 파일
| 파일 | Phase |
|------|-------|
| `artifacts/api-server/src/routes/xmode.ts` | 3 |
| `artifacts/api-server/src/routes/pool-events.ts` | 3 |
| `artifacts/api-server/src/routes/curriculum-requests.ts` | 3 |
| `artifacts/api-server/src/routes/growth.ts` | 6 |
| `artifacts/api-server/src/routes/growth-report.ts` | 8 |
| `artifacts/api-server/src/routes/parent-ai-search.ts` | 7 |
| `artifacts/api-server/src/lib/parent-ai-guard.ts` | 7 |
| `artifacts/api-server/src/jobs/report-generator.ts` | 8 |
| `artifacts/swim-app/app/(super)/pool-xmode-detail.tsx` | 9 |
| `artifacts/swim-app/app/(admin)/xmode-curriculum.tsx` | 9 |
| `artifacts/swim-app/app/(parent)/growth.tsx` | 9 |
| `artifacts/swim-app/app/(parent)/ai-search.tsx` | 9 |
| `scripts/generate-pilot-templates.ts` | 11 |
| `scripts/generate-full-templates.ts` | 11 |

### 변경 파일
| 파일 | Phase | 변경 내용 |
|------|-------|----------|
| `artifacts/api-server/src/migrations/pool-db-init.ts` | 1 | 신규 테이블 전체 추가 |
| `artifacts/api-server/src/routes/billing.ts` | 2 | xmode webhook 분기 |
| `artifacts/api-server/src/lib/subscriptionService.ts` | 2 | applyXmodeState 추가 |
| `artifacts/api-server/src/lib/diary-template-search.ts` | 4 | configStatus 파라미터 추가 |
| `artifacts/api-server/src/routes/ai-v1.ts` | 4 | xmode 조회 + contract_version 1.1 |
| `artifacts/api-server/src/lib/ai-diary-utils.ts` | 4 | curriculum_matches 스키마 추가 |
| `artifacts/api-server/src/routes/diary.ts` | 5 | growth_event 연동 |
| `artifacts/swim-app/app/(super)/pools.tsx` | 9 | X모드 필터 |
| `artifacts/swim-app/app/(teacher)/diary-write.tsx` | 9 | curriculum_matches UI |
| `artifacts/swimnote-web/src/pages/PoolAdmin.tsx` | 12 | 홈페이지 편집 수정 |
