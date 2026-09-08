---
name: P0 MASTER Super Admin Web Console 완료
description: Super Admin 웹 콘솔 전면 구성 + 가격 정리 + 공지 이미지 + Parent 배너 Carousel 완료 상태
---

## 완료 SHA
- GitHub main: 9450f655
- Render LIVE: 9450f655 (confirmed)
- iOS OTA: 01a08217 (production-v2, runtimeVersion=2.1.0)

## 완료 항목
1. officialPlanCatalog.ts + xPlanCatalog.ts: X300=₩129k, X500=₩199k, X1000=₩359k
2. platform-banners.ts: target_pool_id 컬럼 지원 + CREATE/UPDATE/DELETE audit_log 추가
3. super-db-init.ts: platform_banners.target_pool_id migration
4. parent.ts /ad-slot: platform_banners(slider) 기반 creatives[] 배열 반환 (creative 단일도 유지)
5. super.ts /marketing/notices POST: image_urls 지원 추가
6. ParentAdBanner.tsx: FlatList carousel + 5초 자동슬라이드 + page indicator dot
7. subscription-products.tsx: SWIMNOTE/X300/X500/X1000/DATA100/DATA300 공식 가격표
8. storage.tsx: 추정가(₩9,900/월~) → DATA100(₩7,900)/DATA300(₩22,900) 표시
9. SuperNotices.tsx: 신규 — 공지 CRUD (이미지 5장 업로드 포함, /uploads 파이프라인)
10. SuperAds.tsx: 신규 — platform_banners 기반 배너 CRUD (이미지 업로드, target_pool_id)
11. SuperLayout.tsx NAV: "공지 관리" + "광고 관리" 항목 추가
12. App.tsx: /super/notices + /super/ads 라우트 추가

## 남은 작업 (보고 기준 미수행)
- SuperPools.tsx TABLE 구조 개선 (X/BASE/subscription/curriculum 컬럼) — 차후 WP
- SuperOverview.tsx KPI 확장 — 차후 WP
