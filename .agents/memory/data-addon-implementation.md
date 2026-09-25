---
name: DATA add-on 구현 완료 상태
description: DATA100/DATA300 추가 저장공간 구독 Production 전체 구현 기록 및 주요 설계 결정
---

## 구현 완료 항목
- SHA 6d3e0909; Render dep-darc5265kias73b21q30 진행 중; iOS OTA 01a0d9ea production-v2

## 핵심 설계 원칙
**extra_storage_gb는 += 누적 금지 — 항상 canonical SET**
- INITIAL_PURCHASE: extra_storage_gb = canonicalGb (SET), data_addon_status='active'
- RENEWAL: extra_storage_gb = canonicalGb (SET 갱신), expires_at 갱신
- CANCELLATION: status='cancelled', storage 유지 (purge 금지)
- EXPIRATION: extra_storage_gb=0, upload_blocked=true, purge job 즉시 생성
- BILLING_ISSUE: status='billing_issue', storage 유지
- UNCANCELLATION: extra_storage_gb 복원 (canonical SET)

**Why:** 사용자 데이터 보호 최우선. CANCELLATION≠EXPIRATION. Store는 취소 후에도 기간까지 서비스 보장.

## DB 변경 (Production 적용 완료)
- swimming_pools: data_addon_tier, data_addon_status, data_addon_started_at, data_addon_expires_at
- pool_data_purge_jobs 테이블 + 3 indexes (status/pool_active/rc_event)

## 서버 신규 엔드포인트
- POST /billing/sync-data-addon — RC 구매 직후 webhook 지연 보완 즉시 동기화
- POST /billing/restore-data-addon — restore flow
- GET /billing/status: data_addon_* 4개 필드 추가

## purge worker (data-purge-worker.ts)
- 3 source: photo_assets_meta(is_clone=false)/student_photos/video_assets_meta(status=active)
- 전역 created_at ASC 순서 oldest-first
- R2 sibling 체크 (photo_assets_meta): 마지막 reference만 R2 삭제
- video: soft-delete (status='deleted'), photo/student_photo: hard DELETE
- 5분 간격, acquireLock 기반 distributed lock
- EXPIRATION trigger_rc_event_id dedup (중복 job 방지)

## APP UI
- subscriptionPlans.ts: DataPackDef에 rc_product_id 추가
- subscription.tsx: dataAddonTier/Status/ExpiresAt state + loadData 통합
- handleDataPurchase(): RC package → purchase → sync-data-addon 동기화
- DATA 카드: RC package 탐색 (모든 offerings에서 product ID로). 패키지 없으면 "준비 중".
- billing.tsx: DATA add-on 상태 섹션 (구독 중/취소/만료일 표시)

## RC Package 탐색 방식 (중요)
- data_monthly RC offering이 별도 존재 여부 미확인 → 모든 offerings(solo/center/x/swimnote)에서 product ID로 탐색
- 패키지 발견되어야만 "구독 시작" CTA 활성화 — 없으면 "준비 중" 유지 (HOLD 원칙 준수)
- com.swimnote.data100.monthly / com.swimnote.data300.monthly

**How to apply:** RC Console에서 data_monthly offering 등록 완료 후 CTA 자동 활성화됨.
