---
name: OTA 채널 정책 (영구)
description: iOS OTA 배포 시 반드시 사용할 브랜치/채널 — 잘못된 브랜치로 업로드하면 앱이 업데이트를 수신하지 못함
---

## 핵심 규칙

**iOS OTA = 항상 `--branch production-v2`**

절대 `--branch release-2.0.0` 또는 `--branch production` 사용 금지.

**Why:** EAS 채널 매핑이 `production-v2 channel → production-v2 branch`로 고정되어 있음.
`release-2.0.0` 브랜치에 올리면 앱이 업데이트를 전혀 수신하지 못함 (2026-09-08 실기기 검증 확인).

**How to apply:**
```bash
eas update --skip-bundler --input-dir /tmp/ios-ota-<sha> \
  --branch production-v2 --platform ios \
  --environment production \
  --message "..." --non-interactive
```

## Android

Android OTA = 별도 명시 지시 시에만, 금지가 기본.

## preview branch

사용 금지 (명시 지시 시만 예외). TestFlight ≠ preview channel.

## runtimeVersion

현재 앱 `runtimeVersion: 2.1.0` (app.json). 번들 업로드 시 동일하게 나와야 정상.
guard script의 REQUIRED_RUNTIME="2.0.0"은 **구버전으로 무시**.

## OTA 모달 동작

- `DEV_OTA_RESTART_MODAL = version.startsWith("2.")` → 현재 true
- 업데이트 수신 시 자동으로 재시작 모달 표시
- 앱 완전 종료 후 재실행해야 체크 트리거됨
