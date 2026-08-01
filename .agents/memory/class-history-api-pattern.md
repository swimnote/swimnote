---
name: student_class_history API 통합 패턴
description: 반이동/배정/미배정 API에 history 기록 추가, 날짜 기준 학생목록 API 구조
---

## 규칙
- move-class / remove-from-class / assign 모두 `effective_date` 파라미터를 받음 (기본값: 오늘)
- 이 세 API는 단일 `db.transaction()` 으로 student_class_history + students 캐시를 동시 갱신
- students.assigned_class_ids / class_group_id 는 캐시로 유지 (삭제 금지)
- 날짜 기준 학생목록: `GET /api/class-groups/:id/students?date=YYYY-MM-DD` (history JOIN)

**Why:** 과거 날짜 조회 시 client-side filter는 현재 assigned_class_ids 기준이라 잘못된 결과 반환

## 핵심 스키마
```sql
student_class_history (id, student_id, class_group_id, swimming_pool_id, enrolled_at, left_at, created_at)
```
- `enrolled_at IS NULL` 조건 없음 — 항상 날짜 범위로 조회
- `left_at IS NULL OR left_at > date` 패턴 사용

## move-class 검증 이중화
- `assigned_class_ids.includes(from_class_id)` OR `history 날짜 기준 조회` 둘 중 하나만 통과해도 허용
- 기존 앱 (effective_date 미전송)은 오늘 기준으로 동작 (하위 호환)

## 앱 side (ClassDetailSheet + my-schedule)
- ClassDetailSheet: `studentsByDate` prop으로 서버 사전필터 결과 수신, `onStudentsChanged` 콜백으로 재조회
- my-schedule: detailGroup+selectedDate 둘 다 있을 때만 `/class-groups/:id/students?date=` 호출
- 날짜 없는 오늘 보기는 기존 `students` 배열 + client-side filter 유지

## backfill
- 2026-08-01 실행 결과: inserted=0, skipped=244 → 기존 history 완비, 추가 backfill 불필요
- 스크립트 위치: artifacts/api-server/src/scripts/backfill-class-history.ts
