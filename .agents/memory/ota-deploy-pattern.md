---
name: OTA 배포 패턴
description: Replit 환경에서 EAS OTA(eas update) 배포 시 메모리/타임아웃 제약과 우회 방법
---

## 규칙

Replit 환경(가용 RAM ~4-8GB)에서 `eas update`는 bash tool 120초 제한 때문에 직접 완료가 어려움.
Metro 번들러가 iOS는 ~110s, Android는 ~150s+ 소요.

**Why:** bash tool 최대 timeout 120,000ms. Android 번들이 iOS보다 크고 느림.

## 성공한 우회 방법 (iOS)

1. Expo 워크플로우를 재시작해서 Metro 캐시 warm-up (256+ dirs 확인)
2. Metro PID 찾기: `pgrep -af "node" | grep "expo\|metro\|pnpm.*swim"`
3. Metro kill: `kill -9 <PID>`
4. 즉시 expo export 실행 (119s timeout):
   ```bash
   EXPO_NO_TELEMETRY=1 node_modules/.bin/expo export --platform ios --output-dir dist
   ```
5. exit code -1로 타임아웃돼도 dist/가 생성됨 (iOS는 ~110s에 완료)
6. metadata.json 확인: `cat dist/metadata.json | python3 -c "import json,sys; ..."`
7. **skip-bundler 업로드** (60s 이내 완료):
   ```bash
   EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 \
   EXPO_TOKEN=$(printenv EXPO_TOKEN) \
   node_modules/.bin/eas update --skip-bundler --input-dir dist \
     --branch production --platform ios --message "메시지" --non-interactive
   ```

## 성공한 우회 방법 (Android) — 워크플로우 활용

Android는 ~150s+ 소요로 bash tool 120s 제한 초과. **Expo 워크플로우 자체를 export runner로 활용**.

1. `package.json` dev 스크립트 임시 교체:
   ```
   "dev": "EXPO_NO_TELEMETRY=1 node_modules/.bin/expo export --platform android --output-dir /tmp/android-dist && [기존 expo start 명령]"
   ```
2. `restart_workflow` 실행 (30s timeout — export가 완료되기 전 반환되지만 워크플로우는 계속 실행)
3. 3분 대기 후 `/tmp/android-dist/metadata.json` 확인:
   ```bash
   sleep 180 && cat /tmp/android-dist/metadata.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('platform:', list(d.get('fileMetadata',{}).keys()))"
   ```
4. **skip-bundler 업로드** (input-dir = /tmp/android-dist):
   ```bash
   EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 \
   EXPO_TOKEN=$(printenv EXPO_TOKEN) \
   node_modules/.bin/eas update --skip-bundler --input-dir /tmp/android-dist \
     --branch production --platform android --message "메시지" --non-interactive
   ```
5. dev 스크립트 원래대로 복원 후 `restart_workflow`

**Why:** 워크플로우는 Replit이 관리하는 장기 실행 프로세스로, bash tool의 120s 제한을 받지 않음.

## --clear 플래그 제거 필수

package.json dev 스크립트에서 `expo start --clear` → `expo start` 로 변경해야 Metro 캐시가 재시작 후에도 유지됨. `--clear`가 있으면 매번 캐시 초기화되어 iOS export도 실패함.

## OTA 앱 적용 방법

- `runtimeVersion: { policy: "appVersion" }` → 앱 버전 일치 시 업데이트 수신
- 앱 **두 번** 재시작 필요: 1번째 열기 → 다운로드, 2번째 열기 → 적용
- EAS_NO_VCS=1 사용 시 git 추적 스킵 (Replit sandbox에서 git commit 불가)
- EAS_SKIP_AUTO_FINGERPRINT=1: appVersion policy에서는 안전하게 스킵 가능

## runtimeVersion = app.json version 필드

`runtimeVersion: {policy: appVersion}` → app.json의 `version` 필드값과 동일.
OTA 배포 시 app.json version이 **설치된 바이너리 버전**과 반드시 일치해야 함.

## preview 브랜치 불필요

eas.json preview 프로필에 `channel: "production"` → 모든 빌드가 production 채널/브랜치 사용.
production 브랜치만 배포하면 됨.
