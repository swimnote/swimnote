---
name: A1-2 Global Design System 완료 상태
description: Navy primary CTA, AppButton/NavigationListItem 신규, icon tiles 제거, C.button→primaryAction 전수 교체 완료
---

# A1-2 Global Design System Implementation

## 완료 상태
- SHA: e5bd3822
- OTA production: 5726e5b3-ed6c-48ef-a7cc-56b854da9d7b
- OTA preview: ee00bcb6-619e-4179-bac7-59a5767198b5

## 핵심 결정 (불변)
- Primary CTA: `C.primaryAction` = navy `#0F172A` (흰 텍스트)
- Super Admin CTA: `#7C3AED` purple (유지)
- C.button (orange): WARNING/PENDING 전용으로만 남김 — 일반 CTA에서 모두 제거됨
- 장식용 아이콘 타일 bg: 전부 제거 또는 `#F1F5F9` 중립 색으로 교체

## BATCH별 작업 범위

### BATCH 1 — Global Tokens + Shared Primitives
- `theme/colors.ts`: `primaryAction`, `primaryActionSoft`, `divider`, `textLink` 추가
- `components/common/AppButton.tsx`: 신규 (primary/secondary/tertiary/destructive variants)
- `components/common/NavigationListItem.tsx`: 신규 (icon=no tile, chevron, divider)

### BATCH 2 — Auth + Parent Home
- login.tsx, signup.tsx, parent-login.tsx, teacher-signup.tsx: C.button/C.tint/C.success → primaryAction
- onboarding-parent/admin/teacher.tsx: ORANGE/MINT/GREEN dots+buttons → NAVY
- ParentAttendanceCard/RecentPhotosCard/NoticeCard/LatestDiaryCard/GrowthCard: iconBg 제거
- settings.tsx: 모든 메뉴 아이콘 색상 N(navy)로 통일
- more.tsx: infoBanner mint → 중립 회색

### BATCH 3 — P1 Screens
- classes.tsx: 반 등록 C.button→primaryAction, 보강 버튼 mint/purple → #F1F5F9
- members.tsx: CTA mint→primaryAction, empty state icon tile → #F1F5F9
- notifications.tsx: iconBox cfg.bg → #F1F5F9
- data-storage-overview.tsx: stat/cleanup icon tiles → #F1F5F9
- today-schedule.tsx: sun tiles/step tiles/section icon → 중립

### BATCH 4 — Role Consistency
- attendance(admin), notices, admin-grant, makeups, teacher/attendance: C.button → primaryAction
- parent/messages, photos, home: C.tint/ORANGE → primaryAction

### BATCH 5 — Super Admin
- users, risk-center, ads: C.button → #7C3AED (purple)
- storage: GREEN/C.button/#2EC4B6 CTA → #7C3AED
- readonly-control: enabled ? mint : red → enabled ? #7C3AED : red
- operator-detail: X 사용권 활성화 mint → #7C3AED

### BATCH 5-EXT — 나머지 admin screens
- admin-revenue, communication, community, data-delete, level-settings, people-pending, photo-upload, pool-settings, recovery, teacher-pending-detail: C.button → primaryAction
- parent/add-child: ORANGE icon+button → primaryAction

## 검증
- TSC: 기존 pre-existing 에러만 (admin-revenue/parents-list/additional-guardians/teacher-photos) — 내 변경으로 인한 새 에러 0
- C.button backgroundColor 잔여: 0
- C.tint CTA 잔여: 0

## 범위 보정 추가 (SCOPE CORRECTION)
- SHA: b3f5ba6f
- OTA production: b39eada3 · OTA preview: 3db53b90
- C.tint CTA 전수 교체: approval/attendance/inquiries/signup/forgot-pw/makeups/register/pool+auth 39개 파일
- **C.button backgroundColor 잔여 (non-super): 0** ✅
- **C.tint CTA 잔여: 0** ✅ (남은 것은 전부 chip/checkbox/role card 선택 상태)
- X 화면 Steel Blue = accent only (CTA에 사용 안 됨) ✅ 확인됨

## 다음 단계
- A2: Normal SWIMNOTE AI Visibility Cleanup (A1-2 완전 완료, 시작 가능)
