---
name: WP-CS23C-R 완료 상태
description: Canonical Reconciliation & Live Runtime Closure — P0 버그 2개 수정, DB 마이그레이션, 검증 결과
---

## 결과 요약
- SHA: `291652f5` (P0 fixes) → `a8b23426` (closure report)
- Remote: `origin/deploy-photo-clone`
- 3091/3091 TC 통과

## P0 버그 수정 (이번 세션)
1. **`finalCandidates` 미선언** (support-direct-answer.ts line 154/160)
   - fuzzy match 전체가 ReferenceError → non-fatal catch → null 반환
   - Fix: `finalCandidates` → `candidates`
2. **단일 token fuzzy false positive**
   - "결제" (1 meaningful stem) → "결제가 왜 안 돼?" (cStems=["결제"]) → perfect overlap
   - Fix: `if (meaningfulStems.length < 2) return null` in `findFuzzy`
3. **`answer_mode === null` 처리**: 유지 (legacy KI는 null → fall-through to GPT chain)
   - 단, 26개 existing active KI에 `answer_mode='DIRECT_DB'` DB write 완료 (이번 세션)

## DB 마이그레이션
- 26개 기존 active KI (`ki_cs12_*`, `ki_cs22_*`, `ki_x_*`, `ki_swimnote_*`):
  `answer_mode = NULL → 'DIRECT_DB'` (production Supabase)
- 실행일: 2026-08-19

## 43 vs 71 불일치
- "71"은 free-text 기재 오류. 실제: 41 NEW_PENDING + 2 HUMAN_ONLY = 43 신규 KI

## 검증 결과
- ACTIVE_UTT → NONACTIVE_KI VIOLATIONS: 0
- EXISTING_ACTIVE_CONTENT_CHANGED: 0
- EXACT match 10/10 (100%), SHORT match 10/10 (100%)
- AMBIGUOUS_FALSE_POSITIVE: 0
- LLM_CALLS_ON_DIRECT_HIT: 0 (structural)
- CIRCULAR_FALLBACK_VIOLATIONS: 0
- Performance: p50=8ms, p95=16ms, max=43ms

## Human Approval 대기 중
- 41 DIRECT_DB (pending) + 2 HUMAN_ONLY (pending) → Super Admin 콘솔 검토 필요
- 승인 후 371 pending utterances → active 전환

## 다음 Render 배포
- dep-da2hob7qj5pc73frl7m0 (SHA 291652f5) — 이번 세션 트리거됨
- 이후 a8b23426 (closure report만, 로직 변경 없음) → 필요시 별도 배포
