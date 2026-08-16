---
name: WP-X0 완료 상태
description: X mode common control theme gap hotfix — AppButton/MainTabs X aware, today-schedule header btn fix
---

# WP-X0 완료

**SHA**: 3149ff2e  
**브랜치**: deploy-photo-clone  
**OTA production**: 01a00b38-6d52  
**OTA preview**: 01a00b38-c1ae  

## 변경 파일 (3개)

### 1. components/common/AppButton.tsx
- `useMode` + `isXMode` 추가
- primary variant: X → `XT.primary` (#1A4070 Nautic) / Normal → `C.primaryAction` (#0F2742) 그대로
- pressedBg: X → `XT.primaryPressed` (#1F4C80)
- destructive/secondary/tertiary: 변경 없음

### 2. components/common/MainTabs.tsx
- `useMode` + `isXMode` 추가
- active tint: X → `XT.accent` (#2A5EA8 Yacht Primary) / Normal → `C.tint` (mint) 그대로
- `accentColor` prop 우선 (FEATURE_FIXED 호출자 unaffected)

### 3. app/(teacher)/today-schedule.tsx
- X header button bg: `rgba(255,255,255,0.12)` → `XT.surfaceNavySoft` (#1F4C80)
- 4개 인스턴스: switchChip, inbox, swimnote-logo, logout
- Normal: 그대로

## 보호 항목
- Normal visual change: NONE
- Scheduler classColor() palette: UNCHANGED
- Semantic colors (error/warning/success): UNCHANGED
- Feature-fixed (AI/feed): UNCHANGED

**Why**: AppButton/MainTabs는 X-aware 아니면 X 화면 내부에서 old-navy CTA + mint tabs이 노출됨.
