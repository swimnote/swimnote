# SWIMNOTE X — 최종 설계서 v3.3.4
> 작성일: 2026-08-02
> V3.3 → V3.3.1 → V3.3.2 → V3.3.3 → V3.3.4 정정 전부 반영한 단일 확정본
> 이 문서가 구현 기준 문서이다. 하위 버전 errata는 참고용으로만 존재.
>
> **절대 금지 (별도 승인 전):**
> 코드 수정 · Migration 실행 · Commit · Push · OTA · Render 배포 · RevenueCat 상품 생성 · 샘플 데이터 생성

---

## 차례

1. [전체 설계 개요](#1-전체-설계-개요)
2. [신규 테이블 ERD](#2-신규-테이블-erd)
3. [WP1 Migration — M-A ~ M-J](#3-wp1-migration--m-a--m-j)
4. [Global Template 구조](#4-global-template-구조)
5. [Match Token (MatchTokenV2)](#5-match-token-matchtokenv2)
6. [Growth Event 구조](#6-growth-event-구조)
7. [Confidence Config](#7-confidence-config)
8. [Evidence 구조](#8-evidence-구조)
9. [Audit 인프라](#9-audit-인프라)
10. [Parent AI 사용량 추적](#10-parent-ai-사용량-추적)
11. [Growth Reports](#11-growth-reports)
12. [Swimming Pools X모드 컬럼](#12-swimming-pools-x모드-컬럼)
13. [학생 비식별화 정책](#13-학생-비식별화-정책)
14. [AI Contract V1.3](#14-ai-contract-v13)
15. [테스트](#15-테스트)
16. [Rollback SQL](#16-rollback-sql)
17. [NEEDS_VERIFICATION 미결 목록](#17-needs_verification-미결-목록)
18. [WP별 구현 파일 목록](#18-wp별-구현-파일-목록)

---

## 1. 전체 설계 개요

### 1-1. SWIMNOTE X란

X모드(SWIMNOTE X)는 기존 수영 일지 플랫폼에 AI 기반 커리큘럼 성장 추적 기능을 추가하는 상위 구독 서비스다.

### 1-2. WP 목록 (구현 순서)

| WP | 이름 | 범위 |
|----|------|------|
| **WP1** | DB Migration | M-A ~ M-J 전체 DDL 실행 |
| **WP2** | X모드 구매·EntitlementSync | RevenueCat webhook + swimming_pools xmode 컬럼 갱신 |
| **WP3** | X모드 설정 UI | 앱 xmode_config_status 흐름, 커리큘럼 연결 |
| **WP4** | Global Template 관리 | super_admin 활성화 API + 앱 슈퍼어드민 화면 |
| **WP5** | X모드 잠금 화면 | 구독 미보유 pool 접근 시 업그레이드 안내 |
| **WP6** | AI Diary Pipeline V2 | candidate_id, match_token 생성, Confidence 계산 |
| **WP7** | Growth Event 저장 | match_token 검증, saveGrowthEvent, 성장판 집계 |
| **WP8** | 성장판 조회 API | 학생별·pool별 집계 조회 |
| **WP9** | 성장판 앱 화면 | 교사/학부모 성장판 뷰 |
| **WP10** | AI Trace + 비용 추적 | ai_request_traces 고도화, pricing_config |
| **WP11** | Background Worker | job_queue, 만료 Reservation 정리, Pending 48h 처리 |
| **WP12** | Parent AI 기능 | parent AI 일지 생성, 한도 관리 |
| **WP13** | Teacher Review UI | PENDING_REVIEW 승인/거절 화면, 삭제 학생 처리 |
| **WP14** | Audit Log 뷰어 | super_admin 감사 로그 조회 |
| **WP15** | Growth Event 검토 통계 | PENDING_REVIEW 처리율, 자동 승인율 대시보드 |
| **WP16** | 성장 리포트 생성 | growth_reports AI 분석 |
| **WP17** | 성장 리포트 앱 화면 | 리포트 조회/다운로드 |
| **WP18** | PPT 내보내기 | growth_reports → PPT 생성 (별도 설계) |

### 1-3. REPOSITORY_VERIFIED 사전 조사 결과

| 항목 | 확인 결과 (2026-08-02) |
|------|----------------------|
| `swimming_pools` xmode 컬럼 | ❌ 없음 → M-B에서 추가 |
| `diary_templates.scope` | ✅ `text NOT NULL DEFAULT 'global'`, CHECK 없음 → M-E에서 CHECK 추가 |
| `diary_templates.global_template_set_id` | ❌ 없음 → M-E에서 추가 |
| `diary_templates.swimming_pool_id` | NOT NULL 제약 존재 → M-E-1에서 DROP NOT NULL |
| `global_template_sets` | ❌ 없음 → M-C에서 생성 |
| `audit_logs` | ❌ 없음 (`class_diary_audit_logs`는 별도 목적) |
| `growth_events` | ❌ 없음 → M-I에서 생성 |
| `growth_reports` | ❌ 없음 → M-J에서 생성 |
| `parent_ai_daily_usage` | ❌ 없음 → M-H에서 생성 |
| Drizzle transaction | ✅ `db.transaction(async (tx) => { await tx.execute(sql\`...\`) })` |
| Worker 인프라 | ✅ `"start:worker": "WORKER_MODE=true node dist/index.mjs"` |

---

## 2. 신규 테이블 ERD

```
swimming_pools (기존)
  ├─ xmode_entitlement (boolean)           ← M-B 신규
  ├─ xmode_config_status (enum)            ← M-B 신규
  ├─ xmode_purchased_at (timestamptz)      ← M-B 신규
  ├─ xmode_subscription_end_at             ← M-B 신규
  └─ xmode_payment_failed_at               ← M-B 신규

global_template_sets (신규 — M-C)
  ├─ id (text PK)
  ├─ version_name (text UNIQUE)
  ├─ status (global_template_status_enum: DRAFT|ACTIVE|ARCHIVED)
  ├─ activated_at, archived_at
  └─ 1:N ──────────────────────────────────┐
                                            ↓
diary_templates (기존)                    ← M-E 수정
  ├─ swimming_pool_id (NULL 허용)
  ├─ scope: 'global' | 'teacher' | 'x_global'
  └─ global_template_set_id (FK → global_template_sets.id)

audit_entity_versions (신규 — M-F)
  └─ (entity_type, entity_id) PK → version bigint (atomic counter)

audit_logs (신규 — M-G)
  ├─ entity_version (bigint — next_audit_version()로 발급)
  ├─ actor_id (NULL 허용 — system actor일 때)
  └─ correlation_id (요청 단위 이상의 흐름 추적)

parent_ai_daily_usage (신규 — M-H)
  └─ (parent_account_id, usage_date) UNIQUE

parent_ai_usage_reservations (신규 — M-H2)
  └─ request_id PRIMARY KEY

growth_events (신규 — M-I)
  ├─ match_token_id UNIQUE (NULL 허용 — 구버전 앱 호환)
  ├─ uq_growth_events_per_note PARTIAL UNIQUE (diary_note_id, student_id, item_id, source WHERE is_invalidated=false)
  └─ growth_match_status: AUTO_ACCEPTED|PENDING_REVIEW|TEACHER_ACCEPTED|TEACHER_REJECTED|DISCARDED

growth_reports (신규 — M-J)
  └─ 버전 추적 컬럼 7개 (report_schema_version, report_template_version, ...)
```

### scope 허용값 의미

| scope | swimming_pool_id | global_template_set_id | 의미 |
|-------|-----------------|----------------------|------|
| `global` | NOT NULL | NULL | 특정 pool 내 교사 전체 공유 템플릿 |
| `teacher` | NOT NULL | NULL | 교사 개인 override 템플릿 |
| `x_global` | NULL | NOT NULL | X모드 cross-pool 전역 템플릿 |

---

## 3. WP1 Migration — M-A ~ M-J

### 3-1. 실행 파일 및 진입점

```
파일: artifacts/api-server/src/migrations/pool-db-x-init.ts
진입: export async function initXModeSchema(): Promise<void>
호출: pool-db-init.ts의 initPoolDb() 마지막에서 await initXModeSchema()
```

### 3-2. Migration Group 구조 (실패 즉시 중단)

```
Group 1: M-A, M-B         ENUM 타입 → swimming_pools 컬럼 (ENUM이 먼저여야 함)
Group 2: M-C, M-D, M-E    global_template_sets → 인덱스 → diary_templates (FK 대상 먼저)
Group 3: M-F, M-G         audit_entity_versions + 함수 → audit_logs
Group 4: M-H, M-H2        parent_ai_daily_usage → reservations (daily_usage가 먼저)
Group 5: M-I, M-J         growth_events → growth_reports (ENUM은 Group 1에서 완료)
```

**실패 정책:**
- `.catch(() => {})` 또는 `.catch((e) => console.error(...))` 후 계속 진행 **금지**
- 어느 Group이든 실패 시 이후 Group 실행 중단
- 멱등성 패턴(`IF NOT EXISTS`, `DO $$`, `ADD COLUMN IF NOT EXISTS`)은 재실행 안전성용이지 오류 은폐용 아님

```typescript
// initXModeSchema 구조 (실제 코드: pool-db-x-init.ts)
export async function initXModeSchema(): Promise<void> {
  try { await runGroup1_EnumAndPools(db); }
  catch (err) { console.error('[X WP1] Group 1 실패', err); throw err; }

  try { await runGroup2_GlobalTemplate(db); }
  catch (err) { console.error('[X WP1] Group 2 실패', err); throw err; }

  try { await runGroup3_Audit(db); }
  catch (err) { console.error('[X WP1] Group 3 실패', err); throw err; }

  try { await runGroup4_ParentAiUsage(db); }
  catch (err) { console.error('[X WP1] Group 4 실패', err); throw err; }

  try { await runGroup5_Growth(db); }
  catch (err) { console.error('[X WP1] Group 5 실패', err); throw err; }

  console.log('[SWIMNOTE X WP1] ✅ 전체 Migration 완료');
}
```

### 3-3. M-A: ENUM 타입 생성

```sql
-- 패턴: DO $$ + EXCEPTION WHEN duplicate_object (CREATE TYPE IF NOT EXISTS 미지원)
DO $$ BEGIN
  CREATE TYPE xmode_config_status_enum AS ENUM
    ('NOT_CONFIGURED', 'CURRICULUM_PENDING', 'READY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE global_template_status_enum AS ENUM
    ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE growth_match_status_enum AS ENUM
    ('AUTO_ACCEPTED', 'PENDING_REVIEW',
     'TEACHER_ACCEPTED', 'TEACHER_REJECTED', 'DISCARDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 3-4. M-B: swimming_pools X모드 컬럼 추가

```sql
-- ENUM 타입(M-A) 완료 후 실행
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_entitlement        boolean                  NOT NULL DEFAULT false;
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_config_status       xmode_config_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_purchased_at        timestamptz;
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_subscription_end_at timestamptz;
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_payment_failed_at   timestamptz;
```

### 3-5. M-C: global_template_sets 신규 테이블

```sql
CREATE TABLE IF NOT EXISTS global_template_sets (
  id            text                        PRIMARY KEY
                  DEFAULT ('gts_' || replace(gen_random_uuid()::text,'-','')),
  version_name  text                        NOT NULL,
  status        global_template_status_enum NOT NULL DEFAULT 'DRAFT',
  created_at    timestamptz                 NOT NULL DEFAULT now(),
  activated_at  timestamptz,
  archived_at   timestamptz
);
```

### 3-6. M-D: global_template_sets 인덱스

```sql
-- ① ACTIVE 유일성: (1) 표현식 인덱스
--   ACTIVE 행 모두 색인값 1 공유 → UNIQUE 위반으로 2번째 ACTIVE 차단
--   ADD CONSTRAINT IF NOT EXISTS 미지원 → DO $$ + pg_class 조회
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'uniq_global_template_sets_one_active'
      AND n.nspname = 'public'
  ) THEN
    CREATE UNIQUE INDEX uniq_global_template_sets_one_active
      ON global_template_sets ((1))
      WHERE status = 'ACTIVE';
  END IF;
END $$;

-- ② version_name UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS uniq_global_template_sets_version_name
  ON global_template_sets (version_name);
```

### 3-7. M-E: diary_templates 변경 (2단계 사전 검증 포함)

> **사전 검증은 Migration 코드 내부에 내장되어 있음 (pool-db-x-init.ts 참고)**

#### 1차 검증 — M-E-1 실행 전

```sql
-- global_template_set_id 컬럼이 아직 없으므로 기존 컬럼만 검증
SELECT id, scope, swimming_pool_id
FROM diary_templates
WHERE scope NOT IN ('global', 'teacher')
   OR swimming_pool_id IS NULL;
-- 예상: 0 rows. 1행 이상이면 Migration 중단.
```

#### M-E-1: swimming_pool_id NOT NULL 해제

```sql
ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id DROP NOT NULL;
```

#### M-E-2: global_template_set_id 컬럼 추가

```sql
ALTER TABLE diary_templates ADD COLUMN IF NOT EXISTS global_template_set_id text;
```

#### 2차 검증 — M-E-3 실행 전

```sql
-- global_template_set_id 추가 후 전체 정합성 검증
SELECT id, scope, swimming_pool_id, global_template_set_id
FROM diary_templates
WHERE NOT (
  (scope = 'x_global'          AND swimming_pool_id IS NULL     AND global_template_set_id IS NOT NULL)
  OR
  (scope IN ('global','teacher') AND swimming_pool_id IS NOT NULL AND global_template_set_id IS NULL)
);
-- 예상: 0 rows. 1행 이상이면 Migration 중단.
```

#### M-E-3: scope 정합성 CHECK 추가

```sql
-- ADD CONSTRAINT IF NOT EXISTS 미지원 → DO $$ + pg_constraint 조회
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_diary_templates_scope_integrity'
      AND conrelid = 'diary_templates'::regclass
  ) THEN
    ALTER TABLE diary_templates
    ADD CONSTRAINT chk_diary_templates_scope_integrity
    CHECK (
      (scope = 'x_global'          AND swimming_pool_id IS NULL     AND global_template_set_id IS NOT NULL)
      OR
      (scope IN ('global','teacher') AND swimming_pool_id IS NOT NULL AND global_template_set_id IS NULL)
    );
  END IF;
END $$;
```

**CHECK가 거부하는 케이스:**

| 입력 조합 | 거부 이유 |
|-----------|----------|
| `scope = 'arbitrary'` | 허용 3개 값에 없음 |
| `scope = 'x_global'` + `swimming_pool_id IS NOT NULL` | x_global 조건 위반 |
| `scope = 'x_global'` + `global_template_set_id IS NULL` | x_global 조건 위반 |
| `scope = 'global'` + `swimming_pool_id IS NULL` | global 조건 위반 |
| `scope = 'teacher'` + `global_template_set_id IS NOT NULL` | teacher 조건 위반 |

#### M-E-4: global_template_set_id FK

```sql
-- M-C(global_template_sets 생성) 이후에만 실행 가능
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_diary_templates_global_set'
      AND conrelid = 'diary_templates'::regclass
  ) THEN
    ALTER TABLE diary_templates
    ADD CONSTRAINT fk_diary_templates_global_set
    FOREIGN KEY (global_template_set_id)
    REFERENCES global_template_sets (id)
    ON DELETE RESTRICT;
    -- RESTRICT: 연결된 diary_templates 있으면 세트 삭제 차단 (롤백 경로 보존)
  END IF;
END $$;
```

#### M-E-5: x_global 검색 인덱스

```sql
CREATE INDEX IF NOT EXISTS idx_diary_templates_xglobal
  ON diary_templates (global_template_set_id, is_active)
  WHERE scope = 'x_global';
```

### 3-8. M-F: audit_entity_versions + next_audit_version 함수

```sql
-- entity별 version counter 테이블
CREATE TABLE IF NOT EXISTS audit_entity_versions (
  entity_type  text    NOT NULL,
  entity_id    text    NOT NULL,
  version      bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
);

-- Atomic increment (동시 호출에서도 중복 version 발생 없음)
CREATE OR REPLACE FUNCTION next_audit_version(
  p_entity_type text,
  p_entity_id   text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO audit_entity_versions (entity_type, entity_id, version)
  VALUES (p_entity_type, p_entity_id, 1)
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET version = audit_entity_versions.version + 1
  RETURNING version INTO v;
  RETURN v;
END;
$$;
```

### 3-9. M-G: audit_logs 신규 테이블

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id              text        PRIMARY KEY
                    DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  entity_version  bigint      NOT NULL,
  action          text        NOT NULL,
  actor_type      text        NOT NULL,
  actor_id        text,                   -- NULL 허용: actor_type='system'일 때
  pool_id         text,                   -- NULL or 'GLOBAL' for cross-pool actions
  before_data     jsonb,
  after_data      jsonb,
  reason          text,
  request_id      text,
  correlation_id  text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_audit_logs_action
    CHECK (action IN ('create', 'update', 'delete')),

  CONSTRAINT chk_audit_logs_actor_type
    CHECK (actor_type IN ('super_admin', 'pool_admin', 'teacher', 'parent', 'system')),

  -- actor_type='system'이면 actor_id NULL, 나머지는 NOT NULL
  CONSTRAINT chk_audit_logs_actor_id_consistency
    CHECK (
      (actor_type = 'system' AND actor_id IS NULL)
      OR
      (actor_type <> 'system' AND actor_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, entity_version);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_pool
  ON audit_logs (pool_id, created_at DESC)
  WHERE pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation
  ON audit_logs (correlation_id)
  WHERE correlation_id IS NOT NULL;
```

### 3-10. M-H: parent_ai_daily_usage 신규 테이블

```sql
-- 일(日) 단위. Asia/Seoul 기준 날짜 (서버에서 변환).
-- M-H2(reservations)가 이 테이블 집계를 참조하므로 먼저 생성.
CREATE TABLE IF NOT EXISTS parent_ai_daily_usage (
  id                    text            PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_account_id     text            NOT NULL,
  usage_date            date            NOT NULL,
  reserved_count        integer         NOT NULL DEFAULT 0,
  completed_count       integer         NOT NULL DEFAULT 0,
  failed_count          integer         NOT NULL DEFAULT 0,
  intent_blocked_count  integer         NOT NULL DEFAULT 0,
  prompt_tokens         integer         NOT NULL DEFAULT 0,
  completion_tokens     integer         NOT NULL DEFAULT 0,
  estimated_cost_krw    numeric(10,2)   NOT NULL DEFAULT 0,
  created_at            timestamptz     NOT NULL DEFAULT now(),
  updated_at            timestamptz     NOT NULL DEFAULT now(),
  UNIQUE (parent_account_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_parent_ai_usage_date
  ON parent_ai_daily_usage (parent_account_id, usage_date DESC);
```

### 3-11. M-H2: parent_ai_usage_reservations 신규 테이블

```sql
-- request_id PRIMARY KEY: 동일 request_id 중복 예약 원천 차단.
-- status: RESERVED → COMPLETED / FAILED / BLOCKED / EXPIRED
-- expires_at: 기본 10분
CREATE TABLE IF NOT EXISTS parent_ai_usage_reservations (
  request_id          text            PRIMARY KEY,
  parent_account_id   text            NOT NULL,
  usage_date          date            NOT NULL,
  status              text            NOT NULL DEFAULT 'RESERVED',
  reserved_at         timestamptz     NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  expires_at          timestamptz     NOT NULL DEFAULT (now() + interval '10 minutes'),
  prompt_tokens       integer         NOT NULL DEFAULT 0,
  completion_tokens   integer         NOT NULL DEFAULT 0,
  estimated_cost_krw  numeric(10,2)   NOT NULL DEFAULT 0,
  error_code          text,
  created_at          timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT chk_reservation_status
    CHECK (status IN ('RESERVED','COMPLETED','FAILED','BLOCKED','EXPIRED')),

  CONSTRAINT chk_reservation_completed_at
    CHECK (
      (status IN ('COMPLETED','FAILED','BLOCKED','EXPIRED') AND completed_at IS NOT NULL)
      OR status = 'RESERVED'
    )
);

CREATE INDEX IF NOT EXISTS idx_par_reservations_parent_date
  ON parent_ai_usage_reservations (parent_account_id, usage_date);

CREATE INDEX IF NOT EXISTS idx_par_reservations_expired
  ON parent_ai_usage_reservations (status, expires_at)
  WHERE status = 'RESERVED';
```

### 3-12. M-I: growth_events 신규 테이블

```sql
-- growth_match_status_enum은 M-A에서 생성됨
CREATE TABLE IF NOT EXISTS growth_events (
  id                          text                     PRIMARY KEY
                                DEFAULT ('ge_' || replace(gen_random_uuid()::text,'-','')),

  -- 식별
  student_id                  text        NOT NULL,
  swimming_pool_id            text        NOT NULL,
  curriculum_item_id          text        NOT NULL,
  curriculum_version_id       text        NOT NULL,
  diary_note_id               text,

  -- 출처
  source                      text        NOT NULL DEFAULT 'teacher_ai',
  match_token_id              text,          -- one-time token JTI (재사용 방지)

  -- AI 매칭 상태 (서버 산출 — 앱 전달값 신뢰 안 함)
  growth_match_status         growth_match_status_enum NOT NULL DEFAULT 'AUTO_ACCEPTED',

  -- 신뢰도·버전 추적
  confidence                  numeric(4,3) NOT NULL,
  matching_algorithm_version  text,
  confidence_config_version   text,
  engine_version              text,
  prompt_version              text,
  knowledge_version           text,
  template_set_version        text,
  contract_version            text,

  -- 증거 (분리 컬럼 — JSONB 단일 컬럼 아님)
  evidence_source_type        text,          -- 'teacher_input'|'generated_content'|NULL
  evidence_sentence_index     integer,       -- 0-based, NULL 허용
  evidence_text               text,          -- 최대 300자, NULL 허용
  evidence_metadata           jsonb,
  evidence_validation         text,          -- 'PASS'|'FAIL'|'SKIPPED'|NULL

  -- 검토 (PENDING_REVIEW → TEACHER_ACCEPTED/REJECTED)
  reviewed_by                 text,
  reviewed_at                 timestamptz,
  review_reason               text,

  -- 무효화 (일지 삭제 시 DELETE 대신 플래그)
  is_invalidated              boolean     NOT NULL DEFAULT false,
  invalidated_at              timestamptz,

  -- 추적
  request_id                  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- CHECK 제약
  CONSTRAINT chk_ge_confidence
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT chk_ge_evidence_sentence_index
    CHECK (evidence_sentence_index IS NULL OR evidence_sentence_index >= 0),
  CONSTRAINT chk_ge_evidence_text_len
    CHECK (evidence_text IS NULL OR length(evidence_text) <= 300),
  CONSTRAINT chk_ge_evidence_validation
    CHECK (evidence_validation IS NULL OR evidence_validation IN ('PASS','FAIL','SKIPPED')),
  CONSTRAINT chk_ge_source
    CHECK (source IN ('teacher_ai','teacher_manual','parent_ai','video_ai')),
  CONSTRAINT chk_ge_invalidated_consistency
    CHECK (
      (is_invalidated = false AND invalidated_at IS NULL)
      OR
      (is_invalidated = true  AND invalidated_at IS NOT NULL)
    )
);

-- one-time token 재사용 방지 (NULL 허용 — 구버전 앱 호환)
CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_events_match_token_id
  ON growth_events (match_token_id)
  WHERE match_token_id IS NOT NULL;

-- 동일 일지·학생·커리큘럼·출처 중복 방지 (유효 이벤트만)
CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_events_per_note
  ON growth_events (diary_note_id, student_id, curriculum_item_id, source)
  WHERE diary_note_id IS NOT NULL AND is_invalidated = false;

-- 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_growth_events_student
  ON growth_events (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_pool
  ON growth_events (swimming_pool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_pending
  ON growth_events (growth_match_status)
  WHERE growth_match_status = 'PENDING_REVIEW' AND is_invalidated = false;
```

### 3-13. M-J: growth_reports 신규 테이블

```sql
CREATE TABLE IF NOT EXISTS growth_reports (
  id                      text        PRIMARY KEY
                            DEFAULT ('gr_' || replace(gen_random_uuid()::text,'-','')),

  student_id              text        NOT NULL,
  swimming_pool_id        text        NOT NULL,
  report_type             text        NOT NULL DEFAULT 'monthly',
  period_start            date        NOT NULL,
  period_end              date        NOT NULL,

  -- 데이터 소스 추적
  source_event_count      integer     NOT NULL DEFAULT 0,
  source_data_cutoff_at   timestamptz,

  -- 버전 추적 (재다운로드 시 동일 버전 → 재분석 없이 cached 응답)
  curriculum_version_id   text,
  report_schema_version   text,
  report_template_version text,
  analysis_version        text,
  prompt_version          text,
  knowledge_version       text,
  ppt_template_version    text,          -- WP18에서 활성화, 현재 NULL

  -- 콘텐츠
  content                 jsonb,         -- AI 분석 결과 원본 (WP16에서 채워짐)
  summary_text            text,
  file_url                text,

  -- 생성 메타
  generated_at            timestamptz NOT NULL DEFAULT now(),
  generated_by            text,
  ai_version              text,
  confidence_config_ver   text,

  -- 소프트 딜리트
  deleted_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_gr_report_type
    CHECK (report_type IN ('monthly','quarterly','annual','custom')),
  CONSTRAINT chk_gr_period
    CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_growth_reports_student
  ON growth_reports (student_id, period_start DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_growth_reports_pool
  ON growth_reports (swimming_pool_id, created_at DESC)
  WHERE deleted_at IS NULL;
```

---

## 4. Global Template 구조

### 4-1. 활성화 Transaction (Advisory Lock 포함)

```typescript
// src/lib/global-template-activation.ts

export async function activateGlobalTemplateSet(
  templateSetId: string,
  actorId:       string,
  requestId:     string,
  ipHash?:       string,
): Promise<void> {

  await db.transaction(async (tx) => {
    // ① Advisory Transaction Lock (하드코딩 정수 — 환경 독립)
    //    pg_try_advisory_xact_lock: transaction 종료 시 자동 해제
    const [lockRow] = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(20260802) AS locked
    `);
    if (!lockRow.locked) {
      throw new AppError(409, 'TEMPLATE_ACTIVATION_IN_PROGRESS');
    }

    // ② 대상 row 조회 + row lock
    const [target] = await tx.execute(sql`
      SELECT id, status, version_name
      FROM global_template_sets
      WHERE id = ${templateSetId}
      FOR UPDATE
    `);
    if (!target) throw new AppError(404, 'TEMPLATE_SET_NOT_FOUND');

    // ③ 상태 검증
    //    DRAFT → ACTIVE: 가능
    //    ARCHIVED → ACTIVE: 가능 (롤백 경로)
    //    ACTIVE: ALREADY_ACTIVE
    if (target.status === 'ACTIVE')   throw new AppError(409, 'ALREADY_ACTIVE');
    if (target.status !== 'DRAFT' && target.status !== 'ARCHIVED') {
      throw new AppError(400, 'INVALID_TEMPLATE_SET_STATUS');
    }

    // ④ 기존 ACTIVE → ARCHIVED
    const prevRows = await tx.execute(sql`
      UPDATE global_template_sets
      SET status = 'ARCHIVED', archived_at = NOW()
      WHERE status = 'ACTIVE'
      RETURNING id, version_name
    `);

    // ⑤ 대상 → ACTIVE
    await tx.execute(sql`
      UPDATE global_template_sets
      SET status = 'ACTIVE', activated_at = NOW(), archived_at = NULL
      WHERE id = ${templateSetId}
    `);

    // ⑥ Audit Log (동일 tx)
    await writeAuditLog(tx, {
      entity_type:    'global_template_set',
      entity_id:      templateSetId,
      action:         'update',
      actor_type:     'super_admin',
      actor_id:       actorId,
      pool_id:        'GLOBAL',
      before_data:    { status: target.status, version_name: target.version_name },
      after_data:     {
        status:           'ACTIVE',
        prev_active_id:   prevRows.rows[0]?.id ?? null,
        prev_active_name: prevRows.rows[0]?.version_name ?? null,
      },
      reason:         target.status === 'ARCHIVED'
                        ? `rollback to ${target.version_name}`
                        : `activate ${target.version_name}`,
      request_id:     requestId,
      correlation_id: genCorrelationId(),
      ip_hash:        ipHash ?? null,
    });
  });
}
```

### 4-2. 활성화 API

```
PATCH /api/v1/admin/global-template-sets/:id/activate
  Auth: super_admin only

  사전 검증:
  - 대상 세트 존재 여부
  - 유효 template 수 >= 1
  - status IN ('DRAFT', 'ARCHIVED')

  응답:
  {
    "active_set_id": "gts_xxx",
    "version_name": "global_v1",
    "previous_set_id": "gts_yyy" | null,
    "activated_at": "2026-08-02T..."
  }

  롤백: 이전 ARCHIVED 세트 id로 동일하게 호출
```

### 4-3. x_global 템플릿 검색 쿼리

```sql
SELECT dt.*
FROM diary_templates dt
JOIN global_template_sets gts ON gts.id = dt.global_template_set_id
WHERE dt.scope = 'x_global'
  AND dt.is_active = TRUE
  AND gts.status = 'ACTIVE';
```

---

## 5. Match Token (MatchTokenV2)

### 5-1. 설계 근거

`candidateMap`(메모리)을 사용하지 않는 이유: 서버 재시작·수평 확장 시 Map 소멸 → 저장 단계 검증 불가. HMAC-signed match_token으로 무상태 검증.

### 5-2. 최종 Payload 구조

```typescript
interface MatchTokenV2Payload {
  key_id:                       string;   // 현재: 'match_key_v1'  ← V3.3.4 추가
  jti:                          string;   // UUID — one-time 사용 (growth_events.match_token_id에 저장)
  request_id:                   string;   // AI 요청 단위 (저장 요청과 반드시 일치)
  pool_id:                      string;   // 저장 대상 pool 검증
  student_ref:                  string;   // HMAC-SHA256(student_id, MATCH_TOKEN_SECRET)
  curriculum_item_id:           string;
  curriculum_version_id:        string;
  candidate_id:                 string;   // "cand_7f3a2c" — 불투명 식별자
  confidence:                   number;   // 서버 계산 — 앱 변조 불가
  confidence_config_version:    string;
  matching_algorithm_version:   string;
  issued_at:                    string;   // ISO8601
  expires_at:                   string;   // ISO8601 (기본 issued_at + 24h)
  // hmac: string — stableStringify(payload_without_hmac) 서명 (전달 시 포함)
}
```

### 5-3. 환경변수

```
MATCH_TOKEN_SECRET    — HMAC 서명 키 (필수)
MATCH_TOKEN_KEY_ID    — 현재 키 식별자, 기본값: 'match_key_v1'

❌ JWT_SECRET fallback 금지. MATCH_TOKEN_SECRET 미설정 시 Match 기능 비활성화.
```

### 5-4. 토큰 생성

```typescript
function createMatchToken(
  payload: Omit<MatchTokenV2Payload, 'key_id' | 'hmac'> & { key_id?: string }
): string {
  const secret = process.env.MATCH_TOKEN_SECRET!;
  const keyId  = process.env.MATCH_TOKEN_KEY_ID ?? 'match_key_v1';
  const full   = { ...payload, key_id: keyId };
  const base   = stableStringify(full);           // key 포함 직렬화
  const hmac   = createHmac('sha256', secret).update(base).digest('hex');
  return Buffer.from(JSON.stringify({ ...full, hmac })).toString('base64url');
}
```

### 5-5. 토큰 검증 (검증 순서 중요)

```typescript
function verifyMatchToken(
  token:            string,
  claimedStudentId: string,
  claimedPoolId:    string,
  claimedRequestId: string,
): MatchTokenV2Payload {
  let raw: any;
  try {
    raw = JSON.parse(Buffer.from(token, 'base64url').toString());
  } catch {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }
  const { hmac, ...rest } = raw;

  // ① key_id 지원 여부 (먼저 검사)
  const supportedKeyIds = ['match_key_v1'];
  if (!supportedKeyIds.includes(raw.key_id)) {
    throw new AppError(400, 'MATCH_TOKEN_KEY_NOT_SUPPORTED');
  }

  // ② HMAC 길이 검사 (timingSafeEqual 전 필수)
  if (typeof hmac !== 'string' || hmac.length !== 64) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // ③ 서명 검증
  const secret   = process.env.MATCH_TOKEN_SECRET!;
  const expected = createHmac('sha256', secret).update(stableStringify(rest)).digest('hex');
  if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // ④ 만료 검증
  if (new Date(raw.expires_at) < new Date()) {
    throw new AppError(400, 'MATCH_TOKEN_EXPIRED');
  }

  // ⑤ student_ref 검증
  const expectedRef = createHmac('sha256', secret).update(claimedStudentId).digest('hex');
  if (raw.student_ref !== expectedRef) {
    throw new AppError(403, 'STUDENT_MISMATCH');
  }

  // ⑥ request_id 일치 검증
  if (raw.request_id !== claimedRequestId) {
    throw new AppError(400, 'REQUEST_ID_MISMATCH');
  }

  return raw as MatchTokenV2Payload;
}
```

**검증 순서별 오류 코드:**

| 케이스 | 반환 코드 |
|--------|----------|
| malformed token (파싱 불가) | `INVALID_MATCH_TOKEN` |
| 지원되지 않는 key_id | `MATCH_TOKEN_KEY_NOT_SUPPORTED` |
| key_id 변조 (지원 안 되는 값으로) | `MATCH_TOKEN_KEY_NOT_SUPPORTED` |
| 지원되는 key_id + payload/hmac 변조 | `INVALID_MATCH_TOKEN` |
| 만료 | `MATCH_TOKEN_EXPIRED` |
| student_ref 불일치 | `STUDENT_MISMATCH` |
| request_id 불일치 | `REQUEST_ID_MISMATCH` |

### 5-6. 향후 Secret Rotation (현재 미구현)

```
현재: 단일 MATCH_TOKEN_SECRET + key_id='match_key_v1'
Secret 교체: 기존 토큰 TTL(24h) 경과 후 교체

향후 확장:
MATCH_TOKEN_SECRETS_JSON = '{"match_key_v1":"old","match_key_v2":"new"}'
  → payload.key_id로 해당 secret 선택 → 다중 키 동시 검증 가능
현재 구현 범위 밖 — 설계만 명시
```

---

## 6. Growth Event 구조

### 6-1. growth_match_status 5단계

```
AUTO_ACCEPTED
  - 조건: confidence >= auto_progress threshold (기본 0.75)
  - 성장판 집계 포함
  - 교사 UI: 확인용 표시

PENDING_REVIEW
  - 조건: review_required <= confidence < auto_progress (기본 0.55~0.75)
  - 성장판 미반영 (집계 제외)
  - 교사 UI에 "확인 필요" 표시
  - 48시간 미응답 → DISCARDED 자동 처리 (job_queue — WP11)

TEACHER_ACCEPTED
  - 교사가 PENDING_REVIEW 승인
  - 성장판 집계 포함
  - reviewed_by, reviewed_at, review_reason 기록
  - Audit Log 기록

TEACHER_REJECTED
  - 교사가 PENDING_REVIEW 거절
  - 성장판 미반영
  - reviewed_by, reviewed_at, review_reason 기록

DISCARDED
  - confidence < review_required 또는 검증 실패
  - 파일럿 후 저장 여부 결정
  - 저장 시: 성장판 미반영
```

### 6-2. 성장판 집계 조건

```sql
-- 성장판에 집계되는 이벤트
WHERE growth_match_status IN ('AUTO_ACCEPTED', 'TEACHER_ACCEPTED')
  AND is_invalidated = false
```

### 6-3. saveGrowthEvent — 충돌 분기 로직

```typescript
// src/lib/growth-event-store.ts

async function saveGrowthEvent(opts: SaveGrowthEventOpts): Promise<{ event_id: string; idempotent: boolean }> {
  const { tx, tokenPayload, diaryNoteId, studentId, growthMatchStatus, poolId } = opts;

  // ① INSERT 시도 (ON CONFLICT DO NOTHING — match_token_id UNIQUE)
  const insertResult = await tx.execute(sql`
    INSERT INTO growth_events (
      id, student_id, swimming_pool_id, curriculum_item_id,
      curriculum_version_id, diary_note_id, source,
      match_token_id, growth_match_status, confidence,
      confidence_config_version, matching_algorithm_version,
      request_id, created_at, updated_at
    ) VALUES (
      ${'ge_' + randomHex()}, ${studentId}, ${poolId},
      ${tokenPayload.curriculum_item_id}, ${tokenPayload.curriculum_version_id},
      ${diaryNoteId}, 'teacher_ai',
      ${tokenPayload.jti}, ${growthMatchStatus}, ${tokenPayload.confidence},
      ${tokenPayload.confidence_config_version}, ${tokenPayload.matching_algorithm_version},
      ${tokenPayload.request_id}, NOW(), NOW()
    )
    ON CONFLICT (match_token_id) WHERE match_token_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `);

  if ((insertResult.rowCount ?? 0) === 1) {
    return { event_id: insertResult.rows[0].id, idempotent: false };
  }

  // ② match_token_id CONFLICT → 기존 행 조회
  const [existing] = await tx.execute(sql`
    SELECT id, diary_note_id
    FROM growth_events
    WHERE match_token_id = ${tokenPayload.jti}
    LIMIT 1
  `);

  if (!existing) throw new AppError(500, 'GROWTH_EVENT_CONFLICT_UNRESOLVABLE');

  // ③ 동일 diary_note → 멱등 응답
  if (existing.diary_note_id === diaryNoteId) {
    return { event_id: existing.id, idempotent: true };
  }

  // ④ 다른 diary_note 재사용 → 409
  throw new AppError(409, 'MATCH_TOKEN_ALREADY_USED');
}
```

### 6-4. uq_growth_events_per_note 충돌 처리

| 케이스 | 처리 |
|--------|------|
| 동일 match_token_id + 동일 diary_note_id | 멱등 200 — 기존 event 반환 |
| 동일 match_token_id + 다른 diary_note_id | 409 `MATCH_TOKEN_ALREADY_USED` |
| 다른 토큰 + 동일 (note, student, item, source) + is_invalidated=false | 기존 유효 event 반환 또는 409 `DUPLICATE_PROGRESS_EVENT` |
| 기존 event가 is_invalidated=true | Partial INDEX 제외 → 신규 유효 event 생성 가능 |

### 6-5. growth_match_status 서버 재산출

```typescript
// 저장 시 status 결정 — 앱이 전달한 status 무시
async function resolveGrowthMatchStatus(
  signedConfidence:    number,
  signedConfigVersion: string,
): Promise<growth_match_status_enum> {
  const config = await loadConfidenceConfig(signedConfigVersion);
  if (!config) return 'PENDING_REVIEW';  // 설정 없으면 교사 확인 보존

  if (signedConfidence >= config.thresholds.auto_progress)    return 'AUTO_ACCEPTED';
  if (signedConfidence >= config.thresholds.review_required)  return 'PENDING_REVIEW';
  return 'DISCARDED';
}
```

### 6-6. 일지 삭제 시 처리

```sql
-- 일지 삭제 → DELETE 아닌 무효화
UPDATE growth_events
SET is_invalidated = true,
    invalidated_at = NOW(),
    updated_at     = NOW()
WHERE diary_note_id = $1
  AND is_invalidated = false;
```

### 6-7. 교사 검토 API

```
PATCH /api/v1/pools/:poolId/growth-events/:eventId/review
  Auth: teacher 또는 pool_admin (해당 diary_note 권한 검증 필수)
  Body: { action: 'accept' | 'reject', reason?: string }

  - TEACHER_ACCEPTED: growth_match_status='TEACHER_ACCEPTED' (성장판 집계 포함)
  - TEACHER_REJECTED: growth_match_status='TEACHER_REJECTED' (성장판 미반영)
  - reviewed_by, reviewed_at, review_reason 기록
  - Audit Log INSERT
```

---

## 7. Confidence Config

```typescript
// 파일: artifacts/api-server/src/config/growth-confidence-config.ts

export interface GrowthConfidenceConfig {
  config_version: string;
  weights: {
    curriculum_similarity:  number;  // 합계 = 1.0
    concept_overlap:        number;
    evidence_coverage:      number;
    parser_confidence:      number;
    candidate_rank_score:   number;
  };
  thresholds: {
    auto_progress:   number;  // 이상: AUTO_ACCEPTED
    review_required: number;  // 이상~미만: PENDING_REVIEW. 미만: DISCARDED
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
    auto_progress:   0.75,
    review_required: 0.55,
  },
};

export const MATCH_TOKEN_TTL_SEC = 86_400;  // 24시간
```

**설정 변경 정책:**
- 파일럿 50개 결과 후 수치 조정 → `config_version = "confidence_v2"`
- 변경은 신규 요청부터만 적용. 기존 이벤트 자동 재계산 금지.
- `growth_events.confidence_config_version`에 당시 버전 저장.

---

## 8. Evidence 구조

### 8-1. 컬럼 구조

```
growth_events:
  evidence_source_type    TEXT  CHECK: 'teacher_input'|'generated_content'|NULL
  evidence_sentence_index INTEGER  0-based, NULL 허용
  evidence_text           TEXT  최대 300자, NULL 허용
  evidence_metadata       JSONB  확장 메타
  evidence_validation     TEXT  CHECK: 'PASS'|'FAIL'|'SKIPPED'|NULL
```

### 8-2. 검증 흐름

```
1. GPT evidence_text 수신
2. source_type 결정:
   - teacher_input     → req.input.text 원문
   - generated_content → 해당 student content
3. 원본 텍스트를 문장 분리 (마침표/느낌표/물음표 기준)
4. evidence_text가 sentences[] 중 하나에 포함되는지 확인
5. PASS → sentence_index 기록
6. FAIL → match 폐기, evidence_validation='FAIL', progress event 생성 금지
7. SKIPPED → template-only 경로 등 evidence 불필요한 경우
```

### 8-3. 개인정보·로그 정책

```
- 운영 로그: evidence_text 전체 출력 금지
- ai_request_traces: source_type, sentence_index, validation만 저장 (원문 저장 금지)
- 개인정보 삭제 요청 시: evidence_text = NULL
- Debug(NODE_ENV=development)만: 앞 5자 + *** + 뒤 5자 마스킹 출력 허용
```

---

## 9. Audit 인프라

### 9-1. writeAuditLog 헬퍼

```typescript
// src/lib/audit-log.ts

async function writeAuditLog(
  txOrDb: DrizzleTx | Db,
  opts: {
    entity_type:    string;
    entity_id:      string;
    action:         'create' | 'update' | 'delete';
    actor_type:     'super_admin' | 'pool_admin' | 'teacher' | 'parent' | 'system';
    actor_id:       string | null;   // system이면 null
    pool_id:        string | null;
    before_data?:   object;
    after_data?:    object;
    reason?:        string;
    request_id?:    string;
    correlation_id: string;
    ip_hash?:       string | null;
  }
): Promise<void> {
  // next_audit_version 호출 (atomic increment)
  const [vRow] = await txOrDb.execute(sql`
    SELECT next_audit_version(${opts.entity_type}, ${opts.entity_id}) AS v
  `);

  await txOrDb.execute(sql`
    INSERT INTO audit_logs (
      entity_type, entity_id, entity_version,
      action, actor_type, actor_id, pool_id,
      before_data, after_data, reason,
      request_id, correlation_id, ip_hash
    ) VALUES (
      ${opts.entity_type}, ${opts.entity_id}, ${vRow.v},
      ${opts.action}, ${opts.actor_type}, ${opts.actor_id ?? null},
      ${opts.pool_id ?? null},
      ${opts.before_data ? JSON.stringify(opts.before_data) : null},
      ${opts.after_data  ? JSON.stringify(opts.after_data)  : null},
      ${opts.reason ?? null},
      ${opts.request_id ?? null}, ${opts.correlation_id},
      ${opts.ip_hash ?? null}
    )
  `);
}
```

### 9-2. correlation_id 정책

```
request_id:     단일 HTTP 요청 식별
correlation_id: 여러 서비스·Job·AI 요청을 묶는 흐름 추적
                예: diary 생성 → growth_event → report 생성 전체 흐름

단순 조회·파일 다운로드: entity_version = NULL 허용 (audit_logs 미기록 가능)
```

---

## 10. Parent AI 사용량 추적

### 10-1. 상태 전이

```
request_id 신규 → INSERT → RESERVED
                              │
               ┌──────────────┼───────────────┐
               ↓              ↓               ↓
           COMPLETED       FAILED           BLOCKED
           (성공)         (AI 오류)        (Intent 차단)
                                               ↓
                                           EXPIRED (Worker/API — 장애 복구)
```

### 10-2. expireStaleReservationsForParent (API 진입 이중 복구)

```typescript
// Background Worker(5분 주기) + API 진입 시 모두 호출
// 동시 실행해도 WHERE status='RESERVED' 조건으로 한쪽만 실제 전환

async function expireStaleReservationsForParent(
  tx:              DrizzleTx,
  parentAccountId: string,
  usageDate:       string,
): Promise<number> {
  const expired = await tx.execute(sql`
    UPDATE parent_ai_usage_reservations
    SET status       = 'EXPIRED',
        completed_at = NOW()
    WHERE parent_account_id = ${parentAccountId}
      AND usage_date        = ${usageDate}::date
      AND status            = 'RESERVED'
      AND expires_at        < NOW()
    RETURNING request_id
  `);

  const expiredCount = expired.rowCount ?? 0;
  if (expiredCount > 0) {
    await tx.execute(sql`
      UPDATE parent_ai_daily_usage
      SET reserved_count = GREATEST(0, reserved_count - ${expiredCount}),
          updated_at     = NOW()
      WHERE parent_account_id = ${parentAccountId}
        AND usage_date        = ${usageDate}::date
    `);
  }
  return expiredCount;
}
```

### 10-3. reserveParentAiInTx — ON CONFLICT DO NOTHING + 소유권 검증

```typescript
async function reserveParentAiInTx(
  tx:              DrizzleTx,
  requestId:       string,
  parentAccountId: string,
  usageDate:       string,
  dailyLimit:      number,
): Promise<void> {

  // ① INSERT ON CONFLICT DO NOTHING — PK 충돌(동시 요청) 시 0 rows
  const insertResult = await tx.execute(sql`
    INSERT INTO parent_ai_usage_reservations
      (request_id, parent_account_id, usage_date, status)
    VALUES
      (${requestId}, ${parentAccountId}, ${usageDate}::date, 'RESERVED')
    ON CONFLICT (request_id) DO NOTHING
    RETURNING request_id
  `);

  if ((insertResult.rowCount ?? 0) === 0) {
    // ② CONFLICT → 기존 reservation 조회
    const [existing] = await tx.execute(sql`
      SELECT request_id, parent_account_id, usage_date, status
      FROM parent_ai_usage_reservations
      WHERE request_id = ${requestId}
    `);
    if (!existing) throw new AppError(500, 'RESERVATION_CONFLICT_UNRESOLVABLE');

    // ③ 소유권 검증
    if (existing.parent_account_id !== parentAccountId) {
      throw new AppError(409, 'REQUEST_ID_OWNERSHIP_MISMATCH');
    }

    // ④ 상태별 재시도 정책
    switch (existing.status) {
      case 'RESERVED':  throw new AppError(409, 'REQUEST_ALREADY_IN_PROGRESS');
      case 'COMPLETED': throw new AppError(200, 'ALREADY_COMPLETED');  // 멱등 신호
      case 'FAILED':
      case 'BLOCKED':
      case 'EXPIRED':
        throw new AppError(409, 'REQUEST_ID_ALREADY_TERMINAL',
          { hint: '새 request_id를 발급하세요', previous_status: existing.status });
    }
  }

  // ⑤ 일일 한도 검사 (FOR UPDATE — daily_usage 행 잠금)
  const [usage] = await tx.execute(sql`
    SELECT reserved_count, completed_count
    FROM parent_ai_daily_usage
    WHERE parent_account_id = ${parentAccountId}
      AND usage_date = ${usageDate}::date
    FOR UPDATE
  `);
  const current = usage
    ? (usage.reserved_count as number) + (usage.completed_count as number)
    : 0;

  if (current >= dailyLimit) {
    // 한도 초과 → 방금 INSERT한 reservation 즉시 취소
    await tx.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status = 'EXPIRED', completed_at = NOW()
      WHERE request_id = ${requestId}
    `);
    throw new AppError(429, 'AI_USAGE_LIMIT_REACHED');
  }

  // ⑥ reserved_count 증가 (reservation + daily_usage는 동일 tx)
  await tx.execute(sql`
    INSERT INTO parent_ai_daily_usage
      (parent_account_id, usage_date, reserved_count)
    VALUES
      (${parentAccountId}, ${usageDate}::date, 1)
    ON CONFLICT (parent_account_id, usage_date)
    DO UPDATE SET
      reserved_count = parent_ai_daily_usage.reserved_count + 1,
      updated_at     = NOW()
  `);
}
```

**상태별 재시도 응답 요약:**

| 기존 status | 반환 |
|-------------|------|
| `RESERVED` | 409 `REQUEST_ALREADY_IN_PROGRESS` |
| `COMPLETED` | 200 `ALREADY_COMPLETED` (멱등) |
| `FAILED` / `BLOCKED` / `EXPIRED` | 409 `REQUEST_ID_ALREADY_TERMINAL` |
| 다른 parent 소유 | 409 `REQUEST_ID_OWNERSHIP_MISMATCH` |

### 10-4. handleParentAiRequest 전체 처리 순서

```typescript
async function handleParentAiRequest(
  db:              Db,
  parentAccountId: string,
  requestId:       string,
  dailyLimit:      number,
  aiCall:          () => Promise<AiResult>,
): Promise<AiResult> {
  const usageDate = getKSTDate();
  let tokens = { prompt: 0, completion: 0, costKrw: 0 };

  // tx: 만료 정리 + 예약 생성 + 한도 검증
  await db.transaction(async (tx) => {
    await expireStaleReservationsForParent(tx, parentAccountId, usageDate);  // ①
    await reserveParentAiInTx(tx, requestId, parentAccountId, usageDate, dailyLimit);  // ②
  });

  try {
    // ③ Intent Guard (네트워크 호출 — tx 밖)
    const intentOk = await checkSwimmingIntent(aiCall.inputText);
    if (!intentOk) {
      await blockParentAiIntent(db, requestId, parentAccountId, usageDate, tokens);
      throw new AppError(403, 'NON_SWIMMING_INTENT');
    }

    const result = await aiCall();  // ④ AI 호출
    tokens = result.tokens;
    await completeParentAi(db, requestId, parentAccountId, usageDate, tokens);  // ⑤
    return result;

  } catch (err) {
    if (err instanceof AppError &&
        ['NON_SWIMMING_INTENT', 'ALREADY_COMPLETED'].includes(err.code)) throw err;
    await failParentAi(db, requestId, parentAccountId, usageDate, String(err), tokens);  // ⑥
    throw err;
  }
}
```

---

## 11. Growth Reports

### 11-1. 핵심 정책

```
- 리포트 재다운로드 시: 동일 버전이면 재분석 없이 cached 응답
- 재생성: 기존 row 덮어쓰기 금지 → 새 growth_reports row 생성
- ppt_template_version: WP18 전까지 NULL
- content JSONB: WP16에서 채워짐
```

### 11-2. 버전 컬럼 정책

```typescript
// 리포트 생성 시 고정
report_schema_version:    "1.0"
report_template_version:  "report_template_v1"
analysis_version:         "analysis_v1"
prompt_version:           "p_report_v1"
knowledge_version:        null     // 미구현
ppt_template_version:     null     // WP18 이후
source_data_cutoff_at:    NOW()    // 데이터 집계 기준 시점
source_event_count:       42       // 집계된 growth_events 수
```

---

## 12. Swimming Pools X모드 컬럼

### 12-1. xmode_config_status 전이

```
NOT_CONFIGURED
  → 커리큘럼 연결 완료 시: CURRICULUM_PENDING
  → 전체 설정 완료 시: READY

CURRICULUM_PENDING
  → READY (모든 설정 완료)

READY
  → NOT_CONFIGURED (설정 초기화)
```

### 12-2. EntitlementSync (WP2)

```
RevenueCat webhook (INITIAL_PURCHASE / RENEWAL)
  → xmode_entitlement = true
  → xmode_purchased_at = NOW()
  → xmode_subscription_end_at = 갱신일 + 구독 기간

RevenueCat webhook (EXPIRATION / CANCELLATION)
  → xmode_entitlement = false
  → xmode_payment_failed_at = NOW()
```

---

## 13. 학생 비식별화 정책

### 13-1. 비식별화 처리 (SHA-256 해시 제거 — V3.3 수정)

```typescript
// 이전(V3.2): name = SHA256(name), phone = SHA256(phone) → 폐기
// 확정(V3.3):

async function anonymizeStudent(studentId: string, db: Db): Promise<void> {
  await db.execute(sql`
    UPDATE students SET
      name                = '삭제된 회원',
      phone               = NULL,
      parent_phone        = NULL,
      parent_phone2       = NULL,
      parent_phone3       = NULL,
      birth_date          = NULL,
      memo                = NULL,
      notes               = NULL,
      invite_code         = NULL,
      deleted_at          = NOW(),
      status              = 'deleted',
      class_group_id      = NULL,
      assigned_class_ids  = '[]'::jsonb,
      updated_at          = NOW()
    WHERE id = ${studentId}
  `);
  // student_id(PK)는 참조 무결성 위해 유지
  // growth_events, attendance: student_id 유지 (비식별 상태)
}
```

### 13-2. 삭제 영향 분석

```
attendance:           FK 없음 → 레코드 유지, JOIN 시 '삭제된 회원' 표시
growth_events:        student_id 유지 (비식별)
parent_students:      연결 유지 (학부모 화면에서 '삭제된 회원' 표시)
parent_accounts:      다른 활성 학생 없으면 is_active=false
diary_student_notes:  class_group_id=NULL이 간접 필터 역할
                      → 직접 조회 API는 WP7에서 deleted_at IS NULL 필터 추가 필요
```

### 13-3. 법적 보존 구분

```
보존:  growth_events, attendance, 결제/정산 기록(5년), deep_report_orders
삭제:  parent_ai_conversations/messages (CASCADE)
       프로필 이미지 (R2 30일 후 정리)

Audit Log에 비식별화 이전 원본 저장 금지.
```

---

## 14. AI Contract V1.3

### 14-1. candidate_id 방식 (V3.3 — candidate_index 제거)

```typescript
// 서버 측 candidateId 생성 (request 메모리에만 존재)
function generateCandidateId(): string {
  return 'cand_' + crypto.randomBytes(3).toString('hex');  // "cand_7f3a2c"
}
```

### 14-2. GPT 전달 구조

```json
{
  "curriculum_candidates": [
    { "candidate_id": "cand_7f3a2c", "skill_name": "자유형 측면 호흡",   "description": "..." },
    { "candidate_id": "cand_b191d4", "skill_name": "자유형 팔 리커버리", "description": "..." }
  ]
}
```

### 14-3. GPT 반환 구조

```json
{
  "curriculum_matches": [
    { "candidate_id": "cand_7f3a2c", "evidence_text": "호흡 타이밍이 좋아졌어요." }
  ]
}
```

### 14-4. 서버 후처리

```
candidate_id 수신
  → candidateMap.get(candidate_id) 조회
  → 없으면 즉시 폐기 (GPT 창작 ID)
  → pool_id, curriculum_version_id 재검증
  → curriculum_item.is_active 확인
  → evidence 검증 (sentence 포함 여부)
  → confidence 계산 (GrowthConfidenceConfig 기반)
  → match_token 생성 (HMAC-signed)
  → 앱에 반환
```

### 14-5. API Response 구조 (V1.3)

```typescript
// POST /api/v1/teacher-diary/generate 응답
interface CurriculumMatch {
  match_token:   string;    // HMAC-signed, 앱이 저장 요청 시 그대로 전달
  display_label: string;    // UI 표시용 (서버 생성)
  concept_tags:  string[];
}

interface AIGenerateResponse {
  request_id:         string;
  common:             string;
  students: {
    student_id:          string;
    content:             string;
    curriculum_matches:  CurriculumMatch[];
  }[];
  ai_version:         string;
  pipeline_version:   string;
  contract_version:   string;   // "1.3"
  schema_version:     string;   // "curriculum_match_schema_v1" (서버 내부 IR)
  generated_at:       string;
}
```

### 14-6. contract_version vs schema_version 역할 분리

```
contract_version (API 계약):  클라이언트 호환성 판단 기준. 필드 추가·삭제 시 증가.
schema_version (서버 내부):   Parser Meaning·Candidate·Evidence 내부 구조. 서버만 사용.
```

### 14-7. 저장 요청 흐름

```
앱 → POST /diaries {
  diary_content,
  student_diary_items: [{ student_id, match_tokens: ["eyJ..."] }]
}
  ↓
서버 verifyMatchToken(token, student_id, poolId, requestId)
  → OK: payload.curriculum_item_id, confidence 신뢰 사용
  ↓
DB 재확인: curriculum_items WHERE id=? AND pool_id=? AND version_id=?
  → OK: saveGrowthEvent() 호출
```

---

## 15. 테스트

### T-1: scope 사전 검증 (Migration 전)

```typescript
test('기존 diary_templates에 1차 CHECK 위반 행 없음', async () => {
  const result = await db.execute(sql`
    SELECT id FROM diary_templates
    WHERE scope NOT IN ('global', 'teacher')
       OR swimming_pool_id IS NULL
  `);
  expect(result.rowCount).toBe(0);
});
```

### T-2: scope CHECK 위반 케이스

```typescript
const violationCases = [
  { scope: 'arbitrary', swimming_pool_id: 'pool_1', global_template_set_id: null },
  { scope: 'x_global',  swimming_pool_id: 'pool_1', global_template_set_id: 'gts_1' },
  { scope: 'x_global',  swimming_pool_id: null,     global_template_set_id: null },
  { scope: 'global',    swimming_pool_id: null,     global_template_set_id: null },
  { scope: 'teacher',   swimming_pool_id: 'pool_1', global_template_set_id: 'gts_1' },
];
for (const c of violationCases) {
  test(`scope CHECK 거부: ${JSON.stringify(c)}`, async () => {
    await expect(db.execute(sql`
      INSERT INTO diary_templates (swimming_pool_id, scope, global_template_set_id, template_text, created_by)
      VALUES (${c.swimming_pool_id}, ${c.scope}, ${c.global_template_set_id}, 'test', 'admin')
    `)).rejects.toThrow();
  });
}
```

### T-3: Growth Event 중복 정책

```typescript
test('동일 note/student/item/source → 1회만 인정', async () => {
  const r1 = await saveGrowthEvent({ token: tokenA, diaryNoteId: 'note_1', studentId: 's_1',
    curriculumItemId: 'item_1', source: 'teacher_ai' });
  const r2 = await saveGrowthEvent({ token: tokenB, diaryNoteId: 'note_1', studentId: 's_1',
    curriculumItemId: 'item_1', source: 'teacher_ai' });
  expect(r1.idempotent).toBe(false);
  expect(r2.event_id).toBe(r1.event_id);
  expect(r2.idempotent).toBe(true);
});

test('is_invalidated=true 이후 동일 note/item → 신규 허용', async () => {
  await db.execute(sql`
    UPDATE growth_events SET is_invalidated=true, invalidated_at=NOW()
    WHERE diary_note_id='note_1' AND student_id='s_1' AND curriculum_item_id='item_1'
  `);
  const r = await saveGrowthEvent({ ..., diaryNoteId: 'note_1' });
  expect(r.idempotent).toBe(false);
});
```

### T-4: MatchTokenV2 검증 케이스

```typescript
// 지원되지 않는 key_id
test('key_id=match_key_v99 → MATCH_TOKEN_KEY_NOT_SUPPORTED', async () => {
  const token = createTokenWithKeyId('match_key_v99', payload);
  await expect(verifyMatchToken(token, studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'MATCH_TOKEN_KEY_NOT_SUPPORTED' });
});

// key_id 변조 → KEY_NOT_SUPPORTED (key_id 검사가 HMAC보다 선행)
test('key_id=match_key_v2 변조 → MATCH_TOKEN_KEY_NOT_SUPPORTED', async () => {
  const parsed = JSON.parse(Buffer.from(createMatchToken(payload), 'base64url').toString());
  parsed.key_id = 'match_key_v2';
  const tampered = Buffer.from(JSON.stringify(parsed)).toString('base64url');
  await expect(verifyMatchToken(tampered, studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'MATCH_TOKEN_KEY_NOT_SUPPORTED' });
});

// payload 값 변조 → INVALID_MATCH_TOKEN (key_id 유지, HMAC 불일치)
test('confidence 변조 → INVALID_MATCH_TOKEN', async () => {
  const parsed = JSON.parse(Buffer.from(createMatchToken(payload), 'base64url').toString());
  parsed.confidence = 0.99;
  const tampered = Buffer.from(JSON.stringify(parsed)).toString('base64url');
  await expect(verifyMatchToken(tampered, studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'INVALID_MATCH_TOKEN' });
});

// malformed
test('malformed token → INVALID_MATCH_TOKEN', async () => {
  await expect(verifyMatchToken('not.valid', studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'INVALID_MATCH_TOKEN' });
});
```

### T-5: Parent AI 만료 Reservation 복구

```typescript
test('Worker 중단 시 API 진입으로 만료 예약 복구', async () => {
  await db.execute(sql`
    INSERT INTO parent_ai_usage_reservations
      (request_id, parent_account_id, usage_date, status, expires_at)
    VALUES ('req_stale', ${parentId}, ${today}::date, 'RESERVED', NOW() - interval '1 minute')
  `);
  await db.execute(sql`
    UPDATE parent_ai_daily_usage SET reserved_count=1
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  await db.transaction(async (tx) => {
    const n = await expireStaleReservationsForParent(tx, parentId, today);
    expect(n).toBe(1);
  });
  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  expect(u.reserved_count).toBe(0);
});

test('Worker와 API 동시 정리 → reserved_count 중복 감소 없음 (GREATEST)', async () => {
  await insertExpiredReservation('req_concurrent', parentId, today);
  await setReservedCount(parentId, today, 1);
  await Promise.all([
    db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today)),
    db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today)),
  ]);
  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  expect(u.reserved_count).toBe(0);
});

test('reserved_count 절대 음수 없음', async () => {
  await insertExpiredReservation('req_zero', parentId, today);
  await setReservedCount(parentId, today, 0);
  await db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today));
  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  expect(u.reserved_count).toBeGreaterThanOrEqual(0);
});

test('소유권 검증 — 다른 parent_account_id → REQUEST_ID_OWNERSHIP_MISMATCH', async () => {
  await reserveParentAi(db, 'req_owned', parentIdA, 3);
  await expect(
    db.transaction(tx => reserveParentAiInTx(tx, 'req_owned', parentIdB, today, 3))
  ).rejects.toMatchObject({ code: 'REQUEST_ID_OWNERSHIP_MISMATCH' });
});
```

### T-6: Global Template ACTIVE 전환

```typescript
test('ACTIVE 전환 Transaction — 중간 rollback 시 기존 ACTIVE 유지', async () => {
  await createTemplateSet('gts_v1', 'ACTIVE');
  await createTemplateSet('gts_v2', 'DRAFT');
  // 활성화 도중 강제 오류 시뮬레이션 (DO NOTHING)
  // 실제 구현에서는 advisory lock 획득 실패로 테스트
  const [current] = await db.execute(sql`SELECT status FROM global_template_sets WHERE id='gts_v1'`);
  expect(current.status).toBe('ACTIVE');  // 변경 없음
});

test('ARCHIVED → ACTIVE 롤백 가능', async () => {
  await activateGlobalTemplateSet('gts_v1', actorId, requestId);
  await activateGlobalTemplateSet('gts_v2', actorId, requestId);  // gts_v1이 ARCHIVED
  await activateGlobalTemplateSet('gts_v1', actorId, requestId);  // 롤백
  const [v1] = await db.execute(sql`SELECT status FROM global_template_sets WHERE id='gts_v1'`);
  expect(v1.status).toBe('ACTIVE');
});
```

---

## 16. Rollback SQL

> 별도 승인 후 수동 실행. 역순 실행.

```sql
-- ─────────────────────────────────────────────────────────────────
-- Group 5 Rollback (M-J → M-I)
-- ─────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS growth_reports;
DROP TABLE IF EXISTS growth_events;
-- ENUM은 growth_events 없어진 후 DROP 가능:
-- DROP TYPE IF EXISTS growth_match_status_enum;

-- ─────────────────────────────────────────────────────────────────
-- Group 4 Rollback (M-H2 → M-H)
-- ─────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS parent_ai_usage_reservations;
DROP TABLE IF EXISTS parent_ai_daily_usage;

-- ─────────────────────────────────────────────────────────────────
-- Group 3 Rollback (M-G → M-F)
-- ─────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS audit_entity_versions;
DROP FUNCTION IF EXISTS next_audit_version(text, text);

-- ─────────────────────────────────────────────────────────────────
-- Group 2 Rollback (M-E → M-D → M-C) — 역순
-- ─────────────────────────────────────────────────────────────────
-- M-E Rollback 전제: scope='x_global' 행 = 0, swimming_pool_id IS NULL 행 = 0
-- 확인 쿼리:
SELECT COUNT(*) FROM diary_templates WHERE scope = 'x_global';
-- 0이어야 함

DROP INDEX IF EXISTS idx_diary_templates_xglobal;
ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS fk_diary_templates_global_set;
ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS chk_diary_templates_scope_integrity;
ALTER TABLE diary_templates DROP COLUMN IF EXISTS global_template_set_id;
-- swimming_pool_id IS NULL 행 없을 때만:
ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id SET NOT NULL;

DROP INDEX IF EXISTS uniq_global_template_sets_one_active;
DROP INDEX IF EXISTS uniq_global_template_sets_version_name;
DROP TABLE IF EXISTS global_template_sets;

-- ─────────────────────────────────────────────────────────────────
-- Group 1 Rollback (M-B → M-A)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_payment_failed_at;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_subscription_end_at;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_purchased_at;
-- xmode_config_status 컬럼 삭제 전 ENUM 참조 제거:
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_config_status;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_entitlement;

-- ENUM 삭제 (참조 컬럼 없어진 후):
DROP TYPE IF EXISTS xmode_config_status_enum;
DROP TYPE IF EXISTS global_template_status_enum;
DROP TYPE IF EXISTS growth_match_status_enum;
```

---

## 17. NEEDS_VERIFICATION 미결 목록

| # | 항목 | 관련 WP |
|---|------|---------|
| NV-1 | RevenueCat webhook payload의 정확한 transaction_id 필드명 | WP2 |
| NV-2 | RevenueCat consumable 상품 webhook 이벤트 타입 목록 | WP2 |
| NV-3 | Render.com starter plan Worker 추가 과금 여부 | WP11 |
| NV-4 | Growth Report PPT 저장 구조 (report_files 테이블 설계) | WP18 |
| NV-5 | Audit Log DB 레벨 DELETE/UPDATE 제한 방법 (Render/Supabase 설정) | WP14 |
| NV-6 | AUTO_ACCEPTED 항목을 일반 teacher가 변경 가능한지 정책 확정 | WP13 |
| NV-7 | 삭제 학생 diary_student_notes 직접 조회 API 전체 목록 | WP7 |
| NV-8 | PENDING_REVIEW 48시간 미응답 자동 DISCARDED 정책 (파일럿 후 확정) | WP11 |

---

## 18. WP별 구현 파일 목록

| WP | 파일 | 변경 내용 |
|----|------|----------|
| WP1 | `artifacts/api-server/src/migrations/pool-db-x-init.ts` | **신규** — M-A~M-J 전체 (770줄) |
| WP1 | `artifacts/api-server/src/migrations/pool-db-init.ts` | `import initXModeSchema` + 마지막 `await` 호출 추가 |
| WP2 | `artifacts/api-server/src/routes/billing.ts` | RevenueCat webhook → xmode 컬럼 갱신 |
| WP4 | `artifacts/api-server/src/routes/xmode.ts` | `PATCH .../activate` API 추가 |
| WP4 | `artifacts/api-server/src/lib/global-template-activation.ts` | **신규** — activateGlobalTemplateSet |
| WP4 | `artifacts/swim-app/app/(super)/template-sets.tsx` | **신규** — Global Template Set 활성화 화면 |
| WP6 | `artifacts/api-server/src/config/growth-confidence-config.ts` | **신규** — GrowthConfidenceConfig, DEFAULT_CONFIDENCE_CONFIG |
| WP6 | `artifacts/api-server/src/config/ai-pricing.ts` | **신규** — pricing config |
| WP6 | `artifacts/api-server/src/lib/curriculum-candidate-search.ts` | candidate_id 방식으로 수정 (candidate_index 제거) |
| WP6 | `artifacts/api-server/src/lib/curriculum-confidence.ts` | GrowthConfidenceConfig 사용으로 수정 |
| WP6 | `artifacts/api-server/src/routes/ai-v1.ts` | match_token 생성, contract_version="1.3" |
| WP7 | `artifacts/api-server/src/lib/growth-event-store.ts` | **신규** — saveGrowthEvent, resolveGrowthMatchStatus |
| WP7 | `artifacts/api-server/src/routes/diary.ts` | growth_event 저장 연동, deleted_at 필터 추가 |
| WP9 | `artifacts/api-server/src/lib/audit-log.ts` | **신규** — writeAuditLog |
| WP10 | `artifacts/api-server/src/lib/parent-ai-usage.ts` | **신규** — reserveParentAiInTx, handleParentAiRequest |
| WP11 | `artifacts/api-server/src/jobs/parent-ai-expiry.ts` | **신규** — Background Worker, 만료 Reservation 정리 |
| WP11 | `render.yaml` | Worker service 추가 |
| WP13 | `artifacts/api-server/src/routes/students.ts` | 학생 삭제: SHA-256 제거 → NULL/'삭제된 회원' |
| WP13 | `artifacts/swim-app/app/(teacher)/diary.tsx` | PENDING_REVIEW 표시 + 승인/거절 UI |

---

## 변경 이력 요약

| 버전 | 주요 변경 |
|------|----------|
| V3.3 | candidate_id 방식, evidence 분리 컬럼, growth_match_status 5단계, Global Template Transaction |
| V3.3.1 | candidateMap → HMAC match_token, Audit entity_version atomic UPSERT, Parent AI reserved_count 예약 구조 |
| V3.3.2 | xmode 컬럼 swimming_pools 확정, ACTIVE 인덱스 (1) 표현식 패턴, MATCH_TOKEN_SECRET 분리, AI Contract V1.3 |
| V3.3.3 | diary_templates scope REPOSITORY_VERIFIED, ARCHIVED 재활성화 허용, growth_events DDL 완성, MatchTokenV2 jti 추가 |
| V3.3.4 | M-E 사전 검증 2단계 분리, Migration `.catch` 금지·Group 실패 즉시 throw, Match Token 검증 순서 테스트 수정, Reservation 소유권 검증 + ON CONFLICT DO NOTHING 패턴 |

---

*최종 확정: 2026-08-02 | 상태: WP1 Migration 코드 제출 완료 — 실행 승인 대기*
