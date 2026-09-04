---
name: WP7 완료 상태
description: Notification / Push Delivery Diagnostics — Control Center 완료 상태 기록
---

SHA d790b420; branch release/v2.0.0

## 변경 파일 (3개)
- super.ts: WP7 additive migration(push_logs.notification_id + ref_id + 4 indexes)
  + /notifications 완전 재작성(LATERAL JOIN, 필터, summary KPI)
  + /notifications/summary 신규
  + /notifications/:notifId 신규 (cross-pool guard)
  + normalizePushState() / safePushError() / notifTypeLabel() helpers
- SuperPoolControlCenter.tsx: NotificationsTab 재작성
  + KPI 카드, 필터, 타임라인, type-click filter, NotificationDetailDrawer(5섹션)
- cc-preflight.ts: WP7-01..41 (41 assertions)

## Gate: 602 PASSED / 0 FAILED / 3 SKIPPED

## 핵심 발견 및 결정
- notifications 테이블: id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read, created_at, deep_link
- push_logs: notification_id FK 없음 → heuristic: target_user_id + pool_id + ±60s LATERAL JOIN
- push_logs.status: 'sent'|'skipped'|'failed' → 정규화: ACCEPTED_BY_PROVIDER/FAILED/SKIPPED/NOT_ATTEMPTED
- push_tokens.platform 컬럼 없음 → token_platform = 'UNKNOWN' 정직하게 보고
- Push retry: NOT IMPLEMENTED → 정확히 표시
- Raw push token: NEVER in response (has_push_token bool만)
- 'DELIVERED' 금지 — provider accepted ≠ device received
- requireRole("super_admin") returns 401 for insufficient role (not 403) — cc-preflight 401||403 허용

## Render/OTA
- Render: 미배포
- OTA: 없음 (앱 수정 없음)
