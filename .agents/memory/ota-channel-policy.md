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

runtimeVersion은 매번 현재 app.json과 설치 빌드 설정에서 확인한다. 오래된 메모의 버전을 그대로 사용하지 않는다. 업로드 wrapper의 REQUIRED_RUNTIME도 현재 설정과 비교한다.

## 운영 데이터 정리 전 OTA 도달성 확인

브랜치에 업데이트가 존재한다는 사실만으로 Production 채널 배포를 완료했다고 판단하지 않는다. 운영 데이터 정리가 OTA 완료에 의존하면, 활성 채널의 실제 branch mapping과 두 플랫폼 업데이트의 branch identity까지 독립적으로 확인한다.

**Why:** 올바른 이름의 브랜치에 정상 업데이트를 올려도 채널이 다른 브랜치를 가리키거나 일시중지되어 있으면 설치 앱은 수신하지 못한다. 이를 확인하지 않고 데이터 정리를 먼저 하면 구형 앱 상태와 운영 데이터가 어긋난다.

**How to apply:** 원격 업데이트의 source SHA·runtime·platform·group과 원격 채널의 활성 상태·매핑을 확인한 뒤, 별도 승인된 데이터 정리로 진행한다. 로컬 설정이나 과거 매핑 확인만으로 대체하지 않는다.

## OTA 모달 동작

- 업데이트 수신 시 자동으로 재시작 모달 표시
- 앱 완전 종료 후 재실행해야 체크 트리거됨
