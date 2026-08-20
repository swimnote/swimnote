---
name: WP-AI-01 Scope and Locked Interpretations
description: WP-AI-01 전체 범위, 종료 조건, 고정 해석 3가지 (2026-08-21 FINAL LOCK)
---

# WP-AI-01 Locked Interpretations

## 1. AI Diary Production Path
- /ai/diary/generate → direct OpenAI (legacy | parser_v1 mode)
- /api/v1/ai/diary/generate → direct OpenAI (always parser_v1)
- 둘 다 Professional AI Engine 미연결
- 모바일 앱이 어느 endpoint 호출하는지는 미확정
- **AI Diary WP 시작 시 app-side 1회 read-only trace로 확정. 미리 보고 금지.**

## 2. Support Nano 정의
- gpt-4o-mini 사용 ≠ Support Nano 완료
- Support Nano = Broad Retrieval → Candidate → Nano 1회(context+선택+제거+종합+grounded answer) → Server Validator
- 현재 direct OpenAI 사용은 미완 상태
- PHASE 2 별도 구현 작업

## 3. WP-AI-01 전체 종료 조건
Phase 1 blocker 5개(trigger_type/Whisper/ai-pricing/cost_source/latency bug)는 선행 조건일 뿐.

전체 완료 범위:
- GPT usage logging (trigger_type 포함)
- Whisper/STT logging
- Parent Curriculum Engine logging (cost=null, UNKNOWN)
- Growth Report Engine logging (cost=null, UNKNOWN)
- SMS provider logging (Naver SENS 등)
- Cloudflare R2 logging
- request_count / units
- unknown cost 처리
- Super Admin aggregation API (GET /super/ai-cost-overview)
- Super Admin AI/API Cost UI ([AI비용] 탭)

**Why:** Phase 1만 완료 후 WP-AI-01 완료 처리하면 헌법 §14 전체 요구사항 미충족.

## 4. Roadmap Lock (2026-08-21)
WP-AI-01 → Support Nano → Professional Retrieval → Parent Curriculum → AI Diary → Growth Report → Real Unit Economics

순서 변경 금지. 현재 단계 완료 전 다음 단계 구현 금지.

## 5. Phase 1 Blockers (구현 대기 중)
1. AiTraceContext에 trigger_type 추가 + 전체 callsite 명시
2. handleWhisper에 saveAiTrace 추가 (ai.ts)
3. ai-pricing.ts: cached_input, Whisper, gpt-4o 가격 추가
4. AiTraceContext에 cost_source 추가
5. support-cases.ts line 659 latency_ms=0 버그 수정
