---
name: GR-M Feed Delivery Done
description: GR-M6/M7/M8 구현 완료 상태 및 핵심 패턴 기록
---

## 구현 상태
SHA 07290b27; branch deploy-photo-clone; Render 미배포

## 변경 파일
- growth-report-scheduler.ts: autoPublish SQL에 `report_fact_package IS NOT NULL AND sns_summary IS NOT NULL` 추가
- parent.ts `/students/:id/feed`: PUBLISHED growth_reports → GROWTH_REPORT feed items (projection, LIMIT 5, sorted by published_at)
- pool-db-init.ts: `uq_notifications_gr_published` partial unique index (non-FATAL)
- notify.ts: INSERT ON CONFLICT DO NOTHING RETURNING id; rows=[] → push skip
- parent-growth-report.ts: questions endpoint에 `report_type` SELECT + monthly → 403 FREE_MONTHLY_QUESTIONS_DISABLED
- growth-report-questions.tsx: 403+FREE_MONTHLY_QUESTIONS_DISABLED → router.back()

## 핵심 패턴
- **GR-M6**: 물리 feed 테이블 없음. growth_reports WHERE product_status='PUBLISHED' projection
- **GR-M8**: ON CONFLICT(type,ref_id,recipient_id) WHERE type='GROWTH_REPORT_PUBLISHED' DO NOTHING RETURNING id. rows=[] = conflict = push skip
- **테스트**: vi.hoisted로 selectChain 노출, setupFeedMocks(opts) 헬퍼로 select/execute 분리 제어

## 테스트
gr2: 42/42, gr7-push: 55/55 (TC13/14/23/24 정적문구 기준 수정), monthly-policy: 22/22, feed-delivery: 23/23

**Why:** SELECT pre-check + INSERT ON CONFLICT 두 겹 방어로 레이스 컨디션 대응
