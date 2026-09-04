---
name: GR4 완료 상태
description: GR4 Parent Question UI + Answer Submission + Second-Pass Reanalysis 완료 기록
---

## GR4 완료 상태

- **Branch**: deploy-photo-clone
- **SHA**: 32655242
- **TC**: 58 TC 추가 → 전체 662/662 통과

## 신규/수정 파일

| 파일 | 역할 |
|---|---|
| `parent-growth-report.ts` | GET /questions + PUT /answers + POST /complete |
| `routes/index.ts` | parentGrowthReportRouter 등록 |
| `growth-report-questions.tsx` | Parent Expo 질문 UI (SINGLE/MULTI_CHOICE, partial save, complete) |
| `(parent)/_layout.tsx` | growth-report-questions 스크린 등록 |

## 핵심 설계

- `requireAuth` 테스트 모킹 필수 (실제 JWT 검증) — `vi.mock("../../middlewares/auth.js")`
- `requireReportXAccess` 도 vi.fn으로 next() 호출로 pass-through 필요
- parent ownership: `parent_students WHERE parent_id=? AND student_id=? AND status='approved'`
- EDIT_LOCKED (423): ANALYZING/REVIEW_REQUIRED/APPROVED/PUBLISHED 상태에서 answer 수정 불가
- PARENT_INPUT_CLOSED (423): parent_input_status=CLOSED 시 PUT /answers 차단
- complete: QUESTION_AVAILABLE → READY_FOR_ANALYSIS → GR3 worker가 second-pass ENGINE 호출
- idempotent complete: 이미 READY_FOR_ANALYSIS 이상이면 200 already_complete:true 반환

## 다음 단계: GR5~GR9
- GR5: Teacher Review API (review/approve)
- GR6: Parent View API (published report 조회)
- GR7: SNS Share + Push Deep Link
- GR8: Admin/Audit endpoints
- GR9: Integration 검증
