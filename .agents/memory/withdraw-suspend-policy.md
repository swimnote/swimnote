---
name: 연기/퇴원 정책 구현 (education_started_at)
description: suspended_at+education_started_at 컬럼, canonical withdraw service, 장기연기 교육구간 컷오프 패턴
---

## 핵심 규칙

봉인된 월간 eligible target의 퇴원은 denominator/target/report identity를 삭제하지 않는다. 실제 post-seal withdrawal 증거에 따라 기존 정책 제외 귀결로 계산하며 generated에는 포함하지 않는다. 부모 자동 공개/PUSH와 AI 재분석으로 해결하지 않는다.

**Why:** 사용자가 2026-10-05 확정한 월간 정책이다. 퇴원 정리로 미발송 완료 리포트가 삭제되면 다음 준비 실행이 해당 대상을 다시 만들고 정상 귀결을 깨뜨릴 수 있다.

**How to apply:** PUBLISHED 보존 외에 봉인 대상의 월간 리포트도 보호한다. 감사·archive 증거를 유지한 canonical 정책 귀결과 정상 READY/outbox 경로를 사용하고, 일반 비봉인 임시 데이터 삭제 정책은 확대하지 않는다.

**suspended_at**: 연기 시 NOW() 기록, active 복귀 시 NULL로 초기화.
**education_started_at**: active 복귀 시 suspended_at 기준 1개월 초과이면 KST 오늘 날짜로 갱신, 미초과이면 유지.
**NULL education_started_at** = 전체 이력이 현재 교육구간 (기존 회원, backfill 금지).

## Canonical Withdraw Service

`artifacts/api-server/src/lib/withdraw-student-service.ts` — 퇴원은 반드시 이 함수 경유.
admin.ts `/students/:id/withdraw` + students.ts change-status `withdrawn` 양쪽 모두 동일 service 위임.

## 교육구간 컷오프 적용 위치

- `growth-report-snapshot-builder.ts` `buildAnalysisSnapshot`: `education_started_at` DB에서 직접 조회 → `effectiveAnalysisFrom`, `growthEvents` startFilter, `getPublishedReportHistory` educationStartMonth, `queryPreviousUsableReport` 조건부 skip.
- `growth-report-service.ts` `getPublishedReportHistory`: `educationStartMonth` 파라미터 추가 → `AND report_period >= educationStartMonth` 필터.
- `parent.ts` `/students/:id/diary`: SQL raw query에 `educationDateFilter` 추가.
- `parent.ts` `/students/:id/diary` growth report 피드: `AND gr.report_period >= educationStartMonth` 추가.
- `parent.ts` `/students/:id/news`: `newsEducationStartedAt` 조회 → diary 쿼리에 `newsDateFilter` 추가.

**Why:** 1개월 이상 연기 후 재등록 시 이전 교육기록이 현재 구간에 섞이지 않아야 함.

## 배포 상태 (2026-09-25)

SHA: fcfcc52a (Render LIVE 확인)
Migration: Supabase 운영 DB suspended_at+education_started_at 추가 완료
iOS OTA: production-v2, ID 01a0d917, runtimeVersion 2.2.0
