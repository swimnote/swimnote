---
name: WP2 완료 상태
description: APP+PC UI 연결 + Growth Report Navigation + 최종 E2E 완료
---

## 완료 SHA
main HEAD: 315b3668  
Render LIVE: 315b3668  
iOS OTA: 01a0a3fc (branch production-v2, runtimeVersion 2.2.0)

## 구현 목록

### APP 변경
- teacher/student-detail.tsx: "성장리포트 보기" 버튼 추가 (→ teacher-gr-history)
- teacher/teacher-gr-history.tsx: 학생별 PUBLISHED GR 목록 (GET /teacher/students/:studentId/growth-reports)
- teacher/teacher-gr-detail.tsx: GR 상세 (GET /teacher/growth-reports/:reportId), report_content 필드 사용, AI trace 제외, 하단 "학부모 반응 보기" 버튼
- teacher/_layout.tsx: teacher-gr-history / teacher-gr-detail 등록
- teacher/messages-inbox.tsx: growth_report_like/comment → teacher-gr-detail (기존 growth-report-reactions 아님)
- admin/makeups.tsx: pool_admin mutation 버튼 전부 제거 (READ ONLY)

### API 변경
- admin-growth-report-production.ts: GET /admin/growth-reports/students/:studentId 추가 (pool_admin + super_admin)
  - 라우터가 /admin/growth-reports에 마운트됨 → 실제 경로 /admin/growth-reports/students/:studentId

### Dashboard 변경
- MakeupsPage.tsx: AssignDrawer / cancelMut 완전 제거, read-only 테이블
- MembersPage.tsx: GrHistorySection 컴포넌트 추가 (useQuery → /admin/growth-reports/students/:studentId)

## API 응답 필드명 주의
- GET /teacher/growth-reports/:reportId 응답: report_content (content 아님!)
- summary_text는 report 최상위 필드 (report_content 안에도 있을 수 있음)

## DB migration
없음
