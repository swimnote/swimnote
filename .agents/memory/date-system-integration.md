---
name: 날짜 시스템 통합
description: student_class_history(enrolled_at/left_at) 단일 소스 통합 — 핵심 패턴, 함정, 운영 배포 완료 기록
---

## 핵심 원칙

- `student_class_history`가 날짜 진실 소스. `s.status` 조건 제거, `s.deleted_at IS NULL`만 유지.
- `left_at` = 방식 B (제외 시작일): `left_at IS NULL OR left_at > date` (left_at 당일은 미포함)
- `enrolled_at` = 포함 시작일: `enrolled_at <= date`

**Why:** 기존 s.status 필드가 enrolled_at/left_at과 독립적으로 관리되어 불일치 발생.
history 테이블을 단일 소스로 사용하면 반이동·연기·복귀 모두 자동 처리됨.

## DB 타입 함정

- `student_class_history.enrolled_at`, `left_at`: **date 타입** (pg → Date 객체 또는 YYYY-MM-DD 문자열)
- `attendance.date`, `class_diaries.lesson_date`: **text 타입**
- 비교 시 반드시 `::text` 캐스팅 필요:
  ```sql
  AND sch.enrolled_at::text <= a.date
  AND (sch.left_at IS NULL OR sch.left_at::text > a.date)
  ```
- 캐스팅 없으면 `operator does not exist: date <= text` 런타임 오류

## DISTINCT ON 버그 패턴

- `SELECT DISTINCT ON (s.id, h.class_group_id) ... ORDER BY enrolled_at DESC`는 **최신 hist row만 선택**
- 연기→복귀 학생의 이전 기간 출결/일지 누락
- **해결:** DISTINCT ON 제거 + aggregated 방식 (student+class_group 키로 JS에서 집계)
- 적용 위치: attendance.ts weekly, attendance.ts monthly-summary

## toDateStr 정규화 패턴

pg가 date 컬럼을 Date 객체로 반환할 수 있어 항상 정규화 필요:
```ts
const toDateStr = (v: any): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
```

## 수정된 파일 목록

- `today-schedule.ts`: studentCountMap history JOIN
- `attendance.ts`: weekly + monthly-summary DISTINCT ON 제거, aggregated 집계
- `diary.ts`: sendDiaryPush history JOIN
- `push-scheduler.ts`: 예약 푸시 history JOIN
- `parent.ts` 332/366행: `enrolled_at::text <= a.date`

## 통합 테스트

`artifacts/api-server/src/scripts/integration-test.ts` — 42개 항목 전체 PASS
실행: `pnpm --filter @workspace/api-server exec tsx src/scripts/integration-test.ts`

## 운영 배포 (2026-07-20)

- 서버 버전: v2.3-2026-07-20 (app.ts 하드코딩)
- OTA Update Group IDs:
  - iOS production: 015341be-574e-4b11-bc95-8932c2f2986a
  - iOS preview:    5cdc43a2-6423-4702-b75b-dcbfc2dff624
  - Android production: 10d5559b-7e78-4c0b-b07c-49f3b187dcb4
  - Android preview:    f963a211-ceae-453c-ba43-d70e4cf6938a
- Runtime version: 1.6.0
- Git tag 생성 필요: `v2.3-date-system-integration` (main agent에서 차단됨 → 수동 생성)
