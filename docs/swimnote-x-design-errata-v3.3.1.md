# SWIMNOTE X — 설계 정정서 v3.3.1
> V3.3 대비 구현 차단 요소 6개 수정 + WP4·5·6 Phase 재편
> 코드 수정·Migration 실행·Commit·Push·OTA·배포 금지 (승인 전)

---

## 차례
1. [FIX-1] candidateMap 영속성 → HMAC Signed match_token
2. [FIX-2] Audit entity_version → Atomic UPSERT
3. [FIX-3] Migration 문법 → DO $$ / information_schema 패턴
4. [FIX-4] Parent AI 동시 한도 → reserved_count 예약 구조
5. [FIX-5] Global Template 동시 활성화 → Advisory Lock
6. [FIX-6] 삭제 학생 표시 정책 → deleted_at IS NULL 필터 전체 범위
7. [PHASE] WP4-A/4-B/5/6/6-B 재편

---

## FIX-1 | candidateMap 영속성 → HMAC Signed match_token

### 문제 (V3.3 설계의 결함)
- AI Pipeline 응답에서 `candidate_id → curriculum_item_id` 매핑을 요청 메모리 Map에만 유지
- 서버 재시작·수평 확장·요청 분산 시 Map 소멸 → 저장 단계에서 검증 불가
- 앱이 `curriculum_item_id`나 `confidence`를 임의 변경해도 서버가 탐지하지 못함

### 해결: HMAC-signed match_token (채택 이유)

**임시 후보 테이블 방식과 비교:**

| 항목 | 임시 후보 테이블 | HMAC match_token (채택) |
|------|----------------|------------------------|
| 서버 확장 | ✅ DB 공유 | ✅ 무상태 |
| 서버 재시작 | ✅ 영속 | ✅ 영속 (토큰이 앱에) |
| DB 쓰기 부하 | 후보 생성마다 INSERT | 없음 |
| 앱 변조 탐지 | 저장 시 DB 재조회 | 서명 검증으로 즉시 탐지 |
| TTL 관리 | 배치 청소 필요 | expires_at 필드 내장 |
| 복잡도 | 중간 | 낮음 |

**채택: HMAC match_token**

---

### match_token 구조

```typescript
// 서버 생성 페이로드 (앱에 전달)
interface MatchTokenPayload {
  request_id:            string;   // uuid — AI 요청 단위 식별
  student_ref:           string;   // student_id의 HMAC-SHA256 해시 (직접 노출 금지)
  curriculum_item_id:    string;   // DB PK — 앱 변조 불가
  curriculum_version_id: string;   // 저장 시 version drift 탐지
  candidate_id:          string;   // "cand_7f3a2c" — 불투명 식별자
  confidence:            number;   // 서버 계산값 — 앱 변조 불가
  expires_at:            string;   // ISO8601 — 기본 24시간
  hmac:                  string;   // HMAC-SHA256(payload_without_hmac, JWT_SECRET)
}
```

```typescript
// growth-confidence-config.ts
export const MATCH_TOKEN_TTL_SEC = 86_400; // 24시간

// 토큰 생성 (AI Pipeline 응답 구성 시)
function createMatchToken(payload: Omit<MatchTokenPayload, 'hmac'>): string {
  const sorted = stableStringify(payload); // 키 정렬 직렬화
  const hmac   = createHmac('sha256', process.env.JWT_SECRET!).update(sorted).digest('hex');
  const full   = { ...payload, hmac };
  return Buffer.from(JSON.stringify(full)).toString('base64url');
}

// 토큰 검증 (성장 이벤트 저장 요청 수신 시)
function verifyMatchToken(
  token: string,
  claimedStudentId: string,
  claimedPoolId:    string,
): MatchTokenPayload {
  const raw     = JSON.parse(Buffer.from(token, 'base64url').toString());
  const { hmac, ...rest } = raw;

  // 1. 서명 검증
  const expected = createHmac('sha256', process.env.JWT_SECRET!).update(stableStringify(rest)).digest('hex');
  if (!timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
    throw new AppError(400, 'INVALID_MATCH_TOKEN');
  }

  // 2. 만료 검증
  if (new Date(raw.expires_at) < new Date()) {
    throw new AppError(400, 'MATCH_TOKEN_EXPIRED');
  }

  // 3. student_ref 검증 (앱이 보낸 student_id와 매칭)
  const expectedRef = createHmac('sha256', process.env.JWT_SECRET!).update(claimedStudentId).digest('hex');
  if (raw.student_ref !== expectedRef) {
    throw new AppError(403, 'STUDENT_MISMATCH');
  }

  // 4. pool 소속 검증 (curriculum_items 조회로 확인)
  //    → verifyMatchToken 호출 후 DB에서 curriculum_item.pool_id == claimedPoolId 재확인 필요

  return raw as MatchTokenPayload;
}
```

### AI Response Contract 변경 (V1.2 → V1.3)

```typescript
// POST /api/v1/teacher-diary/generate 응답
interface CurriculumMatch {
  match_token:   string;   // ← V1.2의 candidate_id + curriculum_item_id + confidence 통합
  display_label: string;   // UI 표시용 (서버 생성)
  concept_tags:  string[];
}

interface AIGenerateResponse {
  request_id:         string;
  common:             string;
  students: {
    student_id:          string;
    content:             string;
    curriculum_matches:  CurriculumMatch[];  // match_token 포함
  }[];
  ai_version:         string;
  pipeline_version:   string;
  generated_at:       string;
}
```

### 저장 요청 검증 흐름

```
앱 → POST /diaries  { diary_content, student_diary_items: [{ student_id, match_tokens: ["eyJ..."] }] }
                                           ↓
서버 verifyMatchToken(token, student_id, poolId)
  ├─ 서명 실패    → 400 INVALID_MATCH_TOKEN
  ├─ 만료         → 400 MATCH_TOKEN_EXPIRED  (재생성 안내)
  ├─ student_ref  → 403 STUDENT_MISMATCH
  └─ OK → payload.curriculum_item_id, confidence 신뢰 사용
                                           ↓
DB 재확인: curriculum_items WHERE id=? AND pool_id=? AND version_id=?
  ├─ 없음         → 409 CURRICULUM_VERSION_DRIFT
  └─ OK → growth_events INSERT (confidence = payload.confidence)
```

---

## FIX-2 | Audit entity_version → Atomic UPSERT

### 문제 (V3.3 설계의 결함)
- `SELECT MAX(entity_version) ... FOR UPDATE` 패턴은 동시 트랜잭션에서 두 트랜잭션 모두 동일 MAX를 읽으면 중복 version이 생성됨
- PostgreSQL에서 FOR UPDATE는 row lock이지 aggregation lock이 아님

### 해결: audit_entity_versions 테이블 + UPSERT RETURNING

#### 신규 테이블 (M-H — WP1 Migration에 추가)

```sql
-- audit_entity_versions: entity별 version counter
CREATE TABLE IF NOT EXISTS audit_entity_versions (
  entity_type  text    NOT NULL,
  entity_id    text    NOT NULL,
  version      bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
);
```

#### Atomic increment 함수 (PostgreSQL)

```sql
-- 사용 예: SELECT next_audit_version('curriculum_item', 'item_abc123');
CREATE OR REPLACE FUNCTION next_audit_version(
  p_entity_type text,
  p_entity_id   text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v bigint;
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

#### 서버 코드 패턴

```typescript
// audit-log 헬퍼 (신규 파일: src/lib/audit-log.ts)
async function writeAuditLog(
  db: Db,
  opts: {
    entity_type:    string;
    entity_id:      string;
    action:         'create' | 'update' | 'delete';
    actor_id:       string;
    actor_role:     string;
    pool_id:        string;
    correlation_id: string;
    diff:           Record<string, { before: unknown; after: unknown }>;
  }
): Promise<void> {
  // ① Atomic version 채번 — 동시 호출 시 중복 불가
  const [{ next_audit_version: version }] = await db.execute(sql`
    INSERT INTO audit_entity_versions (entity_type, entity_id, version)
    VALUES (${opts.entity_type}, ${opts.entity_id}, 1)
    ON CONFLICT (entity_type, entity_id)
    DO UPDATE SET version = audit_entity_versions.version + 1
    RETURNING version
  `);

  // ② audit_logs INSERT
  await db.execute(sql`
    INSERT INTO audit_logs
      (entity_type, entity_id, entity_version, action,
       actor_id, actor_role, pool_id, correlation_id, diff, created_at)
    VALUES
      (${opts.entity_type}, ${opts.entity_id}, ${version}, ${opts.action},
       ${opts.actor_id}, ${opts.actor_role}, ${opts.pool_id}, ${opts.correlation_id},
       ${JSON.stringify(opts.diff)}, NOW())
  `);
}
```

**보장:** `audit_entity_versions`의 PK (entity_type, entity_id) + `ON CONFLICT DO UPDATE SET version = version + 1`은 PostgreSQL이 단일 row lock으로 처리하므로 동시 트랜잭션에서도 version 중복이 발생하지 않음.

---

## FIX-3 | Migration 문법 → DO $$ / information_schema 패턴

### 문제
- `ADD CONSTRAINT IF NOT EXISTS`는 **PostgreSQL 어떤 버전도 지원하지 않음** (PG 9.6 ~ PG 16 모두 미지원)
- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`는 지원됨

### 코드베이스 확인 결과
기존 `pool-db-init.ts`에서 이미 두 가지 패턴을 사용 중:

**패턴 A — DO $$ EXCEPTION 블록 (ENUM, CONSTRAINT 생성에 사용)**
```sql
-- 기존 사용 예 (line 21~37)
DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

**패턴 B — information_schema 조회 후 동적 ADD (기존 line 442)**
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'pool_push_settings' AND constraint_name = 'pool_push_settings_pool_id_unique'
  ) THEN
    ALTER TABLE pool_push_settings ADD CONSTRAINT pool_push_settings_pool_id_unique UNIQUE (pool_id);
  END IF;
END $$;
```

### WP1 Migration SQL 작성 원칙 (확정)

| 구문 | 지원 여부 | 사용 방법 |
|------|----------|-----------|
| `CREATE TABLE IF NOT EXISTS` | ✅ PG 9.6+ | 직접 사용 |
| `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | ✅ PG 9.6+ | 직접 사용 |
| `CREATE INDEX IF NOT EXISTS` | ✅ PG 9.6+ | 직접 사용 |
| `CREATE UNIQUE INDEX IF NOT EXISTS` | ✅ PG 9.6+ | 직접 사용 |
| `ADD CONSTRAINT IF NOT EXISTS` | ❌ 미지원 | DO $$ + information_schema 패턴 B |
| ENUM 타입 생성 | ❌ 중복 시 오류 | DO $$ + EXCEPTION 패턴 A |
| `CREATE OR REPLACE FUNCTION` | ✅ | 직접 사용 |

### WP1 M-H (audit_entity_versions) 실제 실행 가능 SQL

```sql
-- M-H-1: audit_entity_versions 테이블
CREATE TABLE IF NOT EXISTS audit_entity_versions (
  entity_type  text    NOT NULL,
  entity_id    text    NOT NULL,
  version      bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
);

-- M-H-2: next_audit_version 함수
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

-- M-H-3: xmode 상태 ENUM (패턴 A)
DO $$ BEGIN
  CREATE TYPE xmode_config_status_enum AS ENUM
    ('NOT_CONFIGURED', 'CURRICULUM_PENDING', 'READY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- M-H-4: growth_match_status ENUM (패턴 A)
DO $$ BEGIN
  CREATE TYPE growth_match_status_enum AS ENUM
    ('AUTO_ACCEPTED', 'PENDING_REVIEW', 'TEACHER_ACCEPTED', 'TEACHER_REJECTED', 'DISCARDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- M-H-5: global_template_sets ACTIVE 유일성 인덱스 (패턴 B)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'uniq_global_template_sets_active' AND n.nspname = 'public'
  ) THEN
    CREATE UNIQUE INDEX uniq_global_template_sets_active
      ON global_template_sets (pool_id)
      WHERE status = 'ACTIVE';
  END IF;
END $$;

-- M-H-6: xmode_entitlement, xmode_config_status 컬럼 추가
ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS xmode_entitlement    boolean                  NOT NULL DEFAULT false;
ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS xmode_config_status  xmode_config_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED';

-- M-H-7: ai_daily_usage reserved_count 컬럼 추가 (FIX-4)
ALTER TABLE ai_daily_usage ADD COLUMN IF NOT EXISTS reserved_count  integer NOT NULL DEFAULT 0;
ALTER TABLE ai_daily_usage ADD COLUMN IF NOT EXISTS failed_count    integer NOT NULL DEFAULT 0;
```

---

## FIX-4 | Parent AI 동시 한도 → reserved_count 예약 구조

### 문제 (V3.3 설계의 결함)
- `completed_count`만 집계하면 동시 요청 N개가 모두 한도 미달로 통과 후 완료 시 초과됨
- 예: 월 한도 2회, 동시 요청 3개 → 셋 다 `completed=0` 읽고 통과 → `completed=3`으로 초과

### 해결: reserved_count 예약 구조

#### ai_daily_usage 테이블 컬럼 추가 (M-H-7에 포함)

```
completed_count  — 성공 완료 횟수 (기존)
reserved_count   — 진행 중 예약 횟수 (신규)
failed_count     — 실패 횟수 (신규, 청구 제외)
```

#### 한도 검사 기준

```
사용 실효값 = completed_count + reserved_count
한도 초과   = 사용 실효값 >= monthly_limit
```

#### Transaction 설계 (4가지 케이스)

**케이스 A: 요청 시작 — Intent 예약**
```sql
-- RETURNING으로 갱신 후 값을 원자적으로 확인
UPDATE ai_daily_usage
SET reserved_count = reserved_count + 1,
    updated_at     = NOW()
WHERE parent_id    = $1
  AND usage_month  = $2                         -- 'YYYY-MM'
  AND (completed_count + reserved_count) < $3   -- monthly_limit
RETURNING completed_count, reserved_count, failed_count;

-- 0 rows → 한도 초과 또는 row 없음
-- 1 row  → 예약 성공, (completed + reserved) 재확인
```

```typescript
// 케이스 A 서버 코드 패턴
async function reserveAiUsage(db, parentId, month, limit) {
  const rows = await db.execute(sql`
    INSERT INTO ai_daily_usage (parent_id, usage_month, completed_count, reserved_count, failed_count)
    VALUES (${parentId}, ${month}, 0, 1, 0)
    ON CONFLICT (parent_id, usage_month)
    DO UPDATE SET
      reserved_count = CASE
        WHEN ai_daily_usage.completed_count + ai_daily_usage.reserved_count < ${limit}
        THEN ai_daily_usage.reserved_count + 1
        ELSE ai_daily_usage.reserved_count   -- 변경 없음
      END,
      updated_at = NOW()
    WHERE ai_daily_usage.completed_count + ai_daily_usage.reserved_count < ${limit}
    RETURNING completed_count, reserved_count
  `);

  if (rows.rowCount === 0) throw new AppError(429, 'AI_USAGE_LIMIT_REACHED');
  return rows.rows[0]; // 예약 성공
}
```

**케이스 B: 성공 완료 — reserved → completed 이동**
```sql
UPDATE ai_daily_usage
SET reserved_count  = GREATEST(0, reserved_count - 1),
    completed_count = completed_count + 1,
    updated_at      = NOW()
WHERE parent_id   = $1
  AND usage_month = $2;
```

**케이스 C: 실패 완료 — reserved 반환 + failed 증가**
```sql
UPDATE ai_daily_usage
SET reserved_count = GREATEST(0, reserved_count - 1),
    failed_count   = failed_count + 1,
    updated_at     = NOW()
WHERE parent_id   = $1
  AND usage_month = $2;
-- 실패는 monthly_limit에서 차감하지 않음 (completed_count 불변)
```

**케이스 D: Intent 차단 (한도 초과 응답 전)**
```sql
-- 예약 자체를 하지 않으므로 별도 rollback 불필요
-- reserveAiUsage가 0 rows RETURNING → AppError(429) 반환
```

#### 서버 try/finally 패턴

```typescript
async function handleParentAiRequest(parentId, month, limit, aiCall) {
  await reserveAiUsage(db, parentId, month, limit);      // 케이스 A

  try {
    const result = await aiCall();
    await commitAiUsage(db, parentId, month);            // 케이스 B
    return result;
  } catch (err) {
    await failAiUsage(db, parentId, month);              // 케이스 C
    throw err;
  }
}
```

---

## FIX-5 | Global Template 동시 활성화 → Advisory Transaction Lock

### 문제 (V3.3 설계의 결함)
- 두 요청이 동시에 ACTIVE 전환을 시도하면 ARCHIVED → ACTIVE 순서가 교차하여 두 개의 ACTIVE가 잠시 공존 가능

### 해결: pg_try_advisory_xact_lock + SELECT FOR UPDATE row lock 이중 보호

#### Transaction 구조

```typescript
async function activateGlobalTemplateSet(db, templateSetId, actorId) {
  await db.execute(sql`BEGIN`);
  try {

    // ① Advisory Transaction Lock — 동시 활성화 요청 직렬화
    //    lock_key: 'global_template_activate' 의 hashtext (동일 수식 유지 필수)
    const locked = await db.execute(sql`
      SELECT pg_try_advisory_xact_lock(hashtext('global_template_activate'))
    `);
    if (!locked.rows[0].pg_try_advisory_xact_lock) {
      throw new AppError(409, 'TEMPLATE_ACTIVATION_IN_PROGRESS');
    }

    // ② 대상 row SELECT FOR UPDATE — version drift 방지
    const target = await db.execute(sql`
      SELECT id, status, version FROM global_template_sets
      WHERE id = ${templateSetId}
      FOR UPDATE
    `);
    if (!target.rows[0]) throw new AppError(404, 'TEMPLATE_SET_NOT_FOUND');
    if (target.rows[0].status === 'ACTIVE') throw new AppError(409, 'ALREADY_ACTIVE');

    // ③ 기존 ACTIVE → ARCHIVED (FOR UPDATE로 lock)
    await db.execute(sql`
      UPDATE global_template_sets
      SET status     = 'ARCHIVED',
          updated_at = NOW()
      WHERE status   = 'ACTIVE'
    `);

    // ④ 대상 → ACTIVE
    await db.execute(sql`
      UPDATE global_template_sets
      SET status     = 'ACTIVE',
          updated_at = NOW()
      WHERE id = ${templateSetId}
    `);

    // ⑤ Audit Log 기록 (FIX-2 패턴 사용)
    await writeAuditLog(db, {
      entity_type:    'global_template_set',
      entity_id:      templateSetId,
      action:         'update',
      actor_id:       actorId,
      actor_role:     'super_admin',
      pool_id:        'GLOBAL',
      correlation_id: genCorrelationId(),
      diff:           { status: { before: target.rows[0].status, after: 'ACTIVE' } },
    });

    await db.execute(sql`COMMIT`);
  } catch (err) {
    await db.execute(sql`ROLLBACK`);
    throw err;
  }
}
```

#### 보장
- `pg_try_advisory_xact_lock`은 Transaction 범위 lock → COMMIT/ROLLBACK 시 자동 해제
- `ROLLBACK` 시 advisory lock도 함께 해제되므로 교착 없음
- 두 번째 요청은 `pg_try_advisory_xact_lock = false` 즉시 반환 → 409

#### 동시 활성화 테스트 명세 (WP14 E2E에 추가)

```typescript
test('동시 활성화 요청 — 하나만 성공해야 함', async () => {
  const [r1, r2] = await Promise.all([
    request.patch(`/admin/global-template-sets/${setA}/activate`),
    request.patch(`/admin/global-template-sets/${setB}/activate`),
  ]);

  // 둘 중 하나는 409
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([200, 409]);

  // ACTIVE는 정확히 1개
  const active = await db.query(`SELECT COUNT(*) FROM global_template_sets WHERE status='ACTIVE'`);
  expect(active.rows[0].count).toBe('1');
});
```

---

## FIX-6 | 삭제 학생 표시 정책 → deleted_at IS NULL 필터 전체 범위

### 정책 확정

| 영역 | 삭제 학생 표시 여부 | 조건 |
|------|-------------------|------|
| teacher/parent 일반 화면 | ❌ 숨김 | `deleted_at IS NULL` 필터 필수 |
| super_admin 감사/리포트 | ✅ '삭제된 회원'으로 표시 | 필터 없음, name='삭제된 회원' |
| parent_students 관계 | ✅ 보존 | 삭제 학생이라도 관계 레코드 유지 |
| 과거 일지/출결/결제 기록 | ✅ 원문 보존 | 삭제 여부와 무관 (히스토리) |

### 코드베이스 조사 결과: deleted_at IS NULL 필터 누락 범위

```
REPOSITORY_VERIFIED — 2026-08-02 기준
```

#### ① `routes/parent.ts` — students 직접 조회 (deleted_at 필터 없음)

| 위치 | 쿼리 | 누락 이유 | WP7 수정 필요 |
|------|------|----------|--------------|
| L101, L112, L127, L133 | `SELECT id FROM students WHERE id = ?` | 단건 조회 | ✅ |
| L164 | `SELECT COUNT(*) FROM students` | 집계 | ✅ |
| L317 | `JOIN students s ON s.id = ps.student_id` | parent_students 경유 | ✅ |
| L427 | `SELECT id, name FROM students WHERE id = ?` | 단건 조회 | ✅ |
| L792 | `SELECT current_level_order FROM students WHERE id = ?` | 단건 조회 | ✅ |
| L1197 | `SELECT * FROM students WHERE id = ?` | 단건 조회 (리포트) | ✅ |
| L1855, L1929 | `FROM students WHERE id = ?` | parent link 확인 | ✅ |

#### ② `routes/diary.ts` — students 조인 (부분 미적용)

| 위치 | 현재 조건 | 문제 | WP7 수정 필요 |
|------|----------|------|--------------|
| L140 | `ps.status='approved' AND s.deleted_at IS NULL` | ✅ 이미 적용 | — |
| L300 | `s.status NOT IN ('withdrawn','deleted')` | `deleted_at IS NULL` 미적용 | ✅ |
| L353 | `LEFT JOIN students s ON s.id = cdn.student_id` | WHERE 없음 | ✅ (LEFT JOIN이므로 IS NULL 조건 별도) |
| L668 | `JOIN students s ON s.id = csn.student_id` | deleted_at 없음 | ✅ |
| L2084, L2091 | `s.status NOT IN ('withdrawn','deleted')` | `deleted_at IS NULL` 미적용 | ✅ |

#### ③ `routes/admin.ts` — 이미 적용된 위치 (수정 불필요)

| 위치 | 확인 |
|------|------|
| L2847, L2947, L2976, L2987, L3030, L3061 | `deleted_at IS NULL` ✅ 적용됨 |
| L839 (super_admin 목록) | `deleted_at` 컬럼 SELECT만, 필터 없음 — **의도적** (super_admin 감사용) |

#### ④ `routes/attendance.ts` — 이미 적용 (수정 불필요)
- L151, L233: `s.deleted_at IS NULL` ✅ 적용됨

#### ⑤ `routes/teachers.ts` — 이미 적용 (수정 불필요)
- L321: `deleted_at IS NULL` ✅
- L491, L492, L502: `s.deleted_at IS NULL` ✅

#### ⑥ `routes/class-groups.ts` — 이미 적용 (수정 불필요)
- L52, L418: `deleted_at IS NULL` ✅

### WP7에서 추가할 필터 요약 (함수·파일 기준)

```
[WP7-FILTER-1] routes/parent.ts
  대상: L101, L112, L127, L133, L164, L317, L427, L792, L1197, L1855, L1929
  추가: AND s.deleted_at IS NULL (또는 WHERE id=? AND deleted_at IS NULL)
  예외: parent link 확인 (L1855, L1929) — 관계 보존 목적이므로 parent_students 쿼리는 유지,
        students 직접 조회 부분에만 IS NULL 추가

[WP7-FILTER-2] routes/diary.ts
  대상: L300, L668, L2084, L2091
  변경: status NOT IN ('withdrawn','deleted') → status NOT IN ('withdrawn','deleted') AND s.deleted_at IS NULL
  대상: L353 (LEFT JOIN)
  추가: AND (s.deleted_at IS NULL OR s.id IS NULL)  ← LEFT JOIN 특성 유지

[WP7-FILTER-3] 신규 growth_events/growth_reports 조회 API
  모든 students JOIN에 s.deleted_at IS NULL 포함 (신규 코드이므로 처음부터 적용)
```

---

## PHASE | WP4-A/4-B/5/6/6-B 재편

### V3.3 → V3.3.1 Phase 변경

| V3.3 | V3.3.1 | 변경 내용 |
|------|--------|----------|
| WP4 (단일) | WP4-A + WP4-B | Template Set DB/API 분리, 파일럿 50개 별도 단계 |
| WP5 | WP5 | Global Search 분기 (명칭 유지, 범위 명확화) |
| WP6 (단일) | WP6 + WP6-B | Candidate Contract 분리, 파일럿 품질·검증 별도 단계 |
| WP15 | WP15 | 검증 통과 후 2,000개 확대 (조건 명확화) |

### 재편 상세

#### WP4-A | Global Template Set DB + API
- `global_template_sets` 테이블 생성 (M-H-5 인덱스 포함)
- CRUD API: `POST/GET/PATCH /admin/global-template-sets`
- 활성화 API: `PATCH /admin/global-template-sets/:id/activate` (FIX-5 Advisory Lock 적용)
- `(super)/template-sets.tsx` 신규 화면
- **완료 기준:** ACTIVE 최대 1개 제약 동시성 테스트 통과

#### WP4-B | 파일럿 50개 템플릿 생성
- `global_template_sets`에 DRAFT 상태 Set 1개 생성
- `curriculum_items` 50개 수동 입력 또는 스크립트 생성
- 내용: 초·중·상급별 대표 영법(자유형·배영·평영·접영) × 레벨 단계 포함
- **완료 기준:** 50개 DRAFT 상태 DB 저장 확인

#### WP5 | Global Search 분기
- `diary-template-search.ts`의 `searchTemplates(poolId, meaning)` 확장
- 분기 로직: `pool_curriculum_items` 미존재 → `global_template_sets(ACTIVE).curriculum_items` fallback
- **완료 기준:** pool 커리큘럼 없는 환경에서 global 검색 결과 반환

#### WP6 | Candidate Contract (V1.3)
- AI Pipeline 응답에 `match_token` 포함 (FIX-1 구조 적용)
- `createMatchToken`, `verifyMatchToken` 구현
- `/diaries` POST 저장 시 token 검증 → `growth_events` INSERT
- `GrowthConfidenceConfig` 로드 및 confidence 계산 서버 전담
- **완료 기준:** 변조된 match_token 거부 테스트 통과

#### WP6-B | 파일럿 품질·Latency·Threshold 검증
- 파일럿 50개 대상 실제 AI 호출 10~20건
- 측정: latency P50/P95, confidence 분포, AUTO_ACCEPTED/PENDING_REVIEW/DISCARDED 비율
- 검증 기준 (초안): `AUTO_ACCEPTED ≥ 40%`, `P95 latency ≤ 8s`, `DISCARDED ≤ 20%`
- threshold 조정 후 `growth-confidence-config.ts` 업데이트
- **완료 기준:** 품질 기준 통과 리포트 제출 → WP15 확대 결정 입력값으로 사용

#### WP15 | 2,000개 확대 (WP6-B 통과 후)
- WP6-B 검증 통과가 전제 조건
- 파일럿 DRAFT Set ARCHIVED → 신규 2,000개 Set ACTIVE 전환
- **완료 기준:** ACTIVE Set 2,000개 curriculum_items 확인

---

## 변경 요약 (V3.3 → V3.3.1)

| ID | 항목 | V3.3 | V3.3.1 |
|----|------|------|--------|
| FIX-1 | candidateMap | 요청 메모리 Map | HMAC signed match_token |
| FIX-2 | Audit entity_version | SELECT MAX FOR UPDATE | audit_entity_versions UPSERT RETURNING |
| FIX-3 | Migration 문법 | ADD CONSTRAINT IF NOT EXISTS | DO $$ / information_schema 패턴 |
| FIX-4 | Parent AI 한도 | completed_count만 검사 | reserved_count 예약 구조 + 4케이스 Transaction |
| FIX-5 | Template 활성화 | 단순 Transaction | Advisory Transaction Lock + row lock |
| FIX-6 | 삭제 학생 표시 | 미정의 | deleted_at IS NULL 전체 파일·함수 범위 확정 |
| PHASE | WP4/5/6 | 단일 WP | WP4-A/4-B/5/6/6-B 분리 |

---

## NEEDS_VERIFICATION (신규 추가)

V3.3 기존 목록 외 이번 정정에서 발생한 미확인 항목:

- **NV-9** HMAC match_token에 사용하는 `JWT_SECRET`이 서버 재배포 시 교체되면 기존 미저장 토큰 전체 무효화됨 → 별도 `MATCH_TOKEN_SECRET` 분리 여부 결정 필요
- **NV-10** `pg_try_advisory_xact_lock(hashtext('global_template_activate'))` — hashtext 결과값이 환경에 따라 다를 수 있으므로 lock key를 하드코딩 정수 상수로 바꿀지 결정 필요 (예: `pg_try_advisory_xact_lock(20260802)`)
- **NV-11** `ai_daily_usage` 테이블이 현재 DB에 존재하는지 확인 필요 (신규 생성 vs ALTER TABLE)
- **NV-12** WP6-B 파일럿 품질 검증 기준값 (`AUTO_ACCEPTED ≥ 40%` 등)은 실측 전 초안 — 파일럿 후 확정

---
*최종 작성: 2026-08-02 | 상태: 승인 대기 | 다음 단계: WP1 구현 승인 후 Migration 실행*
