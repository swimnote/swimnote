---
name: WP2 Member Limit Enforcement 완료 상태
description: WP2 X Plan Member Limit Enforcement — race-safe canonical helper 구현 완료
---

SHA: b17df141; branch: release/v2.0.0

## 핵심 결정

- `lib/member-limit.ts` canonical helper 신설
- `pg_advisory_xact_lock(hashtext(poolId))` → pool-level 직렬화 (cross-DB transaction 불필요)
- x_plan_key canonical source: x300=300 / x500=500 / x1000=1000
- active member count 정의: `status NOT IN ('archived','deleted')` — 기존 lifecycle 그대로

## 수정 경로 (bypass → 보호)

| 경로 | 파일 | 처리 |
|---|---|---|
| POST /students (admin create) | students.ts | 기존 non-race-safe 제거 → db.transaction + assertMemberLimitInTx |
| POST /students/batch | students.ts | 기존 non-race-safe 제거 → db.transaction + advisory lock |
| POST /students/teacher-request | students.ts | 신규 추가 (pending_approval은 count 포함) |
| POST /auth/simple-parent-register | auth.ts | unmatched student INSERT에 추가 |
| POST /admin/students/:id/restore | admin.ts | deleted→active에만 추가 (withdrawn은 이미 count 포함) |
| POST /admin/students/:id/restore-archive | admin.ts | archived→active에 추가 |

## X Pool 판단 로직

```
isX = (x_management_override OR x_paid_entitlement OR x_manual_entitlement) AND NOT x_force_disabled
limit = X_PLAN_LIMITS[x_plan_key] if isX else pool_override_limit ?? plan_limit
```

**Why:** client 보낸 plan 값 신뢰 금지; x_plan_key가 server-side canonical source

## Tests

25TC PASS (src/routes/__tests__/wp2-member-limit.test.ts)

## 다음 작업

WP3 이후 — 사용자 승인 후 시작
