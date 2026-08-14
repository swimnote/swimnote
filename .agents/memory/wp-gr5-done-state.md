---
name: GR5 완료 상태
description: GR5 Teacher Review + Approval Workflow 완료 기록
---

## GR5 완료 상태

- **Branch**: deploy-photo-clone
- **SHA**: 3f8e10d8
- **TC**: 56 TC 추가 → 전체 718/718 통과

## 신규/수정 파일

| 파일 | 역할 |
|---|---|
| `teacher-growth-report-review.ts` | GET /review + POST /review (APPROVE/REQUEST_REANALYSIS) |
| `growth-report-gr5-review-init.ts` | teacher_review_action/reason_code/note/reanalysis_count 컬럼 |
| `routes/index.ts` | teacherGrowthReportReviewRouter 등록 |
| `growth-report-review.tsx` | Teacher Expo 검토 UI |
| `(teacher)/_layout.tsx` | growth-report-review 스크린 등록 |

## 핵심 설계

- 검토 자격: REVIEW_REQUIRED 상태만 → 나머지 409 REVIEW_NOT_ELIGIBLE
- teacher ownership: `class_groups.teacher_user_id + students.current_class_id` + `student_class_history` fallback
- APPROVE: REVIEW_REQUIRED → APPROVED (transitionReportStatus)
- REQUEST_REANALYSIS: REVIEW_REQUIRED → ANALYZING, 새 request_id 생성, analysis_retry_count=0, GR3 worker setImmediate
- Loop protection: teacher_reanalysis_count >= max → 429 REANALYSIS_LIMIT_EXCEEDED (default 3)
- Content editing 금지 (spec §10): summary_text/section 직접 수정 라우트 없음
- teacher_review 직렬화: JSON.stringify({reason_code, note}) → ENGINE snapshot teacher_review 필드

## vitest mock 패턴 주의

- `requireReportXAccess` mock이 `resolvedReportPoolId`를 전역으로 POOL_ID로 설정 → pool mismatch 테스트는 `mockImplementationOnce`로 override 필요
- `C.danger` Colors 키 없음 → `C.error` 사용 (theme/colors.ts)

## 다음 단계: GR6 (Parent View — PUBLISHED 리포트 조회)
