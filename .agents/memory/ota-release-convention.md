---
name: OTA 배포 릴리즈 컨벤션
description: 클라이언트 OTA 배포 기본 규칙 — iOS우선, Android는 누적 배포
---

## 규칙 (2026-08-17 확정)

**기본 배포 범위:** iOS production + iOS preview만 배포

**Android OTA:** Android 최종 검증 단계에서 누적 변경사항 한 번에 반영
- 별도 지시가 있는 WP만 Android 동시 배포

**이유:** iOS TestFlight 검증 우선; Android는 주기적 누적 배포로 빌드 분 절약

## 적용 방법

```
# 기본 OTA 흐름
1. expo export --platform ios → /tmp/ios-{wp}
2. eas update production (iOS)
3. eas update preview (iOS)
# Android는 별도 지시 시에만
```
