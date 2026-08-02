# SWIMNOTE X — 설계 정정서 v3.3.3
> V3.3.2 대비 8개 + growth_reports 스키마 복원 정정
> 코드 수정·Migration 실행·Commit·Push·OTA·배포는 금지 (승인 전)

---

## REPOSITORY_VERIFIED 선행 조사

| 항목 | 확인 결과 |
|------|----------|
| `diary_templates.scope` 타입 | `text NOT NULL DEFAULT 'global'` — ENUM·CHECK 없음 (옵션 C) |
| scope 기존 허용값 | `'global'`, `'teacher'` — 코드 및 쿼리에서 사용 중 |
| scope CHECK 제약 | ❌ 없음 — 신규 CHECK가 Migration에서 추가되어야 함 |

---

## 차례

1. `diary_templates.scope` x_global 추가 SQL + 정합성 CHECK
2. `global_template_set_id` FK + `version_name` UNIQUE
3. ARCHIVED 재활성화 가능한 Transaction 코드
4. 완성된 `growth_events` DDL
5. `MatchTokenV2` 최종 Payload
6. token 충돌 시 동일 diary / 다른 diary 구분 로직
7. `parent_ai_usage_reservations` DDL + 상태 전이
8. 수정 `audit_logs` DDL
9. 완성된 `growth_reports` DDL
10. WP1 실제 Migration 실행 순서
11. Rollback 순서
12. 테스트

---

## 1. `diary_templates.scope` x_global 추가 + 정합성 CHECK

### 1-1. scope 타입 확인 결과

```
REPOSITORY_VERIFIED: diary_templates.scope = text NOT NULL DEFAULT 'global'
CHECK 제약 없음 → 옵션 C: 별도 타입 변경 없이 x_global 사용 가능
단, DB 정합성을 위해 CHECK 제약 신규 추가 필요
```

### 1-2. x_global 정합성 CHECK Migration SQL

```sql
-- ① swimming_pool_id NOT NULL 해제 (x_global 행은 NULL)
ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id DROP NOT NULL;

-- ② global_template_set_id 컬럼 추가 (아직 없으면)
ALTER TABLE diary_templates ADD COLUMN IF NOT EXISTS global_template_set_id text;

-- ③ scope 정합성 CHECK 추가 (DO $$ + pg_constraint 패턴)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_diary_templates_scope_integrity'
      AND conrelid = 'diary_templates'::regclass
  ) THEN
    ALTER TABLE diary_templates ADD CONSTRAINT chk_diary_templates_scope_integrity
    CHECK (
      (scope = 'x_global'
        AND swimming_pool_id IS NULL
        AND global_template_set_id IS NOT NULL)
      OR
      (scope IN ('global', 'teacher')
        AND swimming_pool_id IS NOT NULL
        AND global_template_set_id IS NULL)
    );
  END IF;
END $$;
```

> **주의:** CHECK 추가 전 기존 `global_template_set_id IS NULL` 행이 모두 `scope IN ('global','teacher')`이고 `swimming_pool_id IS NOT NULL`인지 검증 필요. 기존 데이터가 CHECK에 위반하지 않음은 `scope` 신규 컬럼 기본값 `'global'`과 `swimming_pool_id NOT NULL` 기존 제약으로 보장됨.

---

## 2. `global_template_set_id` FK + `version_name` UNIQUE

```sql
-- ① version_name UNIQUE (IF NOT EXISTS 사용 가능)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_global_template_sets_version_name
  ON global_template_sets (version_name);

-- ② global_template_set_id FK (DO $$ + pg_constraint 패턴)
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
  END IF;
END $$;
```

> `ON DELETE RESTRICT`: global_template_set에 연결된 diary_templates가 있으면 세트 삭제 차단. ARCHIVED 세트도 롤백 재활성화 경로가 있으므로 RESTRICT가 적합.

---

## 3. ARCHIVED 재활성화 가능한 Transaction 코드

V3.3.2의 `CANNOT_ACTIVATE_ARCHIVED` 조건을 제거하고, ARCHIVED → ACTIVE 롤백을 허용.

```typescript
// src/lib/global-template-activation.ts (수정)

export async function activateGlobalTemplateSet(
  templateSetId: string,
  actorId:       string,
  requestId:     string,
  ipHash?:       string,
): Promise<void> {

  await db.transaction(async (tx) => {
    // ① Advisory Transaction Lock (하드코딩 정수 — 환경 독립)
    const [lockRow] = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(20260802) AS locked
    `);
    if (!lockRow.locked) {
      throw new AppError(409, 'TEMPLATE_ACTIVATION_IN_PROGRESS');
    }

    // ② 대상 row 조회 + row lock (FIX-F 컬럼 사용)
    const [target] = await tx.execute(sql`
      SELECT id, status, version_name
      FROM global_template_sets
      WHERE id = ${templateSetId}
      FOR UPDATE
    `);
    if (!target) throw new AppError(404, 'TEMPLATE_SET_NOT_FOUND');

    // ③ 정책 확정 (수정):
    //    DRAFT  → ACTIVE: 가능
    //    ARCHIVED → ACTIVE: 가능 (롤백 경로)
    //    ACTIVE → 요청: ALREADY_ACTIVE
    //    그 외 status: 거부
    if (target.status === 'ACTIVE') {
      throw new AppError(409, 'ALREADY_ACTIVE');
    }
    if (target.status !== 'DRAFT' && target.status !== 'ARCHIVED') {
      throw new AppError(400, 'INVALID_TEMPLATE_SET_STATUS');
    }

    // ④ 기존 ACTIVE → ARCHIVED
    const prevRows = await tx.execute(sql`
      UPDATE global_template_sets
      SET status      = 'ARCHIVED',
          archived_at = NOW()
      WHERE status = 'ACTIVE'
      RETURNING id, version_name
    `);

    // ⑤ 대상 → ACTIVE (archived_at은 NULL로 복원)
    await tx.execute(sql`
      UPDATE global_template_sets
      SET status       = 'ACTIVE',
          activated_at = NOW(),
          archived_at  = NULL
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
        prev_active_id:   prevRows[0]?.id ?? null,
        prev_active_name: prevRows[0]?.version_name ?? null,
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

---

## 4. 완성된 `growth_events` DDL

```sql
-- growth_match_status ENUM은 M-A에서 생성됨
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
  -- one-time token JTI (재사용 방지)
  match_token_id              text,

  -- AI 매칭 상태 (서버 산출 — 앱 전달값 신뢰 안 함)
  growth_match_status         growth_match_status_enum NOT NULL DEFAULT 'AUTO_ACCEPTED',

  -- 신뢰도·버전
  confidence                  numeric(4,3) NOT NULL,
  matching_algorithm_version  text,
  confidence_config_version   text,
  engine_version              text,
  prompt_version              text,
  knowledge_version           text,
  template_set_version        text,
  contract_version            text,

  -- 증거
  evidence_source_type        text,
  evidence_sentence_index     integer,
  evidence_text               text,
  evidence_metadata           jsonb,
  evidence_validation         text,      -- 'PASS'|'FAIL'|'SKIPPED'|NULL

  -- 검토
  reviewed_by                 text,
  reviewed_at                 timestamptz,
  review_reason               text,

  -- 무효화 (일지 삭제 시 DELETE 아닌 플래그)
  is_invalidated              boolean     NOT NULL DEFAULT false,
  invalidated_at              timestamptz,

  -- 추적
  request_id                  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- ── CHECK 제약 ──────────────────────────────────────────────────────────
  CONSTRAINT chk_ge_confidence
    CHECK (confidence >= 0 AND confidence <= 1),

  CONSTRAINT chk_ge_evidence_sentence_index
    CHECK (evidence_sentence_index IS NULL OR evidence_sentence_index >= 0),

  CONSTRAINT chk_ge_evidence_text_len
    CHECK (evidence_text IS NULL OR length(evidence_text) <= 300),

  CONSTRAINT chk_ge_evidence_validation
    CHECK (evidence_validation IS NULL
           OR evidence_validation IN ('PASS','FAIL','SKIPPED')),

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

-- 중복 저장 방지 (동일 일지·학생·커리큘럼·출처의 유효 이벤트)
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

### 성장판 집계 조건

```sql
-- 성장판에 집계되는 이벤트
WHERE growth_match_status IN ('AUTO_ACCEPTED', 'TEACHER_ACCEPTED')
  AND is_invalidated = false
```

### 일지 삭제 시 처리

```sql
-- 일지 삭제 → growth_events 삭제하지 않고 무효화
UPDATE growth_events
SET is_invalidated = true,
    invalidated_at = NOW(),
    updated_at     = NOW()
WHERE diary_note_id = $1
  AND is_invalidated = false;
```

---

## 5. `MatchTokenV2` 최종 Payload

```typescript
interface MatchTokenV2Payload {
  jti:                          string;   // UUID — one-time 사용 (growth_events.match_token_id)
  request_id:                   string;   // AI 요청 단위 (저장 요청과 반드시 일치)
  pool_id:                      string;   // 저장 대상 pool 검증
  student_ref:                  string;   // HMAC-SHA256(student_id, MATCH_TOKEN_SECRET)
  curriculum_item_id:           string;
  curriculum_version_id:        string;
  candidate_id:                 string;   // 불투명 식별자 "cand_xxxxxx"
  confidence:                   number;   // 서버 계산 — 앱 변조 불가
  confidence_config_version:    string;   // 저장 시 서버가 이 버전 재로드하여 status 재산출
  matching_algorithm_version:   string;   // 알고리즘 버전 추적
  issued_at:                    string;   // ISO8601
  expires_at:                   string;   // ISO8601 (기본 issued_at + 24h)
  // hmac: string — stableStringify(payload_without_hmac) 서명 (전달 시 포함)
}
```

### growth_match_status 서버 재산출 규칙

```typescript
// 저장 시 status 결정 — 앱이 보낸 status 무시
async function resolveGrowthMatchStatus(
  signedConfidence:           number,
  signedConfigVersion:        string,
): Promise<growth_match_status_enum> {

  // confidence_config_version으로 설정 로드
  const config = await loadConfidenceConfig(signedConfigVersion);
  if (!config) {
    // 설정 버전이 더 이상 없음 → 안전한 PENDING_REVIEW 처리
    // (DISCARDED 아닌 이유: 교사가 수동 확인하도록 보존)
    return 'PENDING_REVIEW';
  }

  if (signedConfidence >= config.autoAcceptThreshold) return 'AUTO_ACCEPTED';
  if (signedConfidence >= config.pendingReviewThreshold) return 'PENDING_REVIEW';
  return 'DISCARDED';
}
```

> **앱이 전달한 `growth_match_status`는 UI 표시용으로만 사용. DB 저장 상태는 위 서버 재산출 결과만 사용.**

---

## 6. Token 충돌 시 동일 diary / 다른 diary 구분 로직

`ON CONFLICT DO NOTHING`만으로는 A(멱등)와 B(재사용 시도)를 구분 불가 → INSERT 결과로 분기.

```typescript
// src/lib/growth-event-store.ts

interface SaveGrowthEventOpts {
  tx:                   DrizzleTx;
  tokenPayload:         MatchTokenV2Payload;  // 검증 완료된 페이로드
  diaryNoteId:          string;
  studentId:            string;
  growthMatchStatus:    growth_match_status_enum;  // 서버 재산출값
  // ... 나머지 컬럼
}

async function saveGrowthEvent(opts: SaveGrowthEventOpts): Promise<{ event_id: string; idempotent: boolean }> {
  const { tx, tokenPayload, diaryNoteId, studentId, growthMatchStatus } = opts;

  // ① INSERT 시도 — match_token_id UNIQUE 충돌 감지
  const insertResult = await tx.execute(sql`
    INSERT INTO growth_events (
      id, student_id, swimming_pool_id, curriculum_item_id,
      curriculum_version_id, diary_note_id, source,
      match_token_id, growth_match_status, confidence,
      confidence_config_version, matching_algorithm_version,
      request_id, created_at, updated_at
    ) VALUES (
      ${'ge_' + randomHex()}, ${studentId}, ${opts.poolId},
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

  if (insertResult.rowCount === 1) {
    // 정상 신규 저장
    return { event_id: insertResult.rows[0].id, idempotent: false };
  }

  // ② CONFLICT 발생 → 기존 행 조회
  const [existing] = await tx.execute(sql`
    SELECT id, diary_note_id
    FROM growth_events
    WHERE match_token_id = ${tokenPayload.jti}
    LIMIT 1
  `);

  if (!existing) {
    // 이론상 불가 — 방어 코드
    throw new AppError(500, 'GROWTH_EVENT_CONFLICT_UNRESOLVABLE');
  }

  // ③ 동일 diary_note 재시도 → 멱등 응답
  if (existing.diary_note_id === diaryNoteId) {
    return { event_id: existing.id, idempotent: true };
  }

  // ④ 다른 diary_note 재사용 시도 → 409
  throw new AppError(409, 'MATCH_TOKEN_ALREADY_USED');
}
```

---

## 7. `parent_ai_usage_reservations` DDL + 상태 전이

### 7-1. DDL

```sql
CREATE TABLE IF NOT EXISTS parent_ai_usage_reservations (
  request_id          text        PRIMARY KEY,
  parent_account_id   text        NOT NULL,
  usage_date          date        NOT NULL,   -- Asia/Seoul 기준
  status              text        NOT NULL DEFAULT 'RESERVED',
  reserved_at         timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  prompt_tokens       integer     NOT NULL DEFAULT 0,
  completion_tokens   integer     NOT NULL DEFAULT 0,
  estimated_cost_krw  numeric(10,2) NOT NULL DEFAULT 0,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now(),

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

### 7-2. 상태 전이 다이어그램

```
                     ┌─────────────────────────────────────────────────┐
request_id 신규      │                                                 │
     ↓               │  RESERVED ──────→ COMPLETED  (성공)            │
INSERT → RESERVED    │     │     ──────→ FAILED     (AI 오류)         │
동일 request_id      │     │     ──────→ BLOCKED    (Intent 차단)     │
재시도 → 기존 상태 반환   │     └──────→ EXPIRED     (Worker — 장애 복구) │
                     └─────────────────────────────────────────────────┘
```

### 7-3. 처리 함수 (상태 전이 + 집계 업데이트를 동일 tx에서)

```typescript
// src/lib/parent-ai-usage.ts

// ① 예약 생성 (request_id PRIMARY KEY로 중복 차단)
async function reserveParentAi(
  db:               Db,
  requestId:        string,
  parentAccountId:  string,
  dailyLimit:       number,
): Promise<{ usageDate: string; alreadyReserved: boolean }> {
  const usageDate = getKSTDate();

  // 동일 request_id 재시도: 기존 예약 반환
  const [existing] = await db.execute(sql`
    SELECT status, usage_date FROM parent_ai_usage_reservations
    WHERE request_id = ${requestId}
  `);
  if (existing) {
    return { usageDate: existing.usage_date, alreadyReserved: true };
  }

  // 한도 검사 + 예약 INSERT를 tx 안에서 원자적으로
  await db.transaction(async (tx) => {
    // 현재 사용 실효값 조회 (FOR UPDATE로 집계 행 잠금)
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

    if (current >= dailyLimit) throw new AppError(429, 'AI_USAGE_LIMIT_REACHED');

    // 예약 행 INSERT
    await tx.execute(sql`
      INSERT INTO parent_ai_usage_reservations
        (request_id, parent_account_id, usage_date, status)
      VALUES
        (${requestId}, ${parentAccountId}, ${usageDate}::date, 'RESERVED')
    `);

    // 집계 reserved_count +1
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
  });

  return { usageDate, alreadyReserved: false };
}

// ② 성공 완료
async function completeParentAi(
  db:               Db,
  requestId:        string,
  parentAccountId:  string,
  usageDate:        string,
  tokens:           { prompt: number; completion: number; costKrw: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status       = 'COMPLETED',
          completed_at = NOW(),
          prompt_tokens      = ${tokens.prompt},
          completion_tokens  = ${tokens.completion},
          estimated_cost_krw = ${tokens.costKrw}
      WHERE request_id = ${requestId} AND status = 'RESERVED'
    `);
    await tx.execute(sql`
      UPDATE parent_ai_daily_usage SET
        reserved_count     = GREATEST(0, reserved_count - 1),
        completed_count    = completed_count + 1,
        prompt_tokens      = prompt_tokens + ${tokens.prompt},
        completion_tokens  = completion_tokens + ${tokens.completion},
        estimated_cost_krw = estimated_cost_krw + ${tokens.costKrw},
        updated_at         = NOW()
      WHERE parent_account_id = ${parentAccountId}
        AND usage_date = ${usageDate}::date
    `);
  });
}

// ③ 실패 완료
async function failParentAi(
  db:              Db,
  requestId:       string,
  parentAccountId: string,
  usageDate:       string,
  errorCode:       string,
  tokens:          { prompt: number; completion: number; costKrw: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status       = 'FAILED',
          completed_at = NOW(),
          error_code   = ${errorCode},
          prompt_tokens      = ${tokens.prompt},
          completion_tokens  = ${tokens.completion},
          estimated_cost_krw = ${tokens.costKrw}
      WHERE request_id = ${requestId} AND status = 'RESERVED'
    `);
    await tx.execute(sql`
      UPDATE parent_ai_daily_usage SET
        reserved_count     = GREATEST(0, reserved_count - 1),
        failed_count       = failed_count + 1,
        prompt_tokens      = prompt_tokens + ${tokens.prompt},
        completion_tokens  = completion_tokens + ${tokens.completion},
        estimated_cost_krw = estimated_cost_krw + ${tokens.costKrw},
        updated_at         = NOW()
      WHERE parent_account_id = ${parentAccountId}
        AND usage_date = ${usageDate}::date
    `);
  });
}

// ④ Intent 차단
async function blockParentAiIntent(
  db:              Db,
  requestId:       string,
  parentAccountId: string,
  usageDate:       string,
  tokens:          { prompt: number; completion: number; costKrw: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status       = 'BLOCKED',
          completed_at = NOW(),
          prompt_tokens      = ${tokens.prompt},
          completion_tokens  = ${tokens.completion},
          estimated_cost_krw = ${tokens.costKrw}
      WHERE request_id = ${requestId} AND status = 'RESERVED'
    `);
    await tx.execute(sql`
      UPDATE parent_ai_daily_usage SET
        reserved_count       = GREATEST(0, reserved_count - 1),
        intent_blocked_count = intent_blocked_count + 1,
        prompt_tokens        = prompt_tokens + ${tokens.prompt},
        completion_tokens    = completion_tokens + ${tokens.completion},
        estimated_cost_krw   = estimated_cost_krw + ${tokens.costKrw},
        updated_at           = NOW()
      WHERE parent_account_id = ${parentAccountId}
        AND usage_date = ${usageDate}::date
    `);
  });
}
```

### 7-4. Worker: EXPIRED 장애 복구

```typescript
// 매 5분 실행 — RESERVED 상태이고 expires_at 초과 행 정리
async function expireStaleReservations(db: Db): Promise<void> {
  const stale = await db.execute(sql`
    UPDATE parent_ai_usage_reservations
    SET status = 'EXPIRED', completed_at = NOW()
    WHERE status = 'RESERVED'
      AND expires_at < NOW()
    RETURNING parent_account_id, usage_date
  `);

  // 집계 복구 — 각 (parent_account_id, usage_date) 그룹별
  const groups = groupBy(stale.rows, r => `${r.parent_account_id}::${r.usage_date}`);
  for (const [, rows] of Object.entries(groups)) {
    const { parent_account_id, usage_date } = rows[0];
    await db.execute(sql`
      UPDATE parent_ai_daily_usage SET
        reserved_count = GREATEST(0, reserved_count - ${rows.length}),
        updated_at     = NOW()
      WHERE parent_account_id = ${parent_account_id}
        AND usage_date = ${usage_date}::date
    `);
  }
}
```

---

## 8. 수정 `audit_logs` DDL

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id              text        PRIMARY KEY
                    DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  -- entity_version: audit_entity_versions에서 원자적 발급받은 순번
  -- 실제 FK 없음 (audit_entity_versions=현재 카운터, audit_logs=이력 스냅샷)
  entity_version  bigint      NOT NULL,
  action          text        NOT NULL,

  -- actor_type = 'system' → actor_id NULL 허용
  actor_type      text        NOT NULL,
  actor_id        text,               -- ← NOT NULL → NULL 허용으로 수정
  pool_id         text,               -- 'GLOBAL' for cross-pool

  before_data     jsonb,
  after_data      jsonb,
  reason          text,
  request_id      text,
  correlation_id  text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- ── CHECK 제약 ──────────────────────────────────────────────────────────
  CONSTRAINT chk_audit_logs_action
    CHECK (action IN ('create','update','delete')),

  CONSTRAINT chk_audit_logs_actor_type
    CHECK (actor_type IN ('super_admin','pool_admin','teacher','parent','system')),

  -- system이면 actor_id NULL, 그 외는 NOT NULL
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

### ERD 관계 정정

```
audit_logs.(entity_type, entity_id, entity_version)
  ≠ FK to audit_entity_versions

정확한 의미:
  audit_entity_versions = (entity_type, entity_id) 별 현재 버전 카운터
  audit_logs.entity_version = 변경 시점에 발급받은 순번 (이력 스냅샷)
  실제 PostgreSQL FOREIGN KEY 없음
  단방향 관계: audit_logs가 version 번호를 참조하나 DB 레벨 제약 없음
```

---

## 9. 완성된 `growth_reports` DDL

```sql
CREATE TABLE IF NOT EXISTS growth_reports (
  id                      text        PRIMARY KEY
                            DEFAULT ('gr_' || replace(gen_random_uuid()::text,'-','')),

  -- 대상
  student_id              text        NOT NULL,
  swimming_pool_id        text        NOT NULL,
  report_type             text        NOT NULL DEFAULT 'monthly',
  period_start            date        NOT NULL,
  period_end              date        NOT NULL,

  -- 분석 메타
  source_event_count      integer     NOT NULL DEFAULT 0,
  source_data_cutoff_at   timestamptz,

  -- 버전 추적 (재다운로드 시 재분석 금지 — 버전이 같으면 cached 응답)
  curriculum_version_id   text,
  report_schema_version   text,
  report_template_version text,
  analysis_version        text,
  prompt_version          text,
  knowledge_version       text,
  ppt_template_version    text,       -- WP18에서 활성화, 지금은 NULL

  -- 결과
  content                 jsonb,      -- 분석 결과 원본 (WP18 PPT 생성의 기반)
  summary_text            text,
  file_url                text,       -- PPT 다운로드 URL (WP18에서 채워짐)

  -- 생성 정보
  generated_at            timestamptz NOT NULL DEFAULT now(),
  generated_by            text,       -- teacher_id or 'system'
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

## 10. WP1 실제 Migration 실행 순서

> `pool-db-init.ts`에 아래 순서대로 추가. 각 블록은 `.catch(() => {})` 로 감싸지 않고, 오류 시 로그 출력 후 재시도 가능하도록 구성.
> DO $$ 블록은 `.catch((e) => console.error('[X-init]', e.message))` 허용.

```
M-A  ENUM 타입 생성 (xmode_config_status_enum, global_template_status_enum, growth_match_status_enum)
M-B  swimming_pools X모드 컬럼 추가 (xmode_entitlement, xmode_config_status, ...)
M-C  global_template_sets 신규 테이블
M-D  global_template_sets ACTIVE 유일성 인덱스 ON ((1)) WHERE status='ACTIVE'
     + version_name UNIQUE 인덱스
M-E  diary_templates 변경
     ① swimming_pool_id DROP NOT NULL
     ② global_template_set_id 컬럼 추가
     ③ scope 정합성 CHECK (DO $$ + pg_constraint)
     ④ global_template_set_id FK (DO $$ + pg_constraint)
     ⑤ idx_diary_templates_xglobal 인덱스
M-F  audit_entity_versions 테이블 + next_audit_version 함수
M-G  audit_logs 테이블 + 인덱스 (actor_id NULL 허용, CHECK 포함)
M-H  parent_ai_daily_usage 테이블
M-H2 parent_ai_usage_reservations 테이블 + 인덱스
M-I  growth_events 테이블 (완성 버전 — 버전 컬럼, CHECK, UNIQUE INDEX 포함)
M-J  growth_reports 테이블 (완성 버전 — 버전 컬럼, content JSONB, deleted_at 포함)
```

### 순서 의존성

```
M-A → M-B (ENUM 먼저)
M-A → M-I (growth_match_status_enum)
M-A → M-G (actor_type CHECK는 ENUM 아니지만 M-A 이후 배치)
M-C → M-D (테이블 후 인덱스)
M-C → M-E-④ (FK 대상 테이블 먼저)
M-F → M-G (writeAuditLog가 audit_entity_versions 사용)
M-H → M-H2 (parent_ai_daily_usage 먼저)
```

---

## 11. Rollback 순서

> 역순 실행. 각 단계는 독립적으로 실행 가능.

```sql
-- M-J
DROP TABLE IF EXISTS growth_reports;

-- M-I
DROP TABLE IF EXISTS growth_events;

-- M-H2
DROP TABLE IF EXISTS parent_ai_usage_reservations;

-- M-H
DROP TABLE IF EXISTS parent_ai_daily_usage;

-- M-G
DROP TABLE IF EXISTS audit_logs;

-- M-F
DROP TABLE IF EXISTS audit_entity_versions;
DROP FUNCTION IF EXISTS next_audit_version(text, text);

-- M-E: 순서 중요
-- ① FK 제거
ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS fk_diary_templates_global_set;
-- ② CHECK 제거
ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS chk_diary_templates_scope_integrity;
-- ③ 인덱스 제거
DROP INDEX IF EXISTS idx_diary_templates_xglobal;
-- ④ global_template_set_id 컬럼 제거 (x_global 행이 없을 때만 안전)
ALTER TABLE diary_templates DROP COLUMN IF EXISTS global_template_set_id;
-- ⑤ swimming_pool_id NOT NULL 복원 (x_global 행 없을 때만 가능)
ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id SET NOT NULL;

-- M-D
DROP INDEX IF EXISTS uniq_global_template_sets_one_active;
DROP INDEX IF EXISTS uniq_global_template_sets_version_name;

-- M-C
DROP TABLE IF EXISTS global_template_sets;

-- M-B
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_entitlement;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_config_status;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_purchased_at;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_subscription_end_at;
ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_payment_failed_at;

-- M-A (CASCADE — 연결 컬럼 없을 때만 안전)
DROP TYPE IF EXISTS xmode_config_status_enum;
DROP TYPE IF EXISTS global_template_status_enum;
DROP TYPE IF EXISTS growth_match_status_enum;
```

> **M-E Rollback 전제 조건:**
> - `scope = 'x_global'` 행이 0개일 때만 `swimming_pool_id SET NOT NULL` 복원 가능
> - `global_template_set_id` 컬럼 DROP 전 FK 반드시 제거
> - M-A ENUM DROP은 해당 ENUM을 사용하는 컬럼 없을 때만 가능 (CASCADE 대신 수동 확인 권장)

---

## 12. 테스트

### T-1: scope 정합성 CHECK

```sql
-- 위반 케이스 — 반드시 오류 발생해야 함
-- x_global인데 swimming_pool_id가 있음
INSERT INTO diary_templates (swimming_pool_id, scope, global_template_set_id, template_text, created_by)
VALUES ('pool_abc', 'x_global', 'gts_001', 'test', 'admin');
-- 예상: ERROR: new row violates check constraint "chk_diary_templates_scope_integrity"

-- global인데 swimming_pool_id가 NULL
INSERT INTO diary_templates (swimming_pool_id, scope, template_text, created_by)
VALUES (NULL, 'global', 'test', 'admin');
-- 예상: ERROR: violates check constraint
```

### T-2: ARCHIVED 재활성화 (롤백)

```typescript
test('ARCHIVED 세트를 재활성화할 수 있어야 함', async () => {
  // setA: ACTIVE, setB: ARCHIVED
  await activateGlobalTemplateSet(setB.id, adminId, reqId);

  const [a] = await db.execute(sql`SELECT status FROM global_template_sets WHERE id=${setA.id}`);
  const [b] = await db.execute(sql`SELECT status FROM global_template_sets WHERE id=${setB.id}`);
  expect(a.status).toBe('ARCHIVED');
  expect(b.status).toBe('ACTIVE');
});

test('ACTIVE 세트 재활성화는 409', async () => {
  await expect(activateGlobalTemplateSet(activeSet.id, adminId, reqId))
    .rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
});
```

### T-3: match_token 충돌 구분

```typescript
test('동일 token + 동일 diary_note → 멱등 200', async () => {
  const r1 = await saveGrowthEvent({ token, diaryNoteId: 'd1', ... });
  const r2 = await saveGrowthEvent({ token, diaryNoteId: 'd1', ... });
  expect(r1.event_id).toBe(r2.event_id);
  expect(r2.idempotent).toBe(true);
});

test('동일 token + 다른 diary_note → 409', async () => {
  await saveGrowthEvent({ token, diaryNoteId: 'd1', ... });
  await expect(saveGrowthEvent({ token, diaryNoteId: 'd2', ... }))
    .rejects.toMatchObject({ code: 'MATCH_TOKEN_ALREADY_USED' });
});
```

### T-4: parent_ai_usage_reservations 멱등성

```typescript
test('동일 request_id 재시도 → 기존 예약 반환', async () => {
  const r1 = await reserveParentAi(db, 'req_001', parentId, 3);
  const r2 = await reserveParentAi(db, 'req_001', parentId, 3);
  expect(r2.alreadyReserved).toBe(true);
  // reserved_count는 1회만 증가해야 함
  const [u] = await db.execute(sql`SELECT reserved_count FROM parent_ai_daily_usage WHERE ...`);
  expect(u.reserved_count).toBe(1);
});
```

### T-5: EXPIRED 장애 복구

```typescript
test('RESERVED 초과 시 Worker가 reserved_count 복구', async () => {
  // expires_at을 과거로 설정해 강제 만료
  await db.execute(sql`
    UPDATE parent_ai_usage_reservations
    SET expires_at = NOW() - interval '1 minute'
    WHERE request_id = 'req_stale'
  `);
  await expireStaleReservations(db);
  const [u] = await db.execute(sql`SELECT reserved_count FROM parent_ai_daily_usage WHERE ...`);
  expect(u.reserved_count).toBe(0);
});
```

### T-6: audit_logs system actor

```typescript
test('actor_type=system이면 actor_id NULL 허용', async () => {
  await expect(writeAuditLog(tx, {
    entity_type: 'growth_event', entity_id: 'ge_001',
    action: 'update', actor_type: 'system', actor_id: undefined, pool_id: 'pool_001',
    before_data: null, after_data: { is_invalidated: true },
  })).resolves.not.toThrow();
});

test('actor_type=teacher이면 actor_id NULL 거부', async () => {
  await expect(writeAuditLog(tx, {
    actor_type: 'teacher', actor_id: undefined, ...
  })).rejects.toThrow(); // CHECK constraint violation
});
```

---

## 변경 요약 (V3.3.2 → V3.3.3)

| ID | 항목 | V3.3.2 | V3.3.3 |
|----|------|--------|--------|
| 1 | scope x_global 추가 | Migration 없음 | text 타입 확인 (옵션 C) + scope 정합성 CHECK 추가 |
| 2 | global_template_set_id FK | 컬럼만 추가 | FK + version_name UNIQUE 추가 |
| 3 | ARCHIVED 재활성화 | CANNOT_ACTIVATE_ARCHIVED로 차단 | DRAFT·ARCHIVED 모두 허용 (롤백 경로) |
| 4 | growth_events | 버전 추적 컬럼 누락, evidence_validation JSONB | 완성 DDL — 버전 11개, TEXT CHECK, 무효화 일관성 CHECK |
| 5 | MatchTokenV2 | confidence만 서명 | confidence_config_version, matching_algorithm_version 추가 |
| 6 | token 충돌 | ON CONFLICT DO NOTHING만 | 기존 행 diary_note_id 비교로 A/B 구분 |
| 7 | Parent AI 한도 | 집계 테이블만 | parent_ai_usage_reservations 추가 — 멱등·장애복구 |
| 8 | audit_logs | actor_id NOT NULL, ERD FK 오표기 | actor_id NULL 허용 + system CHECK + ERD 정정 |
| growth_reports | 버전 컬럼 누락, content JSONB 없음 | 완성 DDL — 버전 7개, content JSONB, deleted_at |

---

## 남은 NEEDS_VERIFICATION (갱신)

| ID | 항목 | 상태 |
|----|------|------|
| NV-1 | RevenueCat webhook transaction_id 필드명 | 미확인 |
| NV-2 | RevenueCat consumable webhook 이벤트 타입 | 미확인 |
| NV-3 | Render.com Worker 추가 과금 | 미확인 |
| NV-4 | AUTO_ACCEPTED 항목 teacher 변경 가능 여부 | 정책 미결 |
| NV-5 | PENDING_REVIEW 48시간 미응답 DISCARDED 정책 | 파일럿 후 확정 |
| NV-6 | WP6-B 품질 검증 기준값 | 파일럿 후 확정 |
| NV-13 | diary_templates DROP NOT NULL 기존 쿼리 전체 영향 | WP4-A 전 재확인 |
| NV-14 | x_global 벡터 검색 기존 함수 재사용 여부 | WP5 전 확인 |
| **NV-15** | growth_events의 `uq_growth_events_per_note` Partial UNIQUE — `is_invalidated=false`인 행에서 동일 (diary_note_id, student_id, curriculum_item_id, source) 중복 차단이 의도대로 동작하는지 확인 | WP7 전 |
| **NV-16** | `parent_ai_usage_reservations.expires_at` 10분 TTL이 실제 AI 응답 시간 P99에 충분한지 검증 | WP9 전 |

---
*최종 작성: 2026-08-02 | 상태: 승인 대기 | 다음 단계: WP1 승인 후 pool-db-init.ts M-A~M-J 순서대로 실행*
