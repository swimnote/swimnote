---
name: admin/curriculum/summary 500 버그 수정
description: /admin/curriculum/summary 500 원인 — attendance.date text 타입 + class_groups.is_active 없음
---

**Rule:** admin.ts `/curriculum/summary` 쿼리에서 두 가지 주의:
1. `attendance.date` 컬럼은 **text** 타입 → `date::date >= ...::date` 명시 CAST 필요
2. `class_groups`에 `is_active` 컬럼 없음 → `is_deleted IS NOT TRUE` 조건 사용

**Why:** attendance.date가 text이면 `text >= date` operator 없음으로 500. class_groups에 is_active 없어서 42703. 둘 다 Promise.all 내부 병렬 실행이라 하나라도 실패하면 전체 500.

**How to apply:** 이 테이블 쿼리 작성 시 항상 컬럼 타입/존재 여부를 먼저 확인.
