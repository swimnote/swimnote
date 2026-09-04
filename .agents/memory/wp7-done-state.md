---
name: WP7 완료 상태
description: Notification / Push Delivery Diagnostics — Control Center 완료 + iOS OTA 검증 배포 상태
---

SHA d790b420 (product code); ade972fe (memory-only commit on top)
Branch: release/v2.0.0

## 변경 파일 (3개)
- super.ts: WP7 additive migration(push_logs.notification_id + ref_id + 4 indexes)
  + /notifications 완전 재작성(LATERAL JOIN, 필터, summary KPI)
  + /notifications/summary 신규
  + /notifications/:notifId 신규 (cross-pool guard)
  + normalizePushState() / safePushError() / notifTypeLabel() helpers
- SuperPoolControlCenter.tsx: NotificationsTab 재작성
- cc-preflight.ts: WP7-01..41 (41 assertions)

## Gate: 602 PASSED / 0 FAILED / 3 SKIPPED (재확인도 동일)

## iOS OTA 검증 배포
- Runtime: 2.1.0
- Channel/Branch: production-v2
- Group ID: 8b52a35b-c22c-4c21-9b94-7316f627a443
- iOS Update ID: 01a06c34-b5a3-7433-95f1-455ca1bd410f
- Message: "SWIMNOTE 2.1.0 - Control Center verified - d790b420"
- EAS source commit: ade972fe* (memory-only; product code = d790b420)
- Android: NOT PUBLISHED
- EAS 서버 원격 확인: ✅ (production-v2 최신 update로 조회됨)
- Export: iOS 15MB bundle + 32 assets + metadata.json PASS

## 핵심 검증 결과
- DELIVERED 단어: super.ts/Web 모두 0건 ✅
- NOT_IMPLEMENTED (push retry): ✅
- UNKNOWN (token platform): ✅
- ACCEPTED_BY_PROVIDER: ✅
- TS 에러 21개 = d790b420 기준 pre-existing (앱 수정 없음 확인됨)
- Production API URL: swimnote-api.onrender.com (localhost/dev URL 번들 내 없음) ✅

## Render/OTA
- Render: 미배포
- iOS OTA: 01a06c34 (production-v2)
- Android OTA: 없음
