---
name: 성장 리포트 발급 헌법
description: 월별 AI 성장 리포트 발급 대상 학생 선정 기준 (영구 불변)
---

# 성장 리포트 발급 헌법

> 2026-09-11 확정. 500개 수영장 20만명 기준으로 설계. 변경 시 별도 승인 필요.

## 발급 대상 조건 (3가지 동시 충족)

```
(a) students.status = 'active'           -- 퇴원·정지·삭제 제외
(b) students.deleted_at IS NULL
(c) student_class_history 이력:
      enrolled_at <= report_period 시작일 (1일)  -- 전달 시작 전 등록
      left_at IS NULL OR left_at >= 다음달 1일   -- 이번 달까지 유지
(d) class_groups.swimming_pool_id = pool_id     -- 같은 pool 반 소속
```

## 예시

- 8월 리포트: enrolled_at <= 2026-08-01 AND (left_at IS NULL OR left_at >= 2026-09-01)
- 8월 중 신규 등록 학생: 10월 리포트부터 첫 발급 (한 달 완전 유지 후)

## 중복 방지

- student_id 기준 사이클당 1건 (ON CONFLICT DO NOTHING)
- 주2회 등 여러 반 수강자도 1건만 발급
- 동명이인: parent_students.status='approved' 기준 별개 학생 확인 후 각 1건

## 코드 위치

- 스케줄러(사이클 오픈): `artifacts/api-server/src/jobs/growth-report-scheduler.ts` — openCycleForPool()
- 배치 워커(AI 생성): `artifacts/api-server/src/jobs/growth-report-batch-worker.ts` — getEligibleStudents()
- 두 곳의 학생 SELECT 조건이 동일해야 함 (헌법 위반 방지)

## 발급 흐름

1. 매월 1일 00:00 KST — 스케줄러: cycle 생성 + 대상 학생 OPEN 리포트 생성
2. 매월 5일 02:00 KST — 배치 워커: AI 분석 시작 (PENDING batch job)
3. AI 완료 → REVIEW_REQUIRED → 관리자 앱 push 알림 발송
4. 관리자 검수 후 "발송" → 학부모 전달 (PUBLISHED)

**Why:** 500개 수영장 20만명 규모에서 발급 오류가 발생하면 복구 비용이 막대하다.
학부모 신뢰가 핵심 지표이므로 발급 기준을 단순하고 예측 가능하게 유지한다.

**How to apply:** 스케줄러 또는 배치워커 학생 SELECT 쿼리를 수정할 때 반드시 이 문서와
비교하여 두 쿼리가 동일한 기준을 사용하는지 확인하고 TC를 통과시킨다.
