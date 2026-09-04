---
name: GR8 완료 상태
description: GR8 PARENT NATIVE GROWTH REPORT DETAIL 완료 기록
---

## GR8 완료 상태

- **Branch**: deploy-photo-clone
- **SHA**: cb642da2
- **TC**: 66 TC 추가 → 전체 899/899 통과

## 신규/수정 파일

| 파일 | 역할 |
|---|---|
| `routes/parent-growth-report.ts` | GET /parent/growth-reports/:reportId 추가 (기존 Q&A 라우트 파일 확장) |
| `app/(parent)/growth-report-detail.tsx` | GR7 shell → 완전한 Native Detail Screen |
| `app/(parent)/home.tsx` | GrowthReportFeedCard View→Pressable, opacity 비활성 제거 |

## 서버 API 설계 (GET /parent/growth-reports/:reportId)

- requireAuth only (requireReportXAccess 미사용 — X 만료 후에도 PUBLISHED 조회 가능)
- product_status = PUBLISHED 전용 (나머지 → 403 UNPUBLISHED)
- parent_students status='approved' ownership DB 검증
- safe SELECT: report_content, sns_summary, report_period, published_at
  (report_fact_package, teacher_review_note 제외 — DB SELECT 레벨에서 차단)
- report_content safe projection: summary_text + sections(text only, 8 canonical keys)
- claim_ids / debug_trace / grounding_result → 응답에서 제외
- report_content null/string/array → 500 INVALID_REPORT_CONTENT (500≠"리포트 없음")
- sns_summary null → null 그대로 반환 (nullable)

## 앱 화면 설계

- apiRequest 재사용 (AuthContext, raw fetch 금지)
- 에러 6종 구분: NOT_FOUND / FORBIDDEN / UNPUBLISHED / INVALID_REPORT_CONTENT / NETWORK_ERROR / SERVER_ERROR
- 재시도 버튼: NETWORK_ERROR / SERVER_ERROR만
- ScrollView + 단일 스크롤 (nested scroll 없음)
- 섹션 canonical order 8개, 없으면 완전 생략 (placeholder 금지)
- summary_text 전체 표시 (numberOfLines 없음)
- 점수/게이지/퍼센트/레이더 없음
- PDF/SNS share 없음 (GR9)
- NAVY + MINT 브랜드

## 주의사항 / 함정

- `gr.deleted_at` 컬럼명에 "DELETE"가 포함 → TC11에서 regex `/DELETE/i` 오매칭
  → `/^DELETE\b/im` (multiline anchor)로 해결
- `require("@workspace/db")` in test → ESM mock 우회 → top-level import로 해결
- GR8 라우트는 `requireReportXAccess` 미사용이 올바른 설계 (X 만료 후에도 열람 가능)

## 다음 단계: GR9 (PDF Export / SNS Share)
