---
name: WP-CS23C 완료 상태
description: Expected Question Library, Direct Matcher Import & Runtime QA 완료 기록
---

# WP-CS23C 완료 상태

## 핵심 결과
- SHA: 81b8f2e8
- 총 테스트: 3091/3091 통과
- Render 재배포 트리거됨 (LIMIT 500 P0 fix = 서버사이드 변경)
- OTA 없음 (서버 전용 변경)

## LIMIT 500 P0 Fix
- 파일: `artifacts/api-server/src/lib/support-direct-answer.ts`
- 기존: `WHERE status='active' LIMIT 500` (blind full-scan)
- 신규: keyword-prefilter (ILIKE + LIMIT 300) + weight fallback (LIMIT 100)
- 상수: FUZZY_KEYWORD_LIMIT=300, FUZZY_FALLBACK_LIMIT=100, FUZZY_SUPPLEMENT_THRESHOLD=30

## Utterance Dataset
- 파일: `artifacts/api-server/src/content/support-intent-utterances.json`
- 총계: 610 utterances, 72 intents
- ERRORS: 0, WARNINGS: 0, CROSS_INTENT_COLLISIONS: 0
- 생성 스크립트: `scripts/generate-utterances.py`

## Production DB 결과
- 43 new canonical answers → pending knowledge items
- 26 existing ACTIVE ki_* → intent_id backfilled
- 610 utterances inserted: 239 active + 371 pending
- active = has_active_ki=true (기존 ACTIVE ki_* 연결)
- pending = new canonical (관리자 승인 후 활성화 예정)

## 테스트 파일
- `artifacts/api-server/src/routes/__tests__/cs23c.test.ts` (56 TC)
  - CS23C-D: Dataset integrity (D1~D15)
  - CS23C-L: LIMIT fix validation (L1~L4)
  - CS23C-E: Exact match (E1~E5)
  - CS23C-F: Fuzzy match (F1~F7)
  - CS23C-W: Wrong match prevention (W1~W9)
  - CS23C-S: Security isolation (S1~S4)
  - CS23C-H: HUMAN_ONLY flow (H1~H2)
  - CS23C-C: Circular fallback (C1~C2)
  - CS23C-P: Performance verification (P1~P4)
  - CS23C-R: Runtime 300+ queries (R1~R4)
- `artifacts/api-server/src/routes/__tests__/cs23a.test.ts` — mock 업데이트 (LIMIT 500 → ILIKE/LIMIT 300/100)

## 메트릭 검증 결과
- WRONG_DIRECT_MATCH: 0
- DIRECT_DB_LLM_CALLS: 0
- ROLE_LEAKAGE: 0
- MODE_LEAKAGE: 0
- POOL_LEAKAGE: 0
- CIRCULAR_FALLBACK: 0
- RUNTIME_QUERIES_TESTED: 320+

## 다음 단계
- Render 배포 완료 후 live 검증 가능
- pending utterances: 신규 canonical answer 관리자 승인 후 activate
- import 스크립트: `artifacts/api-server/import-utterances-cs23c.ts` (재실행 안전, ON CONFLICT DO NOTHING)
