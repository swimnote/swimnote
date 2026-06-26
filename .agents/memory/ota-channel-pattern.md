---
name: OTA 채널 패턴
description: TestFlight/앱스토어 바이너리의 EAS 채널 구분 및 올바른 배포 방법
---

# OTA 채널 패턴

## 규칙
항상 `production` AND `preview` 두 브랜치 모두에 OTA 배포해야 함.

## 왜
- `production` EAS 빌드 프로파일 → "production" 채널 → 앱스토어/TestFlight(production 프로파일로 빌드된 경우)
- `preview` EAS 빌드 프로파일 → "preview" 채널 (TestFlight internal distribution용)
- eas.json에 `"channel": "production"`을 preview 프로파일에 명시하지 않으면 채널 분리됨
- 2026-06-26에 발견: TestFlight 바이너리가 "preview" 채널이어서 "production" 배포만으론 OTA 전달 안 됨

## How to apply
- OTA 배포 시: `--branch production` 과 `--branch preview` 순차 배포
- 단, 두 개 동시(& background) 실행 시 Metro OOM으로 타임아웃 → 반드시 순차 실행
- eas.json preview 프로파일에 `"channel": "production"` 추가됨 (향후 빌드부터는 통일됨)

## 배포 명령 패턴
```bash
# production 먼저
timeout 115 sh -c 'EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 eas update --branch production --platform ios --message "..." --non-interactive 2>&1'
# 그 다음 preview
timeout 115 sh -c 'EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 eas update --branch preview --platform ios --message "..." --non-interactive 2>&1'
```
