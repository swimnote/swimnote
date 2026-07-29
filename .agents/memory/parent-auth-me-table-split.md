---
name: 학부모 /auth/me 테이블 분리 구조
description: parent_account role은 users 테이블이 아닌 parent_accounts 테이블 소속 — /auth/me 처리 시 role 분기 필수
---

## 규칙

`/api/auth/me` 엔드포인트는 role에 따라 조회 테이블을 분기해야 한다.

- `role === "parent_account"` → `parent_accounts` 테이블 조회 (db 사용)
- 그 외 (pool_admin, teacher, sub_admin 등) → `users` 테이블 조회 (superAdminDb 사용)

**Why:** `parent_accounts`와 `users`는 완전히 분리된 테이블이다. 학부모 userId(`pa_v2_...`)를 `users` 테이블에서 조회하면 항상 NOT FOUND(404)가 반환된다. `loadStored()`는 404를 명시적 인증 실패로 처리해 AsyncStorage를 전부 삭제하므로, 앱 재실행 시마다 학부모가 강제 로그아웃되는 버그가 발생한다.

**How to apply:**
- `auth.ts` `/auth/me` 핸들러에서 `req.user!.role === "parent_account"` 분기 먼저 처리
- 반환 필드: `id, name, nickname, phone, swimming_pool_id, login_id` + swimming_pools JOIN으로 `pool_name`
- `pin_hash` 등 민감 컬럼은 SELECT에서 제외 (spread 금지)
- `refreshSession()`의 `{ ...prev, ...user }` merge 패턴과 호환되는 구조 유지
