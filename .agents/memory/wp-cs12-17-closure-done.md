---
name: WP-CS12~17 CLOSURE 완료 상태
description: CS12~17 Evidence Recovery, Runtime Integration & Security Closure 최종 상태
---

# WP-CS12~17 CLOSURE 완료

**SHA**: 489b09e2
**TC**: 81 신규 (cs12-17-closure.test.ts), 2676 전체 통과
**Render**: 미배포 (다음 기능 작업 시 배포)
**OTA**: 없음

## 수정된 실제 버그 3건

### P1 — knowledge-search.ts /approve revision guard 누락
- **문제**: `PATCH /super/support/knowledge/:id/approve`에 revision guard 없음
  → 두 super_admin이 동시 approve 시 DUPLICATE_ACTIVE 가능
- **수정**: `AND revision = ${currentRevision} RETURNING id` + `!(rows[0])` 체크
  + `status IN ('pending','edit_required')` 상태 게이트 추가
- **영향**: cs-05r.test.ts mock도 RETURNING id 패턴 + hasRevisionGuard 분기 추가

### P3 — support-coverage.v1.ts ComplaintClass 타입 누락
- **문제**: `COMPLAINT_NOT_RECEIVED`가 ComplaintClass 유니온 타입에 없음 → TS 오류
- **수정**: 타입에 추가

### FIX — knowledge-approval.ts import 오류 (CS17에서 수정됨)
- `../db/superAdminDb.js` (존재하지 않음) → `@workspace/db` + `drizzle-orm`

## 테스트 레벨 분류

| 레벨 | 항목 |
|------|------|
| UNIT | 순수 함수 검증 (isApprovalAllowed, CS12_CANDIDATE_READINESS, REJECT_REASONS 등) |
| MOCK | CASE_IDOR 시뮬레이션, 소유권 체크 단위 테스트 |
| COMPONENT | readFileSync 기반 소스 분석 (auto-promotion 경로, route 구조, UI 코드) |
| INTEGRATION | import chain 검증 (실제 tsx import 성공 여부) |
| E2E | 없음 (Production DB 불필요) |
| PRODUCTION | 없음 (DB write=0, deploy=0) |

## 주요 메트릭

**RUNTIME**: RUNTIME_IMPORT_ERROR=0, SERVER_BOOT_ERROR=0 (재시작 확인), WEB_BUILD_ERROR=0, TYPECHECK_ERROR=0(CS12~17 관련; 사전존재 오류 2건 P3 fix)

**CS12**: CANDIDATES_TOTAL=21, PENDING_STATUS=21, ACTIVE_AUTO_PROMOTED=0, READY=17, REVIEW_REQUIRED=4, BLOCKED=0

**CS13**: ROLE_LEAKAGE=0, POOL_LEAKAGE=0, CASE_IDOR=0(actor+pool 2중 체크), STUDENT_SCOPE_STATUS=NOT_APPLICABLE

**CS14**: GROUNDING=active-only(WHERE status='active'), PENDING_IN_EVIDENCE=0, NEW_LLM_CALLS=0, UNSAFE_OR_UNGROUNDED=0

**CS15**: TRACE_SCOPE_LEAKAGE=0(case gate 먼저), DUPLICATE_ACTIVE_GUARD=IMPLEMENTED, ACTIVE_CONFLICT_AUDIT=PRODUCTION_ONLY

**CS16**: READY=17, REVIEW_REQUIRED=4, BLOCKED=0, UNAUTHORIZED_AUTO_PROMOTION_PATHS=0, APPROVAL_IDOR=0(requireApprovalRole), APPROVAL_POOL_LEAKAGE=NOT_APPLICABLE, CONCURRENT_DUPLICATE=0(revision guard)

**CS17**: UNAUTHORIZED_UI_ACCESS=0(SuperGuard), UI_BYPASS_APPROVAL=0(server enforces), CONCURRENT_APPROVAL_UI_ERROR=0(409+refetch), RAW_SOURCE_LEAKAGE=0(safeSourceRef), PII_LEAKAGE=0(reviewer_role only), PENDING_SHOWN_AS_ACTIVE=0, KNOWN_ISSUE_SHOWN_AS_INCIDENT=0

## CLOSURE MATRIX

| WP | 상태 |
|----|------|
| CS12 | CLOSED |
| CS13 | CLOSED (STUDENT_SCOPE=NOT_APPLICABLE 명시) |
| CS14 | CLOSED (UNSUPPORTED_CLAIMS=COMPONENT verified) |
| CS15 | CLOSED (ACTIVE_CONFLICT_AUDIT=PRODUCTION_ONLY 명시) |
| CS16 | CLOSED (APPROVAL_POOL_LEAKAGE=NOT_APPLICABLE 명시) |
| CS17 | CLOSED |

**ALL_CS12_TO_CS17_CLOSED: YES**

## 테스트 핵심 패턴

- detectConflicts 시그니처: `(items: EvidenceItem[])` — CandidateRow 아님
- REJECT_REASONS 실제값: UNSUPPORTED_SOURCE/NOT_IMPLEMENTED/WRONG_ROLE/WRONG_MODE/POLICY_UNVERIFIED/DUPLICATE/CONFLICT/OUTDATED/SECURITY_RISK/OTHER
- isGlobalApprovalAllowed: super_admin + platform_admin 모두 허용
- cs-05r.test.ts mock UPDATE: hasRevisionGuard → params[params.length-2]=id, RETURNING id → rows[{id}] 반환
