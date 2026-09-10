---
name: P0 X Trial Mode Switch Fix
description: X 무료체험 버튼 클릭 후 mode가 x_trial로 전환되지 않던 버그 수정 상태
---

## Root Cause
DB 기록은 정상 (x_trial_used_at 세팅됨). client refreshMode()가 isRefreshingRef lock으로
in-flight 요청 있을 때 silently no-op 반환 → mode 업데이트 없이 normal 유지.

## Fix
- ModeContext.tsx: forceRefreshMode() 추가 — seqRef++, isRefreshingRef=false, refreshMode() 호출
- subscription.tsx doActivateTrial: refreshMode → forceRefreshMode 교체
- billing.ts x-trial-activate: payment_suspended pool 차단 (TRIAL_NOT_AVAILABLE_PAYMENT_SUSPENDED 403)

## Deployment
- main HEAD: 2532e05b
- iOS OTA: 01a088e7-01fc-79eb-acad-bc61d76c2e08 (production-v2)
- Android OTA: 01a088e7-01fc-70eb-a654-fc865288110e (production-v2)
- Render: deploy dep-dah0ca1t0dsc73e2m6kg (2532e05b)

## Production DB Verification (before fix)
- pool_1788627129857_4hqcextum ("스윔노트테스트"):
  - x_trial_used_at: 2026-09-10T00:58:07Z
  - x_trial_ends_at: 2026-09-13T00:58:07Z (72h, active)
  - computed_mode: x_trial ← server 정상, client만 문제

## Tests
- 11 TC pass (computeMode x_trial 분기 우선순위 + lazy expiration)
- src/routes/__tests__/p0-x-trial-fix.test.ts
