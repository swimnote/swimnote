---
name: P0-OBSERVABILITY 완료 상태
description: P0 Support Respond production trace 계측 배포 완료 상태
---

# P0-OBSERVABILITY 완료 상태

## 핵심 결과

- **SHA**: 4124c1c94eaf
- **Render deploy**: dep-da1islu7bikc7397ddug, status=live
- **iOS OTA**: NO
- **Android OTA**: NO
- **Schema 변경**: NO
- **Support data 변경**: NO
- **Mobile 변경**: NO

## 구현 내용

### lib/support-trace.ts (신규)
- `createSupportTrace()` — trace context 생성 (request_id, case_id, pool_id, user_role, service_mode)
- `addStage(ctx, stage, extra)` — stage 기록 (PII 금지)
- `flushSupportTrace(ctx, params)` — event_logs에 단일 JSONB 레코드 기록 (best-effort)
- `flushInsertFailStage(ctx, err, which)` — AI INSERT 실패 시 즉시 pg error code 캡처
- `classifyPgError(err)` — pg code → NOT_NULL/FK/ENUM/MISSING_TABLE/OTHER
- `MessageContract` interface — content 값 미포함 구조 트레이스

### support-respond.ts (계측)
- 17개 stage marker: REQUEST_RECEIVED → HTTP_RESPONSE
- AI INSERT 실패 시 pg_code/constraint/column/table 즉시 capture
- HTTP_RESPONSE stage = actual http_status source of truth
- Storage: event_logs (신규 테이블 없음)
- 모든 early-return 경로에 HTTP_RESPONSE stage + flushSupportTrace 추가

### 테스트
- 33TC (OBS-01~12)
- 1750TC 전체 통과

## 재현 후 조회 방법

사용자가 재현하면:
1. event_logs에서 최신 SUPPORT_RESPOND_TRACE 조회
2. stages 배열에서 AI_MESSAGE_INSERT_FAIL 확인 → pg_code 확인
3. HTTP_RESPONSE stage의 http_status 확인
4. support_ticket_replies에서 AI role rows 확인

## 현재 defect 상태

```
CURRENT_DEFECT = OPEN
DEVICE_RESULT  = NOT_OBSERVED
```

사용자가 실제 iPhone에서 재현 후 event_logs 조회해야 root cause 확정 가능.

## REPORTING_CONSTITUTION 준수 여부

- OBSERVED: git push ✓, Render live 4124c1c94eaf ✓, 1750TC ✓
- NOT_OBSERVED: device result (사용자 미재현)
- INFERRED_200 사용 금지 → HTTP_RESPONSE stage가 실제 status source of truth
