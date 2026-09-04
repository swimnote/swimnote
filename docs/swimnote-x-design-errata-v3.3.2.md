#SWIMNOTE  X — 설계 정정서 v3.3.2
> V3.3.1 대비 구현 차단 요소 9개 정정
> 코드 수정·Migration 실행·Commit·Push·OTA·배포·RevenueCat 상품 생성·샘플 데이터 생성은 승인 전 금지

---

## REPOSITORY_VERIFIED 선행 조사 결과
> 2026-08-02 기준 실제 codebase 확인

| 항목 | 확인 결과 |
|------|----------|
| `swimming_pools` xmode 컬럼 | ❌ 없음 — ALTER 필요 |
| `pool_subscriptions` xmode 컬럼 | ❌ 없음 — **FIX-B: swimming_pools에 저장** |
| `diary_templates.scope` | ✅ 존재. DEFAULT `'global'` = pool-level 공유 템플릿 (선생님 전체 공유). X모드용 cross-pool 전역은 별도 scope 값 필요 |
| `diary_templates.global_template_set_id` | ❌ 없음 — ALTER 필요 |
| `diary_templates.swimming_pool_id` | `NOT NULL` 제약 존재 — global 템플릿 저장 위해 DROP NOT NULL 필요 |
| `global_template_sets` | ❌ 테이블 없음 — 신규 생성 |
| `audit_logs` | ❌ 없음 (`class_diary_audit_logs`는 별도 테이블, 목적 다름) |
| `growth_events` | ❌ 없음 — 신규 |
| `growth_reports` | ❌ 없음 — 신규 |
| `parent_ai_daily_usage` | ❌ 없음 — 신규 |
| Drizzle transaction API | ✅ `db.transaction(async (tx) => { await tx.execute(sql\`...\`); })` — students.ts, diary.ts에서 확인 |
| Worker 인프라 | ✅ `package.json`: `"start:worker": "WORKER_MODE=true node dist/index.mjs"` |

---

## 차례

1. [FIX-A] global_template_sets ACTIVE 인덱스 수정
2. [FIX-B] X모드 컬럼 저장 테이블 확정 → `swimming_pools`
3. [FIX-C] Parent AI 사용량 테이블 및 단위 확정 → `parent_ai_daily_usage` + 일(日) 단위
4. [FIX-D] Global Hidden Template = `diary_templates` (curriculum_items 혼용 금지)
5. [FIX-E] Drizzle `db.transaction(tx)` 확정 — BEGIN/COMMIT 직접 호출 금지
6. [FIX-F] `global_template_sets` 컬럼 계약 정합
7. [FIX-G] `audit_logs` 실제 스키마·`writeAuditLog` 함수 확정
8. [FIX-H] match_token 재사용 공격 방지 + `MATCH_TOKEN_SECRET` 분리
9. [FIX-I] Teacher Diary AI Contract V1.3 — 기존 호환성 유지

---

## 1. 수정 ERD (신규 테이블 관계)

```
swimming_pools
  ├─ xmode_entitlement (boolean)
  ├─ xmode_config_status (enum)
  ├─ xmode_purchased_at
  └─ xmode_subscription_end_at

global_template_sets
  ├─ id, version_name, status, created_at, activated_at, archived_at
  └─ 1:N → diary_templates (global_template_set_id)

diary_templates (기존)
  ├─ swimming_pool_id (NULL 허용 — X모드 global용)
  ├─ scope: 'global' | 'teacher' | 'x_global'   ← x_global 신규
  └─ global_template_set_id (NULL허용, x_global일 때만)

parent_ai_daily_usage (신규)
  ├─ parent_account_id, usage_date (PK)
  ├─ reserved_count, completed_count, failed_count, intent_blocked_count
  └─ prompt_tokens, completion_tokens, estimated_cost_krw

audit_entity_versions (신규)
  └─ (entity_type, entity_id) PK → version bigint

audit_logs (신규)
  └─ entity_version FK → audit_entity_versions

growth_events (신규)
  ├─ match_token_id (UNIQUE — 재사용 방지)
  └─ growth_match_status (enum)

growth_reports (신규)
  └─ report_files FK
```

---

## 2. 실제 실행 가능한 Migration SQL (WP1 M-A ~ M-J)

> Migration Runner: `pool-db-init.ts`의 `db.execute(sql.raw(...)).catch(() => {})` 패턴
> DO $$ 블록·information_schema 패턴 사용. `ADD CONSTRAINT IF NOT EXISTS` 미사용.

### M-A: ENUM 타입 생성

```sql
-- 패턴 A: DO $$ + EXCEPTION WHEN duplicate_object
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

### M-B: swimming_pools X모드 컬럼 추가

```sql
-- FIX-B 확정: swimming_pools에 저장
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_entitlement        boolean                  NOT NULL DEFAULT false;
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_config_status       xmode_config_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_purchased_at        timestamptz;
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_subscription_end_at timestamptz;
ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS xmode_payment_failed_at   timestamptz;
```

### M-C: global_template_sets 신규 테이블

```sql
CREATE TABLE IF NOT EXISTS global_template_sets (
  id            text                       PRIMARY KEY DEFAULT ('gts_' || replace(gen_random_uuid()::text,'-','')),
  version_name  text                       NOT NULL,
  status        global_template_status_enum NOT NULL DEFAULT 'DRAFT',
  created_at    timestamptz                NOT NULL DEFAULT now(),
  activated_at  timestamptz,
  archived_at   timestamptz
);
```

### M-D: global_template_sets ACTIVE 유일성 인덱스

```sql
-- FIX-A 확정: (1) 표현식 인덱스 — pool_id 컬럼 없음
-- global set 전체에서 ACTIVE는 최대 1개
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
```

> `(1)` 표현식 인덱스: `status = 'ACTIVE'`인 모든 행이 색인값 `1`을 공유 → UNIQUE 위반으로 2번째 ACTIVE 삽입/갱신 차단. 표준 PostgreSQL 관용 패턴.

### M-E: diary_templates 글로벌 템플릿 컬럼 추가

```sql
-- swimming_pool_id: x_global 템플릿은 NULL 저장 → NOT NULL 제약 해제
ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id DROP NOT NULL;

-- x_global scope 식별 및 global_template_set FK
ALTER TABLE diary_templates ADD COLUMN IF NOT EXISTS global_template_set_id text;

-- 기존 scope 값 설명:
--   'global'   = pool-level 공유 (교사 전체 접근, swimming_pool_id 존재)
--   'teacher'  = 교사 개인 override
--   'x_global' = X모드 cross-pool 전역 (swimming_pool_id=NULL, global_template_set_id 필수)

-- 기존 데이터: 이미 있는 scope='global' 행은 swimming_pool_id가 있으므로 영향 없음

CREATE INDEX IF NOT EXISTS idx_diary_templates_xglobal
  ON diary_templates (global_template_set_id, is_active)
  WHERE scope = 'x_global';
```

### M-F: audit_entity_versions + next_audit_version 함수

```sql
CREATE TABLE IF NOT EXISTS audit_entity_versions (
  entity_type  text    NOT NULL,
  entity_id    text    NOT NULL,
  version      bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
);

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

### M-G: audit_logs 신규 테이블 (FIX-G 확정 스키마)

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id              text        PRIMARY KEY DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  entity_version  bigint      NOT NULL,
  action          text        NOT NULL,   -- 'create' | 'update' | 'delete'
  actor_type      text        NOT NULL,   -- 'super_admin' | 'pool_admin' | 'teacher' | 'system'
  actor_id        text        NOT NULL,
  pool_id         text,                   -- 'GLOBAL' for cross-pool actions
  before_data     jsonb,
  after_data      jsonb,
  reason          text,
  request_id      text,
  correlation_id  text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs (entity_type, entity_id, entity_version);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor      ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_pool       ON audit_logs (pool_id, created_at DESC) WHERE pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON audit_logs (correlation_id) WHERE correlation_id IS NOT NULL;
```

### M-H: parent_ai_daily_usage 신규 테이블 (FIX-C 확정)

```sql
-- FIX-C: 일(日) 단위, parent_account_id 키
CREATE TABLE IF NOT EXISTS parent_ai_daily_usage (
  id                    text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_account_id     text        NOT NULL,
  usage_date            date        NOT NULL,   -- Asia/Seoul 기준 날짜 (서버에서 변환)
  reserved_count        integer     NOT NULL DEFAULT 0,
  completed_count       integer     NOT NULL DEFAULT 0,
  failed_count          integer     NOT NULL DEFAULT 0,
  intent_blocked_count  integer     NOT NULL DEFAULT 0,
  prompt_tokens         integer     NOT NULL DEFAULT 0,
  completion_tokens     integer     NOT NULL DEFAULT 0,
  estimated_cost_krw    numeric(10,2) NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_account_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_parent_ai_usage_date
  ON parent_ai_daily_usage (parent_account_id, usage_date DESC);
```

### M-I: growth_events 신규 테이블

```sql
-- FIX-H: match_token_id UNIQUE로 재사용 방지
CREATE TABLE IF NOT EXISTS growth_events (
  id                     text                      PRIMARY KEY DEFAULT ('ge_' || replace(gen_random_uuid()::text,'-','')),
  student_id             text                      NOT NULL,
  swimming_pool_id       text                      NOT NULL,
  curriculum_item_id     text                      NOT NULL,
  curriculum_version_id  text                      NOT NULL,
  diary_note_id          text,
  growth_match_status    growth_match_status_enum  NOT NULL DEFAULT 'AUTO_ACCEPTED',
  confidence             numeric(4,3)              NOT NULL,
  match_token_id         text,                     -- FIX-H: one-time token JTI
  evidence_source_type   text,
  evidence_sentence_index integer,
  evidence_text          text,
  evidence_metadata      jsonb,
  evidence_validation    jsonb,
  reviewed_by            text,
  reviewed_at            timestamptz,
  request_id             text,
  created_at             timestamptz               NOT NULL DEFAULT now(),
  updated_at             timestamptz               NOT NULL DEFAULT now()
);

-- match_token_id UNIQUE (NULL 허용 — 기존 구버전 앱 호환)
CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_events_match_token_id
  ON growth_events (match_token_id)
  WHERE match_token_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_growth_events_student  ON growth_events (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_pool     ON growth_events (swimming_pool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_status   ON growth_events (growth_match_status) WHERE growth_match_status = 'PENDING_REVIEW';
```

### M-J: growth_reports 신규 테이블

```sql
CREATE TABLE IF NOT EXISTS growth_reports (
  id                     text        PRIMARY KEY DEFAULT ('gr_' || replace(gen_random_uuid()::text,'-','')),
  student_id             text        NOT NULL,
  swimming_pool_id       text        NOT NULL,
  report_type            text        NOT NULL DEFAULT 'monthly',
  period_start           date        NOT NULL,
  period_end             date        NOT NULL,
  generated_at           timestamptz NOT NULL DEFAULT now(),
  generated_by           text,
  ai_version             text,
  confidence_config_ver  text,
  schema_version         text,
  summary_text           text,
  file_url               text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_reports_student ON growth_reports (student_id, period_start DESC);
```

---

## 3. Match Token V2 계약 (FIX-H)

### 3-1. 페이로드 구조

```typescript
interface MatchTokenV2Payload {
  jti:                   string;   // UUID — one-time 사용 보장 (growth_events.match_token_id)
  request_id:            string;   // AI 요청 단위 — 저장 요청과 반드시 일치
  pool_id:               string;   // 저장 대상 pool 검증용
  student_ref:           string;   // HMAC-SHA256(student_id, MATCH_TOKEN_SECRET)
  curriculum_item_id:    string;
  curriculum_version_id: string;
  candidate_id:          string;   // 불투명 식별자 "cand_xxxxxx"
  confidence:            number;
  issued_at:             string;   // ISO8601
  expires_at:            string;   // ISO8601 (기본 issued_at + 24h)
  // hmac: string — 직렬화 후 서명 값 (페이로드 분리)
}
```

### 3-2. MATCH_TOKEN_SECRET 환경변수

```
환경변수명: MATCH_TOKEN_SECRET
- JWT_SECRET과 반드시 분리. fallback 금지.
- 미설정 시 서버 시작 실패 (엄격 모드) 또는 AI match 기능 비활성화
- Secret rotation 고려 시 향후 kid(key id) 필드 추가 검토 (현재 버전 미포함)
```

```typescript
// src/lib/match-token.ts
import { createHmac, timingSafeEqual } from 'crypto';

const MATCH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const HMAC_HEX_LENGTH    = 64; // SHA-256 hex 길이

function getSecret(): string {
  const s = process.env.MATCH_TOKEN_SECRET;
  if (!s) throw new Error('[match-token] MATCH_TOKEN_SECRET 미설정 — 서버 시작 불가');
  return s;
}

function stableStringify(obj: object): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

export function createMatchToken(
  payload: Omit<MatchTokenV2Payload, never>
): string {
  const { ...rest } = payload;
  const base   = stableStringify(rest);
  const hmac   = createHmac('sha256', getSecret()).update(base).digest('hex');
  return Buffer.from(JSON.stringify({ ...rest, hmac })).toString('base64url');
}

export function verifyMatchToken(
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

  // ① HMAC 길이 검사 — timingSafeEqual 전 필수
  if (typeof hmac !== 'string' || hmac.length !== HMAC_HEX_LENGTH) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // ② 서명 검증 (timing-safe)
  const expected = createHmac('sha256', getSecret()).update(stableStringify(rest)).digest('hex');
  if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // ③ 만료 검증
  if (new Date(raw.expires_at) < new Date()) {
    throw new AppError(400, 'MATCH_TOKEN_EXPIRED');
  }

  // ④ pool_id 검증 (앱 변조 탐지)
  if (raw.pool_id !== claimedPoolId) {
    throw new AppError(403, 'POOL_MISMATCH');
  }

  // ⑤ request_id 검증 (다른 AI 요청 토큰 재활용 방지)
  if (raw.request_id !== claimedRequestId) {
    throw new AppError(400, 'REQUEST_ID_MISMATCH');
  }

  // ⑥ student_ref 검증
  const expectedRef = createHmac('sha256', getSecret()).update(claimedStudentId).digest('hex');
  const actualRef   = raw.student_ref;
  if (typeof actualRef !== 'string' || actualRef.length !== HMAC_HEX_LENGTH) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }
  if (!timingSafeEqual(Buffer.from(actualRef, 'hex'), Buffer.from(expectedRef, 'hex'))) {
    throw new AppError(403, 'STUDENT_MISMATCH');
  }

  return raw as MatchTokenV2Payload;
}
```

### 3-3. 저장 시 one-time 검증 흐름

```
POST /diaries { request_id, student_diary_items: [{ student_id, match_tokens: ["eyJ..."] }] }
  ↓
verifyMatchToken(token, student_id, pool_id, request_id)
  → payload.jti, curriculum_item_id, confidence 신뢰
  ↓
DB: curriculum_items WHERE id=? AND pool_id=? AND version_id=?  (version drift 탐지)
  ↓
db.transaction(async (tx) => {
  // one-time 검증: jti 충돌 시 INSERT 실패 → 409
  INSERT INTO growth_events (..., match_token_id=payload.jti, ...)
  -- UNIQUE INDEX uq_growth_events_match_token_id 가 재사용 차단
  -- 동일 diary_note 재시도: 멱등 응답 (ON CONFLICT DO NOTHING RETURNING)
  -- 다른 diary에 재사용 시도: CONFLICT → 409 MATCH_TOKEN_ALREADY_USED
})
```

---

## 4. Parent AI Reservation 구조 (FIX-C 확정)

### 4-1. 한도 기준

```
사용 실효값 = completed_count + reserved_count
일일 한도 초과 = 사용 실효값 >= daily_question_limit
```

### 4-2. Intent Guard 처리 순서 (확정)

```
① 입력 길이·기본 권한 검증
② 일일 한도 reservation 확보 (reserveParentAiUsage)
   → 실패: 429 AI_USAGE_LIMIT_REACHED (reservation 없음 → rollback 불필요)
③ Intent Guard 실행 (수영 관련 여부 판단)
④ 비수영 질문이면:
     - reservation 반환 (releaseReservation)
     - intent_blocked_count 증가
     - 토큰/비용 기록 (intent guard 자체 토큰)
     → 403 NON_SWIMMING_INTENT
⑤ 정상 질문이면 본 AI 호출
⑥ 성공: reserved → completed (commitUsage)
⑦ 실패: reserved 반환 + failed_count 증가 (failUsage)
⑧ 토큰·비용은 차단·실패 여부와 무관하게 항상 기록
```

### 4-3. Atomic UPSERT 패턴 (일 단위)

```typescript
// src/lib/parent-ai-usage.ts

function getKSTDate(): string {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }); // 'YYYY-MM-DD'
}

// ① 예약 확보 — ON CONFLICT UPSERT + WHERE 조건으로 원자적 처리
async function reserveParentAiUsage(
  db:    Db,
  parentAccountId: string,
  dailyLimit:      number,
): Promise<{ usageDate: string }> {
  const usageDate = getKSTDate();

  const result = await db.execute(sql`
    INSERT INTO parent_ai_daily_usage
      (parent_account_id, usage_date, reserved_count, completed_count, failed_count, intent_blocked_count)
    VALUES
      (${parentAccountId}, ${usageDate}::date, 1, 0, 0, 0)
    ON CONFLICT (parent_account_id, usage_date)
    DO UPDATE SET
      reserved_count = CASE
        WHEN parent_ai_daily_usage.completed_count
           + parent_ai_daily_usage.reserved_count < ${dailyLimit}
        THEN parent_ai_daily_usage.reserved_count + 1
        ELSE parent_ai_daily_usage.reserved_count
      END,
      updated_at = NOW()
    WHERE parent_ai_daily_usage.completed_count
        + parent_ai_daily_usage.reserved_count < ${dailyLimit}
    RETURNING reserved_count, completed_count
  `);

  // 0 rows = 한도 초과 또는 INSERT도 WHERE에 걸림
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(429, 'AI_USAGE_LIMIT_REACHED');
  }
  return { usageDate };
}

// ② Intent 차단 — reservation 반환 + blocked 증가
async function blockIntentUsage(db: Db, parentAccountId: string, usageDate: string) {
  await db.execute(sql`
    UPDATE parent_ai_daily_usage SET
      reserved_count       = GREATEST(0, reserved_count - 1),
      intent_blocked_count = intent_blocked_count + 1,
      updated_at           = NOW()
    WHERE parent_account_id = ${parentAccountId}
      AND usage_date        = ${usageDate}::date
  `);
}

// ③ 성공 완료 — reserved → completed
async function commitUsage(
  db: Db, parentAccountId: string, usageDate: string,
  promptTokens: number, completionTokens: number, costKrw: number,
) {
  await db.execute(sql`
    UPDATE parent_ai_daily_usage SET
      reserved_count    = GREATEST(0, reserved_count - 1),
      completed_count   = completed_count + 1,
      prompt_tokens     = prompt_tokens + ${promptTokens},
      completion_tokens = completion_tokens + ${completionTokens},
      estimated_cost_krw = estimated_cost_krw + ${costKrw},
      updated_at        = NOW()
    WHERE parent_account_id = ${parentAccountId}
      AND usage_date        = ${usageDate}::date
  `);
}

// ④ 실패 완료 — reserved 반환 + failed 증가
async function failUsage(
  db: Db, parentAccountId: string, usageDate: string,
  promptTokens: number, completionTokens: number, costKrw: number,
) {
  await db.execute(sql`
    UPDATE parent_ai_daily_usage SET
      reserved_count     = GREATEST(0, reserved_count - 1),
      failed_count       = failed_count + 1,
      prompt_tokens      = prompt_tokens + ${promptTokens},
      completion_tokens  = completion_tokens + ${completionTokens},
      estimated_cost_krw = estimated_cost_krw + ${costKrw},
      updated_at         = NOW()
    WHERE parent_account_id = ${parentAccountId}
      AND usage_date        = ${usageDate}::date
  `);
}
```

### 4-4. 월간 사용량 조회 (별도 테이블 없음)

```sql
-- 월간 집계: usage_date의 연월로 SUM
SELECT
  SUM(completed_count)      AS monthly_completed,
  SUM(reserved_count)       AS current_reserved,
  SUM(intent_blocked_count) AS monthly_blocked,
  SUM(estimated_cost_krw)   AS monthly_cost_krw
FROM parent_ai_daily_usage
WHERE parent_account_id = $1
  AND DATE_TRUNC('month', usage_date) = DATE_TRUNC('month', $2::date);
```

---

## 5. Global Template Transaction — 실제 Drizzle 코드 (FIX-E + FIX-F + FIX-G)

> REPOSITORY_VERIFIED: Drizzle `db.transaction(async (tx) => { await tx.execute(sql\`...\`); })` 패턴 — students.ts L833, diary.ts L758에서 확인

```typescript
// src/lib/global-template-activation.ts

import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { writeAuditLog } from './audit-log';
import { genCorrelationId } from './request-utils';
import { AppError } from './errors';

export async function activateGlobalTemplateSet(
  templateSetId: string,
  actorId:       string,
  requestId:     string,
  ipHash?:       string,
): Promise<void> {

  await db.transaction(async (tx) => {
    // ① Advisory Transaction Lock — 동시 활성화 직렬화
    //    pg_try_advisory_xact_lock: Transaction 종료 시 자동 해제
    //    lock key: 하드코딩 정수 (환경 독립성 보장)
    const [lockRow] = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(20260802) AS locked
    `);
    if (!lockRow.locked) {
      throw new AppError(409, 'TEMPLATE_ACTIVATION_IN_PROGRESS');
    }

    // ② 대상 row 조회 + row lock (FIX-F 확정 컬럼 사용)
    const [target] = await tx.execute(sql`
      SELECT id, status, version_name
      FROM global_template_sets
      WHERE id = ${templateSetId}
      FOR UPDATE
    `);
    if (!target)                      throw new AppError(404, 'TEMPLATE_SET_NOT_FOUND');
    if (target.status === 'ACTIVE')   throw new AppError(409, 'ALREADY_ACTIVE');
    if (target.status === 'ARCHIVED') throw new AppError(409, 'CANNOT_ACTIVATE_ARCHIVED');

    // ③ 기존 ACTIVE → ARCHIVED
    const prevRows = await tx.execute(sql`
      UPDATE global_template_sets
      SET status      = 'ARCHIVED',
          archived_at = NOW()
      WHERE status = 'ACTIVE'
      RETURNING id, version_name
    `);

    // ④ 대상 DRAFT → ACTIVE (FIX-F: activated_at 사용, updated_at 없음)
    await tx.execute(sql`
      UPDATE global_template_sets
      SET status       = 'ACTIVE',
          activated_at = NOW(),
          archived_at  = NULL
      WHERE id = ${templateSetId}
    `);

    // ⑤ Audit Log — 동일 tx 전달 (FIX-G 확정 스키마)
    const correlationId = genCorrelationId();
    await writeAuditLog(tx, {
      entity_type:    'global_template_set',
      entity_id:      templateSetId,
      action:         'update',
      actor_type:     'super_admin',
      actor_id:       actorId,
      pool_id:        'GLOBAL',
      before_data:    { status: target.status, version_name: target.version_name },
      after_data:     { status: 'ACTIVE',
                        prev_active_id: prevRows[0]?.id ?? null },
      reason:         `activate template set ${templateSetId}`,
      request_id:     requestId,
      correlation_id: correlationId,
      ip_hash:        ipHash ?? null,
    });
    // tx COMMIT은 db.transaction callback 정상 종료 시 자동
  });
  // ROLLBACK: callback throw 시 자동. advisory lock도 자동 해제.
}
```

---

## 6. Audit Log 실제 스키마·함수 (FIX-G 확정)

```typescript
// src/lib/audit-log.ts

type AuditAction  = 'create' | 'update' | 'delete';
type AuditActorType = 'super_admin' | 'pool_admin' | 'teacher' | 'parent' | 'system';

interface WriteAuditLogOpts {
  entity_type:    string;
  entity_id:      string;
  action:         AuditAction;
  actor_type:     AuditActorType;
  actor_id:       string;
  pool_id:        string | null;   // 'GLOBAL' for cross-pool
  before_data?:   Record<string, unknown> | null;
  after_data?:    Record<string, unknown> | null;
  reason?:        string | null;
  request_id?:    string | null;
  correlation_id?: string | null;
  ip_hash?:       string | null;
}

/**
 * writeAuditLog
 * - 반드시 호출자의 Drizzle tx를 받아 동일 transaction에서 실행
 * - 내부에서 audit_entity_versions를 원자적으로 증가 (UPSERT)
 * - 내부에서 별도 connection/transaction 열지 않음
 */
export async function writeAuditLog(
  tx:   Parameters<Parameters<typeof db.transaction>[0]>[0],
  opts: WriteAuditLogOpts,
): Promise<void> {
  // ① entity_version 원자적 채번 (FIX-2: UPSERT RETURNING)
  const [vRow] = await tx.execute(sql`
    INSERT INTO audit_entity_versions (entity_type, entity_id, version)
    VALUES (${opts.entity_type}, ${opts.entity_id}, 1)
    ON CONFLICT (entity_type, entity_id)
    DO UPDATE SET version = audit_entity_versions.version + 1
    RETURNING version
  `);
  const entityVersion = vRow.version as number;

  // ② audit_logs INSERT (FIX-G 확정 컬럼명: actor_type, before_data, after_data)
  await tx.execute(sql`
    INSERT INTO audit_logs
      (entity_type, entity_id, entity_version, action,
       actor_type, actor_id, pool_id,
       before_data, after_data, reason,
       request_id, correlation_id, ip_hash,
       created_at)
    VALUES
      (${opts.entity_type}, ${opts.entity_id}, ${entityVersion}, ${opts.action},
       ${opts.actor_type}, ${opts.actor_id}, ${opts.pool_id ?? null},
       ${opts.before_data ? JSON.stringify(opts.before_data) : null},
       ${opts.after_data  ? JSON.stringify(opts.after_data)  : null},
       ${opts.reason       ?? null},
       ${opts.request_id   ?? null},
       ${opts.correlation_id ?? null},
       ${opts.ip_hash      ?? null},
       NOW())
  `);
}
```

---

## 7. Template와 Curriculum 분리 Phase (FIX-D)

### 7-1. 명확한 역할 분리

| 테이블 | 용도 | scope 값 |
|--------|------|----------|
| `diary_templates` scope=`'global'` | 수영장 내 교사 공유 템플릿 (기존) | pool-level |
| `diary_templates` scope=`'teacher'` | 교사 개인 override (기존) | pool-level |
| **`diary_templates` scope=`'x_global'`** | X모드 AI 일지용 전역 템플릿 **(신규)** | cross-pool |
| `curriculum_items` | 수영장 전용 교육과정 — 성장판·학부모 AI 검색용 | pool-level |

**X모드 global template ≠ curriculum_items. 절대 혼용 금지.**

### 7-2. x_global 템플릿 저장 구조

```sql
-- x_global 템플릿 특징
swimming_pool_id    = NULL               -- NOT NULL 제약 해제 (M-E)
scope               = 'x_global'
global_template_set_id = '<gts_xxx>'    -- global_template_sets FK
is_active           = true
created_by          = '<super_admin_id>'
```

### 7-3. WP4-B: 파일럿 50개 생성 구조 (FIX-D 수정)

```sql
-- WP4-B에서 생성할 객체
-- Step 1: DRAFT global_template_set 생성
INSERT INTO global_template_sets (version_name, status)
VALUES ('pilot_v1', 'DRAFT');

-- Step 2: diary_templates 50개 (x_global scope)
INSERT INTO diary_templates
  (swimming_pool_id, scope, global_template_set_id, category, level, template_text, created_by, is_active)
VALUES
  (NULL, 'x_global', '<gts_id>', 'freestyle', 'beginner', '...', '<super_admin_id>', true),
  ... (50개);
```

### 7-4. WP5: Global Search 분기 로직 (FIX-D 수정)

```typescript
// diary-template-search.ts 확장
async function searchDiaryTemplates(poolId: string, meaning: string) {
  // 1차: 해당 수영장 pool-level 템플릿 검색
  const poolResults = await searchPoolTemplates(poolId, meaning);
  if (poolResults.length >= MIN_CANDIDATES) return poolResults;

  // 2차: ACTIVE global_template_set의 x_global 템플릿 검색
  const globalSet = await db.execute(sql`
    SELECT id FROM global_template_sets WHERE status = 'ACTIVE' LIMIT 1
  `);
  if (!globalSet.rows[0]) return poolResults;

  const globalResults = await searchXGlobalTemplates(globalSet.rows[0].id, meaning);
  return [...poolResults, ...globalResults];
}

// x_global 검색 — curriculum_items 조회 안 함
async function searchXGlobalTemplates(globalSetId: string, meaning: string) {
  return db.execute(sql`
    SELECT id, template_text, category, level
    FROM diary_templates
    WHERE scope = 'x_global'
      AND global_template_set_id = ${globalSetId}
      AND is_active = true
    -- 의미 유사도 필터: 기존 searchTemplates 벡터 로직 적용
    LIMIT 10
  `);
}
```

### 7-5. WP15: 2,000개 확대 (FIX-D 수정)

```
WP6-B 품질 검증 통과 조건 충족 후:
1. 신규 global_template_set INSERT (DRAFT)
2. diary_templates 2,000개 x_global scope로 생성
3. activateGlobalTemplateSet() 호출 — 기존 pilot ACTIVE → ARCHIVED, 신규 → ACTIVE
4. curriculum_items에는 아무것도 넣지 않음
```

---

## 8. 기존 AI Contract 호환성 (FIX-I) — Contract V1.3

### 8-1. 최종 Contract V1.3 전체 구조

```typescript
// POST /api/v1/teacher-diary/generate 응답
interface TeacherDiaryAIResponseV1_3 {
  contract_version:    "1.3";
  schema_version:      "curriculum_match_schema_v1";
  request_id:          string;
  engine_version:      string;    // 'grounded_v1' (기존 상수)
  prompt_version:      string;
  knowledge_version:   string | null;
  template_set_version: string | null;
  feature:             "teacher_diary";

  result: {
    common: string;               // ← 기존 필드 유지
    students: Array<{
      student_ref: string;        // ← 기존 필드 유지 (student_id 아님)
      content:     string;        // ← 기존 필드 유지
      curriculum_matches?: Array<{  // ← 신규, optional
        match_token:          string;  // HMAC-signed V2 token
        display_label:        string;
        concept_tags:         string[];
        growth_match_status:  'AUTO_ACCEPTED' | 'PENDING_REVIEW';
      }>;
    }>;
  };

  meta: {
    generation_mode:       'TEMPLATE_ASSISTED' | 'INPUT_ONLY' | 'POLISH_ONLY';
    parser_confidence:     number;
    template_used:         boolean;
    candidate_count:       number;
    selected_candidate_count: number;
    grounding_validation:  'pass' | 'fail' | 'skipped';
  };
}
```

### 8-2. 하위 호환성 규칙

| 상황 | 처리 |
|------|------|
| 앱이 `curriculum_matches` 없이 저장 요청 | `growth_events` 생성 안 함. 기존 diary 저장만 처리 |
| 구버전 앱 (V1.2 이하) | `result.common`, `result.students[].content` 그대로 사용 가능 |
| `curriculum_matches` 포함 저장 요청 | `match_token` 검증 → `growth_events` INSERT |
| `match_token` 없이 `curriculum_item_id` 직접 전달 | **거부** — 400 MATCH_TOKEN_REQUIRED |

### 8-3. 앱 측 처리 원칙

```
앱은 match_token을 불투명 string으로만 취급.
저장 시 받은 그대로 서버에 전달.
match_token 내부 파싱·수정 금지.
curriculum_item_id, confidence 직접 생성 금지.
```

---

## 9. 테스트 명세

### 9-1. ACTIVE 유일성 동시성 테스트

```typescript
describe('global_template_sets 동시 활성화', () => {
  test('두 개 동시 요청 — 하나만 200, 하나는 409', async () => {
    const [r1, r2] = await Promise.all([
      request.patch(`/admin/global-template-sets/${setA}/activate`),
      request.patch(`/admin/global-template-sets/${setB}/activate`),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const [{ count }] = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM global_template_sets WHERE status = 'ACTIVE'
    `);
    expect(count).toBe(1);
  });

  test('ACTIVE 인덱스 직접 INSERT 차단', async () => {
    await expect(db.execute(sql`
      UPDATE global_template_sets SET status = 'ACTIVE' WHERE id = ${setB}
    `)).rejects.toThrow(); // unique violation
  });
});
```

### 9-2. match_token 재사용 방지 테스트

```typescript
describe('match_token one-time use', () => {
  test('동일 token → 동일 diary: 멱등 응답', async () => {
    const r1 = await saveDiaryWithToken(token, diaryId);
    const r2 = await saveDiaryWithToken(token, diaryId);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200); // 멱등
  });

  test('동일 token → 다른 diary: 409', async () => {
    await saveDiaryWithToken(token, diaryId1);
    const r2 = await saveDiaryWithToken(token, diaryId2);
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('MATCH_TOKEN_ALREADY_USED');
  });

  test('변조된 confidence → 서명 실패 → 400', async () => {
    const tampered = tamperTokenField(token, 'confidence', 0.99);
    const r = await saveDiaryWithToken(tampered, diaryId);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_MATCH_TOKEN');
  });

  test('만료 token → 400', async () => {
    const expired = createExpiredToken(payload);
    const r = await saveDiaryWithToken(expired, diaryId);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MATCH_TOKEN_EXPIRED');
  });
});
```

### 9-3. Parent AI 한도 동시성 테스트

```typescript
describe('parent_ai_daily_usage 동시 한도', () => {
  test('한도 2, 동시 요청 5 → 정확히 2개만 통과', async () => {
    const results = await Promise.all(
      Array(5).fill(null).map(() => callParentAI(parentId, date, limit=2))
    );
    const passed = results.filter(r => r.status !== 429).length;
    expect(passed).toBe(2);
  });
});
```

### 9-4. Audit entity_version 동시성 테스트

```typescript
describe('audit_entity_versions atomic increment', () => {
  test('동시 10개 increment → 중복 version 없음', async () => {
    const results = await Promise.all(
      Array(10).fill(null).map(() =>
        db.execute(sql`
          INSERT INTO audit_entity_versions (entity_type, entity_id, version)
          VALUES ('test', 'e1', 1)
          ON CONFLICT (entity_type, entity_id)
          DO UPDATE SET version = audit_entity_versions.version + 1
          RETURNING version
        `)
      )
    );
    const versions = results.map(r => r.rows[0].version);
    const unique   = new Set(versions);
    expect(unique.size).toBe(10); // 1~10 중복 없음
  });
});
```

---

## 10. Rollback 계획

| 단계 | Rollback 방법 |
|------|--------------|
| M-A ENUM 생성 | `DROP TYPE IF EXISTS ... CASCADE` — 연결 테이블 없으면 안전 |
| M-B swimming_pools 컬럼 | `ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_*` |
| M-C global_template_sets | `DROP TABLE IF EXISTS global_template_sets` |
| M-D 인덱스 | `DROP INDEX IF EXISTS uniq_global_template_sets_one_active` |
| M-E diary_templates 변경 | `ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id SET NOT NULL` (기존 NULL 행 없으면 가능) |
| M-F audit 테이블 | `DROP TABLE IF EXISTS audit_entity_versions`, `DROP FUNCTION IF EXISTS next_audit_version` |
| M-G audit_logs | `DROP TABLE IF EXISTS audit_logs` |
| M-H parent_ai_daily_usage | `DROP TABLE IF EXISTS parent_ai_daily_usage` |
| M-I growth_events | `DROP TABLE IF EXISTS growth_events` |
| M-J growth_reports | `DROP TABLE IF EXISTS growth_reports` |

**Rollback 전제 조건:**
- 프로덕션 실행 전 반드시 pg_dump 스냅샷
- M-E diary_templates DROP NOT NULL rollback은 x_global 행이 0개일 때만 가능
- global_template_sets Rollback 전 diary_templates.global_template_set_id 외래키 의존성 확인

---

## 11. 남은 NEEDS_VERIFICATION

| ID | 항목 | 현황 |
|----|------|------|
| NV-1 | RevenueCat webhook transaction_id 정확한 필드명 | 미확인 |
| NV-2 | RevenueCat consumable 상품 webhook 이벤트 타입 | 미확인 |
| NV-3 | Render.com starter plan Worker 추가 과금 | 미확인 |
| NV-4 | AUTO_ACCEPTED 항목 일반 teacher 변경 가능 여부 | 정책 미결 |
| NV-5 | PENDING_REVIEW 48시간 미응답 자동 DISCARDED | 파일럿 후 확정 |
| NV-6 | WP6-B 품질 검증 기준값 | 파일럿 후 확정 |
| NV-10 | advisory lock key 하드코딩 정수 `20260802` | ✅ V3.3.2에서 환경 독립 정수로 확정 |
| NV-11 | `parent_ai_daily_usage` 신규/기존 여부 | ✅ 신규 확인 — M-H에서 CREATE |
| NV-12 | WP6-B 품질 기준 초안 | 파일럿 후 확정 |
| **NV-13** | `diary_templates.swimming_pool_id DROP NOT NULL` — 기존 조회 쿼리 `WHERE swimming_pool_id = ?` 전체 영향 범위 | **WP4-A 전 확인 필수** |
| **NV-14** | `diary_templates` x_global scope 검색 시 벡터/의미 유사도 기존 `searchTemplates` 함수 재사용 가능 여부 | **WP5 전 확인 필수** |

> **NV-13 중요:** `swimming_pool_id NOT NULL → nullable` 변경 시 기존 `diary.ts` L1413, L1414, L1417 등 `WHERE swimming_pool_id = ${poolId}` 필터가 x_global 행을 자동 제외하므로 기존 pool-level 기능은 영향 없음. 단, NULL 허용 후 `IS NULL` 조건 없는 INSERT 실수 방지 위해 `scope = 'x_global'` 행에 DB-level CHECK 추가 검토.

---

## 변경 요약 (V3.3.1 → V3.3.2)

| ID | 항목 | V3.3.1 | V3.3.2 |
|----|------|--------|--------|
| FIX-A | global_template_sets ACTIVE 인덱스 | `ON (pool_id) WHERE ACTIVE` (pool_id 없음 — 오류) | `ON ((1)) WHERE status='ACTIVE'` |
| FIX-B | X모드 컬럼 위치 | `pool_subscriptions` (V3.3.1 오기) | `swimming_pools` (기존 확정안 복원) |
| FIX-C | Parent AI 사용량 | `ai_daily_usage`, usage_month, 월간 | `parent_ai_daily_usage`, usage_date, 일간 |
| FIX-D | Global Template 저장 위치 | curriculum_items (혼용 오류) | `diary_templates` scope=`x_global` |
| FIX-E | Transaction API | `db.execute(BEGIN/COMMIT)` | `db.transaction(async (tx) => {...})` |
| FIX-F | `global_template_sets` 컬럼 | `version`, `updated_at` (없는 컬럼) | `version_name`, `activated_at`, `archived_at` |
| FIX-G | `writeAuditLog` 파라미터 | `actor_role`, `diff` (스키마 불일치) | `actor_type`, `before_data`, `after_data` |
| FIX-H | match_token 재사용 방지 | 미설계 | `jti` + `growth_events.match_token_id UNIQUE` + `MATCH_TOKEN_SECRET` |
| FIX-I | AI Contract | student_id 노출, 필드 누락 | V1.3: `student_ref` 유지, `meta` 블록, curriculum_matches optional |

---
*최종 작성: 2026-08-02 | 상태: 승인 대기 | 다음 단계: WP1 승인 후 pool-db-init.ts에 M-A~M-J 추가*
