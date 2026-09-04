---
name: WP-CS14 완료 상태
description: Support Resolution Quality & Grounding Audit — 품질/근거 감사 완료 기록
---

## 완료 정보
- **SHA**: fcebb10f
- **TC**: 93 신규 / 전체 2319 (all pass)
- **Render 배포**: 없음 (감사 전용)
- **OTA**: 없음

## 핵심 발견 사항

### 아키텍처 — 근거 보장 (SOUND)
1. LLM 프롬프트: "근거에 없는 메뉴, 정책, 기능, 가격을 창작하거나 추측하지 않습니다" 명시
2. gatherEvidence SQL: `WHERE status='active'` → PENDING 지식 완전 차단
3. 빈 evidence → LLM 호출 스킵 → LOW confidence + human CTA (no_evidence path)
4. SCREEN_BY_ID registry → 환각 UI 경로 차단 (미등록 screen_id 제공 불가)
5. DB-backed answers: `row.answer ?? row.content` (하드코딩 없음)
6. maxItems=5 cap + `.slice(0, maxItems)` → 무관련 지식 포함 방지

### 추적성 — 부분 구현 (NOT_IMPLEMENTED gap)
- `deriveEvidenceContext`: source_type/source_id는 support_cases.context_json에 내부 저장
- **HTTP 응답에 source_id/knowledge_id 미포함** (NOT_IMPLEMENTED — CS15 scope 검토 필요)
- `saveAiTrace` 호출: SUPPORT_AI 타입으로 전체 관측성 확보

### 모순 탐지 — 협소 (PARTIAL)
- `deriveEvidenceContext`: feature 충돌 시 null 반환 (안전 fallback)
- 일반 KB 모순 탐지 메커니즘 없음 (evidence 단위 충돌만 처리)

## Golden Set (50 scenarios)
| 카테고리 | 수 | 품질 |
|---------|---|------|
| normal_success | 10 | A (모두) |
| permission_role | 10 | A/B/C |
| mode_x | 10 | A/B |
| failure_unknown | 10 | B/C |
| adversarial | 10 | B/C |

## 9개 품질 지표 — 전부 0
- UNSUPPORTED_CLAIMS = 0
- CONTRADICTED_CLAIMS = 0
- HALLUCINATED_UI_PATH = 0
- INVALID_ACTIONS = 0
- PENDING_KNOWLEDGE_USED_AS_GROUNDING = 0
- IRRELEVANT_KNOWLEDGE_IN_ANSWER = 0
- CONTRADICTORY_INSTRUCTION_EMITTED = 0
- UNSAFE_OR_UNGROUNDED = 0
- UNSAFE_OR_UNGROUNDED golden scenarios = 0

## P0 커버리지 갭 (정직 보고)
- CS12 21개 PENDING 후보가 P0 10종을 커버하나 **모두 PENDING** (운영 미활성)
- 운영 지식 갭 = 10 (CS12 Super Admin 승인 후 해소 예정)
- 갭 문서화 자체가 CS14 목표 — 테스트 실패 아님

## 검증된 코드 패턴
- `LLM output에서 직접 entity 추출 금지 — evidence metadata만 사용` (support-resolver.ts:820)
- `maxItems = 5` default + `.slice(0, maxItems)` (support-resolver.ts:906, 931)
- `role = user.role` (JWT, not body.role) (support-respond.ts)
- `POOL_MISMATCH` 격리 검증 (CS13에서 확인)
