# SWIMNOTE 보강(Makeup) 시스템 전체 아키텍처 감사 보고서

> **작성 기준**: 2026-08-07 KST  
> **조사 범위**: READ-ONLY. 코드 수정·커밋·푸시·배포 전혀 없음.  
> **목적**: REQ-1~4 충돌 위치 파악 + 전체 구조 기록. 해결책 작성 금지.  
> **표기 규칙**: `CONFIRMED` = 코드 직접 확인, `INFERRED` = 간접 추론, `UNKNOWN` = 미확인

---

## 목차

| # | 섹션 | 상태 |
|---|------|------|
| 01 | Git 상태 | CONFIRMED |
| 02 | 파일 구조 개요 | CONFIRMED |
| 03 | makeup_sessions DB 스키마 전체 | CONFIRMED |
| 04 | status 상태 머신 | CONFIRMED |
| 05 | source_type 유형 목록 | CONFIRMED |
| 06 | expire_at 생성 정책 | CONFIRMED |
| 07 | can_expire 필드 의미 | CONFIRMED |
| 08 | is_expired 계산 방식 | CONFIRMED |
| 09 | GET /teacher/makeups (대기 목록) | CONFIRMED |
| 10 | GET /teacher/makeups/eligible-classes | CONFIRMED |
| 11 | GET /teacher/makeups/:id/eligible-occurrences | CONFIRMED |
| 12 | validateMakeupOccurrence 함수 | CONFIRMED |
| 13 | PATCH /teacher/makeups/:id/assign | CONFIRMED |
| 14 | PATCH /teacher/makeups/:id/complete-direct | CONFIRMED |
| 15 | POST /teacher/makeups/:id/handover | CONFIRMED |
| 16 | GET /teacher/makeups/assigned | CONFIRMED |
| 17 | PATCH /teacher/makeups/:id/complete | CONFIRMED |
| 18 | PATCH /teacher/makeups/:id/revert (teacher 경로) | CONFIRMED |
| 19 | POST /teacher/makeups/:id/extinguish | CONFIRMED |
| 20 | GET /teacher/makeup-requests (history) | CONFIRMED |
| 21 | GET /admin/makeups/eligible-classes | CONFIRMED |
| 22 | PATCH /admin/makeups/:id/assign | CONFIRMED |
| 23 | PATCH /admin/makeups/:id/complete | CONFIRMED |
| 24 | PATCH /admin/makeups/:id/revert | CONFIRMED |
| 25 | PATCH /admin/makeups/:id/cancel | CONFIRMED |
| 26 | POST /admin/makeups/:id/extinguish | CONFIRMED |
| 27 | PATCH /admin/makeups/:id/self-extinguish | CONFIRMED |
| 28 | 보강 생성 경로 1: teacher_absence (absences.ts) | CONFIRMED |
| 29 | 보강 생성 경로 2: attendance.ts autoCreateMakeup | CONFIRMED |
| 30 | 보강 생성 경로 3: parent-requests link-result | CONFIRMED |
| 31 | makeup-date-range.ts 전체 | CONFIRMED |
| 32 | teacher/makeups.tsx — State 변수 전체 목록 | CONFIRMED |
| 33 | teacher/makeups.tsx — 탭 구조 | CONFIRMED |
| 34 | teacher/makeups.tsx — loadWaiting / loadAssigned / loadHistory | CONFIRMED |
| 35 | teacher/makeups.tsx — selectClass 흐름 | CONFIRMED |
| 36 | teacher/makeups.tsx — doAssign 흐름 | CONFIRMED |
| 37 | teacher/makeups.tsx — doDirectComplete 흐름 | CONFIRMED |
| 38 | teacher/makeups.tsx — doHandover 흐름 | CONFIRMED |
| 39 | teacher/makeups.tsx — doSelfExtinguish 흐름 | CONFIRMED |
| 40 | teacher/makeups.tsx — handleTeacherComplete / handleRevert | CONFIRMED |
| 41 | 대기 목록 정렬 및 is_expired 구분선 | CONFIRMED |
| 42 | AuthContext API 캐시 구조 | CONFIRMED |
| 43 | parent-requests link-result 경계 | CONFIRMED |
| 44 | admin/makeups.tsx 클라이언트 구조 | CONFIRMED |
| 45 | REQ-4 충돌 위치 종합 (정원 초과 차단) | CONFIRMED |
| 46 | REQ-2 충돌 위치 종합 (날짜 범위) | CONFIRMED |
| 47 | REQ-1 현황 (기간 지난 보강 유지) | CONFIRMED |
| 48 | REQ-3 현황 (선보강 허용) | CONFIRMED |

---

## 섹션 01 — Git 상태

**CONFIRMED** (2026-08-07 기준)

| 항목 | 값 |
|------|-----|
| 브랜치 | `release/v1.2-phase1-clean` |
| Local HEAD | `7eb93859` — `docs/makeup-capacity-override-spec.md` 추가 (미push) |
| Remote HEAD | `32734188` — OTA 후 dev script 복원 |
| 관계 | Local이 Remote보다 1커밋 앞서 있음 |
| Untracked | 첨부 txt 파일 1개 |

> **주의**: `7eb93859` 커밋(spec 파일)은 push되지 않았다. 이 보고서 파일(`docs/makeup-architecture-audit.md`)도 동일하게 untracked 상태가 될 것이다. push는 별도 승인 필요.

---

## 섹션 02 — 파일 구조 개요

**CONFIRMED**

보강 시스템에 관련된 파일 목록:

```
artifacts/api-server/src/
├── routes/
│   ├── teachers.ts          # teacher용 모든 makeup API
│   ├── admin.ts             # admin용 모든 makeup API
│   ├── absences.ts          # 선생님 결근 → 보강 생성 경로 1
│   ├── attendance.ts        # 출결 absent → 보강 생성 경로 2
│   └── parent-requests.ts   # 학부모 요청 → 보강 연결 경로 3
├── lib/
│   └── makeup-date-range.ts # 날짜 범위 헬퍼 (getMakeupDateRange, validateMakeupDateRange)
└── migrations/
    └── pool-db-init.ts      # makeup_sessions 스키마 정의

artifacts/swim-app/app/
├── (teacher)/
│   └── makeups.tsx          # 선생님 보강 화면 (대기/배정/현황 탭)
└── (admin)/
    └── makeups.tsx          # 관리자 보강 화면
```

---

## 섹션 03 — makeup_sessions DB 스키마 전체

**CONFIRMED** (`artifacts/api-server/src/migrations/pool-db-init.ts` 179–230행)

```sql
CREATE TABLE IF NOT EXISTS makeup_sessions (
  -- 식별자
  id                         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  swimming_pool_id           text        NOT NULL,

  -- 학생
  student_id                 text        NOT NULL,
  student_name               text,

  -- 원래 반 정보 (결석한 반)
  original_class_group_id    text,
  original_class_group_name  text,
  original_teacher_id        text,
  original_teacher_name      text,

  -- 결석 정보
  absence_date               text        NOT NULL,   -- YYYY-MM-DD
  absence_attendance_id      text,
  absence_time               text,
  absence_id                 text,                   -- teacher_absences.id (경로 1 전용)
  source_type                text,                   -- 생성 경로 구분

  -- 만료 정책
  can_expire                 boolean     DEFAULT true,
  expire_at                  timestamptz,
  weekly_frequency           integer     DEFAULT 1,  -- 학생 주간 수업 횟수

  -- 상태
  status                     text        NOT NULL DEFAULT 'waiting',

  -- 배정 정보
  assigned_class_group_id    text,
  assigned_class_group_name  text,
  assigned_teacher_id        text,
  assigned_teacher_name      text,
  assigned_date              text,                   -- YYYY-MM-DD

  -- 대리 수업 정보
  is_substitute              boolean     DEFAULT false,
  substitute_teacher_id      text,
  substitute_teacher_name    text,

  -- 완료 정보
  completed_at               timestamptz,
  completed_attendance_id    text,

  -- 인계 정보
  transferred_to_teacher_id   text,
  transferred_to_teacher_name text,
  transferred_at              timestamptz,
  transferred_by              text,
  transferred_by_name         text,
  handed_to_teacher_id        text,     -- 담당자 간 인계 (status는 waiting 유지)
  handed_to_teacher_name      text,

  -- 취소/소멸 정보
  cancelled_reason            text,
  cancelled_custom            text,
  cancelled_at                timestamptz,
  cancelled_by                text,
  cancelled_by_name           text,

  -- 기타
  note                        text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
```

> `handed_to_teacher_id/name`은 ALTER TABLE로 후에 추가된 컬럼.  
> `absence_id`, `source_type`, `can_expire`, `expire_at`, `weekly_frequency`도 마찬가지.

---

## 섹션 04 — status 상태 머신

**CONFIRMED** (코드 전체에서 사용 패턴 확인)

```
waiting
  ├─→ assigned         (assign API로 배정)
  ├─→ extinguished     (결석소멸: teacher extinguish 또는 admin extinguish 또는 self-extinguish)
  ├─→ cancelled        (admin cancel 또는 absences.ts transfer 시 해당 학생)
  └─→ expired          (INFERRED: cron 또는 수동으로 status='expired' 설정 가능, DB 레벨 상태)

assigned
  ├─→ completed        (admin complete 또는 teacher complete, WHERE status='assigned' 조건부)
  ├─→ waiting          (revert: admin 또는 teacher 경로)
  └─→ transferred      (INFERRED: 상태 머신에 존재, 코드에서 IN('assigned','transferred') 패턴)

transferred
  └─→ waiting          (revert: admin.ts revert에서 ['assigned','transferred'] 모두 처리)

completed → (terminal, 변경 API 없음)
extinguished → (terminal)
cancelled → (terminal)
expired → (INFERRED: terminal, waiting과 함께 대기 목록에 표시됨)
```

> **is_expired vs status='expired'**: `is_expired`는 서버가 응답 시 계산하는 필드 (`status === 'expired' || expire_at < kstNow`). DB의 status 컬럼이 실제로 'expired'로 설정되는 경로는 미확인(INFERRED: cron 가능성).  
> **handed_to_teacher_id**: 인계는 status를 변경하지 않는다. 'waiting' 유지.

---

## 섹션 05 — source_type 유형 목록

**CONFIRMED**

| source_type | 생성 경로 | can_expire | expire_at |
|-------------|-----------|-----------|-----------|
| `'teacher_absence'` | absences.ts (선생님 결근) | `false` (하드코딩) | `null` (미설정) |
| `null` (미설정) | attendance.ts autoCreateMakeup (학생 결석 출결 처리) | `true` (스키마 DEFAULT) | 풀 정책에 따라 계산 |
| `null` 또는 기타 | parent-requests link-result (INFERRED, link-result에서 makeupId를 연결하는 구조) | UNKNOWN | UNKNOWN |

---

## 섹션 06 — expire_at 생성 정책

**CONFIRMED** (`artifacts/api-server/src/routes/attendance.ts` 367–431행)

### calcExpireAt 함수

```typescript
function calcExpireAt(expiryType, expiryDays, absenceDate): string | null {
  const base = new Date(absenceDate);  // "YYYY-MM-DD" 문자열 파싱
  if (expiryType === "fixed_days" && expiryDays > 0)
    → base + expiryDays 일
  if (expiryType === "end_of_month")
    → 결석 월 말일 23:59:59 (UTC ISO)
  if (expiryType === "next_month_end")
    → 결석 다음 달 말일 23:59:59 (UTC ISO)
  return null  // 나머지 모든 케이스
}
```

### 풀 정책 조회 (superAdminDb)

- `swimming_pools.make_up_expiry_type` — 없으면 `"end_of_month"` (기본값)
- `swimming_pools.make_up_expiry_days` — 없으면 `null`
- 컬럼 자체가 없을 경우 `try/catch`로 폴백

### 호출 시점

- `autoCreateMakeup` 에서만 호출 (attendance.ts 경로)
- `absences.ts` 경로: `expire_at` 미설정, `can_expire=false`

---

## 섹션 07 — can_expire 필드 의미

**CONFIRMED**

| 값 | 의미 | 설정 경로 |
|----|------|----------|
| `false` | 만료 면제 — expire_at이 있어도 is_expired 계산에서 무시(INFERRED) | absences.ts 하드코딩 |
| `true` (DEFAULT) | 만료 대상 — expire_at + kstNow 비교로 is_expired 결정 | autoCreateMakeup 기본값 |

> **주의**: teachers.ts의 is_expired 계산식(`status === 'expired' || (expire_at != null && toKstDateStr(new Date(expire_at)) < kstNow)`)에서 **`can_expire` 컬럼을 참조하지 않는다**.  
> 즉, DB의 `can_expire=false`가 서버 응답의 `is_expired` 계산에 실제로 반영되는지는 **UNKNOWN**. 필드는 존재하지만 teachers.ts GET /teacher/makeups의 is_expired 계산 로직에 `can_expire` 조건이 없음.

---

## 섹션 08 — is_expired 계산 방식

**CONFIRMED** (`teachers.ts` 620–626행)

```typescript
// GET /teacher/makeups 응답 시 서버에서 계산
is_expired =
  r.status === "expired"
  || (r.expire_at != null && toKstDateStr(new Date(r.expire_at)) < kstNow)
```

- `kstNow` = `toKstDateStr(new Date())` — KST 기준 날짜 문자열 (YYYY-MM-DD)
- `toKstDateStr`: UTC+9 변환 함수 (`makeup-date-range.ts`에 위치, INFERRED)
- `can_expire` 컬럼은 이 계산에 **포함되지 않음**
- `is_expired=true`여도 status는 여전히 `'waiting'` 또는 `'expired'`

---

## 섹션 09 — GET /teacher/makeups (대기 목록)

**CONFIRMED** (`teachers.ts` 594–631행)

**경로**: `GET /teacher/makeups?status=waiting`

### 쿼리 로직

```sql
SELECT ms.*, u.name AS student_name_from_user
FROM makeup_sessions ms
LEFT JOIN users u ON u.id = ms.student_id
WHERE ms.swimming_pool_id = '{poolId}'
  AND ms.status IN ('waiting', 'expired')   -- waiting과 expired 모두 포함
  AND ms.cancelled_at IS NULL
ORDER BY ms.absence_date ASC, ms.created_at ASC
```

### 특이사항

- `status=waiting` 쿼리 파라미터가 있어도 DB에서는 `IN ('waiting', 'expired')` 사용
- `cancelled_at IS NULL` 조건 — cancelled 상태지만 cancelled_at이 없는 경우는 포함될 수 있음(INFERRED)
- 결과에 `is_expired` 필드를 서버에서 추가
- **필터 없음**: poolId 기준 전체 — 담당 선생님 필터 없음 (모든 waiting 보강이 보임)

---

## 섹션 10 — GET /teacher/makeups/eligible-classes

**CONFIRMED** (`teachers.ts` 634–665행)

**경로**: `GET /teacher/makeups/eligible-classes?all=true`

### SQL 핵심

```sql
SELECT
  cg.id, cg.name, cg.schedule_days, cg.schedule_time,
  COUNT(DISTINCT s.id)::int                AS total_students,
  COALESCE(SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END), 0)::int AS present_today,
  GREATEST(cg.capacity - COUNT(DISTINCT s.id), 0)::int                  AS available_slots,
  (GREATEST(cg.capacity - COUNT(DISTINCT s.id), 0) > 0)                 AS is_eligible
FROM class_groups cg
LEFT JOIN students s ...
LEFT JOIN attendance a ...
GROUP BY cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity
HAVING GREATEST(cg.capacity - COUNT(DISTINCT s.id), 0) > 0   -- ⚠️ REQ-4 충돌
```

### REQ-4 충돌 #1 (CONFIRMED)

`HAVING GREATEST(...) > 0` → **정원이 찬 반(`available_slots=0`)은 결과에서 제외됨**.  
즉, 선생님이 보강 배정 모달을 열면 정원 찬 반은 목록에 표시되지 않는다.

---

## 섹션 11 — GET /teacher/makeups/:id/eligible-occurrences

**CONFIRMED** (`teachers.ts` 687–840행, 추가 검증)

**경로**: `GET /teacher/makeups/:makeupId/eligible-occurrences?class_group_id=...`

### 처리 흐름

1. makeup 세션 조회 (`absence_date`, `expire_at`, `swimming_pool_id`)
2. class_group 조회 (`schedule_days`, `schedule_time`, `capacity`, 현재 학생 수)
3. `getMakeupDateRange()` 호출 → `{ from, to }` 날짜 범위 계산
4. `schedule_days` 기반 해당 기간 내 모든 수업일 생성 (occurrence 목록)
5. 각 occurrence에 `is_full`, `available_slots` 계산 후 반환
6. `validateMakeupOccurrence()` 는 **직접 완료 경로**에서만 호출 (assign 경로에선 별도 검증)

### 반환 구조

```typescript
{
  occurrences: [
    {
      occurrence_date: "YYYY-MM-DD",
      class_group_id:  string,
      schedule_time:   string,
      is_full:         boolean,    // 정원 초과 여부 (정보 제공만)
      available_slots: number,
      is_future:       boolean,
      is_today:        boolean,
      is_past:         boolean,
    }
  ],
  date_range: { from, to },
  makeup: { ... }
}
```

> eligible-occurrences 자체는 정원 찬 날짜를 **제외하지 않는다**. 정보만 반환.  
> 차단은 assign 단계(서버) + 클라이언트 UI(disabled)에서 발생.

---

## 섹션 12 — validateMakeupOccurrence 함수

**CONFIRMED** (`teachers.ts` 327–410행)

```typescript
async function validateMakeupOccurrence(
  db, poolId, makeupId, date, classGroupId, allowExpired?: boolean
): Promise<{
  mk: makeup_sessions row,
  cg: class_groups row,
  isFull: boolean,
  currentCount: number,
  capacity: number,
}>
```

### 검증 단계

1. makeup 세션 존재 확인 + poolId 일치 확인
2. makeup 상태 확인 — `'waiting'` 이 아니면 에러
3. classGroup 존재 확인
4. `validateMakeupDateRange(date, mk.absence_date, mk.expire_at, allowExpired)` 호출
   - `allowExpired=true` 이면 날짜 범위 검사 **스킵**
5. 해당 날짜 assigned 보강 수 조회 → `isFull` 계산
6. **`isFull=true`여도 에러를 던지지 않음** — 호출자가 처리 결정

### isFull 계산

```sql
SELECT COUNT(*)::int AS cnt
FROM makeup_sessions
WHERE assigned_class_group_id = classGroupId
  AND assigned_date = date
  AND status = 'assigned'
  AND cancelled_at IS NULL
```

`isFull = currentCount >= capacity`

---

## 섹션 13 — PATCH /teacher/makeups/:id/assign

**CONFIRMED** (`teachers.ts` 843–950행)

**경로**: `PATCH /teacher/makeups/:id/assign`  
**바디**: `{ date, class_group_id }`

### 처리 흐름

1. `validateMakeupOccurrence(db, poolId, makeupId, date, classGroupId)` 호출
   - 내부에서 `validateMakeupDateRange` 호출 (날짜 범위 검사)
2. `if (validation.isFull) → HTTP 400 CLASS_FULL` ← **⚠️ REQ-4 충돌 #2**
3. `UPDATE makeup_sessions SET status='assigned', assigned_date=..., assigned_class_group_id=..., ...`
4. `INSERT INTO attendance ... ON CONFLICT DO UPDATE` (보강 출석 예약)
5. 학부모 요청 자동 연결 시도 (parent_student_requests에서 pending 'makeup' 찾아 link-result)

### REQ-4 충돌 #2 (CONFIRMED)

```typescript
if (validation.isFull) {
  return res.status(400).json({
    error: "CLASS_FULL",
    message: "해당 날짜 수업 정원이 가득 찼습니다.",
    currentCount: validation.currentCount,
    capacity: validation.capacity,
  });
}
```

---

## 섹션 14 — PATCH /teacher/makeups/:id/complete-direct

**CONFIRMED** (`teachers.ts` 1090–1188행)

**경로**: `PATCH /teacher/makeups/:id/complete-direct`  
**바디**: `{ date, class_group_id, allow_expired? }`  
**용도**: 오늘·과거 날짜에 대한 직접 완료 (미래 날짜 배정 없이 즉시 완료)

### 처리 흐름

1. `validateMakeupOccurrence(db, poolId, makeupId, date, classGroupId, allow_expired)` 호출
2. **`isFull` 체크 없음** ← 정원 초과 허용 (올바른 구현)
3. `UPDATE makeup_sessions SET status='completed', is_substitute=TRUE, ...`
4. `INSERT INTO attendance ... (session_type='makeup', status='present')` — 출석 기록 생성

### 특이사항

- `allow_expired=true`이면 만료된 보강도 처리 가능 (클라이언트에서 전달)
- 코드 주석: "expire_at 제한 제거: 날짜 범위가 유일한 날짜 기준"
- `is_substitute=TRUE`로 설정 → 대리 수업으로 처리됨

---

## 섹션 15 — POST /teacher/makeups/:id/handover

**CONFIRMED** (`teachers.ts` 954–1013행)

**경로**: `POST /teacher/makeups/:id/handover`  
**바디**: `{ receiver_teacher_id }`  
**용도**: 담당 선생님 간 보강 인계

### 처리 흐름

1. makeup 상태 확인 — `status !== 'waiting'`이면 409
2. 권한 확인 — `original_teacher_id === userId` OR co-teacher 여부 확인
3. 수신 선생님 동일 풀 소속 확인
4. `UPDATE makeup_sessions SET handed_to_teacher_id=..., handed_to_teacher_name=...`
   - **status는 'waiting' 유지** (변경 없음)
5. `INSERT INTO work_messages` — 메신저 자동 알림

### 특이사항

- 인계 후 보강은 수신 선생님의 대기 목록에 표시 (INFERRED: handed_to_teacher_id로 필터링)
- 대기 목록 필터링 방식은 GET /teacher/makeups에서 `handed_to_teacher_id` 조건이 없으므로 → **전체 poolId 기준으로 보임** (INFERRED: UI에서 handed_to_teacher_id === myId 조건으로 "이관받음" 뱃지 표시)

---

## 섹션 16 — GET /teacher/makeups/assigned

**CONFIRMED** (`teachers.ts` 1016–1033행)

**경로**: `GET /teacher/makeups/assigned`

```sql
SELECT ms.*
FROM makeup_sessions ms
WHERE ms.swimming_pool_id = '{poolId}'
  AND ms.status IN ('assigned', 'transferred')
  AND ms.cancelled_at IS NULL
ORDER BY ms.assigned_date ASC, ms.absence_date ASC, ms.created_at ASC
```

- 풀 전체 배정된 보강 반환 (선생님 필터 없음 — poolId 기준 전체)
- `status IN ('assigned', 'transferred')` — 두 상태 모두 포함
- 정렬: assigned_date ASC → absence_date ASC → created_at ASC

---

## 섹션 17 — PATCH /teacher/makeups/:id/complete

**CONFIRMED** (`teachers.ts` 1285–1345행)

**경로**: `PATCH /teacher/makeups/:id/complete`  
**용도**: 배정된 보강 완료 처리 (보강 수업 실시 후)

### 권한 확인

```typescript
const canComplete = isPoolAdmin
  || mk.original_teacher_id === userId
  || mk.assigned_teacher_id === userId
  || mk.transferred_to_teacher_id === userId;
```

### 처리 흐름

1. 권한 확인 (pool_admin 또는 관련 선생님)
2. `UPDATE makeup_sessions SET status='completed', is_substitute=TRUE, substitute_teacher_id=userId, ...`
3. `INSERT INTO attendance ... (session_type='makeup', status='present') ON CONFLICT DO UPDATE`
4. **`isFull` 체크 없음** — 정원 초과 허용 (올바른 구현)

> `WHERE status='assigned'` 조건 없음 (admin complete와 달리) → 낙관적 잠금 없음.

---

## 섹션 18 — PATCH /teacher/makeups/:id/revert (teacher 경로)

**CONFIRMED** (`teachers.ts` 1192행 주변, 클라이언트 코드 확인)

**경로**: `PATCH /teacher/makeups/:id/revert`  
클라이언트: `apiRequest(token, '/teacher/makeups/${mk.id}/revert', { method: "PATCH" })`

> **UNKNOWN**: teachers.ts 1192행부터 시작하는 revert 핸들러 전문을 직접 확인하지 못함. 클라이언트 코드에서 해당 경로 호출 확인. admin.ts에 동일한 경로가 별도 존재.

**admin.ts revert (CONFIRMED)**:
- `WHERE status IN ('assigned','transferred')` 조건 확인 후 waiting으로 복귀
- assigned_* 컬럼 전부 NULL로 초기화
- `transferred_to_teacher_id`, `is_substitute`, `substitute_teacher_id` 도 NULL로

---

## 섹션 19 — POST /teacher/makeups/:id/extinguish

**CONFIRMED** (`teachers.ts` 1348–1369행)

**경로**: `POST /teacher/makeups/:id/extinguish`  
**용도**: 선생님이 보강 소멸 처리 (학생이 보강을 원하지 않을 때)

```typescript
UPDATE makeup_sessions SET
  status           = 'extinguished',
  cancelled_reason = cancelled_reason || '보강원하지않음',
  cancelled_custom = cancelled_custom || null,
  cancelled_at     = now(),
  cancelled_by     = userId,
  cancelled_by_name= userName,
  updated_at       = now()
WHERE id = req.params.id
```

- `WHERE swimming_pool_id` 조건 없음 (INFERRED: poolId 검증 없이 id만으로 처리)
- 정산 기록 없음 (self-extinguish와 다름)
- 메신저 알림 없음

---

## 섹션 20 — GET /teacher/makeup-requests (history)

**CONFIRMED** (`teachers.ts` 1372–1415행)

**경로**: `GET /teacher/makeup-requests`  
**용도**: 탭 3 "보강 현황" — 이력 조회

```sql
SELECT id, student_name,
  original_class_group_name AS class_name,
  absence_date AS original_date,
  note AS reason,
  status,
  created_at AS requested_at,
  assigned_date AS makeup_date,
  assigned_class_group_name AS makeup_class_name
FROM makeup_sessions
WHERE swimming_pool_id = '{poolId}'
  AND cancelled_at IS NULL
  AND (
    original_teacher_id = userId
    OR EXISTS (
      SELECT 1 FROM class_groups cg
      WHERE cg.id = original_class_group_id
        AND cg.co_teacher_ids @> to_jsonb(userId::text)
    )
  )
ORDER BY absence_date DESC, created_at DESC
```

### status 매핑

```typescript
waiting   → "pending"
assigned  → "approved"
completed → "completed"
기타      → "rejected"
```

> **필터**: `cancelled_at IS NULL` — cancelled·extinguished 건은 이력에서 제외됨  
> **범위**: `original_teacher_id` 또는 co-teacher인 반의 보강만 표시

---

## 섹션 21 — GET /admin/makeups/eligible-classes

**CONFIRMED** (`admin.ts` 1768–1796행)

**경로**: `GET /admin/makeups/eligible-classes?makeup_id=...`

### 처리 흐름

1. makeup 세션 조회
2. class_groups 전체 조회 (해당 풀)
3. 각 반별 `total_students`, `capacity`, `available_slots` 계산
4. `filter(r => r.is_eligible)` 적용 → **⚠️ REQ-4 충돌 #3**

```typescript
const result = classRows.map(cg => ({
  ...cg,
  is_eligible: cg.available_slots > 0,   // 정원 여유 있어야만 eligible
})).filter(r => r.is_eligible);          // ← 정원 찬 반 제외
```

### REQ-4 충돌 #3 (CONFIRMED)

관리자 화면에서 반 목록 조회 시 정원 찬 반은 반환되지 않는다.  
→ 관리자도 정원 찬 반에 보강 배정 불가 (클라이언트에서 선택 자체가 불가)

---

## 섹션 22 — PATCH /admin/makeups/:id/assign

**CONFIRMED** (`admin.ts` 1815–1897행)

**경로**: `PATCH /admin/makeups/:id/assign`  
**권한**: `super_admin`, `pool_admin`

### 처리 흐름

1. poolId 확인
2. makeup 세션 조회
3. class_group 존재 확인
4. **`isFull` 체크 없음** ← 정원 초과 허용 (올바른 구현)
5. `UPDATE makeup_sessions SET status='assigned', assigned_date=..., ...`
6. `INSERT INTO attendance ON CONFLICT DO UPDATE`
7. writeActivityLog

> admin assign은 정원 초과 차단이 없음. teacher assign과 정반대.  
> 단, admin eligible-classes 단계에서 이미 정원 찬 반이 필터링되어 도달 자체가 불가.

---

## 섹션 23 — PATCH /admin/makeups/:id/complete

**CONFIRMED** (`admin.ts` 1934–1987행)

**경로**: `PATCH /admin/makeups/:id/complete`  
**권한**: `super_admin`, `pool_admin`, `teacher`  
**바디**: `{ substitute_teacher_id?, substitute_teacher_name?, note? }`

### 낙관적 잠금 (CONFIRMED)

```sql
UPDATE makeup_sessions SET
  status = 'completed', ...
WHERE id = req.params.id
  AND swimming_pool_id = poolId
  AND status = 'assigned'   -- ← 낙관적 잠금 조건
RETURNING id
```

- `RETURNING id`가 0건이면 409 `MAKEUP_CONFLICT` 반환
- `latest_state`도 함께 반환

### 특이사항

- teacher complete (섹션 17)과 달리 `WHERE status='assigned'` 조건 있음
- `is_substitute` 필드: `substitute_teacher_id !== original_teacher_id` 이면 true

---

## 섹션 24 — PATCH /admin/makeups/:id/revert

**CONFIRMED** (`admin.ts` 1989–2030행)

**경로**: `PATCH /admin/makeups/:id/revert`  
**권한**: `super_admin`, `pool_admin`

```sql
UPDATE makeup_sessions SET
  status = 'waiting',
  assigned_class_group_id    = NULL,
  assigned_class_group_name  = NULL,
  assigned_teacher_id        = NULL,
  assigned_teacher_name      = NULL,
  assigned_date              = NULL,
  transferred_to_teacher_id  = NULL,
  transferred_to_teacher_name= NULL,
  is_substitute              = FALSE,
  substitute_teacher_id      = NULL,
  substitute_teacher_name    = NULL,
  updated_at                 = now()
WHERE id = req.params.id AND swimming_pool_id = poolId
```

- `WHERE status IN ('assigned','transferred')` 사전 확인 후 진행
- assigned_* + transferred_* + substitute_* 모두 초기화

---

## 섹션 25 — PATCH /admin/makeups/:id/cancel

**CONFIRMED** (`admin.ts` 2032–2053행)

**경로**: `PATCH /admin/makeups/:id/cancel`  
**권한**: `super_admin`, `pool_admin`

```sql
UPDATE makeup_sessions SET status = 'cancelled', updated_at = now()
WHERE id = req.params.id AND swimming_pool_id = poolId
```

- `cancelled_at` 컬럼을 설정하지 않음 → `cancelled_at IS NULL`인 채로 status='cancelled' 가능
- 이 경우 대기 목록 쿼리(`AND ms.cancelled_at IS NULL`)에 포함될 수 있음 (INFERRED 버그 가능성)

---

## 섹션 26 — POST /admin/makeups/:id/extinguish

**CONFIRMED** (`admin.ts` 2055–2090행)

**경로**: `POST /admin/makeups/:id/extinguish`  
**권한**: `super_admin`, `pool_admin`  
**바디**: `{ reason, custom? }`

```sql
UPDATE makeup_sessions SET
  status = 'extinguished',
  cancelled_reason = reason,
  cancelled_custom = custom || null,
  cancelled_at = now(),
  cancelled_by = actor.userId,
  cancelled_by_name = actor.name || "관리자",
  updated_at = now()
WHERE id = req.params.id AND swimming_pool_id = poolId
```

- `reason` 필수 (없으면 400)
- `cancelled_at = now()` 설정 → 대기 목록 쿼리에서 제외됨

---

## 섹션 27 — PATCH /admin/makeups/:id/self-extinguish

**CONFIRMED** (`admin.ts` 2279–2338행)

**경로**: `PATCH /admin/makeups/:id/self-extinguish` (POST도 동일 핸들러)  
**권한**: `super_admin`, `pool_admin`, `teacher`  
**용도**: 선생님이 본인 정산 기타 +1을 받고 보강 소멸

### 처리 흐름

1. `status !== 'waiting'`이면 409 (중복 방지)
2. `UPDATE makeup_sessions SET status='extinguished'`
3. `monthly_settlements` 에 `extra_manual_amount +1` (이번 달, 기타 보강 소멸)
   - ON CONFLICT 업데이트 방식
4. `INSERT INTO work_messages` — 메신저 자동 알림

> 클라이언트: `doSelfExtinguish`는 `/admin/makeups/${id}/self-extinguish`를 `PATCH`로 호출

---

## 섹션 28 — 보강 생성 경로 1: teacher_absence (absences.ts)

**CONFIRMED** (`absences.ts` 93–158행)

**트리거**: `POST /absences` — 선생님 결근 등록  
**대상**: 해당 반 전체 재학생

### 생성 SQL

```sql
INSERT INTO makeup_sessions
  (id, swimming_pool_id, student_id, student_name,
   original_class_group_id, original_class_group_name,
   original_teacher_id, original_teacher_name,
   absence_date, absence_attendance_id, status,
   source_type, absence_id, can_expire)
VALUES
  (..., 'waiting', 'teacher_absence', absence.id, false)
```

### 특이사항

- `can_expire = false` (하드코딩)
- `expire_at` 미설정 (NULL)
- `absence_id` 설정 (teacher_absences.id 연결)
- 동일 결근에서 임시이동(transfer) 처리 시 해당 학생의 waiting 보강이 `cancelled`로 전환

---

## 섹션 29 — 보강 생성 경로 2: attendance.ts autoCreateMakeup

**CONFIRMED** (`attendance.ts` 367–487행)

**트리거**: 출결 `POST /` 또는 PUT에서 `status='absent'`로 처리 시 자동 호출

### 중복 방지

```sql
SELECT id, status FROM makeup_sessions
WHERE student_id = studentId AND absence_date = date
  AND status NOT IN ('cancelled','expired')
LIMIT 1
```
→ 이미 세션 존재 시 `{ created: false, reason: "already_exists" }`

### 월간 한도 체크

```sql
SELECT COUNT(*)::int AS cnt FROM makeup_sessions
WHERE student_id = studentId
  AND absence_date LIKE '{YYYY-MM}%'
  AND status NOT IN ('cancelled','expired')
```

- 월 한도: `weekly_count >= 3` → 5, `== 2` → 4, `== 1` → 2 (풀 설정 없을 때 기본값)
- 풀 설정: `swimming_pools.make_up_limit_weekly_{1,2,3}`

### 생성 SQL (핵심)

```sql
INSERT INTO makeup_sessions
  (id, swimming_pool_id, student_id, student_name,
   original_class_group_id, original_class_group_name,
   original_teacher_id, original_teacher_name,
   absence_date, absence_attendance_id, status,
   expire_at, weekly_frequency)
VALUES (..., 'waiting', {calcExpireAt 결과}, {weeklyCount})
```

- `source_type`: 미설정 (NULL)
- `can_expire`: 스키마 DEFAULT `true`

---

## 섹션 30 — 보강 생성 경로 3: parent-requests link-result

**CONFIRMED** (`parent-requests.ts` 571–683행)

**경로**: `POST /parent-requests/:id/link-result`  
**바디**: `{ result_type: "makeup_assignment", result_id: string }`  
**용도**: 학부모가 보강 요청 → 선생님이 실제 보강 배정 후 요청을 처리 완료로 연결

### 처리 흐름

1. `request_type !== 'makeup'`이면 400
2. `status !== 'pending'`이면 400
3. `processed_result_id` 이미 있으면 409
4. `makeup_sessions WHERE id = result_id` 조회 (보강 세션 존재 확인)
5. `UPDATE parent_student_requests SET status='done', processed_result_type='makeup_assignment', processed_result_id=result_id`
   - Partial Unique 위반 시 409

> **핵심**: link-result는 보강을 **생성**하지 않는다. 이미 존재하는 makeup_session에 연결만 함.  
> 이 경로는 보강 생성 경로가 아니라 **요청-보강 연결** 경로.  
> PATCH /teacher/makeups/:id/assign에서 자동으로 link-result를 호출하는 로직이 있음 (섹션 13 참조).

---

## 섹션 31 — makeup-date-range.ts 전체

**CONFIRMED** (`artifacts/api-server/src/lib/makeup-date-range.ts`)

### getMakeupDateRange

```typescript
function getMakeupDateRange(absenceDate: string, expireAt?: string | null): {
  from: string;  // KST 오늘 -14일
  to: string;    // KST 오늘 +28일
}
```

- `from` = KST today - 14일 (경계 포함)
- `to` = KST today + 28일 (경계 포함)
- `absenceDate`, `expireAt` 파라미터가 있어도 범위 계산에 **영향을 미치지 않음** (INFERRED: 파라미터는 다른 목적으로 사용되거나 현재 미사용)

### validateMakeupDateRange

```typescript
function validateMakeupDateRange(
  date: string,           // 검사할 날짜
  absenceDate: string,    // 결석 날짜 (참고용)
  expireAt?: string | null,
  allowExpired?: boolean  // true이면 범위 검사 스킵
): void  // 범위 밖이면 throw
```

- `allowExpired=true`이면 검사 없이 통과
- 범위 밖이면 HTTP-호환 에러 throw

---

## 섹션 32 — teacher/makeups.tsx — State 변수 전체 목록

**CONFIRMED** (`teacher/makeups.tsx` 119–156행)

| 변수명 | 타입 | 용도 |
|--------|------|------|
| `tab` | `TabKey` | 현재 탭 ("waiting"/"assigned"/"history") |
| `waitingList` | `MakeupSession[]` | 대기 목록 |
| `waitingLoading` | `boolean` | 대기 목록 로딩 |
| `waitingRefresh` | `boolean` | pull-to-refresh |
| `assignTarget` | `MakeupSession \| null` | 배정 모달 대상 보강 |
| `eligibleClasses` | `any[]` | 배정 가능 반 목록 |
| `classLoading` | `boolean` | 반 목록 로딩 |
| `selectedClassId` | `string \| null` | 선택된 반 ID |
| `selectedDate` | `string \| null` | 선택된 날짜 |
| `assigning` | `boolean` | 배정 처리 중 |
| `handoverTarget` | `MakeupSession \| null` | 인계 모달 대상 |
| `handoverStep` | `HandoverStep` | 인계 모달 단계 ("menu"/"teacher_select"/"done") |
| `teachers` | `Teacher[]` | 선생님 목록 (인계용) |
| `teachersLoading` | `boolean` | 선생님 목록 로딩 |
| `selectedTeacher` | `Teacher \| null` | 선택된 인계 대상 선생님 |
| `handoverSubmitting` | `boolean` | 인계 처리 중 |
| `handoverDoneMsg` | `string` | 인계 완료 메시지 |
| `selfExtTarget` | `MakeupSession \| null` | 소멸 확인 모달 대상 |
| `selfExtSubmitting` | `boolean` | 소멸 처리 중 |
| `assignedList` | `MakeupSession[]` | 배정된 보강 목록 |
| `assignedLoading` | `boolean` | 배정 목록 로딩 |
| `completeTarget` | `any \| null` | 완료 확인 모달 대상 |
| `revertingId` | `string \| null` | 배정 취소 처리 중인 ID |
| `historyList` | `MakeupRequest[]` | 보강 현황 이력 |
| `historyLoading` | `boolean` | 이력 로딩 |
| `directCompleteTarget` | `MakeupSession \| null` | 직접 완료 모달 대상 |
| `directCompleting` | `boolean` | 직접 완료 처리 중 |
| `confirmMsg` | `string \| null` | 공통 확인 메시지 모달 |
| `occurrences` | `MakeupOccurrence[]` | eligible-occurrences 응답 |
| `occLoading` | `boolean` | occurrences 로딩 |
| `occError` | `boolean` | occurrences 에러 여부 |
| `occErrorDetail` | `{status, code} \| null` | 에러 상세 |
| `selectedOccurrence` | `MakeupOccurrence \| null` | 선택된 회차 |
| `occSeqRef` | `useRef<number>` | in-flight 요청 무효화 시퀀스 |
| `occPendingRef` | `useRef<Set<string>>` | 진행 중 occKey 추적 |

---

## 섹션 33 — teacher/makeups.tsx — 탭 구조

**CONFIRMED** (`teacher/makeups.tsx` 580–606행)

| 탭 Key | 표시명 | 색상 | 뱃지 |
|--------|--------|------|------|
| `"waiting"` | 보강 대기 | themeColor | waitingList.length (타 탭 활성 시) |
| `"assigned"` | 배정된 보강 | `#7C3AED` | assignedList.length (타 탭 활성 시) |
| `"history"` | 보강 현황 | themeColor | 없음 |

### 탭 전환 시 데이터 로드 (225–228행)

```typescript
useEffect(() => { loadWaiting(); }, [loadWaiting]);
useEffect(() => { if (tab === "assigned") loadAssigned(); }, [tab, loadAssigned]);
useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);
useFocusEffect(useCallback(() => {
  loadWaiting();
  if (tab === "assigned") loadAssigned();
}, [...]));
```

> **history 탭**: `useFocusEffect`에 포함되지 않음 — 화면 재진입 시 자동 새로고침 없음

---

## 섹션 34 — teacher/makeups.tsx — loadWaiting / loadAssigned / loadHistory

**CONFIRMED** (`teacher/makeups.tsx` 160–185행)

### loadWaiting

```typescript
GET /teacher/makeups?status=waiting
→ setWaitingList(Array.isArray(data) ? data : [])
finally: setWaitingLoading(false), setWaitingRefresh(false)
```

### loadAssigned

```typescript
GET /teacher/makeups/assigned
→ setAssignedList(await res.json())
setAssignedLoading(true) → finally setAssignedLoading(false)
```

### loadHistory

```typescript
GET /teacher/makeup-requests
→ setHistoryList(await res.json())
setHistoryLoading(true) → finally setHistoryLoading(false)
```

---

## 섹션 35 — teacher/makeups.tsx — selectClass 흐름

**CONFIRMED** (`teacher/makeups.tsx` 271–340행)

### 경쟁 조건 방지 메커니즘

1. `occSeqRef.current` 증가 → 이전 in-flight 요청 무효화
2. `occPendingRef.current`: 동일 `{makeupId}:{classId}` 조합 중복 방지
3. 응답 수신 후 `occSeqRef.current !== mySeq`이면 결과 버림

### 흐름

```
openAssignModal(mk) 또는 openDirectCompleteModal(mk)
  → loadEligibleClasses()
  
selectClass(classId)
  → GET /teacher/makeups/{activeTarget.id}/eligible-occurrences?class_group_id={classId}
  → 실패 시 500ms 후 1회 자동 재시도 (CONFIRMED)
  → 실패 시 /crash-report로 자동 에러 보고
  → 성공 시 setOccurrences(data.occurrences)
```

> `activeTarget = assignTarget ?? directCompleteTarget` — 두 모달 공용

---

## 섹션 36 — teacher/makeups.tsx — doAssign 흐름

**CONFIRMED** (`teacher/makeups.tsx` 338–401행)

```typescript
async function doAssign() {
  if (!assignTarget || !selectedOccurrence) return;
  setAssigning(true);
  
  PATCH /teacher/makeups/{assignTarget.id}/assign
  body: { date: selectedOccurrence.occurrence_date, class_group_id: selectedClassId }
  
  if (ok) {
    setAssignTarget(null);   // 모달 닫기
    setWaitingList(prev → 제거);
    loadWaiting(); loadAssigned(); setTab("assigned");
  } else {
    setConfirmMsg(body.message || body.error || "처리에 실패했습니다.");
  }
  setAssigning(false);
}
```

> **낙관적 업데이트 없음**: 성공 후 모달 닫기 → loadWaiting()/loadAssigned() 재요청

---

## 섹션 37 — teacher/makeups.tsx — doDirectComplete 흐름

**CONFIRMED** (`teacher/makeups.tsx` 467–509행)

```typescript
async function doDirectComplete(occ: MakeupOccurrence, allowExpired = false) {
  // 기간 지난 보강 최초 시도: 경고 Alert → 확인 후 allowExpired=true로 재호출
  if (directCompleteTarget.is_expired && !allowExpired) {
    Alert.alert("기간 지난 보강", ..., [
      { text: "취소" },
      { text: "처리하기", onPress: () => doDirectComplete(occ, true) }
    ]);
    return;
  }
  
  // 낙관적 업데이트: 즉시 모달 닫기 + 목록에서 제거
  closeDirectCompleteModal();
  setWaitingList(prev → targetId 제거);
  
  PATCH /teacher/makeups/{targetId}/complete-direct
  body: { date: occ.occurrence_date, class_group_id: occ.class_group_id, allow_expired: allowExpired }
  
  if (ok) setConfirmMsg("... 보강 완료 처리되었습니다.");
  else {
    setConfirmMsg(error);
    setWaitingList(prev → 복원);  // 실패 시 원복
  }
  loadWaiting();
}
```

---

## 섹션 38 — teacher/makeups.tsx — doHandover 흐름

**CONFIRMED** (`teacher/makeups.tsx` 414–443행)

```typescript
async function doHandover() {
  if (!handoverTarget || !selectedTeacher) return;
  
  // 낙관적 업데이트: 즉시 목록에서 제거 + 완료 단계 전환
  setWaitingList(prev → removedId 제거);
  setHandoverStep("done");
  setHandoverDoneMsg(`${selectedTeacher.name} 선생님에게 인계되었습니다...`);
  setHandoverSubmitting(true);
  
  POST /teacher/makeups/{removedId}/handover
  body: { receiver_teacher_id: selectedTeacher.id }
  
  if (!ok) {
    setHandoverStep("teacher_select");  // 실패 시 이전 단계 복귀
    setWaitingList(prev → 복원);
    setConfirmMsg(error);
  }
  setHandoverSubmitting(false);
}
```

> 선생님 목록 조회: `GET /admin/pool-teachers` (인계 모달 열 때)

---

## 섹션 39 — teacher/makeups.tsx — doSelfExtinguish 흐름

**CONFIRMED** (`teacher/makeups.tsx` 445–461행)

```typescript
async function doSelfExtinguish() {
  if (!selfExtTarget) return;
  setSelfExtSubmitting(true);
  
  PATCH /admin/makeups/{selfExtTarget.id}/self-extinguish
  
  if (ok) {
    setWaitingList(prev → 제거);
    setSelfExtTarget(null);
    setHandoverTarget(null);
    setConfirmMsg("보강이 소멸 처리되었습니다.\n내 정산에 기타 1시수가 반영됩니다.");
  } else {
    setSelfExtTarget(null);
  }
  setSelfExtSubmitting(false);
}
```

> **경로**: `/admin/makeups/:id/self-extinguish` — admin 라우터 사용, teacher 전용 라우터 아님

---

## 섹션 40 — teacher/makeups.tsx — handleTeacherComplete / handleRevert

**CONFIRMED** (`teacher/makeups.tsx` 511–527행, 186–221행)

### handleTeacherComplete

```typescript
async function handleTeacherComplete(id: string) {
  PATCH /teacher/makeups/{id}/complete
  
  if (ok) setAssignedList(prev → id 제거);
  else setConfirmMsg(error);
  setCompleteTarget(null);
}
```

### handleRevert

```typescript
async function handleRevert(mk: MakeupSession) {
  Alert.alert("배정 취소", ..., [
    { text: "닫기" },
    { text: "배정 취소", onPress: async () => {
      PATCH /teacher/makeups/{mk.id}/revert
      
      if (ok && success===true) {
        clearApiCache();
        setAssignedList(prev → 제거);
        setTimeout(() => loadAssigned(), 300);
      } else Alert.alert("오류", error);
    }}
  ]);
}
```

> handleRevert는 `clearApiCache()` 호출 후 300ms 딜레이 후 loadAssigned() 재요청

---

## 섹션 41 — 대기 목록 정렬 및 is_expired 구분선

**CONFIRMED** (`teacher/makeups.tsx` 628–651행)

### 정렬 로직

```typescript
const sorted = [...waitingList].sort((a, b) => {
  if (!!a.is_expired !== !!b.is_expired) return a.is_expired ? 1 : -1;
  return 0;
});
// → is_expired=false 항목 먼저, is_expired=true 항목 뒤
```

> 서버 응답 정렬 (`absence_date ASC`)은 유지하되, is_expired 기준 재분류

### 구분선 표시

```typescript
const firstExpiredIdx = sorted.findIndex(mk => mk.is_expired);
const expiredCount = sorted.length - firstExpiredIdx;  // firstExpiredIdx >= 0 일 때

// idx === firstExpiredIdx 인 카드 위에:
<View>
  ─────────── 기간 지난 보강 ({expiredCount}건) ───────────
</View>
```

### 카드 스타일 차이

- 일반: 뱃지 "대기" (노란 배경)
- 이관받음: 뱃지 "이관받음" (남색 배경), `handed_to_teacher_id === adminUser?.id` 조건
- 기간 지난: 뱃지 "기간 지난 보강" (회색), 카드 왼쪽 테두리 3px 회색

---

## 섹션 42 — AuthContext API 캐시 구조

**CONFIRMED** (`artifacts/swim-app/context/AuthContext.tsx`)

```typescript
const _CACHE_TTL = 30_000;  // 30초

const _apiCache = new Map<string, { data: unknown; expiresAt: number }>();

function _makeCacheKey(token, path) { ... }  // token + path 조합
function _getCached(key): unknown | null { ... }  // 만료 시 자동 삭제
function _setCached(key, data) { ... }  // TTL 설정

export function clearApiCache() { _apiCache.clear(); }  // 전체 삭제
```

### 캐시 동작

- **GET 요청**: 캐시 히트 시 즉시 반환 (서버 요청 없음)
- **TTL**: 30초
- **clearApiCache 호출 시점**:
  - 로그인 시
  - 로그아웃 시
  - 401 응답 시
  - ROLE_REVOKED 감지 시
  - handleRevert 성공 시 (직접 호출)
  - doAssign 이후 `loadWaiting()` 재요청 (캐시 새로고침)

### 부작용

- `loadWaiting()` 직후 30초 내 재호출 시 캐시 응답 반환 가능
- handleRevert 후 `clearApiCache()` → `setTimeout(loadAssigned, 300)` 패턴 사용

---

## 섹션 43 — parent-requests link-result 경계

**CONFIRMED** (`parent-requests.ts` 571–683행)

### 연결 규칙

| 조건 | 결과 |
|------|------|
| `request_type !== 'makeup'` | 400 |
| `status !== 'pending'` | 400 |
| `processed_result_id` 이미 있음 | 409 |
| `result_type !== 'makeup_assignment'` | 400 |
| `result_id` 해당 보강 세션 없음 | 404 |
| Unique 제약 위반 | 409 |

### 자동 연결 (CONFIRMED)

PATCH /teacher/makeups/:id/assign 핸들러에서 배정 성공 후 자동으로 link-result를 시도:
```
pending 상태인 makeup 요청이 있으면 → processed_result_type='makeup_assignment', processed_result_id=makeupId로 자동 연결
```

---

## 섹션 44 — admin/makeups.tsx 클라이언트 구조

**CONFIRMED** (부분 확인, `artifacts/swim-app/app/(admin)/makeups.tsx`)

### 반 목록 표시 (267행 주변)

- 서버(`GET /admin/makeups/eligible-classes`)가 이미 정원 찬 반을 필터링하여 반환
- 클라이언트는 수신된 목록 그대로 표시
- **간접 REQ-4 충돌**: 관리자도 정원 찬 반을 선택 불가

### 차이점 (teacher vs admin 화면)

| 항목 | teacher/makeups.tsx | admin/makeups.tsx |
|------|---------------------|-------------------|
| 배정 경로 | PATCH /teacher/.../assign | PATCH /admin/.../assign |
| eligible-classes | HAVING capacity > students | filter(is_eligible) |
| 정원 차단 (서버) | CLASS_FULL 400 | 없음 |
| 정원 차단 (클라이언트) | is_full && is_future → disabled | 없음 (서버 필터로 도달 불가) |
| revert | PATCH /teacher/.../revert | PATCH /admin/.../revert |
| extinguish | POST /teacher/.../extinguish | POST /admin/.../extinguish |

---

## 섹션 45 — REQ-4 충돌 위치 종합 (정원 초과 배정 차단)

**CONFIRMED**

> **REQ-4**: 정원 초과 상태에서도 보강 배정 가능 (차단 금지)

### 충돌 위치 4곳

| # | 위치 | 파일 | 라인 | 내용 | 영향 |
|---|------|------|------|------|------|
| 1 | GET /teacher/makeups/eligible-classes | teachers.ts | ~660 | `HAVING GREATEST(capacity-students,0) > 0` | 정원 찬 반이 반 목록에 표시되지 않음 |
| 2 | PATCH /teacher/makeups/:id/assign | teachers.ts | ~893 | `if (validation.isFull) → HTTP 400 CLASS_FULL` | 배정 서버에서 거부 |
| 3 | GET /admin/makeups/eligible-classes | admin.ts | ~1793 | `.filter(r => r.is_eligible)` | 관리자 반 목록에도 정원 찬 반 없음 |
| 4 | teacher/makeups.tsx UI | makeups.tsx | ~957 | `is_full && is_future → disabled=true` | UI에서 미래 정원 찬 회차 선택 불가 |

### 정원 초과 허용하는 위치 (올바름)

| 위치 | 파일 | 내용 |
|------|------|------|
| PATCH /teacher/makeups/:id/complete-direct | teachers.ts | isFull 체크 없음 |
| PATCH /teacher/makeups/:id/complete | teachers.ts | isFull 체크 없음 |
| PATCH /admin/makeups/:id/assign | admin.ts | isFull 체크 없음 (단, eligible-classes 단계에서 차단됨) |
| PATCH /admin/makeups/:id/complete | admin.ts | isFull 체크 없음 |
| teacher/makeups.tsx UI (직접 완료 경로) | makeups.tsx | is_full 시 Alert 경고 후 허용 |

---

## 섹션 46 — REQ-2 충돌 위치 종합 (날짜 범위)

**CONFIRMED**

> **REQ-2**: 보강 가능 날짜 = KST 오늘 -14일 ~ +28일 (경계 포함)

### 현재 구현 (CONFIRMED)

`getMakeupDateRange()` → `from = kstToday - 14일`, `to = kstToday + 28일`  
→ REQ-2와 일치 ✅

### 날짜 범위 적용 경로

| 경로 | 적용 여부 | 비고 |
|------|-----------|------|
| eligible-occurrences | ✅ 적용 | `getMakeupDateRange()` 기반 occurrence 생성 |
| assign | ✅ 적용 | `validateMakeupOccurrence` → `validateMakeupDateRange` |
| complete-direct (allowExpired=false) | ✅ 적용 | 기본 경로 |
| complete-direct (allowExpired=true) | ⭕ 스킵 | 명시적 허용 |

### getNextDates 함수 (클라이언트, CONFIRMED)

`teacher/makeups.tsx` 100–117행:

```typescript
function getNextDates(scheduleDays: string) {
  // today.setDate(d + 1) ~ today + 28일 이내 수업일 생성
  for (let i = 1; i <= 28; i++) { ... }
}
```

> **충돌 주의**: getNextDates는 오늘 **이후** 28일 (i=1~28). 서버 getMakeupDateRange는 **오늘 포함** -14~+28.  
> 클라이언트 `getNextDates`는 현재 어디서 사용되는지 UNKNOWN (eligible-occurrences로 대체되어 미사용일 가능성).

---

## 섹션 47 — REQ-1 현황 (기간 지난 보강 유지)

**CONFIRMED**

> **REQ-1**: 지난달 미처리 보강 → 다음 달에도 "기간 지난 보강"으로 유지

### 현재 구현

1. `expire_at` 초과 시 `is_expired=true`로 표시 (서버에서 계산)
2. status는 **'waiting' 유지** (자동으로 'cancelled' 등으로 변경되지 않음, CONFIRMED)
3. GET /teacher/makeups 쿼리: `IN ('waiting', 'expired')` — 두 상태 모두 포함
4. UI: 구분선으로 시각적 분리, 별도 뱃지 "기간 지난 보강"

### REQ-1 평가

**부분 충족**: 
- 기간 지난 보강이 목록에 계속 남아있음 ✅
- `is_expired=true`인 건도 선생님 대기 목록에 표시됨 ✅

**주의사항**:
- `can_expire` 컬럼이 `is_expired` 계산에 반영되지 않음 (섹션 07 참조)
- teacher_absence 경로 보강(`can_expire=false`)도 `expire_at`이 없으면 is_expired=false → 만료 없이 영구 유지 ✅

---

## 섹션 48 — REQ-3 현황 (선보강 허용)

**CONFIRMED**

> **REQ-3**: 선보강 허용 (결석 예정일보다 이전 날짜 보강 가능)

### 날짜 범위 분석

`getMakeupDateRange(absenceDate)`:  
- `from = kstToday - 14일`  
- `to = kstToday + 28일`

→ 기준은 `absenceDate`가 아니라 **kstToday**  
→ 만약 결석 예정일이 미래(예: 3일 후)라도, 오늘부터 -14일 ~ +28일 범위라면 결석일 이전도 가능

**REQ-3 평가**:  
- **서버 날짜 범위**: `kstToday -14 ~ +28` 기준 → absenceDate보다 이전 날짜도 범위 내이면 허용 ✅  
- **validateMakeupOccurrence**: absenceDate 기준 제한 없음, 오직 getMakeupDateRange 결과 기준 ✅  
- **주의**: absenceDate 자체가 오늘보다 14일 이상 과거이면 from이 absenceDate보다 늦어져서 해당 결석에 대한 선보강 불가 (edge case)

---

## 요약: 고정 요구사항 vs 현재 구현 충돌 매핑

| REQ | 요구사항 | 현재 상태 | 충돌 위치 수 |
|-----|----------|-----------|-------------|
| REQ-1 | 기간 지난 보강 유지 | ✅ 충족 (구분선으로 표시) | 0 |
| REQ-2 | 날짜 범위 -14 ~ +28 | ✅ 충족 (getMakeupDateRange 기준) | 0 |
| REQ-3 | 선보강 허용 | ✅ 충족 (날짜 범위가 absenceDate 무관) | 0 |
| REQ-4 | 정원 초과 배정 가능 | ❌ **미충족** | **4곳** |

### REQ-4 충돌 4곳 재요약

1. `teachers.ts` HAVING 절 → eligible-classes에서 정원 찬 반 제외
2. `teachers.ts` assign 핸들러 → `isFull=true` 시 HTTP 400
3. `admin.ts` eligible-classes → `.filter(is_eligible)` 로 정원 찬 반 제외
4. `teacher/makeups.tsx` UI → `is_full && is_future` → `disabled=true`

---

*보고서 끝. 해결책 작성 금지. 이 파일은 READ-ONLY 조사 결과물임.*
