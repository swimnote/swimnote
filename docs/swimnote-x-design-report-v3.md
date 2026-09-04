# SWIMNOTE X — 구현 전 설계 보고서 V3
> 작성일: 2026-08-02 | 3차 보완 (GPT 검수 반영)

---

## 1. RevenueCat CANCELLATION / EXPIRATION 분리 `REPOSITORY_VERIFIED`

### 실제 코드 (`billing.ts`)

| 이벤트 | 라인 | 처리 내용 |
|--------|------|----------|
| `INITIAL_PURCHASE` | :167 | applySubscriptionState → active |
| `RENEWAL` | :168 | applySubscriptionState → active |
| `UNCANCELLATION` | :169 | applySubscriptionState → active |
| `CANCELLATION` | :322 | 현재 tier 유지, 만료일까지 active 유지, pending_tier=free 예약 |
| `EXPIRATION` | :346 | applySubscriptionState → free/cancelled 즉시, 읽기전용+업로드차단 |
| `BILLING_ISSUE` | :380 | tier 유지, payment_failed 상태, is_readonly=true, upload_blocked=true |
| `PRODUCT_CHANGE` | :398 | tier 변경 |
| `GRACE_PERIOD` | **없음** | ❌ 미구현 |
| `REFUND` | **없음** | ❌ 미구현 |

### X모드 webhook 매핑 설계 `CONTRACT_DESIGNED`

기존 구독과 동일한 패턴으로 xmode를 처리한다. `applyXmodeState()` 함수 신규 추가.

| RevenueCat 이벤트 | xmode_status 변경 | 홈페이지 처리 | 알림 |
|------------------|------------------|--------------|------|
| INITIAL_PURCHASE | OFF → PURCHASED | 유지 | 슈퍼어드민 xmode_signup 이벤트 |
| RENEWAL | 현재 상태 유지 (OFF이면 PURCHASED) | 유지 | 없음 (silent) |
| UNCANCELLATION | OFF → PURCHASED | 유지 | 없음 |
| CANCELLATION | **현재 상태 유지** (만료일까지 활성) | 유지 | 없음 |
| EXPIRATION | 모든 상태 → OFF | homepage_enabled=false | domain_release 이벤트 발송 |
| BILLING_ISSUE | 현재 상태 유지 + xmode_payment_failed_at=now() | 유지 | 슈퍼어드민 알림 |
| GRACE_PERIOD | 현재 상태 유지 (이벤트 없으므로 패스) | — | — |
| REFUND | EXPIRATION과 동일 처리 (수동 or 추후 구현) | homepage_enabled=false | — |

**CANCELLATION 핵심**: 취소 시 즉시 꺼지지 않는다. `xmode_subscription_end_at`까지 유지. EXPIRATION 이벤트가 도착하면 그때 OFF.

### 신규 컬럼 추가
```sql
ALTER TABLE swimming_pools
  ADD COLUMN xmode_payment_failed_at TIMESTAMPTZ;
```

---

## 2. AI Pipeline 정확한 파일·함수 `REPOSITORY_VERIFIED`

| 항목 | 값 |
|------|-----|
| 진입 파일 | `artifacts/api-server/src/routes/ai-v1.ts` |
| 라우터 등록 | `artifacts/api-server/src/routes/index.ts:2, :110` |
| 엔드포인트 | `POST /v1/teacher-diary/generate` |
| Template Search 파일 | `artifacts/api-server/src/lib/diary-template-search.ts` |
| Template Search 함수 | `searchTemplates(poolId: string, meaning: ExtractedMeaning): Promise<TemplateSearchResult>` (line 212) |
| 호출 위치 | `ai-v1.ts:198-200` |
| Candidate threshold | `CANDIDATE_MIN_CONCEPT_OVERLAP = 0.30` (diary-template-search.ts:38) |
| pool_id 필터 | `swimming_pool_id = $poolId` 조건 (기존 쿼리, NOT NULL 전제) |
| Mode 결정 로직 | `NEEDS_VERIFICATION` — searchTemplates 반환값으로 결정되나 정확한 threshold/분기 추가 확인 필요 |

### 변경 지점 (최소 변경)
- `searchTemplates` 함수 파라미터에 `xmodeStatus` 추가
- 내부 쿼리 조건을 xmode_status에 따라 분기

```typescript
// diary-template-search.ts 변경 지점
export async function searchTemplates(
  poolId: string,
  meaning: ExtractedMeaning,
  xmodeStatus: string = 'OFF'  // 추가
): Promise<TemplateSearchResult>
```

---

## 3. curriculum_requests UNIQUE 제약 수정 `CONTRACT_DESIGNED`

### 기존 설계 문제점
```sql
-- 잘못된 방식: UNIQUE constraint를 CREATE TABLE 내 inline으로 partial 표현 불가
UNIQUE (pool_id, status) WHERE status NOT IN ('completed','rejected','cancelled')
```

### 수정: 별도 PARTIAL UNIQUE INDEX
```sql
CREATE TABLE curriculum_requests (
  id TEXT PRIMARY KEY DEFAULT ('cr_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
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

-- 활성 의뢰 1건 제한: completed/rejected/cancelled 제외
CREATE UNIQUE INDEX idx_curriculum_requests_active_one
  ON curriculum_requests (pool_id)
  WHERE status IN ('pending','in_progress');
```

---

## 4. growth_events 멱등성 재설계 `CONTRACT_DESIGNED`

### 문제점
```sql
-- 기존: diary_note_id가 NULL일 때 UNIQUE가 중복을 막지 못함
-- PostgreSQL에서 NULL != NULL이므로 NULL 컬럼이 포함된 UNIQUE는 중복 허용
UNIQUE (diary_note_id, student_id, curriculum_item_id, source)
```

### 해결: idempotency_key + Partial UNIQUE INDEX 방식

```sql
CREATE TABLE growth_events (
  id TEXT PRIMARY KEY DEFAULT ('ge_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  diary_note_id TEXT,               -- class_diary_student_notes.id (nullable: 수동 등록)
  curriculum_item_id TEXT REFERENCES curriculum_items(id),
  stroke_code TEXT,
  observation_type TEXT,
  observation_text TEXT,
  change_direction TEXT,
  confidence NUMERIC,
  source TEXT NOT NULL DEFAULT 'teacher_ai'
    CHECK (source IN ('teacher_ai','teacher_manual','parent_ai','video_ai')),
  event_role TEXT NOT NULL DEFAULT 'progress'
    CHECK (event_role IN ('progress','observation')),
    -- progress: 성장판 반영 이벤트 (curriculum_item_id 필수)
    -- observation: 관찰 기록 (성장판 미반영, curriculum_item_id nullable)
  idempotency_key TEXT,             -- API 재시도 중복 방지용
  is_invalidated BOOLEAN DEFAULT FALSE,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- diary_note_id가 NOT NULL인 경우만 UNIQUE 적용 (자동 생성 이벤트)
CREATE UNIQUE INDEX idx_growth_events_diary_item
  ON growth_events (diary_note_id, student_id, curriculum_item_id, source)
  WHERE diary_note_id IS NOT NULL;

-- idempotency_key가 있는 경우 중복 방지 (API 재시도)
CREATE UNIQUE INDEX idx_growth_events_idempotency
  ON growth_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### event_role 분리
- `progress`: 성장판에 반영되는 이벤트. `curriculum_item_id` 필수. diary_note 저장 시 자동 생성.
- `observation`: 관찰 기록 전용. 성장판 미반영. 리포트 분석 데이터로만 사용.

---

## 5. 공통 일지 성장판 반영 정책 `CONTRACT_DESIGNED`

### 기존 일지 구조 확인 `REPOSITORY_VERIFIED`
- `class_diaries`: 공통 일지 (수업 단위)
- `class_diary_student_notes`: 학생별 note (`diary_id`로 연결)
- 성장판 반영 단위: `class_diary_student_notes.id` (학생별 note)

### 정책: 학생별 note 기준
**전원 자동 반영 금지**

| 방식 | 설명 | 채택 |
|------|------|------|
| 전원 자동 반영 | 공통 일지 저장 시 모든 학생에게 progress 생성 | ❌ 금지 |
| 학생별 note 기준 | note가 확정 저장된 학생만 progress 생성 | ✅ 채택 |
| 교사 선택 | 교사가 적용 학생 수동 선택 | 추후 고려 |

**이유**: `class_diary_student_notes`는 학생별로 개별 확정되는 구조. note가 없으면 해당 학생에게 수업이 기록되지 않은 것으로 간주.

**Sequence**:
```
class_diary_student_notes INSERT (학생별 note 확정)
  ↓
growth_event INSERT (event_role='progress', diary_note_id=note.id)
  ON CONFLICT DO NOTHING (partial unique index)
  ↓
curriculum_progress 갱신 (아래 §6 참조)
```

---

## 6. curriculum_progress 유지 여부 확정 `CONTRACT_DESIGNED`

### 권장: growth_events 직접 집계 (curriculum_progress 테이블 제거)

| 비교 | 집계 방식 | 캐시 방식 |
|------|----------|----------|
| 신규 테이블 | 불필요 | curriculum_progress 필요 |
| 데이터 일관성 | 항상 정확 | 무효화 시 재계산 필요 |
| 쿼리 복잡도 | COUNT 쿼리 | 단순 SELECT |
| 예상 성능 | 학생 1명 기준 growth_events < 500건 → ms 수준 | 빠름 |
| 초기 구현 비용 | 낮음 | 높음 (트랜잭션 관리 복잡) |
| 롤백 용이성 | 높음 | 낮음 |

**결론**: curriculum_progress 테이블 제거. growth_events에서 직접 집계.

```sql
-- 성장판 % 계산 쿼리
SELECT
  ci.id,
  ci.skill_name,
  COUNT(ge.id) FILTER (WHERE ge.is_invalidated = false) AS completion_count,
  COUNT(ge.id) FILTER (WHERE ge.is_invalidated = false) >= 2 AS is_completed
FROM curriculum_items ci
LEFT JOIN growth_events ge
  ON ge.curriculum_item_id = ci.id
  AND ge.student_id = $studentId
  AND ge.event_role = 'progress'
WHERE ci.pool_id = $poolId AND ci.is_active = true
GROUP BY ci.id, ci.skill_name;
```

---

## 7. 커리큘럼 버전 관리 (행별 version 숫자 → 커리큘럼 단위 버전) `CONTRACT_DESIGNED`

### 구조

```sql
-- 커리큘럼 버전 (수영장 단위)
CREATE TABLE curriculum_versions (
  id TEXT PRIMARY KEY DEFAULT ('cv_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  version_number INTEGER NOT NULL,
  label TEXT,                          -- "2026년 1학기 커리큘럼"
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  activated_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pool_id, version_number)
);

-- 버전별 항목
CREATE TABLE curriculum_items (
  id TEXT PRIMARY KEY DEFAULT ('ci_' || replace(gen_random_uuid()::text,'-','')),
  version_id TEXT NOT NULL REFERENCES curriculum_versions(id),
  pool_id TEXT NOT NULL,               -- 조회 편의용 중복 저장
  level_number INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  stroke_code TEXT,
  skill_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,      -- 버전 내 soft delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 커리큘럼 개정 Sequence

```
[super_admin] 새 커리큘럼 생성
  → curriculum_versions INSERT (status='active', version_number=N+1)
  → curriculum_items INSERT (version_id=new)
  → 기존 version status='archived'

[기존 학생 진도]
  → growth_events는 curriculum_item_id 고정 (버전 바뀌어도 불변)
  → 기존 리포트는 기존 버전 item 참조 → 재현성 보장

[새 학생]
  → ACTIVE version의 items 기준으로 성장판 계산

[보관된 버전 항목 조회]
  → growth_events JOIN curriculum_items (version 상관없이 id로 연결)
```

**원칙**: growth_events와 curriculum_items는 id로만 연결. 버전 변경이 기존 진도를 깨지 않음.

---

## 8. 무료 기본 리포트 / 유료 심층 리포트 분리 `CONTRACT_DESIGNED`

### 8.1 무료 기본 리포트 — 학생별 월 entitlement

```sql
CREATE TABLE growth_report_entitlements (
  id TEXT PRIMARY KEY DEFAULT ('gre_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  report_month TEXT NOT NULL,          -- 'YYYY-MM' (Asia/Seoul 기준)
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','generating','completed','failed','insufficient_data')),
  generated_report_id TEXT,
  reserved_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, report_month)    -- 무료는 월 1회만
);
```

### 8.2 유료 심층 리포트 — 결제 transaction당 order

```sql
CREATE TABLE deep_report_orders (
  id TEXT PRIMARY KEY DEFAULT ('dro_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL,
  rc_transaction_id TEXT NOT NULL UNIQUE,  -- RevenueCat transaction ID 중복 방지
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid','generating','completed','generation_failed')),
  report_month TEXT NOT NULL,          -- 같은 달 복수 구매 허용 (UNIQUE 없음)
  generated_report_id TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generating_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**같은 달 복수 구매 허용**: deep_report_orders는 (student_id, report_month) UNIQUE 없음.
**결제 성공 ≠ 생성 성공**: status='paid' 후 생성 실패 시 status='generation_failed' → 재시도 가능, 재결제 불필요.
**RevenueCat consumable**: rc_transaction_id UNIQUE로 중복 영수증 사용 차단.

---

## 9. X모드 구매자 = pool_admin만 가능 `CONTRACT_DESIGNED`

```
pool_admin만 RevenueCat에서 X모드 상품 구매 가능
  → 구매 버튼은 앱 설정 화면 (pool_admin 전용)에만 노출
  → teacher / parent 화면에서 X모드 상품 구매 버튼 없음

학부모(parent_account)는 심층 리포트(deep_report_orders)만 구매 가능
  → RevenueCat 별도 consumable 상품

권한표 수정:
  X모드 결제: super_admin(수동), pool_admin(인앱) 가능
  심층 리포트 결제: parent_account만 가능
```

---

## 10. pool_events sender_role=system 추가 `CONTRACT_DESIGNED`

```sql
CREATE TABLE pool_events (
  ...
  sender_role TEXT NOT NULL
    CHECK (sender_role IN ('super_admin','pool_admin','system')),
    -- system: 자동 생성 이벤트 (X모드 결제, 만료, 의뢰 상태 변경 등)
  sender_id TEXT,                      -- system이면 NULL
  ...
);
```

| 이벤트 | sender_role |
|--------|------------|
| X모드 결제 완료 | system |
| X모드 만료 | system |
| 도메인 해제 필요 | system |
| 의뢰 제출 | pool_admin |
| 의뢰 반려 | super_admin |
| 의뢰 완료 | super_admin |
| 슈퍼어드민 메시지 | super_admin |
| 수영장 관리자 문의 | pool_admin |

---

## 11. diary_templates global/pool scope 재설계 `CONTRACT_DESIGNED`

### 현재 구조
- `swimming_pool_id TEXT NOT NULL` → 히든 템플릿 허용 불가

### 비교: nullable+is_hidden vs template_scope enum

| 방식 | 장점 | 단점 |
|------|------|------|
| nullable + is_hidden | 기존 쿼리 최소 변경 | 두 컬럼 조합 의미 모호 |
| template_scope enum | 명확한 의미, 쿼리 간결 | 기존 코드 영향 범위 큼 |

### 권장: template_scope enum 방식

```sql
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id DROP NOT NULL,
  ADD COLUMN template_scope TEXT NOT NULL DEFAULT 'pool'
    CHECK (template_scope IN ('pool','global'));
  -- pool: 수영장 전용 (swimming_pool_id NOT NULL 필요)
  -- global: 히든 기본 템플릿 (swimming_pool_id NULL)

-- 기존 레코드: template_scope='pool' 자동 적용
-- CHECK 보강:
ALTER TABLE diary_templates
  ADD CONSTRAINT chk_scope_pool_id
    CHECK (
      (template_scope = 'pool' AND swimming_pool_id IS NOT NULL) OR
      (template_scope = 'global' AND swimming_pool_id IS NULL)
    );
```

### 검색 쿼리 분기

```sql
-- ACTIVE: pool 우선, global 보완
-- 1단계: pool scope
SELECT *, similarity(template_text, $input) AS score
FROM diary_templates
WHERE template_scope = 'pool'
  AND swimming_pool_id = $poolId
  AND is_active = true
ORDER BY score DESC LIMIT 5;

-- 1단계 best score < 0.30이면 2단계: global
SELECT *, similarity(template_text, $input) AS score
FROM diary_templates
WHERE template_scope = 'global' AND is_active = true
ORDER BY score DESC LIMIT 5;

-- CURRICULUM_PENDING: global만
SELECT ...
WHERE template_scope = 'global' AND is_active = true ...;

-- OFF/PURCHASED: pool만 (기존과 동일)
SELECT ...
WHERE template_scope = 'pool' AND swimming_pool_id = $poolId ...;
```

---

## 12. 학부모 AI 검색 Backend Phase `CONTRACT_DESIGNED`

### 아키텍처

```
[학부모] 질문 입력
  ↓
POST /api/v1/parent/ai-search
  Body: { question, student_id, pool_id, conversation_id? }

  1. 권한 검증: parent_account 소속 pool + xmode_status = ACTIVE
  2. Intent Guard: 수영 관련 질문인지 GPT로 검사
     → 비수영 질문: "수영 관련 질문만 답변할 수 있어요" 반환
  3. Curriculum Search: curriculum_items WHERE pool_id = $poolId AND version.status='active'
     → similarity 검색으로 관련 항목 조회
  4. SWIMNOTE Knowledge Search: NEEDS_VERIFICATION (Knowledge DB 구조 미확인)
  5. GPT 문장 생성 (curriculum 컨텍스트 + knowledge 컨텍스트)
  6. Grounding 검증: 답변이 커리큘럼 기반인지 확인
  7. 대화 기록 저장

  → { answer, grounded_items[], conversation_id }
```

### 대화 기록 테이블

```sql
CREATE TABLE parent_ai_conversations (
  id TEXT PRIMARY KEY DEFAULT ('pac_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parent_ai_messages (
  id TEXT PRIMARY KEY DEFAULT ('pam_' || replace(gen_random_uuid()::text,'-','')),
  conversation_id TEXT NOT NULL REFERENCES parent_ai_conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  grounded_item_ids TEXT[],           -- 근거 curriculum_item ids
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 사용량·비용 제한

```sql
ALTER TABLE swimming_pools
  ADD COLUMN parent_ai_daily_limit INTEGER DEFAULT 20; -- 일일 질문 제한
```

- X모드 ACTIVE 수영장만 사용 가능
- 학부모 1인당 일 20회 제한 (추후 조정)
- Intent Guard로 비수영 질문 차단 (GPT 비용 절감)

---

## 13. 홈페이지 현재 구현 범위 `REPOSITORY_VERIFIED`

### 서버 측 (완료)
| 기능 | API | 상태 |
|------|-----|------|
| slug 조회 | `GET /by-slug/:slug` | ✅ |
| slug 중복 확인 | `GET /homepage/check-slug` | ✅ |
| 홈페이지 설정 조회 | `GET /homepage/settings` | ✅ |
| 홈페이지 콘텐츠 저장 | `PUT /pools/content` (5개 필드: introduction, tuition_info, level_test_info, event_info, equipment_info) | ✅ |
| 홈페이지 활성화 | `PATCH /pools/settings` (homepage_enabled) | ✅ |

### 웹 클라이언트 측 (불완전) `REPOSITORY_VERIFIED`
| 기능 | 상태 | 문제 |
|------|------|------|
| 소개글 편집 | ⚠️ 부분 구현 | HTTP PATCH ← 서버는 PUT, 필드명 `intro` ← 서버는 `introduction` |
| 요금 안내 편집 | ❌ 미구현 | |
| 레벨테스트 편집 | ❌ 미구현 | |
| 이벤트 편집 | ❌ 미구현 | |
| 장비 편집 | ❌ 미구현 | |
| 홈페이지 활성화 토글 | `NEEDS_VERIFICATION` | |
| slug 설정 | ✅ (PoolAdmin.tsx:592-655) | |

### 공개 홈페이지 (`PoolHomepage.tsx`)
- swimnote.kr/[slug] 접근 시 수영장 정보 표시
- 기본 섹션: 이름, 소개, 연락처, 위치 (`NEEDS_VERIFICATION` — 실제 섹션 구성 세부 확인 필요)

### X모드 관련 홈페이지 작업 범위
- **이미 된 것**: slug, homepage_enabled/disabled, 기본 API
- **해야 할 것**: 웹 UI 콘텐츠 편집 화면 완성 (HTTP method, field name 수정 + 5개 섹션 UI)
- **홈페이지는 X모드와 별도 Phase로 분리** (API 인프라는 존재, UI만 보완)

---

## 14. 히든 템플릿 2,000개 생성 전 50개 파일럿 Phase `CONTRACT_DESIGNED`

### 파일럿 Phase (Phase 5-A)

```
1. 영법별 대표 레벨 2개, 항목 5개씩 = 50개 생성
2. DB 삽입 (template_scope='global')
3. 검증 항목:
   - 품질: 실제 AI 일지 생성 후 교사 평가
   - 중복: 유사도 > 0.95인 쌍 확인
   - threshold: CANDIDATE_MIN_CONCEPT_OVERLAP = 0.30 적정성 검증
   - latency: searchTemplates 응답 시간 측정 (목표 < 200ms)
   - Grounding: 생성된 일지가 템플릿과 일치하는지 확인
4. 파일럿 통과 기준 충족 후 → 2,000개 배치 생성 Phase 5-B 진행
```

---

## 15. Phase/WP 실행 순서 (의존성 반영, 세부 사항 포함) `CONTRACT_DESIGNED`

### Phase 1: DB Migration
**목적**: 모든 신규 기능의 기반 스키마 구축

변경 파일:
- `artifacts/api-server/src/migrations/` — 신규 migration 파일

DB 변경:
```sql
-- swimming_pools: xmode 컬럼 추가
ALTER TABLE swimming_pools
  ADD COLUMN xmode_status TEXT NOT NULL DEFAULT 'OFF'
    CHECK (xmode_status IN ('OFF','PURCHASED','CURRICULUM_PENDING','ACTIVE')),
  ADD COLUMN xmode_subscription_end_at TIMESTAMPTZ,
  ADD COLUMN xmode_purchased_at TIMESTAMPTZ,
  ADD COLUMN xmode_payment_failed_at TIMESTAMPTZ;

-- diary_templates: scope 변경
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id DROP NOT NULL,
  ADD COLUMN template_scope TEXT NOT NULL DEFAULT 'pool'
    CHECK (template_scope IN ('pool','global')),
  ADD COLUMN curriculum_item_id TEXT;
ALTER TABLE diary_templates
  ADD CONSTRAINT chk_scope_pool_id
    CHECK ((template_scope='pool' AND swimming_pool_id IS NOT NULL) OR
           (template_scope='global' AND swimming_pool_id IS NULL));

-- 신규 테이블 (curriculum_versions, curriculum_items, curriculum_requests,
--   curriculum_request_files, growth_events, pool_events, pool_event_attachments,
--   growth_report_entitlements, deep_report_orders,
--   parent_ai_conversations, parent_ai_messages)
```

완료 조건: Migration 성공, 기존 기능 회귀 없음
Rollback: 신규 컬럼 DROP, 신규 테이블 DROP

---

### Phase 2: RevenueCat X모드 상품 + Webhook 분기
**목적**: X모드 결제 연동

신규 파일: 없음
변경 파일: `artifacts/api-server/src/routes/billing.ts`

작업:
- RevenueCat 대시보드: `xmode_monthly` 상품 생성 (150,000원)
- `billing.ts` switch에 xmode 상품 ID 분기 추가
- `applyXmodeState(poolId, status, expiresAt)` 함수 추가 (`subscriptionService.ts`)

API Contract:
```
POST /revenuecat-webhook (기존 유지)
  xmode 상품 INITIAL_PURCHASE → xmode_status=PURCHASED
  xmode 상품 EXPIRATION → xmode_status=OFF, homepage_enabled=false
  xmode 상품 CANCELLATION → xmode_status 유지 (만료일까지)
  xmode 상품 BILLING_ISSUE → xmode_payment_failed_at=now()
```

완료 조건: webhook 이벤트 시뮬레이션 → DB 상태 변경 확인
Rollback: billing.ts xmode 분기 제거

---

### Phase 3: X모드 상태 API + Pool Events API
**목적**: 서버 API 구축

신규 파일:
- `artifacts/api-server/src/routes/xmode.ts`
- `artifacts/api-server/src/routes/pool-events.ts`

API Contract:
```
GET  /api/v1/pools/:poolId/xmode/status → { xmode_status, xmode_subscription_end_at }
PATCH /api/v1/admin/pools/:poolId/xmode → { status } (super_admin only)
GET  /api/v1/admin/pools/:poolId/events → [pool_events + attachments]
POST /api/v1/admin/pools/:poolId/events → 메시지 + 파일
GET  /api/v1/pools/:poolId/events → (pool_admin용)
```

완료 조건: API unit test 통과
Rollback: 라우트 파일 삭제

---

### Phase 4: 슈퍼어드민 앱 화면
**목적**: 슈퍼어드민이 X모드 관리 가능

변경 파일: `artifacts/swim-app/app/(super)/pools.tsx`
신규 파일: `artifacts/swim-app/app/(super)/pool-xmode-detail.tsx`

기능:
- X모드 수영장 필터 탭
- 수영장 상세 모달: xmode_status 변경, 의뢰 현황
- 이벤트 알림함 대화창 UI (최신 위로 쌓임)
- 파일 업로드/다운로드

완료 조건: 슈퍼어드민으로 X모드 ON/OFF + 메시지 발송 동작
Rollback: 신규 파일 삭제, pools.tsx 변경 롤백

---

### Phase 5-A: 히든 템플릿 파일럿 50개
**목적**: 품질/성능 검증

신규 파일: `scripts/generate-pilot-templates.ts`

작업:
- 대표 영법 5개 × 레벨 2 × 항목 5 = 50개 GPT 생성
- DB 삽입 (template_scope='global')
- searchTemplates 성능/품질 검증

완료 조건: 파일럿 통과 기준 충족 (품질, latency, 중복)
Rollback: 파일럿 템플릿 DELETE

---

### Phase 5-B: 히든 템플릿 2,000개 전체 생성
**목적**: 히든 템플릿 풀 구축

신규 파일: `scripts/generate-full-templates.ts`

완료 조건: 2,000개 삽입 확인, searchTemplates 성능 유지
Rollback: 파일럿 이후 삽입분 DELETE

---

### Phase 6: AI 파이프라인 분기
**목적**: xmode_status별 템플릿 검색 분기

변경 파일:
- `artifacts/api-server/src/lib/diary-template-search.ts`
- `artifacts/api-server/src/routes/ai-v1.ts`

작업:
- `searchTemplates(poolId, meaning, xmodeStatus)` 파라미터 추가
- ACTIVE: pool 우선 + global 보완 (2단계 검색)
- CURRICULUM_PENDING: global만
- OFF/PURCHASED: pool만 (기존 동작)

완료 조건: 3가지 상태 각각 템플릿 검색 결과 다름 확인
Rollback: searchTemplates 파라미터 원복

---

### Phase 7: 커리큘럼 의뢰 시스템 (앱 + API)
**목적**: 수영장이 의뢰 가능, 슈퍼어드민이 수신

신규 파일:
- `artifacts/api-server/src/routes/curriculum-requests.ts`
- `artifacts/swim-app/app/(admin)/xmode-curriculum.tsx`

API Contract:
```
POST   /api/v1/pools/:poolId/curriculum-request
GET    /api/v1/pools/:poolId/curriculum-request
POST   /api/v1/curriculum-request/:id/files
PATCH  /api/v1/admin/curriculum-request/:id { action: approve|reject }
```

완료 조건: 의뢰 제출 → 슈퍼어드민 알림 수신 → ACTIVE 전환
Rollback: 라우트 파일 삭제, 앱 화면 제거

---

### Phase 8: 앱 X모드 UI (선생님/학부모)
**목적**: X모드 상태에 따른 UI 분기

변경 파일:
- 선생님 AI 일지 화면
- 학부모 홈, AI 검색, 성장판 화면

기능:
- 선생님: xmode_status별 AI 일지 결과 품질 차이 표시
- 학부모: 수영 성장판 (growth_events 집계)
- 학부모: AI 검색 분기 메시지
- 학부모: 기본 리포트 화면

완료 조건: 샘플 수영장 ACTIVE 상태에서 전체 흐름 동작
Rollback: UI 분기 코드 제거

---

### Phase 9: 성장 이벤트 연동
**목적**: 일지 저장 → growth_event → 성장판 반영

변경 파일: `artifacts/api-server/src/routes/diary.ts`

작업:
- class_diary_student_notes INSERT 완료 시 growth_event 생성
- 일지 삭제 시 growth_event is_invalidated=true
- curriculum_item_id 변경 시 기존 event 무효화 + 신규 생성

완료 조건: 일지 2회 저장 후 성장판 % 증가, 삭제 후 % 감소 확인
Rollback: diary.ts growth_event 연동 코드 제거

---

### Phase 10: 무료 기본 리포트
**목적**: 학부모 월 1회 무료 리포트

신규 파일:
- `artifacts/api-server/src/routes/growth-report.ts`
- `artifacts/api-server/src/jobs/report-generator.ts`

완료 조건: 학부모 앱에서 리포트 확인
Rollback: 라우트 파일 삭제

---

### Phase 11: 학부모 AI 검색 Backend
**목적**: 수영 질문 AI 답변

신규 파일:
- `artifacts/api-server/src/routes/parent-ai-search.ts`

완료 조건: 수영 질문 답변, 비수영 질문 차단 확인
Rollback: 라우트 파일 삭제

---

### Phase 12: 샘플 수영장 E2E 검증
**목적**: 전체 흐름 검증

작업: 샘플 수영장으로 Phase 1~11 전체 흐름 검증
완료 조건: 모든 상태 전이 동작, 데이터 보존 확인

---

### Phase 13: 홈페이지 웹 UI 완성 (별도)
**목적**: 5개 콘텐츠 섹션 편집 UI

변경 파일: `artifacts/swimnote-web/src/pages/PoolAdmin.tsx` (또는 PoolSettings.tsx)

작업:
- HTTP method 수정 (PATCH → PUT)
- 필드명 수정 (intro → introduction)
- 5개 섹션 편집 UI 추가

완료 조건: 5개 섹션 저장 확인

---

### Phase 14: 심층 리포트 (추후)
### Phase 15: 토이키즈 적용 → 전국 배포

---

## 검증 등급 최종 요약 V3

| 항목 | 등급 |
|------|------|
| RC webhook 이벤트 처리 (CANCELLATION/EXPIRATION) | `REPOSITORY_VERIFIED` |
| AI Pipeline 진입 파일·함수·threshold | `REPOSITORY_VERIFIED` |
| template_scope 변경 방향 | `CONTRACT_DESIGNED` |
| 홈페이지 서버 API | `REPOSITORY_VERIFIED` |
| 홈페이지 웹 UI (불완전, method/field 오류) | `REPOSITORY_VERIFIED` |
| growth_events 멱등성 | `CONTRACT_DESIGNED` |
| curriculum_progress 제거 | `CONTRACT_DESIGNED` |
| 커리큘럼 버전 관리 | `CONTRACT_DESIGNED` |
| 무료/유료 리포트 분리 | `CONTRACT_DESIGNED` |
| pool_events sender_role=system | `CONTRACT_DESIGNED` |
| 학부모 AI 검색 구조 | `CONTRACT_DESIGNED` |
| GRACE_PERIOD 처리 | `REPOSITORY_VERIFIED` — 현재 미구현 |
| REFUND 처리 | `REPOSITORY_VERIFIED` — 현재 미구현 |
| 코드 구현 전체 | `IMPLEMENTATION_NOT_STARTED` |
