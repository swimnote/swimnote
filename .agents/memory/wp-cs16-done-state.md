---
name: WP-CS16 완료 상태
description: Human Review / Knowledge Approval & Production Promotion Governance — 인간 승인 거버넌스 완료 기록
---

## 완료 정보
- **SHA**: e3775864
- **TC**: 95 신규 / 전체 2505 (all pass)
- **Render 배포**: 없음 (migration 미배포)
- **OTA**: 없음
- **UI**: NOT_IMPLEMENTED (API+domain logic+test 완료; Super Admin UI는 추후 WP)

## 핵심 구현

### 신규 파일
**lib/knowledge-approval.ts**
- `ALLOWED_REVIEWER_ROLES = ["super_admin", "platform_admin"]` (§2)
- `isApprovalAllowed(role)`, `isGlobalApprovalAllowed(role)` — JWT req.user.role 기준
- `ALLOWED_TRANSITIONS` — 상태 전환 맵 (§4)
  - pending → active/rejected/edit_required
  - edit_required → pending/rejected (active 직접 불허!)
  - active → archived/superseded (rollback용)
  - rejected/archived/superseded → [] (terminal)
- `REJECT_REASONS` — 10종 (UNSUPPORTED_SOURCE, NOT_IMPLEMENTED, WRONG_ROLE 등)
- `validateApprovalChecklist(candidate)` — 11차원:
  - SOURCE: source_ref 존재 → blocker
  - ROLE: VALID_ROLES 검사 → blocker
  - MODE: VALID_MODES 검사 → blocker
  - SECURITY: 민감 키워드 → blocker
  - CONFLICT: UNKNOWN (서버 라우트에서 별도 검사)
  - IMPLEMENTATION/ACTION/POLICY/GROUNDING/POOL/FRESHNESS: WARN only
- `CS12_CANDIDATE_READINESS` (21개 정적 감사):
  - READY_FOR_HUMAN_REVIEW: 17개
  - REVIEW_REQUIRED: 4개 (KNOWN_ISSUE triage — §15 incident model)
  - BLOCKED: 0
- `NO_AUTO_PROMOTION_GUARANTEE = true`
- `buildApprovalAuditRecord()` — JWT actor only (§9; client body reviewer_id 무시)
- `buildPublicApprovalTrace()` — reviewer PII 제외 (§20)
- `isAiReviewerAttempt()`, `isRollbackAllowed()`

**migrations/pool-db-cs-16.ts**
- `knowledge_approval_log` 테이블 (감사 이력)
  - decision CHECK: APPROVE/REJECT/REQUEST_EDIT/ROLLBACK
  - reject_reason CHECK: 10종
  - reviewer_id/role: JWT actor 기준
- `support_knowledge_items` 컬럼 추가:
  - reject_reason, edit_note, approved_by/at, rejected_by/at

**routes/knowledge-approval.ts**
- `requireApprovalRole()` — isApprovalAllowed 기반 미들웨어 (JWT req.user.role)
- 6개 라우트 (모두 requireAuth + requireApprovalRole):
  - GET /super/support/candidates
  - GET /super/support/candidates/:id
  - POST /super/support/candidates/:id/approve
  - POST /super/support/candidates/:id/reject
  - POST /super/support/candidates/:id/request-edit
  - POST /super/support/knowledge/:id/rollback
  - GET /super/support/approval-audit
  - GET /super/support/cs12-readiness
- Approve 시 §12 conflict check: candidate를 'active'로 매핑 후 detectConflicts 호출
- §7 동시성: WHERE status IN('pending','edit_required') AND revision=<current>
- §13 supersede: 기존 ACTIVE → superseded (명시적 요청 시만)

### 핵심 패턴 / 재발 방지
- `detectConflicts`는 NONE authority(pending) 항목을 NO_CONFLICT 처리 → approve시 candidate를 'active'로 임시 매핑 후 conflict 검사 필요
- `??` 연산자는 null을 falsy로 처리하므로 explicit null 오버라이드 시 `!== undefined` 비교 필요
- CONFLICT dimension은 checklist에서 UNKNOWN (DB 호출 불필요) — 라우트에서 별도 DB 쿼리

## CS12 P0 Coverage 결과
- AUTH_ACCOUNT_WITHDRAWAL/AUTH_POOL_ACCESS_DENIED/ATTENDANCE_PERMISSION_DENIED/
  NOTIFICATION_PERMISSION_OS/DATA_NOT_VISIBLE_ROLE_MISMATCH/DATA_NOT_VISIBLE_FILTER:
  → READY_FOR_HUMAN_REVIEW
- KNOWN_ISSUE_SERVER_API/AI_PROVIDER/PUSH/BILLING:
  → REVIEW_REQUIRED (§15: triage guide ≠ incident fact)

## §26 지표 (전부 0)
UNAUTHORIZED_APPROVAL / UNAUTHORIZED_AUTO_PROMOTION_PATHS /
DUPLICATE_ACTIVE_CREATED / CONCURRENT_APPROVAL_DUPLICATE /
APPROVAL_WITHOUT_SOURCE / APPROVAL_WITH_HARD_CONFLICT /
APPROVAL_WITH_SCOPE_MISMATCH / REJECTED_REACTIVATED_WITHOUT_REVIEW /
EDITED_AUTO_ACTIVATED / APPROVAL_IDOR / APPROVAL_POOL_LEAKAGE = 0
CS13/CS14/CS15 regression = 0
