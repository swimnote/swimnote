---
name: WP-CS24 완료 상태
description: Support Learning Loop — Query Log + Candidate Engine + Review Console 완료 정보
---

## WP-CS24 완료 상태

- **SHA:** 29f90acc
- **TC:** 신규 50 / 전체 3141 모두 통과
- **Render 배포:** push 트리거됨 (자동 빌드)
- **OTA:** 없음 (앱 코드 변경 없음)

## 신규 파일

| 파일 | 역할 |
|------|------|
| `migrations/pool-db-cs-24a.ts` | support_query_log 테이블 |
| `migrations/pool-db-cs-24b.ts` | support_knowledge_candidates 테이블 |
| `lib/support-candidate-engine.ts` | classifyQuery / logSupportQuery / evaluateForCandidacy / promote / metrics |
| `routes/support-learning.ts` | 9개 엔드포인트 (super_admin 전용) |
| `lib/__tests__/support-candidate.test.ts` | 50 TC |
| `pages/super/SuperKnowledgeCandidates.tsx` | Web Review Console |

## 수정 파일

- `routes/support-respond.ts` — 결정론적+LLM 경로 양쪽 fire-and-forget 훅 추가
- `routes/index.ts` — supportLearningRouter 마운트
- `index.ts` — CS24A/CS24B migration 시작 시 실행
- `SuperLayout.tsx` — "Learning Loop" 메뉴 추가 (/super/knowledge-candidates)
- `App.tsx` — Route 추가

## 핵심 설계 원칙 (영구)

- AUTO_ACTIVATE = 완전 금지 (Engine/API/DB/Promote 4중 차단)
- DYNAMIC/POLICY = Candidate 생성 금지
- normalized_query만 저장 (raw message/PII 금지)
- 전체 승인 = Human Review 필수 (시스템 자동 없음)

## 기존 event_logs와 다른 점 (신규 테이블 정당성)

- event_logs.metadata.stages = JSONB 배열 → normalized_query 없음, 집계 불가
- support_query_log = normalized_query + resolution_source + matched_knowledge_id 구조화
- Candidate Engine이 실시간 그루핑 쿼리 가능
