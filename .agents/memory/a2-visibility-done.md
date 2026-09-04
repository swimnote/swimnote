---
name: A2 Normal AI Visibility Cleanup 완료
description: A2 — Normal SWIMNOTE에서 X 전용 AI 기능 진입점 제거. 4개 파일 수정.
---

## 완료 상태

- SHA: 89cfde6a
- OTA production: f90628fe · OTA preview: d67240c0
- 수정 파일: 4개

## 변경 내용

1. `app/(parent)/home.tsx` — "AI 기능 버튼" 섹션 (`{selectedStudent && (` → `{selectedStudent && mode === "x" && (`)
2. `app/(parent)/curriculum-chat.tsx` — XModeGuard 전체 wrapping 추가
3. `app/(parent)/growth-report-detail.tsx` — XModeGuard 전체 wrapping 추가
4. `app/(teacher)/diary.tsx` — useMode import + `onAIInsert={mode === "x" ? handleAIInsert : undefined}` 조건부 전달

## 유지한 항목 (정상)

- dashboard.tsx X 카드: 이미 `mode===x|x_pending` 가드 ✅
- x-growth.tsx (admin/teacher/parent): XModeGuard 이미 존재 ✅
- 일지 템플릿 관리: 수동 일지 기능 = 노말 기능 ✅
- growth-report.tsx (3개월 요약): 노말 기능 ✅
- GrowthReportFeedCard: API가 X풀에만 발행 + growth-report-detail route guard로 커버 ✅

## 다음 단계

A3_ONBOARDING_CLEANUP (A2 PASS 전 시작 금지)
