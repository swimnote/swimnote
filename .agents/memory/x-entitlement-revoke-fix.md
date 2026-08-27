---
name: X Entitlement Revocation Stale Cache Fix
description: ModeContext AppState 리스너 누락 — X revoke 후 클라이언트 stale mode 지속 원인 및 수정
---

## Root Cause

슈퍼관리자가 PATCH /super/operators/:id/xmode로 revoke 시:
- **서버**: x_manual_entitlement=false → effective=false → requireXMode 즉시 403 ✓
- **클라이언트**: ModeContext에 AppState foreground 리스너 없음 → pool_admin/teacher 앱이 background→foreground 전환 시 /pools/x-mode를 재조회하지 않음 → stale X mode 지속

## 확인된 정상 동작 (버그 아님)

- CASE 6: x_paid_entitlement=true인 수영장에서 manual revoke → X 유지 (paid는 manual revoke 범위 밖, 설계 의도)
- RevenueCat webhook EXPIRATION/REFUND만이 x_paid_entitlement=false 처리

## Fix

`ModeContext.tsx`에 AppState `background/inactive → active` 전환 리스너 추가:
```ts
useEffect(() => {
  let prevState = AppState.currentState;
  const sub = AppState.addEventListener("change", (nextState) => {
    if ((prevState === "background" || prevState === "inactive") && nextState === "active") {
      refreshMode();
    }
    prevState = nextState;
  });
  return () => sub.remove();
}, [refreshMode]);
```

**Why:** refreshMode는 안정적 useCallback (deps=[]); isRefreshingRef 중복 차단 내장; 폴링 없음

## 배포

- SHA: bbbd39ea (ModeContext fix) + 472d5149 (dev script restore)
- iOS OTA: update group 78d65a39 / iOS update 01a0444c / branch production / runtimeVersion 1.6.3
- Render 재배포: 불필요 (클라이언트 전용 변경)
