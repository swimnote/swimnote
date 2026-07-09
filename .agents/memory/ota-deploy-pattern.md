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

## Android OTA 제약

Android 번들은 ~150s+ 소요로 119s 내 완료 불가. Background nohup/setsid 방식도 Replit sandbox에서 불안정 (parent shell 종료 시 cgroup kill).

**Android 대안**: 사용자에게 로그아웃 후 재로그인 안내 (teacher 토큰 문제 즉시 해결).

## OTA 앱 적용 방법

- `runtimeVersion: { policy: "appVersion" }` → 앱 버전 일치 시 업데이트 수신
- 앱 **두 번** 재시작 필요: 1번째 열기 → 다운로드, 2번째 열기 → 적용
- EAS_NO_VCS=1 사용 시 git 추적 스킵 (Replit sandbox에서 git commit 불가)
- EAS_SKIP_AUTO_FINGERPRINT=1: appVersion policy에서는 안전하게 스킵 가능

## runtimeVersion = app.json version 필드

`runtimeVersion: {policy: appVersion}` → app.json의 `version` 필드값과 동일.
OTA 배포 시 app.json version이 **설치된 바이너리 버전**과 반드시 일치해야 함.
- 현재 설치 바이너리: 1.5.1 → app.json version = "1.5.1" 유지
- 새 바이너리 빌드 시에만 version 올릴 것

## preview 브랜치 불필요

eas.json preview 프로필에 `channel: "production"` → 모든 빌드가 production 채널/브랜치 사용.
production 브랜치만 배포하면 됨.

## 프로덕션 서버 버전 (참고)

v2.1-2026-04-04 (2026년 4월 4일 마지막 배포). /auth/switch-role 엔드포인트 존재 확인.
