---
name: EAS Build tarball 구조 및 패치
description: Replit 모노레포에서 EAS iOS/Android 빌드를 성공시키기 위한 패치 방법
---

## 핵심 원인

EAS CLI의 `makeShallowCopyAsync`가 git root(`/home/runner/workspace`)를 기준으로 전체 workspace를 클론함.
→ workspace root `package.json`의 yarn 차단 preinstall이 포함되어 빌드 실패.
→ 187MB 업로드 = 전체 workspace (잘못된 것).
→ 5.5MB 업로드 = swim-app만 (올바른 것).

## 가장 간단한 해결법 (패치 불필요) ✅

`EAS_NO_VCS=1` 사용 시 `noVcs.js`의 `getRootPathAsync`가 `EAS_PROJECT_ROOT` 절대경로를 우선함:

```bash
EAS_PROJECT_ROOT=/home/runner/workspace/artifacts/swim-app \
EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 EAS_BUILD_NO_EXPO_GO_WARNING=true \
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
node_modules/.bin/eas build --platform all --profile production --non-interactive --no-wait
```

→ 5.5MB만 업로드됨, 패치 불필요.

## 빌드 완전 명령어

```bash
cd artifacts/swim-app && \
EAS_PROJECT_ROOT=/home/runner/workspace/artifacts/swim-app \
EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 EXPO_NO_TELEMETRY=1 EAS_BUILD_NO_EXPO_GO_WARNING=true \
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
node_modules/.bin/eas build --platform all --profile production --non-interactive --no-wait
```

## iOS 제출 (빌드 FINISHED 후, 사용자 허락 받고)

```bash
cd artifacts/swim-app && \
EAS_NO_VCS=1 EXPO_TOKEN=$(printenv EXPO_TOKEN) \
node_modules/.bin/eas submit --platform ios --profile production --latest --non-interactive
```

## 주의사항
- `EAS_PROJECT_ROOT` 필수 — 없으면 git rev-parse로 workspace root 잡혀서 187MB 업로드
- `eas.json` production 프로필에 `"channel": "production"` 필수 — 없으면 OTA 업데이트 불가 (channel: None → checkForUpdateAsync 실패)
- `.npmrc`에 `frozen-lockfile=false` 유지 필수
- 버전 올리기 전 사용자 허락 필수
- 앱스토어 제출 전 사용자 허락 필수
- iOS EAS Free 플랜 월 한도 있음 → Starter($19/월) 이상 필요

## .npmrc (swim-app 루트)
`frozen-lockfile=false` 유지 필수

## Node 버전 호환성 (2026-07-30 추가)

metro-file-map@0.83.3이 Node >=20.19.4 요구함. EAS 빌드 서버 기본 Node(20.18.3)와 불일치 시 `yarn install` 실패.

해결: `.nvmrc`에 `20.19.4` + `.yarnrc`에 `--ignore-engines true` 동시 적용.

**Why:** `.nvmrc`만으로 EAS가 올바른 Node를 선택하지만, 만약 지원 안 되는 버전일 경우 `.yarnrc --ignore-engines`가 안전망 역할.

`node_modules/.bin/eas`는 swim-app에 없음 — 반드시 `/nix/store/spvnxml8f61qy1jrnlfz9p1yhjyh0f4j-eas-cli-14.7.1/bin/eas` 사용.

## expo-apple-authentication 플러그인 누락 오류 (2026-07-30 추가)

`expo-apple-authentication`이 app.json plugin에 있지만 swim-app/package.json에 없으면 EAS 빌드 서버에서 expo config 실행 시 "Failed to resolve plugin" 오류 발생.

**Why:** EAS_NO_VCS=1로 swim-app만 업로드 → EAS 서버에서 swim-app/package.json 기준으로 yarn install → workspace root에만 있던 패키지 누락.

해결: `expo-apple-authentication: "~8.0.8"`을 swim-app/package.json dependencies에 추가.

## Xcode 26 요구사항 (2026-07-30 추가)

2026-04-28부터 Apple App Store 제출에 Xcode 26 이상 필요. eas.json production iOS에 `"image": "latest"` 추가 필수.

**Why:** EAS 기본 이미지가 Xcode 16이면 빌드는 성공하지만 App Store 제출 불가.
