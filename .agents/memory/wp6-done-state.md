---
name: WP6 완료 상태
description: Error/Incident/Observability — Control Center 완료 상태 기록
---

SHA fa425272; branch release/v2.0.0

## 변경 파일 (7개)
- event-logger.ts: logOperationalError() + OpErrorLevel/Feature/Params + sanitizeMetadata(BLOCKED_KEYS)
- super.ts: WP6 additive migration(8 event_logs cols + push_logs 3 cols + 4 indexes) + errors route 재작성 + parseTimeRange
- push-service.ts: PUSH_EXPO_API_FAILED logOperationalError + push_logs pool_id/error_message/recipient_count
- objectStorage.ts: R2_PUT_FAILED logOperationalError (poolId available 시)
- billing.ts: RC_WEBHOOK_PROCESSING_FAILED logOperationalError
- SuperPoolControlCenter.tsx: ErrorsTab 재작성(KPI/range filter/timeline/ErrorDetailDrawer)
- cc-preflight.ts: WP6-01..100 + pool recreation fix

## Gate: 561 PASSED / 0 FAILED / 3 SKIPPED

## 핵심 설계 결정
- event_logs additive: feature/level/error_code/safe_message/request_id/trace_id/entity_type/entity_id (dev-only)
- push_logs additive: pool_id/error_message/recipient_count
- errors route: event_logs + push_logs(failed) + growth_batch(FAILED) + super_incidents(affected_pool_ids)
- legacy 버그 수정: FROM incidents → FROM super_incidents
- logOperationalError는 자체 실패를 조용히 흡수 (cascade 방지)

## Render/OTA 상태
- Render: 미배포 (Production DB: NO per spec)
- OTA: 없음 (앱 수정 없음)
