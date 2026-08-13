---
name: WP15.5-C 완료 상태
description: Ad Creative 관리 + PARENT_HOME_BANNER 슬롯 구현 현황
---

# WP15.5-C — Ad Creative Management + Parent Ad Slot 완료

**SHA:** `0f8899a4`  
**완료일:** 2026-08-13

## 변경 파일

| 파일 | 내용 |
|---|---|
| `artifacts/api-server/src/routes/super.ts` | ad_creatives 테이블 + CRUD API (GET/POST/POST :id/update) |
| `artifacts/api-server/src/routes/parent.ts` | GET /parent/ad-slot + logEvent import |
| `artifacts/api-server/src/routes/__tests__/wp15-5c-ad.test.ts` | 10 TC (DB mock 방식) |
| `artifacts/swimnote-web/src/pages/super/AdCreativeManager.tsx` | 신규 — Creative CRUD UI |
| `artifacts/swimnote-web/src/pages/SuperAdmin.tsx` | "광고 Creative" 탭 추가 |
| `artifacts/swim-app/app/(parent)/home.tsx` | ParentAdBanner 삽입 |
| `artifacts/swim-app/components/parent/ParentAdBanner.tsx` | 신규 — PARENT_HOME_BANNER 슬롯 컴포넌트 |

## 핵심 구현

**ad_creatives 테이블:**
- ensureExtraTables()에 포함 (CREATE TABLE IF NOT EXISTS)
- placement/creative_type/headline/body_text/image_url/destination_url
- effect_type/display_order/is_active/target_age_band/target_region
- idx_ad_creatives_placement_active 인덱스

**API:**
- `GET /super/ad-creatives?placement=` — super_admin, 슬롯별 목록
- `POST /super/ad-creatives` — super_admin, Creative 생성
- `POST /super/ad-creatives/:id/update` — super_admin, COALESCE 방식 동적 UPDATE
- `GET /parent/ad-slot?placement=PARENT_HOME_BANNER` — parent_account
  - 활성 Creative 1개 반환 (display_order ASC LIMIT 1)
  - AD_IMPRESSION logEvent (fire-and-forget)

**앱 ParentAdBanner:**
- Creative 없으면 null (화면 공간 차지 없음)
- image_url + headline + body_text 조합 렌더링
- AD 라벨 overlay

## 테스트

- 10 TC (A-J), DB mock 방식
- 전체 391/391 통과

## 배포

- Render deploy: GitHub push → 자동 배포 (0f8899a4)
- OTA production: 3316f6f1-4018-4e9b-ad10-73199ce36ee7 (iOS + Android)
- OTA preview: eas.json preview.channel=production → production OTA와 동일

## 주의사항

- sql.raw(query, vals) drizzle에서 미지원 → COALESCE 방식으로 동적 UPDATE 처리
- preview OTA RAM 부족 SIGKILL → eas.json preview.channel=production으로 production OTA 공유 확인
