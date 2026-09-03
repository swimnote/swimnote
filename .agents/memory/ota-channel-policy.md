---
name: OTA 채널 정책 (영구)
description: SWIMNOTE iOS OTA 배포 채널 영구 정책 — 반드시 준수
---

# ★ PERMANENT OTA CHANNEL POLICY

## 핵심 규칙

**빌드 프로파일의 `channel` 필드를 반드시 먼저 확인한다.**

OTA 배포 전 eas.json을 확인하여 현재 활성 빌드 프로파일의 `channel` 값을 `--branch`에 그대로 사용한다.

## 현재 활성 빌드

- **Runtime 2.1.0** (AppStore 현재): build profile `production-v2`, channel = **`production-v2`**
  → OTA 발행: `--branch production-v2`

- **Runtime 1.6.3** (구버전 TestFlight 246): build profile `production`, channel = `production`
  → 현재 사용 안 함

## OTA 발행 전 체크리스트

1. `eas.json` 열어서 활성 build profile의 `channel` 필드 확인
2. `--branch <channel값>` 으로 발행
3. 출력의 `Branch` 라인이 `channel` 값과 일치하는지 확인

## 명령 패턴 (runtime 2.1.0 기준)

```bash
node_modules/.bin/eas update --skip-bundler \
  --input-dir /tmp/ios-ota-export \
  --platform ios \
  --branch production-v2 \
  --message "..." \
  --non-interactive \
  --environment production
```

## Android 정책

각 WP마다 발행하지 않음. 최종 Android 검증 단계에서 누적 반영. 사용자 별도 요청 시만 예외.

## 잘못된 배포 사례 기록

1. (2026-08-17) WP-CS-02R: --branch preview 잘못 사용 → TestFlight 미수신. --branch production 재발행으로 수정.
2. (2026-09-04) X settings cleanup OTA: --branch production으로 발행 → runtime 2.1.0 기기(production-v2 채널) 미수신. --branch production-v2 재발행으로 수정.

**Why:** eas.json의 build profile channel과 OTA --branch가 정확히 일치해야 기기가 수신함. 채널 이름이 바뀌면 기존 규칙이 통째로 틀릴 수 있으므로 항상 eas.json을 먼저 확인할 것.
**How to apply:** OTA 발행 직전 eas.json `build.<profile>.channel` 확인 → 해당 값을 --branch에 사용.
