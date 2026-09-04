---
name: diary 학생 로딩 무한 대기 수정
description: loadClassStudents fallback 엔드포인트 교체로 무한 로딩 수정 (1.6.3/2.0.0)
---

## 근본 원인

`diary.tsx` `loadClassStudents()` 의 2단계 fallback 구조:
1. `/today-schedule?date=` → `student_class_history` 날짜 필터 → 일부 수영장에서 `students:[]` 반환
2. fallback: **GET /students?class_group_id=<id>** (구버전 엔드포인트)
   - 서버가 `class_group_id` 파라미터 무시
   - 전체 학생 목록 반환 후 클라이언트 사이드 필터링
   - **N+1 DB 쿼리 구조** (학생당 class_group_name DB 조회)
   - 대형 수영장: 수십 초 소요 → 30s AbortError → 에러 표시 반복

**Why:** `student_class_history` 마이그레이션 이후 history 기반 날짜 필터가 빈 결과를 내는 경우 느린 fallback에 의존하게 됨.

## 수정 내용 (SHA 0ef05102)

`diary.tsx` lines 367-376:
- 변경 전: `GET /students?class_group_id=${classId}` (N+1 쿼리, 클라이언트 필터)
- 변경 후: `GET /class-groups/${classId}/students?date=${dateToUse}` (단일 JOIN 쿼리, 서버 필터)

클라이언트 필터에서 `class_group_id === classId` 체크 제거 (서버가 이미 처리).

## 배포 정보

- OTA 정책: 1.6.3 iOS+Android 동시, 2.0.0 iOS만
- 1.6.3 iOS: 01a05b6c (branch: production, runtime: 1.6.3)
- 1.6.3 Android: 01a05b6d (branch: production, runtime: 1.6.3)
- 2.0.0 iOS: 01a05b6e (branch: production, runtime: 2.0.0)

## /class-groups/:id/students?date= 엔드포인트

- `class-groups.ts:362` — `student_class_history` JOIN + 날짜 필터 단일 쿼리
- teacher role 접근 가능 (본인 담당 반만)
- response: `[{id, name, status, birth_year, class_group_id, assigned_class_ids, ...}]`
- 정렬: name 알파벳 순
