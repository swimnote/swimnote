---
name: WP14 Cleanup 완료
description: WP14 Legacy/UI Cleanup 완료 상태 — SHA, candidate 목록, 핵심 결정사항
---

## 완료 상태

- **SHA:** `c03446bd` (pushed to `origin/release/v2.0.0`)
- **이전 SHA:** `96295ec3` (WP13)
- **테스트:** 67/67 PASS

## REMOVE (1건)

- `(super)/_layout.tsx` Stack.Screen `infra-usage` 제거
  - 증거: infra-usage.tsx 파일 없음, router.push 참조 0
  - 호환성 영향: NONE

## DEFER (수정 안 함)

- Apple demo accounts (auth.ts lines 489-505, 1061-1090, 1793-1797) — "Apple 심사용" 레이블, App Store 리뷰 의존성. 제거 전 Apple 리뷰 정책 협의 필요
- `classes.ts` — routes/index.ts 미등록이지만 §11 보수적 정책 유지
- `growth-report-analyze.ts` — 미등록이지만 support-coverage 참조 있음, §11 유지
- `(parent)/shopping.tsx` — "쇼핑 준비중" placeholder, deep link 정책 TBD

## KEEP

- platform_banners 테이블/쓰기 API/역사 데이터
- Apple demo credentials (DEFER)
- devCode UI (SMS_PROVIDER=dev 시에만 표시, 운영에서 미노출)
- 전체 workers, growth pipeline, billing, RevenueCat handlers
- AUTH_TRACE console.logs (민감정보 없음, 운영용)
- 모든 security helpers (requireAuth, requireRole)

## Render/OTA 상태

- Render: NO (서버 코드 변경 없음)
- iOS OTA: YES (layout 변경 — 다음 OTA 배포 시 포함)
- Android OTA: NO
