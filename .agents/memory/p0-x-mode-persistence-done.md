---
name: P0 X Mode Persistence Root Cause Fix 완료
description: ModeContext.tsx 3개 버그 수정 — transient failure 시 Normal fallback 방지; auth loading 중 result 보존
---

# P0 X Mode Persistence Fix 완료

**SHA**: 5da756c8  
**브랜치**: deploy-photo-clone  
**변경 파일**: 1개 (context/ModeContext.tsx)

---

## A. Root Cause 3개 (모두 ModeContext.tsx)

| Bug | 위치 | 현상 | Fix |
|---|---|---|---|
| A | line 152 | refreshMode() 시작 시 `result: null` 즉시 리셋 | `setState(prev => ({ ...prev, status: "loading" }))` |
| B | line 207-210 | `isLoading=true` 시 `setState(IDLE_STATE)` | `isLoading=true`면 return only (result 보존) |
| C | lines 163-191 | network/timeout/5xx 에러 시 `result: null` | `prev.result` 보존 (UNKNOWN != NORMAL) |

## B. 에러 처리 분류 (Fix C 세부)

| HTTP status | 처리 | 이유 |
|---|---|---|
| 401 | result = null | auth invalid 확정 (서버 결정) |
| 403 | result = null | forbidden 확정 (서버 결정) |
| 404 | result = null | pool_not_found 확정 (서버 결정) |
| 5xx | prev.result 보존 | transient server error (spec §6 D) |
| network/timeout | prev.result 보존 | transient failure (spec §6 D) |
| parse_error | prev.result 보존 | transient (간헐적 JSON 파싱 실패) |

## C. IDLE_STATE 리셋 조건 (security)

IDLE_STATE 리셋 = `token=null OR poolId=null OR !supported`만:
- logout, pool 변경, 미지원 역할
- 다른 account/pool의 X cache 누출 방지

**`isLoading=true`는 IDLE_STATE 리셋 안 함** → return only (isLoading=false 시 재실행)

## D. 로그 (dev-only)

```
[XMODE] BOOT_START / AUTH_LOADING_WAIT / IDLE_RESET
[XMODE] SERVER_FETCH_START / SERVER_CONFIRMED / SERVER_TRANSIENT_ERROR
```

## E. 서버 미변경

- client-only fix
- SERVER_CHANGED = NO, DB_CHANGED = NO
- Render 재배포 불필요

## F. 실기기 검증 필요 항목

DEVICE-X04 ~ X17: 코드 수정 완료, 실기기 TestFlight 검증 사용자에게 위임

OTA:
- PRODUCTION: 01a00bf0-49a6-7d82-af6b-6b1b4151c892
- PREVIEW: 01a00bf0-828d-7be1-96d3-c945cb7ed55f
