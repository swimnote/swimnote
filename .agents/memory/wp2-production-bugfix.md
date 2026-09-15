---
name: WP2 Production Bug Fix — teacherOwnsStudent + diary
description: WP2 배포 후 발견된 Production 장애 수정 (2026-09-15)
---

## Root Cause A — Diary 0건
- diary.ts GET /diaries/index: student_class_history에 is_deleted 컬럼 없음
- 수정: AND is_deleted = false 제거 → 전체 class_group_id 이력 조회
- student_class_history 실제 컬럼: class_group_id, enrolled_at, left_at (is_deleted 없음)

## Root Cause B+C — GR History/Detail 403 TEACHER_NOT_ASSIGNED  
- teacherOwnsStudent 함수가 students.current_class_id 사용 → 실제 컬럼은 class_group_id
- fallback도 student_class_history.class_id 사용 → 실제 컬럼은 class_group_id
- GET /teacher/growth-reports 학생목록 쿼리도 동일 오류

## 수정 파일
- artifacts/api-server/src/routes/teacher-growth-report-review.ts
  - teacherOwnsStudent: current_class_id → class_group_id (x2)
  - teacherOwnsStudent: sch.class_id → sch.class_group_id
  - GET /teacher/growth-reports 학생목록: current_class_id → class_group_id, sch.class_id → sch.class_group_id
- artifacts/api-server/src/routes/diary.ts
  - student_class_history WHERE is_deleted=false 제거

## 배포
- SHA: 33a646d4
- Render LIVE: 33a646d4 (dep-dakfvj142hec73af25sg)
- OTA: 없음 (서버 수정만)

## Round 2 — Diary 진짜 Root Cause (2026-09-15 2차)
- is_deleted 제거만으로 해결 안 됨
- 진짜 원인: diary access check가 students.class_group_id JOIN만 사용
  → class_group_id=null이지만 assigned_class_ids로 배정된 학생은 403
- 또한 studentCommonFilter도 student_class_history만 사용
  → assigned_class_ids로 배정된 반의 diary 누락
- 수정: access check = class_group_id OR assigned_class_ids OR student_class_history(left_at IS NULL)
- 수정: studentCommonFilter = student_class_history OR class_group_id OR assigned_class_ids
- SHA: 1df8db39, Render LIVE: 1df8db39

## Round 2 — GR History BACK Root Cause
- router.back() 단독 사용 → canGoBack()=false 경우 HOME으로 이동
- 수정: canGoBack() ? back() : replace(student-detail, id=studentId)
- OTA iOS: 01a0a465-4102-71da-9ee5-fea468e1d08d, branch production-v2

## 학생 배정 방식 원칙 (영구)
- students 배정: class_group_id(단일) OR assigned_class_ids(다중배정 jsonb array)
- 접근 체크 시 반드시 두 경우 모두 체크 + student_class_history 포함

## 컬럼명 원칙 (영구)
- students 테이블: class_group_id (current_class_id 아님)
- student_class_history: class_group_id, left_at (class_id 아님, is_deleted 없음)
- 이 테이블을 join할 때 반드시 위 컬럼명 사용

**Why:** teacherOwnsStudent가 잘못된 컬럼명으로 항상 0 rows 반환 → 403
