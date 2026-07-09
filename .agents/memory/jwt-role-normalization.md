---
name: JWT role 정규화 버그
description: teacher 역할 전환 후 앱 재시작 시 teacher 토큰이 pool_admin API 호출에 사용되어 403 반환 → 대시보드 stats "—" 표시
---

## 버그

사용자가 "선생님으로 전환"으로 `teacher` 토큰 발급 → 앱 재시작(OTA/크래시/종료) → AsyncStorage에서 teacher 토큰 복원 → `/auth/me`는 200 (teacher도 유효한 사용자) → `adminUser.role`은 "pool_admin"으로 보임 (freshUserData에서 업데이트) → 하지만 API 호출 시 JWT에는 role="teacher" → `requireRole("pool_admin")` → **403** → `statsRes.ok = false` → stats = null → "—" 표시.

## 수정 (SessionContext.tsx `loadStored`)

1. admin 세션 복원 시 저장된 JWT 디코드 (`atob` + base64url padding)
2. JWT payload의 `role` vs `freshUserData.role` 비교
3. 불일치 시 `/auth/switch-role` 호출 → 올바른 role의 새 토큰 발급
4. 새 토큰으로 `setToken()` 및 AsyncStorage 업데이트

**Why:** teacher 전환 시 새 JWT가 AsyncStorage에 저장됨. 앱 재시작 시 이 teacher JWT가 복원되어 pool_admin 전용 API 호출 시 403 반환.

**How to apply:** `SessionContext.tsx`의 `loadStored` 함수에서 admin 분기 안에 있음. `/auth/switch-role` 엔드포인트가 production 서버에 존재 확인됨 (v2.1-2026-04-04 기준).
