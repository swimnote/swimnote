---
name: P0-MINI CS08R Resolver+Telemetry Harden 완료
description: gatherEvidence FM 독립성 + llm_used/model no_evidence 버그 수정 완료 상태
---

## 수정 내용

**SHA**: 74efb4e2  
**브랜치**: deploy-photo-clone (push 완료)  
**테스트**: 1672/1672 (신규 +19 CS08H TCs)

### DEFECT 1: gatherEvidence FM 독립성

`support-resolver.ts gatherEvidence()` — FM 정적 레지스트리를 knowledge DB와 독립적으로 evidence에 포함.

- ACTIVE knowledge=0이어도 FM 항목이 LLM evidence로 사용 가능
- role/mode 필터 유지 (parent→admin 화면 노출 금지)
- knowledge DB 쿼리는 유지 (regression 없음)

**Why**: production에서 support_knowledge_items가 모두 pending이어도 LLM fallback이 FM 기반 근거로 응답 가능해야 함.

### DEFECT 2: no_evidence llm_used/model 버그

`support-respond.ts` no_evidence 분기:

- `llm_used: true` → `llm_used: llmActuallyCalled` (evidence.length > 0)
- `llm_called: evidence.length > 0 && !llmError` — 동일 기준 정합
- saveAiTrace `model: LLM_MODEL` → `model: null` (미호출이면 모델 없음)

**Why**: llm_used = "실제 provider API 호출했는가" 계약. partner analytics cost 집계 신뢰성 필수.

## Generation Mode Contract (확정)

| mode | llm_used | model | OpenAI call |
|---|---|---|---|
| deterministic | false | null | 0 |
| no_evidence | false | null | 0 |
| llm_grounded | true | gpt-4o-mini | 1 |
| provider_failure (call 후) | true | gpt-4o-mini | 1 (failed) |

## 배포

- Render: 배포 트리거됨 (srv-csi2un8gph6c73crth2g)
- iOS OTA: NO
- Android OTA: NO
- Web: NO
- DB migration: NO
