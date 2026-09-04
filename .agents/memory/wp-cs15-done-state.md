---
name: WP-CS15 완료 상태
description: Traceability, Incident & Knowledge Conflict Governance — 추적성·충돌·인시던트 거버넌스 완료 기록
---

## 완료 정보
- **SHA**: c275eeba
- **TC**: 91 신규 / 전체 2410 (all pass)
- **Render 배포**: 없음 (서버 코드 변경 있으나 미배포)
- **OTA**: 없음

## 핵심 구현

### 신규 파일
**lib/knowledge-governance.ts**
- `getSourceAuthority(itemType, dbSourceType, status)` → L1-L4+NONE
  - L1: RULE/DB_STATE/FRONTEND_MAP/CODE/REGISTRY
  - L2: FAQ/SOLUTION/KNOWLEDGE/GUIDE/POLICY/KNOWN_ISSUE
  - L3: INCIDENT
  - L4: default
  - NONE: status ≠ 'active'
- `assessFreshness(updatedAt, revision, supersededById?)` → CURRENT/REVIEW_DUE/STALE/SUPERSEDED/UNKNOWN
  - < 30일 → CURRENT, 30-90일 → REVIEW_DUE, 90-365일+rev=1 → STALE, > 365일 → STALE
- `detectConflicts(items[])` → KnowledgeConflictRecord[]
  - HARD_CONFLICT: same feature/type/revision, diff id → UNRESOLVED
  - VERSION_CONFLICT: same feature/type, diff revision → RESOLVED (higher wins)
  - AUTHORITY_CONFLICT: diff authority → RESOLVED (lower L# wins)
  - CONTEXT_CONFLICT: same feature, diff type, same authority → UNRESOLVED
- `resolveConflictWinner(a, b)` → EvidenceItem | null
- `hasUnresolvedConflict(items[])` → boolean (HARD/CONTEXT → true)
- `detectDuplicates(items[])` → DuplicateCandidate[] (EXACT/NEAR/VALID_VARIANT/REVIEW_REQUIRED)
- `buildSafeTraceRef(item)` → 5-field whitelist: ref/item_type/status/revision/freshness_state
- `getIncidentSafeMessagePrefix(status)` → 5개 상태별 distinct 메시지
- `LLM_CAN_MODIFY_INCIDENT_STATUS = false` (상수)
- `INCIDENT_FALLBACK_MESSAGE` — 확인된 장애 없을 때 safe fallback
- `AUDIT_LOG_IMMUTABILITY_STATUS = "REVIEW_REQUIRED"` (honest gap)
- `TRACE_RETENTION_POLICY = "NOT_IMPLEMENTED"` (honest gap)

**migrations/pool-db-cs-15.ts**
- `pool_support_incidents` 테이블 — pool별 운영 장애 기록
  - status CHECK: INVESTIGATING/CONFIRMED/MONITORING/RESOLVED/FALSE_ALARM
- `support_cases.origin_request_id` — 최초 request_id 추적
- `support_knowledge_items.supersedes_id + superseded_by_id` — supersede 관계
- `support_knowledge_items.conflict_group` — conflict 탐지 키
- `support_cases.incident_id` → `pool_support_incidents` 참조

### 수정 파일
**lib/support-resolver.ts**
- `EvidenceItem` +5 필드: status/revision/updated_at/source_type/freshness_state
- `gatherEvidence` SELECT +revision/updated_at/source_type/source_ref
- mapping에 `assessFreshness` 적용 (lazy import from knowledge-governance)
- FM evidence `freshness_state = 'CURRENT'` (항상)

**routes/support-respond.ts**
- 두 HTTP 응답 경로 모두 `meta.trace { request_id, evidence_refs[] }` 추가
  - deterministic: `[{ ref: source_id, item_type: source_type }]`
  - LLM: `evidence.map(buildSafeTraceRef)` — 5-field whitelist
- `origin_request_id` → context_json에 COALESCE 저장 (두 경로 모두)

**routes/knowledge-search.ts**
- `pool-db-cs-15` migration boot 등록

## 품질 지표 (모두 0)
- TRACE_MISSING_SOURCE_REF = 0
- TRACE_BROKEN_REQUEST_CHAIN = 0
- TRACE_SCOPE_LEAKAGE = 0
- UNRESOLVED_CONFLICT_EMITTED = 0
- FALSE_INCIDENT_CLAIM = 0
- INCIDENT_SCOPE_LEAKAGE = 0
- INCIDENT_STATUS_MISREPRESENTATION = 0
- PENDING_KNOWLEDGE_USED_AS_GROUNDING = 0
- PENDING_KNOWLEDGE_EXPOSED_IN_TRACE = 0
- CS13 security regression = 0
- CS14 quality regression = 0

## REVIEW_REQUIRED (정직 보고, P0/P1 없음)
- AUDIT_LOG_IMMUTABILITY: support_cases.context_json은 UPDATE 가능 — append-only 아님
- TRACE_RETENTION_POLICY: ai_traces/support_events에 TTL 정책 없음
- HTTP answer-to-source knowledge_id: 내부 context_json에만 (CS14 발견 동일); evidence_refs로 개선됨

## 참고 패턴
- SafeEvidenceRef 5-field whitelist: ref/item_type/status/revision/freshness_state — 추가 필드 요청 시 이 목록에서만 허용
- HARD_CONFLICT → null (safe fallback, LLM 전달 금지)
- VERSION_CONFLICT → higher revision wins (RESOLVED)
- AUTHORITY_CONFLICT → lower SOURCE_AUTHORITY level wins (RESOLVED)
