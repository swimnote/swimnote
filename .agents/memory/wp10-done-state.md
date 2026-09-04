---
name: WP10 완료 상태
description: WP10 AI Trace / Cost Observability 구현 완료 기록
---

## WP10 — AI Trace / Cost Observability ✅ COMPLETE

- **SHA**: `ea0906d4` on `deploy-photo-clone`
- **Render 배포**: live (2026-08-12T18:05:42Z)
- **테스트**: 18/18 WP10 + 305/305 전체 통과

### 구현 파일 (서버 전용, OTA 없음)

| 파일 | 내용 |
|---|---|
| `config/ai-pricing.ts` | gpt-4o-mini 실제 가격 ($0.15/1M in, $0.60/1M out), `calculateAiCost()` |
| `lib/ai-trace-service.ts` | `buildTraceMetadata()` export + `saveAiTrace()` + `listAiTraces()` + `getAiTraceByRequestId()` |
| `lib/event-logger.ts` | EventCategory에 `"AI"` 추가 |
| `routes/ai-v1.ts` | `_capturedUsage` 사전 선언, contract 1.0/1.3 성공 후 trace 저장, catch 블록 통합 |
| `routes/super.ts` | `GET /super/ai-traces` + `GET /super/ai-traces/:requestId` (super_admin only) |
| `routes/__tests__/wp10-ai-trace.test.ts` | 18 TC (A~J), `buildTraceMetadata` 직접 테스트 방식 |

### Production runtime 검증 결과 (2026-08-12)

```
/api/health                     → ok ✅
/super/ai-traces (super_admin)  → total:16, rows 정상 ✅
/super/ai-traces (no auth)      → 401 ✅
AI generate (X pool)            → request_id=wp10_verify_1786558168, x_template_status=NOT_CONFIGURED, INPUT_ONLY, 587 tokens ✅
trace read-back                 → total 16(+1), pool_mode=x, model=gpt-4o-mini, total_tokens=587, total_cost_usd=0.00012585, latency_ms=3003 ✅
```

### 설계 원칙

- AI trace → `event_logs` (superAdminDb), `category = "AI"` — migration 없음
- `buildTraceMetadata()` export → DB mock 없이 단위 테스트 가능
- Non-X pool에서 `x_template_status` / `active_template_set_id` 키 자체 absent
- PII 미포함: 이름·원문·prompt·GPT응답 없음, pool_id/actor_id(내부ID)/request_id만
- `saveAiTrace` → `void ....catch(console.error)` (res.json() 이후 비동기, 응답 지연 없음)

**Why:** `buildTraceMetadata`를 별도 export하지 않으면 drizzle sql 태그 내부 구조에 의존하는 불안정한 테스트가 됨.

**WP11 auto-start 금지** — 사용자 명시 승인 후에만 시작.
