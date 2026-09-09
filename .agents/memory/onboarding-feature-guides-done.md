---
name: Onboarding Feature Guides 연결 완료
description: 13개 미연결 feature guide를 실제 화면에 연결한 작업 완료 상태
---

## 완료 상태
- iOS OTA: 01a08437-57d1-771b-aa01-fa6832c970f3 (production-v2, runtime 2.1.0)
- Git SHA: ce4a8e07

## 연결된 화면 (총 9개 화면, 13개 가이드)

| 화면 | 가이드 키 | 비고 |
|------|-----------|------|
| today-schedule.tsx | teacher_today | bomb prevention: !showOnboarding guard |
| diary-index.tsx | teacher_ai_diary / teacher_x_ai_diary | mode-aware mutual exclusion |
| growth-report.tsx (parent) | parent_growth_report | parentAccount?.id 사용 |
| growth-report-paid.tsx | parent_insight_report | InsightReportHub |
| curriculum-chat.tsx | parent_ai_curriculum_search | |
| x-hub.tsx | x_entry | |
| x-mode-hub.tsx | x_ready | mode==="x" guard |
| x-growth.tsx | x_growth_event | XModeGuard 내부 |
| report-hub.tsx | admin_growth_report / x_growth_report | mode-aware mutual exclusion |

## 핵심 원칙 적용
- 동시/연속 modal 0 (bomb prevention)
- X mode / normal mode 가이드 상호 배제
- parentAccount?.id / adminUser?.id userId 패턴
- teacher_today content onboardingContent.ts에 추가

## E2E 검증 완료 (2026-09-09)
- DB T1~T10 전체 PASS (SUPABASE_DATABASE_URL)
- PDF 버그 수정: parent_growth_report guide에서 PDF 문구 제거 (growth-report.tsx에 PDF 없음)
- main HEAD: d3e7e33c (origin/main)
- iOS OTA: 01a08463 (bug fix OTA)
- Render LIVE SHA: cdd650c1 (서버 변경 없음)

## 미연결 (의도적 결정)
- x_ai_diary: x-hub.tsx에 연결하지 않음 (x_entry와 bomb 방지); diary-index.tsx X mode에서 teacher_x_ai_diary로 커버됨
- x_curriculum: x-setup.tsx에 이전 세션에서 이미 연결됨
