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

## 선생님 홈·스케줄의 활성 역할 범위 계약

같은 계정에 관리자·선생님 권한이 모두 있어도, 앱에서 명시적으로 선생님 모드이면 홈·스케줄은 현재 주담당/보조담당으로 배정된 반만 표시해야 한다. 관리자 모드는 자기 수영장 전체 운영 범위를 유지한다.

**Why:** 2026-10-15 사용자가 이 UX 계약을 명시했다. DB 기본 역할이 관리자라는 이유만으로 선생님 전용 화면의 담당 범위를 넓혀서는 안 된다.

**How to apply:** 기본 DB 역할, 활성 JWT 역할, UI 역할을 구분해 조사한다. 관리자용 공통 접근권한과 선생님 전용 화면의 담당반 조회 기준을 혼동하지 않고, 주담당과 기존 보조담당 구조를 함께 보존한다.
