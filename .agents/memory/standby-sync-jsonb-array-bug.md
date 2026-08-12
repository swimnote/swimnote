---
name: standby-sync jsonb 배열 버그
description: serializeForPg()가 jsonb 컬럼의 JS 배열을 PG 배열 리터럴로 잘못 변환해 22P02 발생
---

## 규칙

`serializeForPg(v)` 함수는 모든 JS Array를 PG 배열 리터럴 `{a,b}` 형식으로 변환한다.
`text[]` 컬럼(users.roles 등)에는 올바르지만, `jsonb` 컬럼(students.assigned_class_ids,
students.class_schedule 등)에는 유효하지 않은 형식 → PostgreSQL 22P02 오류.

**Why:** PostgreSQL의 `jsonb` 컬럼은 `["a","b"]` JSON 형식을 기대하는데
`{"a","b"}` PG 배열 리터럴을 받으면 `invalid input syntax for type json` 발생.

**How to apply (fix):**
`replicateTable()` 안에서 Production information_schema로 컬럼 타입을 조회 후
`colTypes: Map<string, string>` 빌드.

```typescript
function serializeForPg(v: unknown, pgType?: string): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    if (pgType === "jsonb") return JSON.stringify(v);   // jsonb: JSON 배열
    // text[] 등: PG 배열 리터럴
    const elems = v.map(e => ...);
    return `{${elems.join(",")}}`;
  }
  // ...
}
```

`Object.values(row).map((v, i) => serializeForPg(v, colTypes.get(cols[i])))` 형태로 사용.

## 영향 테이블

- students: `assigned_class_ids` (jsonb), `class_schedule` (jsonb)
- students 복제 0행 / 22P02 — Phase 16F에서 발견, 코드 수정 금지로 미해결
- 다른 테이블에도 jsonb array 컬럼이 있으면 동일 오류 발생 가능

## 확인된 동작

- Production SELECT → JS 배열 반환 (pg driver가 jsonb를 JS Array로 파싱)
- serializeForPg → `{"cg_xxx"}` 변환 (PG array literal)
- Backup INSERT → 22P02 `Expected ":", but found "}"`

## 수정 우선순위

HIGH — students 복제 완전 차단 상태. 다음 Phase에서 반드시 수정.
