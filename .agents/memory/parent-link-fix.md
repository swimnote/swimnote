---
name: 학부모 연결 승인 FIX
description: 수동승인 student_id override, sibling 자동연결, rejected→approve, NULL pending 처리 패턴
---

## 핵심 변경

auto-link-v2.ts 재작성 (cf29be93):
- `linkApprovedParentToRegisteredChildren(parentId, poolId, phoneNorm)` — 자동/수동/rejected→approve 세 경로 공통 helper
- `approveParentV2Pending(pendingId, poolId, overrideStudentId?)` — student_id override, pending+rejected 허용, matched=idempotent
- `rejectParentV2Pending` — rejected=idempotent, matched=차단
- `retryNullPendingByPool(poolId)` — NULL pending 일괄 재시도

**Why:** 자동승인 실패 = 관리자 승인 금지가 아님. 기존 코드는 name_mismatch → matched_student_id=NULL → 승인 재시도 → 재실패 루프.

## API 변경

- `PATCH /admin/parent-v2-pending/:id` body에 `student_id` 추가
- `POST /admin/parent-v2-retry-all` 신규 (NULL pending 일괄 재시도)

## UI 변경 (approvals.tsx)

- matched_student_id 없으면 [승인] → StudentPickerModal (GET /students/search 재사용)
- rejected 탭 [승인] 버튼 표시 (rejected → approve)
- pendingReasonLabel 문구: name_mismatch → "학생 이름 확인 필요" 등

## 형제자매 자동연결

보호자 승인 후 동일 pool에서 parent_phone1~4 일치 학생 전원 연결.
자동/수동/rejected→approve 세 경로 모두 동일 helper 사용.

## NULL pending 처리 결과 (2026-08-13)

- 실행 전 NULL: 26건 (5개 pool)
- 자동연결: 5건
- pending_reason 기록: 21건 (name_mismatch 23건, phone_mismatch 3건)
- 남은 NULL: 0건

## 슬래시 이름 정책

"박새연/박세아" 형태 → normalizeName이 그대로 처리 → name_mismatch → pending → 관리자 수동 선택
자동승인 금지. / 기준으로 임의 분할하지 않음.
