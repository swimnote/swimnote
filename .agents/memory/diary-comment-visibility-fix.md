---
name: 일지 댓글 diaryVisibleToStudent 날짜 범위 버그
description: student_class_history의 enrolled_at/left_at 날짜 오류로 인해 diaryVisibleToStudent가 false 반환 → 학부모 댓글 403 실패
---

## 규칙

`diaryVisibleToStudent`에서 `enrolled_at <= lesson_date AND left_at > lesson_date` 날짜 범위 검사 금지.
대신 `sch.student_id = studentId` + `sch.class_group_id = cd.class_group_id` 소속 여부만 확인.

**Why:** 운영 DB의 student_class_history에 날짜 데이터 오류가 존재함:
- enrolled_at가 미래 날짜 (예: 2026-08-04) → 모든 과거 일지에 댓글 불가
- left_at < enrolled_at 불가능한 조합 존재
- 날짜 범위 체크는 false negative 다수 발생

`parentOwnsStudent`가 이미 부모-학생 연결을 검증하므로, class_group 소속 여부 확인으로 충분함.

**How to apply:** comments.ts `diaryVisibleToStudent` 함수에서 날짜 조건 제거 유지.

## 진단 방법 (pnpm --filter @workspace/api-server exec tsx)

```typescript
// student_class_history 날짜 이상 케이스 확인
SELECT COUNT(*) FROM student_class_history WHERE enrolled_at > CURRENT_DATE
// → 4건 이상이면 날짜 오류 존재

// 특정 학생이 볼 수 있는 일지 확인 (날짜 범위 없이)
SELECT cd.id FROM class_diaries cd
JOIN student_class_history sch ON sch.class_group_id = cd.class_group_id
WHERE sch.student_id = '...' AND cd.is_deleted = false
```
