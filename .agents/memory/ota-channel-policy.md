---
name: OTA 채널 정책 (영구)
description: SWIMNOTE iOS OTA 배포 채널 영구 정책 — 반드시 준수
---

# ★ PERMANENT OTA CHANNEL POLICY (2026-08-17 확정)

## 핵심 규칙

**iOS OTA는 항상 `--branch production` 에만 발행한다.**

`--branch preview` 는 사용자가 명시적으로 "preview에 올려", "preview build에서 테스트" 라고 지시할 때만 사용.

## 근거

TestFlight 현재 검증 빌드 (Build 246):
- Profile: production
- Channel: production
- Runtime: 1.6.3

→ production channel OTA만 수신함. preview channel OTA는 수신 불가.

## OTA 발행 전 체크리스트 (항상)

```
CURRENT_TESTFLIGHT_BUILD = 246
CURRENT_CHANNEL          = production
CURRENT_RUNTIME          = 1.6.3
TARGET_BRANCH            = production
```

channel == TARGET_BRANCH mapping 확인 후 발행.

## 명령 패턴

```bash
# iOS production OTA (기본값)
EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 \
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
node_modules/.bin/eas update --skip-bundler --input-dir /tmp/ios-new \
  --branch production --platform ios --environment production \
  --message "..." --non-interactive
```

## Android 정책

각 WP마다 발행하지 않음. 최종 Android 검증 단계에서 누적 반영. 사용자 별도 요청 시만 예외.

## 잘못된 배포 사례 (2026-08-17)

WP-CS-02R에서 "Preview OTA 우선" 스펙 문구를 "preview branch" 로 오해하여 --branch preview 발행. TestFlight Build 246이 production channel 수신이므로 OTA 미전달. 동일 번들을 --branch production 으로 재발행하여 수정.

**Why:** TestFlight = preview channel 이 아님. 빌드 프로파일의 channel 필드를 확인할 것.
**How to apply:** OTA 발행 전 `eas build:list --platform ios --limit 1`로 현재 빌드의 Channel 필드 확인.
