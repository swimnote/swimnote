---
name: _layout.tsx otaReady 미선언 크래시
description: RootNav에서 otaReady 변수 선언 없이 JSX에 참조 → ReferenceError → 앱 전체 크래시
---

## 규칙

`_layout.tsx`의 `RootNav` 함수 안에서 `OtaUpdateBanner` 컴포넌트에 `ready={otaReady}` prop을 전달할 때, `otaReady` 변수(state 또는 const)가 반드시 선언되어 있어야 한다.

**Why:** `otaReadyRef`(useRef)는 존재하지만 `otaReady` 변수 자체가 없으면 ReferenceError가 발생하고, Expo 에러 바운더리가 "Something went wrong" 전체 화면으로 앱을 크래시시킨다. OTA 배포 직후 이 화면이 뜨면 이 버그를 먼저 의심할 것.

**How to apply:**
- `OtaUpdateBanner`가 실제로 ready prop을 사용하지 않는다면 prop 자체를 제거(`<OtaUpdateBanner />`)하는 것이 가장 안전.
- ready prop이 필요하다면 `const otaReady = otaReadyRef.current;`를 렌더 직전에 선언.
- OTA 관련 _layout.tsx 수정 시 반드시 `otaReady` 참조 여부 확인 후 배포.
