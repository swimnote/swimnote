---
name: GR6 완료 상태
description: GR6 APPROVED→PUBLISHED Publication + Parent Feed Integration 완료 기록
---

## GR6 완료 상태

- **Branch**: deploy-photo-clone
- **SHA**: f707d942
- **TC**: 60 TC 추가 → 전체 778/778 통과

## 신규/수정 파일

| 파일 | 역할 |
|---|---|
| `growth-report-service.ts` | publishGrowthReport() + PublishPreconditionError/PublishNotAllowedError 추가 |
| `publish-growth-report.ts` | POST /teacher/growth-reports/:reportId/publish (pool_admin+super_admin) |
| `routes/index.ts` | publishGrowthReportRouter 등록 |
| `routes/parent.ts` | /students/:id/diary에 GROWTH_REPORT 아이템 추가 |
| `home.tsx` | GrowthReportFeedItem 타입 + GrowthReportFeedCard 컴포넌트 |

## 핵심 설계

- Feed 방식: projection/query (별도 feed table 없음) — product_status='PUBLISHED' 단독 필터
- 게시 권한: pool_admin + super_admin만 (teacher = APPROVE까지)
- published_at: 최초 1회만 기록 (transitionReportStatus 내부 처리)
- 멱등성: already PUBLISHED → alreadyPublished=true (200)
- 동시성: transitionReportStatus SELECT FOR UPDATE
- X 만료 후도 기존 PUBLISHED report 조회 유지 (필터 없음)
- preview: report_content.summary_text + sns_summary.headline/key_points만 노출
- 금지: raw fact_package, teacher_review_note, excluded_claims 노출 금지
- GR7 전까지 Push 발송 없음; GR9 전까지 SNS share 구현 없음
- GR8 전까지 상세화면 없음 (growth_report_id 보존, affordance 비활성)

## vitest mock 패턴 핵심

- `vi.mock("../../lib/growth-report-service.js")`에서 publishGrowthReport를 오버라이드하면 다른 describe 블록의 afterEach가 전역으로 영향 → 실제 구현 사용 + superAdminDb.execute 시퀀스 mock으로 route 테스트
- parent.ts 라우터 테스트: db.select() Drizzle ORM 체인 mock 필요 (execute만으로 부족); callIndex로 parentStudents/students 구분
- student_class_history가 빈 배열 반환 시 route가 `res.json([])`로 early return → 반드시 class_group_id 포함 반환

## 다음 단계: GR7 (Push Notification — GROWTH_REPORT_PUBLISHED)
