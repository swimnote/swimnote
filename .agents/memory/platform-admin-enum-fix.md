---
name: platform_admin enum mismatch 수정
description: sendPushToSuperAdmins의 platform_admin 잘못된 enum 참조로 인한 반복 오류 수정 기록
---

# platform_admin role enum mismatch 수정

**SHA**: 476b7922  
**완료일**: 2026-08-17

## 근본 원인

`sendPushToSuperAdmins` (push-service.ts)의 SQL:
```sql
WHERE role IN ('super_admin', 'platform_admin')
```

PostgreSQL `user_role` enum에 `platform_admin` 값이 없어서 매번 오류 발생.
서버 모니터링(perf-monitor 5분, keep-alive 4분)마다 반복 오류 → 로그 오염.

## 확인 사항

- `platform_admin`은 DB `user_role` enum에 존재하지 않음 (추가 금지)
- TypeScript 코드에서 role 문자열 비교(`===`)는 오류 없음 (enum 아님)
- 실제 Super Admin은 `role = 'super_admin'`만 사용
- `admin.ts:244` GET /users도 동일 패턴으로 오류 발생 가능
- `admin.ts:272` POST /users INSERT에 `'platform_admin'` role → DB 오류 발생 가능

## 수정 내용

| 파일 | 변경 |
|------|------|
| `push-service.ts:382` | `WHERE role IN ('super_admin', 'platform_admin')` → `WHERE role = 'super_admin'` |
| `admin.ts:244` | 동일 수정 |
| `admin.ts:272` | INSERT role `'platform_admin'` → `'super_admin'` |

**Why:** DB enum에 없는 값을 raw SQL literal로 사용하면 PostgreSQL이 enum 타입 검증에서 오류를 던짐. TypeScript 타입 시스템은 이를 잡지 못함 (raw sql`` 템플릿).

**How to apply:** raw SQL에서 `user_role` enum 값을 쓸 때 실제 DB enum 허용 값만 사용. 새 role 추가 시 반드시 DB enum ALTER TYPE 먼저.

## 주의

다른 파일들(`auth.ts`, `notices.ts`, `push-settings.ts` 등)에서 `platform_admin` 문자열 비교는 TypeScript 레벨(enum 아님) → DB 오류 없음 → 수정 불필요.
