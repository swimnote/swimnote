---
name: OTA 채널 정책 (영구)
description: iOS OTA 배포 시 반드시 사용할 브랜치/채널 — 잘못된 브랜치로 업로드하면 앱이 업데이트를 수신하지 못함
---

## 핵심 규칙

**iOS OTA = 항상 `--branch production-v2`**

절대 `--branch release-2.0.0` 또는 `--branch production` 사용 금지.

**Why:** EAS 채널 매핑이 `production-v2 channel → production-v2 branch`로 고정되어 있음.
`release-2.0.0` EAS branch에 올리면 앱이 업데이트를 전혀 수신하지 못함.
2026-09-09 실기기에서 실제 수신 실패 확인 및 복구 완료.

**How to apply:**
`ota-publish-v2.sh`의 REQUIRED_BRANCH가 반드시 `"production-v2"`여야 함.
스크립트 수정 후에는 git commit 없이 바로 publish 가능.

```bash
# 올바른 publish
bash scripts/ota-export-ios.sh  # 번들 export
bash scripts/ota-publish-v2.sh "메시지" ios  # production-v2 branch에 업로드
```

## EAS branch vs Git branch 혼동 금지

| 항목 | 값 |
|---|---|
| Git branch | `release/v2.0.0` |
| EAS Update branch (OTA) | `production-v2` |
| EAS channel | `production-v2` |

Git branch 이름과 EAS Update branch 이름이 다르다. 항상 EAS branch 기준으로 생각할 것.

## Android

Android OTA = 별도 명시 지시 시에만, 금지가 기본.

## preview branch

사용 금지 (명시 지시 시만 예외). TestFlight ≠ preview channel.

## runtimeVersion

현재 앱 `runtimeVersion: 2.1.0` (app.json). `ota-publish-v2.sh`의 REQUIRED_RUNTIME=`"2.1.0"` 확인.

## OTA 모달 동작

- 업데이트 수신 시 자동으로 재시작 모달 표시
- 앱 완전 종료 후 재실행해야 체크 트리거됨
