---
name: standby-sync 배열 직렬화 수정
description: drizzle sql template이 JS 배열을 ($1,$2) record tuple로 전개하는 버그와 serializeForPg() 해결 패턴
---

## 규칙

drizzle-orm의 `sql\`${v}\`` 템플릿에 JavaScript 배열을 직접 전달하면
배열 원소가 복수 파라미터로 전개되어 `($1,$2)` record 타입으로 생성됨.
`text[]` 컬럼에 이를 삽입하면 PostgreSQL 42804 오류 발생.

**Why:** drizzle 0.45.x + node-postgres(pg) 조합에서 확인된 동작.
드라이버가 배열을 직렬화하기 전에 drizzle이 전개함.

**How to apply:**
- `sql\`${v}\`` 이전에 `serializeForPg(v)` 호출로 변환:
  - `Array` → `{a,b}` 형식 PostgreSQL 배열 리터럴 문자열
  - `Date` → ISO 8601 문자열
  - `object` → `JSON.stringify()`
  - 나머지(null/bool/number/string) → 그대로
- pg가 text 파라미터를 대상 컬럼 타입(text[], jsonb, timestamptz)으로 암묵 변환함

## 관련 추가 패턴

**LAZY_SYNC_TABLES**: Production에 아직 생성되지 않은 테이블(예: pool_credits)은
`LAZY_SYNC_TABLES = new Set(["pool_credits"])`으로 명시 허용.
SELECT 시 "relation does not exist" → `lazy_skip: true` 반환, 오류로 미계산.

**BACKUP_SCHEMA_MISSING**: Backup DB에 테이블 없고 Production에 행 있으면
stub 자동 생성 금지 → `BACKUP_SCHEMA_MISSING` 오류 + ops alert.

**isPgRelationMissing()**: DrizzleQueryError는 실제 PG 에러를 `e.cause`에 래핑.
`e.message` 만 검사하면 누락됨 — 반드시 `e.cause.code === "42P01"` 도 검사.

**IDENT_RE**: `/^[A-Za-z_][A-Za-z0-9_]*$/` — 테이블명·컬럼명 모두 검증.

## 테스트

`artifacts/api-server/src/scripts/phase16e-test.ts` — 28개 케이스 전부 통과.
A–J 직렬화 매트릭스, lazy skip, BACKUP_SCHEMA_MISSING, 식별자 검증, null/jsonb.
