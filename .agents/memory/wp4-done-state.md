---
name: WP4 XModeGuard 역할 제한 원칙
description: XModeGuard에서 허용 역할 설정 시 ModeProvider 허용 역할과 반드시 일치시켜야 함
---

## X 모드 허용 역할 제한 원칙

ModeProvider는 `pool_admin`과 `teacher`만 서버에서 mode를 로드한다.
`sub_admin`, `super_admin`, `platform_admin`, `super_manager`는 명시적으로 제외 → status가 영구 "idle" 유지.

**Why:** XModeGuard가 `idle` 상태를 로딩 스피너로 처리하므로, ModeProvider가 로드하지 않는 역할을
XModeGuard.allowedRole에 포함하면 무한 스피너가 발생한다 (redirect도 안 됨).

**How to apply:**
- `(admin)/x-growth.tsx`: `allowedRole="pool_admin"` (sub_admin 절대 포함 금지)
- `(teacher)/x-growth.tsx`: `allowedRole="teacher"`
- `(parent)/x-growth.tsx`: `allowedKind="parent"` (role 불필요, ParentContext 분리됨)
- X 메뉴 섹션: mode 조건만으로 분기 충분 (ModeProvider가 이미 역할 필터링)
