---
name: WP-N7S 완료 상태
description: Clear Pool 테마 전환 + 스케줄러 classColor 가시성 복구
---

## 결과

- SHA: 03e34a60
- TS 신규 오류: 0
- iOS OTA production: 01a00c74
- iOS OTA preview: 01a00c75
- Android OTA: 미배포 (릴리즈 컨벤션 — 누적 배포 예정)
- Render: 해당 없음 (client-only)

## Clear Pool 최종 팔레트

| 토큰 | 구값 (Sage) | 신값 (Clear Pool) |
|------|------------|------------------|
| brandStrong | #4F6F67 | #1683A3 |
| brandPrimary | #6F9187 | #25B7CF |
| brandMid | #91ABA3 | #6BD2DE |
| brandSoft | #DDE7E3 | #D9F2F6 |
| brandMist | #ECF2F0 | #EEF9FB |
| background | #F4F7F6 | #F5FAFB |
| textStrong | #24302E | #163842 |
| surface | #FBFCFC | #FFFFFF |

## 수정 파일 (15개)

- theme/colors.ts (source of truth — 전체 교체)
- constants/auth.ts (role badge hardcode)
- components/common/constants.ts (free/paid status)
- context/BrandContext.tsx (DEFAULT_THEME_COLOR)
- components/parent/ParentPromoStrip.tsx (accent + border)
- components/parent/StoryCapturePipeline.tsx (ActivityIndicator)
- app/(admin)/push-message-settings.tsx (local palette)
- app/(admin)/push-notification-settings.tsx (local palette)
- app/(teacher)/today-schedule.tsx (miniDot #2DD4BF→#25B7CF)
- components/teacher/my-schedule/DaySheet.tsx (teacherChip)
- components/teacher/my-schedule/WeeklyTimetableV2.tsx (classColor alpha 개선)

## 보호 확인

- X theme (constants/xTheme.ts): 무수정 ✅
- classColor 값 자체: 무수정 ✅
- SEMANTIC_PROTECTED: 무수정 ✅
- FEATURE_FIXED: 무수정 ✅
- FUNCTION_LOCK: 준수 ✅

## WeeklyTimetableV2 classColor 가시성 개선

- cardBg alpha: +18 (9%) → +28 (16%)
- cardBdr alpha: +55 (33%) → +99 (60%)
- accentBar: 이미 opaque 유지 (미수정)
