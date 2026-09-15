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

## 컬럼명 원칙 (영구)
- students 테이블: class_group_id (current_class_id 아님)
- student_class_history: class_group_id, left_at (class_id 아님, is_deleted 없음)
- 이 테이블을 join할 때 반드시 위 컬럼명 사용

**Why:** teacherOwnsStudent가 잘못된 컬럼명으로 항상 0 rows 반환 → 403
