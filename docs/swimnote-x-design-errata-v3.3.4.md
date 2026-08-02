# SWIMNOTE X — 설계 정정서 v3.3.4
> V3.3.3 대비 4개 항목 추가 보완 — 설계 검수 최종본
> 코드 수정·Migration 실행·Commit·Push·OTA·배포는 승인 전 금지

---

## 차례

1. 최종 `diary_templates.scope` CHECK SQL
2. Growth Event 중복 정책
3. `MatchTokenV2` key_id 계약
4. Parent AI API 진입 시 만료 Reservation 복구 코드
5. 변경 Migration (V3.3.3 M-E 대체)
6. 테스트
7. Rollback

---

## 1. 최종 `diary_templates.scope` CHECK SQL

### 1-1. Migration 전 사전 검증 쿼리 (2단계 — 시점 분리)

> `global_template_set_id` 컬럼은 M-E-2에서 신규 추가되므로 M-E 실행 전에는 존재하지 않음.
> 따라서 사전 검증을 **1차(M-E 전)** 와 **2차(M-E-2 이후 M-E-3 전)** 로 분리한다.

#### 1차 검증 — M-E-1 실행 전 (필수)

```sql
-- global_template_set_id 없이 기존 컬럼만 검증
SELECT id, scope, swimming_pool_id
FROM diary_templates
WHERE scope NOT IN ('global', 'teacher')
   OR swimming_pool_id IS NULL;

-- 예상 결과: 0 rows
-- 1행 이상이면 Migration 중단 후 원인 보고
```

#### 2차 검증 — M-E-2 완료 직후, M-E-3(CHECK 추가) 직전

```sql
-- global_template_set_id 컬럼 추가 후 전체 정합성 검증
SELECT id, scope, swimming_pool_id, global_template_set_id
FROM diary_templates
WHERE NOT (
  (
    scope = 'x_global'
    AND swimming_pool_id IS NULL
    AND global_template_set_id IS NOT NULL
  )
  OR
  (
    scope IN ('global', 'teacher')
    AND swimming_pool_id IS NOT NULL
    AND global_template_set_id IS NULL
  )
);

-- 예상 결과: 0 rows (기존 데이터는 모두 global/teacher이므로 통과)
-- 1행 이상이면 Migration 중단 후 원인 보고
```

### 1-2. 최종 scope CHECK (V3.3.4 확정)

```sql
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
      (
        scope = 'x_global'
        AND swimming_pool_id IS NULL
        AND global_template_set_id IS NOT NULL
      )
      OR
      (
        scope IN ('global', 'teacher')
        AND swimming_pool_id IS NOT NULL
        AND global_template_set_id IS NULL
      )
    );
  END IF;
END $$;
```

### 1-3. 이 CHECK가 거부하는 케이스

| 입력 조합 | 거부 이유 |
|-----------|----------|
| `scope = 'arbitrary'` | 허용된 3개 값에 없음 |
| `scope = 'x_global'` + `swimming_pool_id IS NOT NULL` | x_global 조건 위반 |
| `scope = 'x_global'` + `global_template_set_id IS NULL` | x_global 조건 위반 |
| `scope = 'global'` + `swimming_pool_id IS NULL` | global/teacher 조건 위반 |
| `scope = 'teacher'` + `global_template_set_id IS NOT NULL` | global/teacher 조건 위반 |

---

## 2. Growth Event 중복 정책

### 2-1. 정책 확정

```
성장판 집계 단위: 학생 × 일지 × 커리큘럼 항목 × 출처 = 최대 1회
같은 일지 안에서 동일 기술이 여러 문장에 언급되어도 성장판 횟수는 1회만 증가
같은 날짜라도 서로 다른 diary_note이면 각각 1회 인정
```

### 2-2. Partial UNIQUE INDEX (V3.3.4 확정)

```sql
-- V3.3.3과 동일 — 재확인
CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_events_per_note
  ON growth_events (diary_note_id, student_id, curriculum_item_id, source)
  WHERE diary_note_id IS NOT NULL
    AND is_invalidated = FALSE;
```

### 2-3. 충돌 케이스별 처리 (V3.3.4 확정)

| 케이스 | 판단 근거 | 처리 |
|--------|----------|------|
| 동일 `match_token_id` + 동일 `diary_note_id` | `uq_growth_events_match_token_id` | 멱등 200 — 기존 event 반환 |
| 동일 `match_token_id` + 다른 `diary_note_id` | `uq_growth_events_match_token_id` | 409 `MATCH_TOKEN_ALREADY_USED` |
| 다른 토큰 + 동일 `(diary_note, student, item, source)` + `is_invalidated=false` | `uq_growth_events_per_note` | 기존 유효 event 반환 또는 409 `DUPLICATE_PROGRESS_EVENT` |
| 기존 event가 `is_invalidated=true`인 경우 | Partial INDEX 제외 조건 | 신규 유효 event 생성 가능 |

> `occurrence_index`는 사용하지 않는다. 성장판은 언급 횟수가 아닌 수업 일지 단위 반복 관찰 횟수를 측정한다.

### 2-4. 저장 로직 분기 (V3.3.4)

```typescript
// saveGrowthEvent 내부 — INSERT 충돌 분기

// ① match_token_id CONFLICT
if (matchTokenConflict) {
  const [existing] = await tx.execute(sql`
    SELECT id, diary_note_id FROM growth_events
    WHERE match_token_id = ${jti} LIMIT 1
  `);
  if (existing.diary_note_id === diaryNoteId) {
    return { event_id: existing.id, idempotent: true };         // 멱등
  }
  throw new AppError(409, 'MATCH_TOKEN_ALREADY_USED');
}

// ② uq_growth_events_per_note CONFLICT (다른 토큰이 같은 note/item 시도)
if (perNoteConflict) {
  const [existing] = await tx.execute(sql`
    SELECT id FROM growth_events
    WHERE diary_note_id    = ${diaryNoteId}
      AND student_id       = ${studentId}
      AND curriculum_item_id = ${itemId}
      AND source           = ${source}
      AND is_invalidated   = false
    LIMIT 1
  `);
  if (existing) {
    return { event_id: existing.id, idempotent: true };         // 기존 유효 event 반환
  }
  throw new AppError(409, 'DUPLICATE_PROGRESS_EVENT');
}
```

---

## 3. `MatchTokenV2` key_id 계약

### 3-1. 최종 Payload (V3.3.4 — key_id 추가)

```typescript
interface MatchTokenV2Payload {
  key_id:                       string;   // ← 신규. 현재: 'match_key_v1'
  jti:                          string;
  request_id:                   string;
  pool_id:                      string;
  student_ref:                  string;
  curriculum_item_id:           string;
  curriculum_version_id:        string;
  candidate_id:                 string;
  confidence:                   number;
  confidence_config_version:    string;
  matching_algorithm_version:   string;
  issued_at:                    string;
  expires_at:                   string;
  // hmac: string — 전달 시 포함, stableStringify(payload_without_hmac) 서명
}
```

### 3-2. 환경변수

```
MATCH_TOKEN_SECRET     — HMAC 서명 키 (필수, 미설정 시 Match 기능 시작 금지)
MATCH_TOKEN_KEY_ID     — 현재 키 식별자, 기본값: 'match_key_v1'
```

> `JWT_SECRET` fallback 금지. `MATCH_TOKEN_SECRET` 미설정 시 서버 시작 시 오류 또는 AI match 기능 비활성화.

### 3-3. 토큰 생성 시

```typescript
function createMatchToken(
  payload: Omit<MatchTokenV2Payload, 'key_id'> & { key_id?: string }
): string {
  const secret = getMatchSecret();   // MATCH_TOKEN_SECRET
  const keyId  = process.env.MATCH_TOKEN_KEY_ID ?? 'match_key_v1';

  const full = { ...payload, key_id: keyId };
  const base = stableStringify(full);      // key 포함 직렬화
  const hmac = createHmac('sha256', secret).update(base).digest('hex');
  return Buffer.from(JSON.stringify({ ...full, hmac })).toString('base64url');
}
```

### 3-4. 토큰 검증 시

```typescript
function verifyMatchToken(token: string, ...): MatchTokenV2Payload {
  const raw = JSON.parse(Buffer.from(token, 'base64url').toString());
  const { hmac, ...rest } = raw;

  // ① key_id 확인 (현재 V1에서는 단일 키만 지원)
  const supportedKeyIds = ['match_key_v1'];
  if (!supportedKeyIds.includes(raw.key_id)) {
    throw new AppError(400, 'MATCH_TOKEN_KEY_NOT_SUPPORTED');
  }

  // ② HMAC 길이 검사 (timingSafeEqual 전 필수)
  if (typeof hmac !== 'string' || hmac.length !== 64) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // ③ 서명 검증 (key_id에 해당하는 secret 사용 — 현재는 단일)
  const secret   = getMatchSecret();
  const expected = createHmac('sha256', secret).update(stableStringify(rest)).digest('hex');
  if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // ④~⑥ 만료·pool_id·request_id·student_ref 검증 (V3.3.3과 동일)
  // ...

  return raw as MatchTokenV2Payload;
}
```

### 3-5. 향후 Secret Rotation 확장 경로 (현재 미구현)

```
현재 (WP1~WP6): 단일 MATCH_TOKEN_SECRET + MATCH_TOKEN_KEY_ID='match_key_v1'
Secret 교체 필요 시: 기존 토큰 TTL(24h) 경과 후 교체 (긴급 시 기존 미저장 토큰 무효화 감수)

향후 확장 시:
MATCH_TOKEN_SECRETS_JSON = '{"match_key_v1":"old","match_key_v2":"new"}'
  → payload.key_id로 해당 secret 선택 → 다중 키 동시 검증 가능
현재 구현 범위 밖 — 설계만 명시
```

---

## 4. Parent AI API 진입 시 만료 Reservation 복구 코드

### 4-1. 이중 복구 구조

```
경로 A: Background Worker (5분 주기) — 전체 만료 RESERVED 정리
경로 B: API 진입 시 (해당 parent만) — Worker 중단 시에도 자체 복구
```

두 경로가 동시에 같은 행을 처리해도 `WHERE status = 'RESERVED'` 조건으로 **한쪽만 실제 전환**됨.

### 4-2. `expireStaleReservationsForParent` (API 진입 경로)

```typescript
// src/lib/parent-ai-usage.ts

/**
 * API 요청 진입 시 해당 parent의 만료 Reservation 정리
 * - 동일 tx 안에서 실행 (reserveParentAi와 같은 transaction)
 * - FOR UPDATE SKIP LOCKED: Worker와 동시 실행 시 중복 처리 방지
 * - GREATEST(0, ...) : reserved_count 음수 방지
 */
async function expireStaleReservationsForParent(
  tx:               DrizzleTx,
  parentAccountId:  string,
  usageDate:        string,
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
  // FOR UPDATE SKIP LOCKED 불필요: UPDATE 자체가 row lock 획득 후 처리
  // status='RESERVED' 조건이 Worker와의 중복 전환을 원천 차단

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

### 4-3. Reservation 생성 — ON CONFLICT DO NOTHING + 소유권 검증

```typescript
// reserveParentAiInTx — 동일 tx 안에서 실행
async function reserveParentAiInTx(
  tx:              DrizzleTx,
  requestId:       string,
  parentAccountId: string,
  usageDate:       string,
  dailyLimit:      number,
): Promise<void> {

  // ① INSERT ON CONFLICT DO NOTHING — PK 충돌(동시 요청) 시 0 rows 반환
  const insertResult = await tx.execute(sql`
    INSERT INTO parent_ai_usage_reservations
      (request_id, parent_account_id, usage_date, status)
    VALUES
      (${requestId}, ${parentAccountId}, ${usageDate}::date, 'RESERVED')
    ON CONFLICT (request_id) DO NOTHING
    RETURNING request_id
  `);

  if ((insertResult.rowCount ?? 0) === 0) {
    // ② CONFLICT 발생 — 기존 reservation 조회
    const [existing] = await tx.execute(sql`
      SELECT request_id, parent_account_id, usage_date, status
      FROM parent_ai_usage_reservations
      WHERE request_id = ${requestId}
    `);

    if (!existing) {
      throw new AppError(500, 'RESERVATION_CONFLICT_UNRESOLVABLE');
    }

    // ③ 소유권 검증 — 다른 parent의 request_id 재사용 차단
    if (existing.parent_account_id !== parentAccountId) {
      throw new AppError(409, 'REQUEST_ID_OWNERSHIP_MISMATCH');
    }

    // ④ 상태별 재시도 정책
    switch (existing.status) {
      case 'RESERVED':
        // 동일 요청이 아직 처리 중
        throw new AppError(409, 'REQUEST_ALREADY_IN_PROGRESS');

      case 'COMPLETED':
        // 이미 완료 — 멱등 응답 신호 (호출자가 캐시된 결과 반환)
        throw new AppError(200, 'ALREADY_COMPLETED');

      case 'FAILED':
      case 'BLOCKED':
      case 'EXPIRED':
        // 종료된 request_id 재사용 금지
        throw new AppError(409, 'REQUEST_ID_ALREADY_TERMINAL', {
          hint: '새 request_id를 발급하여 다시 요청하세요',
          previous_status: existing.status,
        });
    }
  }

  // ⑤ INSERT 성공 — reserved_count 집계 증가
  // 한도 검사: FOR UPDATE로 daily_usage 행 잠금 후 실효값 확인
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
    // 한도 초과 — 방금 INSERT한 reservation 즉시 취소
    await tx.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status = 'EXPIRED', completed_at = NOW()
      WHERE request_id = ${requestId}
    `);
    throw new AppError(429, 'AI_USAGE_LIMIT_REACHED');
  }

  // ⑥ reserved_count 증가
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

### 4-4. API 요청 전체 처리 순서 (V3.3.4 확정)

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

  await db.transaction(async (tx) => {
    // ① 만료 Reservation 정리 (API 진입 이중 복구)
    await expireStaleReservationsForParent(tx, parentAccountId, usageDate);

    // ② Reservation 생성 + 소유권·한도 검증
    //    ALREADY_COMPLETED(200) / REQUEST_ALREADY_IN_PROGRESS(409) /
    //    REQUEST_ID_ALREADY_TERMINAL(409) / REQUEST_ID_OWNERSHIP_MISMATCH(409) 등 throw
    await reserveParentAiInTx(tx, requestId, parentAccountId, usageDate, dailyLimit);
  });
  // tx COMMIT 후 아래 진행

  try {
    // ③ Intent Guard (네트워크 호출 — tx 밖)
    const intentOk = await checkSwimmingIntent(aiCall.inputText);
    if (!intentOk) {
      await blockParentAiIntent(db, requestId, parentAccountId, usageDate, tokens);
      throw new AppError(403, 'NON_SWIMMING_INTENT');
    }

    // ④ 본 AI 호출
    const result = await aiCall();
    tokens = result.tokens;

    // ⑤ 성공 완료
    await completeParentAi(db, requestId, parentAccountId, usageDate, tokens);
    return result;

  } catch (err) {
    if (err instanceof AppError &&
        ['NON_SWIMMING_INTENT', 'ALREADY_COMPLETED'].includes(err.code)) throw err;
    // ⑥ AI 오류 → 실패 완료
    await failParentAi(db, requestId, parentAccountId, usageDate, String(err), tokens);
    throw err;
  }
}
```

**상태별 재시도 응답 요약:**

| 기존 status | 반환 |
|-------------|------|
| `RESERVED` (진행 중) | 409 `REQUEST_ALREADY_IN_PROGRESS` |
| `COMPLETED` (완료) | 200 `ALREADY_COMPLETED` (멱등) |
| `FAILED` / `BLOCKED` / `EXPIRED` | 409 `REQUEST_ID_ALREADY_TERMINAL` — 새 request_id 요구 |
| 다른 parent 소유 | 409 `REQUEST_ID_OWNERSHIP_MISMATCH` |

---

## 5. 변경 Migration (V3.3.3 M-E 대체 + 추가 없음)

V3.3.4에서 Migration DDL 변경은 **M-E의 scope CHECK만 영향**. 나머지 M-A~M-J는 V3.3.3과 동일.

### M-E 최종본 (V3.3.4) — 실패 즉시 중단 구조

> `.catch(() => {})` 로 오류를 삼키지 않는다. 각 Group은 하나라도 실패하면 이후 단계 실행 금지.

```typescript
// pool-db-init.ts — Group 2: M-C, M-D, M-E (의존성 묶음)
// 어떤 단계든 throw 하면 Group 전체 실패 → 서버 시작 중단

// ── M-E: diary_templates 변경 (Group 2 내 순서 유지) ──────────────────────

// [1차 사전 검증] M-E-1 실행 전 — 결과가 1행 이상이면 throw
const preCheckRows = await db.execute(sql.raw(`
  SELECT id, scope, swimming_pool_id
  FROM diary_templates
  WHERE scope NOT IN ('global', 'teacher')
     OR swimming_pool_id IS NULL
`));
if ((preCheckRows.rowCount ?? 0) > 0) {
  console.error('[X-init] M-E 1차 검증 실패 — 기존 데이터 정합성 오류:', preCheckRows.rows);
  throw new Error('[X-init] diary_templates 사전 검증 실패: Migration 중단');
}

// M-E-1: swimming_pool_id NOT NULL 해제
await db.execute(sql.raw(`
  ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id DROP NOT NULL;
`));
console.log('[X-init] M-E-1 완료: swimming_pool_id DROP NOT NULL');

// M-E-2: global_template_set_id 컬럼 추가
await db.execute(sql.raw(`
  ALTER TABLE diary_templates ADD COLUMN IF NOT EXISTS global_template_set_id text;
`));
console.log('[X-init] M-E-2 완료: global_template_set_id 컬럼 추가');

// [2차 사전 검증] M-E-2 완료 후, M-E-3 전 — 결과가 1행 이상이면 throw
const postColCheckRows = await db.execute(sql.raw(`
  SELECT id, scope, swimming_pool_id, global_template_set_id
  FROM diary_templates
  WHERE NOT (
    (scope = 'x_global' AND swimming_pool_id IS NULL AND global_template_set_id IS NOT NULL)
    OR
    (scope IN ('global','teacher') AND swimming_pool_id IS NOT NULL AND global_template_set_id IS NULL)
  )
`));
if ((postColCheckRows.rowCount ?? 0) > 0) {
  console.error('[X-init] M-E 2차 검증 실패:', postColCheckRows.rows);
  throw new Error('[X-init] diary_templates 2차 검증 실패: Migration 중단');
}

// M-E-3: scope 정합성 CHECK (허용값: global, teacher, x_global만)
await db.execute(sql.raw(`
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
        (
          scope = 'x_global'
          AND swimming_pool_id IS NULL
          AND global_template_set_id IS NOT NULL
        )
        OR
        (
          scope IN ('global', 'teacher')
          AND swimming_pool_id IS NOT NULL
          AND global_template_set_id IS NULL
        )
      );
    END IF;
  END $$;
`));
console.log('[X-init] M-E-3 완료: scope 정합성 CHECK 추가');

// M-E-4: global_template_set_id FK
await db.execute(sql.raw(`
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
`));
console.log('[X-init] M-E-4 완료: global_template_set_id FK 추가');

// M-E-5: x_global 검색 인덱스
await db.execute(sql.raw(`
  CREATE INDEX IF NOT EXISTS idx_diary_templates_xglobal
    ON diary_templates (global_template_set_id, is_active)
    WHERE scope = 'x_global';
`));
console.log('[X-init] M-E-5 완료: idx_diary_templates_xglobal 인덱스');
```

### Migration Group 구조 (실패 즉시 중단)

```typescript
// pool-db-init.ts — WP1 X모드 Migration 진입점
// 각 Group은 try/catch로 감싸고, 실패 시 throw → 서버 시작 중단

async function initXModeSchema(db: Db): Promise<void> {
  // Group 1: ENUM + swimming_pools 컬럼
  try {
    await runGroup1_EnumAndPools(db);      // M-A, M-B
  } catch (err) {
    console.error('[SWIMNOTE X WP1] Group 1 실패', err);
    throw err;  // 서버 시작 중단
  }

  // Group 2: Global Template 구조
  try {
    await runGroup2_GlobalTemplate(db);    // M-C, M-D, M-E
  } catch (err) {
    console.error('[SWIMNOTE X WP1] Group 2 실패', err);
    throw err;
  }

  // Group 3: Audit
  try {
    await runGroup3_Audit(db);             // M-F, M-G
  } catch (err) {
    console.error('[SWIMNOTE X WP1] Group 3 실패', err);
    throw err;
  }

  // Group 4: Parent AI Usage
  try {
    await runGroup4_ParentAiUsage(db);     // M-H, M-H2
  } catch (err) {
    console.error('[SWIMNOTE X WP1] Group 4 실패', err);
    throw err;
  }

  // Group 5: Growth
  try {
    await runGroup5_Growth(db);            // M-I, M-J
  } catch (err) {
    console.error('[SWIMNOTE X WP1] Group 5 실패', err);
    throw err;
  }

  console.log('[SWIMNOTE X WP1] Migration 전체 완료');
}
```

> **금지:** `.catch(() => {})` 또는 `.catch((e) => console.error(...))` 후 계속 진행.
> 부분 Migration 상태에서 서버가 시작되면 안 됨.
> 멱등성(`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, DO $$ 블록)은 재실행 안전성을 위한 것이지 오류 은폐용이 아님.

> **M-E 실행 전 선행 조건:** 1차 검증 코드가 내부에 포함됨. M-C(global_template_sets 생성) 이후에 실행.

---

## 6. 테스트

### T-1: scope 사전 검증 쿼리 결과 확인

```typescript
test('기존 diary_templates에 CHECK 위반 행 없음', async () => {
  const result = await db.execute(sql`
    SELECT id FROM diary_templates
    WHERE scope NOT IN ('global', 'teacher')
       OR swimming_pool_id IS NULL
  `);
  expect(result.rowCount).toBe(0);
});
```

### T-2: scope CHECK 위반 케이스 (전부 오류 발생해야 함)

```typescript
const violationCases = [
  // 임의 scope
  { scope: 'arbitrary', swimming_pool_id: 'pool_1', global_template_set_id: null },
  // x_global인데 pool 있음
  { scope: 'x_global', swimming_pool_id: 'pool_1', global_template_set_id: 'gts_1' },
  // x_global인데 set 없음
  { scope: 'x_global', swimming_pool_id: null,     global_template_set_id: null },
  // global인데 pool 없음
  { scope: 'global',   swimming_pool_id: null,     global_template_set_id: null },
  // teacher인데 set 있음
  { scope: 'teacher',  swimming_pool_id: 'pool_1', global_template_set_id: 'gts_1' },
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
  // 첫 번째 저장
  const r1 = await saveGrowthEvent({ token: tokenA, diaryNoteId: 'note_1', studentId: 's_1',
    curriculumItemId: 'item_1', source: 'teacher_ai' });
  expect(r1.idempotent).toBe(false);

  // 다른 토큰으로 같은 note/item 시도
  const r2 = await saveGrowthEvent({ token: tokenB, diaryNoteId: 'note_1', studentId: 's_1',
    curriculumItemId: 'item_1', source: 'teacher_ai' });
  // 기존 event 반환 (idempotent)
  expect(r2.event_id).toBe(r1.event_id);
  expect(r2.idempotent).toBe(true);
});

test('다른 note에서 같은 item → 별도 1회 인정', async () => {
  const r1 = await saveGrowthEvent({ ..., diaryNoteId: 'note_1' });
  const r2 = await saveGrowthEvent({ ..., diaryNoteId: 'note_2' });
  expect(r2.event_id).not.toBe(r1.event_id);
  expect(r2.idempotent).toBe(false);
});

test('is_invalidated=true 행 이후 동일 note/item → 신규 허용', async () => {
  await db.execute(sql`
    UPDATE growth_events SET is_invalidated=true, invalidated_at=NOW()
    WHERE diary_note_id='note_1' AND student_id='s_1' AND curriculum_item_id='item_1'
  `);
  const r = await saveGrowthEvent({ ..., diaryNoteId: 'note_1' });
  expect(r.idempotent).toBe(false); // 신규 생성
});
```

### T-4: key_id 포함 Token 검증

> **검증 순서:** key_id 지원 여부(①) → HMAC 길이(②) → 서명(③). 따라서 key_id 변조는 항상 KEY_NOT_SUPPORTED가 먼저 반환됨. INVALID_MATCH_TOKEN 테스트는 key_id를 유지하고 payload 값을 변조해야 함.

```typescript
// 케이스 1: 지원되지 않는 key_id
test('지원되지 않는 key_id → MATCH_TOKEN_KEY_NOT_SUPPORTED', async () => {
  const tokenWithBadKey = createTokenWithKeyId('match_key_v99', payload);
  await expect(verifyMatchToken(tokenWithBadKey, studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'MATCH_TOKEN_KEY_NOT_SUPPORTED' });
});

// 케이스 2: key_id 변조 (지원되지 않는 key로 변경)
// → key_id 검사가 HMAC 검사보다 먼저 실행되므로 KEY_NOT_SUPPORTED 반환
test('key_id를 지원되지 않는 값으로 변조 → MATCH_TOKEN_KEY_NOT_SUPPORTED', async () => {
  const token  = createMatchToken(payload); // key_id='match_key_v1'
  const parsed = JSON.parse(Buffer.from(token, 'base64url').toString());
  parsed.key_id = 'match_key_v2'; // 변조 (지원 안 됨)
  const tampered = Buffer.from(JSON.stringify(parsed)).toString('base64url');
  await expect(verifyMatchToken(tampered, studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'MATCH_TOKEN_KEY_NOT_SUPPORTED' });
  // INVALID_MATCH_TOKEN이 아님 — key_id 검사가 HMAC 검사보다 선행
});

// 케이스 3: 서명 변조 (key_id는 유효, payload 값 변경)
// → key_id 검사 통과 → HMAC 불일치 → INVALID_MATCH_TOKEN
test('payload 값 변조(confidence) → INVALID_MATCH_TOKEN', async () => {
  const token  = createMatchToken(payload); // key_id='match_key_v1'
  const parsed = JSON.parse(Buffer.from(token, 'base64url').toString());
  parsed.confidence = 0.99; // 서명 덮어쓰기 없이 값만 변조
  const tampered = Buffer.from(JSON.stringify(parsed)).toString('base64url');
  await expect(verifyMatchToken(tampered, studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'INVALID_MATCH_TOKEN' });
});

// 케이스 4: malformed token (base64url 디코딩 불가)
test('malformed token → INVALID_MATCH_TOKEN', async () => {
  await expect(verifyMatchToken('not.a.valid.token', studentId, poolId, requestId))
    .rejects.toMatchObject({ code: 'INVALID_MATCH_TOKEN' });
});
```

**정책 요약:**

| 케이스 | 반환 코드 |
|--------|----------|
| 지원되지 않는 key_id | `MATCH_TOKEN_KEY_NOT_SUPPORTED` |
| key_id 변조 (지원 안 되는 값으로) | `MATCH_TOKEN_KEY_NOT_SUPPORTED` |
| 지원되는 key_id + payload/hmac 변조 | `INVALID_MATCH_TOKEN` |
| malformed token | `INVALID_MATCH_TOKEN` |

### T-5: API 진입 시 만료 Reservation 복구

```typescript
test('Worker 중단 상태에서도 API 진입 시 만료 예약 복구', async () => {
  // 만료된 예약 생성
  await db.execute(sql`
    INSERT INTO parent_ai_usage_reservations
      (request_id, parent_account_id, usage_date, status, expires_at)
    VALUES
      ('req_stale', ${parentId}, ${today}::date, 'RESERVED', NOW() - interval '1 minute')
  `);
  await db.execute(sql`
    UPDATE parent_ai_daily_usage SET reserved_count=1
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);

  // API 요청 진입 — expireStaleReservationsForParent 호출
  await db.transaction(async (tx) => {
    const expiredCount = await expireStaleReservationsForParent(tx, parentId, today);
    expect(expiredCount).toBe(1);
  });

  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  expect(u.reserved_count).toBe(0);
});

test('Worker와 API 동시 정리 → reserved_count 중복 감소 없음', async () => {
  // 만료 예약 1개
  await insertExpiredReservation('req_concurrent', parentId, today);
  await setReservedCount(parentId, today, 1);

  // 동시 실행 시뮬레이션
  await Promise.all([
    db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today)),  // API
    db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today)),  // Worker
  ]);

  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  // GREATEST(0, ...) 보장 — 음수 없음, 1에서 1번만 감소
  expect(u.reserved_count).toBe(0);
});

test('만료되지 않은 RESERVED는 유지', async () => {
  await insertActiveReservation('req_active', parentId, today, '+10 minutes');
  await db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today));

  const [r] = await db.execute(sql`
    SELECT status FROM parent_ai_usage_reservations WHERE request_id='req_active'
  `);
  expect(r.status).toBe('RESERVED');
});

test('COMPLETED/FAILED/BLOCKED 행은 정리 대상 제외', async () => {
  for (const status of ['COMPLETED', 'FAILED', 'BLOCKED']) {
    await insertTerminalReservation('req_' + status, parentId, today, status);
  }
  await db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today));

  const rows = await db.execute(sql`
    SELECT status FROM parent_ai_usage_reservations
    WHERE parent_account_id=${parentId} AND status IN ('COMPLETED','FAILED','BLOCKED')
  `);
  expect(rows.rowCount).toBe(3); // 변경 없음
});

test('reserved_count 절대 음수 되지 않음', async () => {
  // reserved_count=0인 상태에서 expired 정리 시도
  await insertExpiredReservation('req_zero', parentId, today);
  await setReservedCount(parentId, today, 0);

  await db.transaction(tx => expireStaleReservationsForParent(tx, parentId, today));

  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  expect(u.reserved_count).toBeGreaterThanOrEqual(0);
});

test('동일 request_id 재시도 시 예약 중복 증가 없음', async () => {
  await reserveParentAi(db, 'req_dup', parentId, 3);
  await reserveParentAi(db, 'req_dup', parentId, 3); // 재시도

  const [u] = await db.execute(sql`
    SELECT reserved_count FROM parent_ai_daily_usage
    WHERE parent_account_id=${parentId} AND usage_date=${today}::date
  `);
  expect(u.reserved_count).toBe(1); // 1회만 증가
});
```

---

## 7. Rollback

V3.3.4 변경분(M-E만 변경)의 Rollback — V3.3.3 Rollback 순서와 동일하되 M-E 상세만 확정.

```sql
-- M-E Rollback (역순)

-- ⑤ 인덱스 제거
DROP INDEX IF EXISTS idx_diary_templates_xglobal;

-- ④ FK 제거 (컬럼 DROP 전 필수)
ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS fk_diary_templates_global_set;

-- ③ scope CHECK 제거
ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS chk_diary_templates_scope_integrity;

-- ② global_template_set_id 컬럼 제거
--    전제: scope='x_global' 행이 0개일 때만 안전
ALTER TABLE diary_templates DROP COLUMN IF EXISTS global_template_set_id;

-- ① swimming_pool_id NOT NULL 복원
--    전제: swimming_pool_id IS NULL 행이 0개일 때만 가능
ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id SET NOT NULL;
```

> **Rollback 전 확인 쿼리:**
> ```sql
> -- x_global 행 존재 시 M-E Rollback 불가
> SELECT COUNT(*) FROM diary_templates WHERE scope = 'x_global';
> -- 0 이어야 함
> ```

---

## 변경 요약 (V3.3.3 → V3.3.4)

| 항목 | V3.3.3 | V3.3.4 |
|------|--------|--------|
| scope CHECK | 정합성 조건만 | 허용값 완전 제한 + 사전 검증 쿼리 필수화 |
| Growth Event 중복 | 정책 기술만 | 케이스별 분기 로직 + DUPLICATE_PROGRESS_EVENT 응답 확정 |
| MatchTokenV2 | key_id 없음 | `key_id` 필드 추가, `MATCH_TOKEN_KEY_ID` 환경변수, 향후 rotation 경로 명시 |
| Parent AI 만료 복구 | Worker 단일 경로 | Worker + API 진입 이중 경로, `expireStaleReservationsForParent` 코드 확정 |

---

## 설계 검수 완료 선언

V3.3.4로 WP1 Migration 설계 검수를 종료한다.

```
설계 문서 이력:
  docs/swimnote-x-design-report-v3.3.md        — 기초 설계
  docs/swimnote-x-design-errata-v3.3.1.md      — 6개 구현 차단 요소 수정
  docs/swimnote-x-design-errata-v3.3.2.md      — 9개 정합성 오류 수정
  docs/swimnote-x-design-errata-v3.3.3.md      — 8개 + growth_reports 스키마 복원
  docs/swimnote-x-design-errata-v3.3.4.md      — 4개 최종 보완 (현재 문서)

다음 단계:
  WP1 Migration 코드 제출 → 검수 → 승인 → WP1 구현 시작
  구현 대상 파일: artifacts/api-server/src/migrations/pool-db-init.ts
  실행 순서: M-A → M-B → M-C → M-D → M-E → M-F → M-G → M-H → M-H2 → M-I → M-J
```

---
*최종 작성: 2026-08-02 | 상태: 설계 검수 완료 — WP1 Migration 구현 승인 대기*
