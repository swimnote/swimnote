---
name: OTA 배포 패턴
description: Replit 환경에서 EAS OTA(eas update) 배포 시 메모리/타임아웃 제약과 우회 방법
---

## 규칙

Replit 환경(가용 RAM ~1.4GB)에서 `eas update`는 Metro 번들러가 ~1.5-2GB RAM을 요구해 OOM 킬 발생.

**Why:** swim-app expo 워크플로우가 Metro dev 서버로 RAM을 점유한 상태에서 production Metro 두 번째 인스턴스를 띄우면 OOM.

## 성공한 우회 방법 (2-단계)

1. swim-app Metro 프로세스 kill 후 `eas update --non-interactive` 실행 (115s 타임아웃 — dist/ 폴더 생성됨)
2. **즉시** `eas update --skip-bundler --input-dir dist --non-interactive EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1` 실행

**핵심:** 1단계가 ~99% 번들링 완료 시점에 타임아웃되면 dist/metadata.json이 남아있음. 2단계는 업로드만 해서 30-60s 내 완료.

**조건:** 1단계 성공에는 Metro 캐시(`/tmp/metro-cache/`)가 충분히 warm해야 함 (256+ dirs). 캐시 cold 상태면 115s 내 99% 도달 불가.

## OTA 앱 적용 방법

- `runtimeVersion: { policy: "appVersion" }` → 앱 버전 일치 시 업데이트 수신
- 앱 **두 번** 재시작 필요: 1번째 열기 → 다운로드, 2번째 열기 → 적용
- EAS_NO_VCS=1 사용 시 git 추적 스킵 (Replit sandbox에서 git commit 불가)
- EAS_SKIP_AUTO_FINGERPRINT=1: appVersion policy에서는 안전하게 스킵 가능

## EAS_SKIP_AUTO_FINGERPRINT=1 필수

fingerprint 계산 단계에서 타임아웃 발생 → `EAS_SKIP_AUTO_FINGERPRINT=1` 환경변수 추가 필수.

정확한 OTA 배포 명령어:
```bash
cd artifacts/swim-app && \
EAS_SKIP_AUTO_FINGERPRINT=1 \
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
node_modules/.bin/eas update \
  --branch production \
  --message "메시지" \
  --non-interactive
```

## runtimeVersion = app.json version 필드

`runtimeVersion: {policy: appVersion}` → app.json의 `version` 필드값과 동일.
OTA 배포 시 app.json version이 **설치된 바이너리 버전**과 반드시 일치해야 함.
- 현재 설치 바이너리: 1.5.1 → app.json version = "1.5.1" 유지
- 새 바이너리 빌드 시에만 version 올릴 것

## preview 브랜치 불필요

eas.json preview 프로필에 `channel: "production"` → 모든 빌드가 production 채널/브랜치 사용.
production 브랜치만 배포하면 됨.
