---
name: 작업 규칙 헌법
description: 모든 작업지시에 항상 적용되는 고정 규칙. 사용자가 명시적으로 지정한 헌법.
---

## 규칙 원문 (변경 금지)

이번 작업은 지정된 feature 브랜치와 개발 환경에서만 수행한다. Production 코드, Production 배포, Production DB를 직접 수정하지 않는다. 작업 시작 전 현재 branch, HEAD, git status를 보고한다. 작업 완료 후 변경 파일 목록, 전체 git diff 요약, 타입 검사, 테스트 결과, 실제 실행 결과, commit hash, remote push 결과를 제출한다. 원격 저장소에 push되지 않은 작업은 완료로 인정하지 않는다. 한 단계가 승인되기 전 다음 단계 작업을 시작하지 않는다. 기존 파일 삭제, 디렉터리 이동, merge, rebase, reset, force push는 별도 승인 없이 금지한다.

## 체크리스트 (모든 작업에 적용)

### 작업 시작 전 반드시 보고
- [ ] 현재 branch 이름
- [ ] 현재 HEAD (git rev-parse HEAD)
- [ ] git status (변경·미추적 파일)

### 작업 완료 후 반드시 제출
- [ ] 변경 파일 목록
- [ ] git diff 요약
- [ ] 타입 검사 결과 (tsc --noEmit 또는 동등)
- [ ] 테스트 결과
- [ ] 실제 실행 결과 (curl, 스크린샷 등)
- [ ] commit hash
- [ ] remote push 결과 (push 없으면 완료 불인정)

### 별도 승인 없이 절대 금지
- 기존 파일 삭제 (git rm, rm)
- 디렉터리 이동/이름 변경
- merge
- rebase
- reset (--hard / --soft 무관)
- force push (--force, --force-with-lease)

**Why:** 이전 세션 Agent들이 파일 삭제(components/ai/ 25개), 허위 완료 보고, Production 미배포 상태 완료 선언을 반복했음. 이를 방지하기 위해 사용자가 2026-07-29에 명시적으로 지정한 헌법.

**How to apply:** 모든 작업지시 수신 즉시 이 체크리스트를 내부적으로 적용. 사용자가 작업지시 문서를 첨부하든 채팅으로 요청하든 동일하게 적용.

---

## ★ iOS OTA 채널 헌법 (2026-09-04 사용자 지정, 위반 절대 금지)

### 규칙

OTA 배포 전 **반드시 eas.json을 열어** 현재 활성 build profile의 `channel` 값을 확인한다.
`--branch` 에는 그 `channel` 값을 그대로 사용한다.

현재 활성 채널: **`production-v2`** (runtime 2.1.0, build profile `production-v2`)

```bash
# 현재 정답 명령
node_modules/.bin/eas update --skip-bundler \
  --input-dir /tmp/ios-ota-export \
  --platform ios \
  --branch production-v2 \
  --message "..." \
  --non-interactive \
  --environment production
```

### 위반 사례 (두 번 반복 — 절대 재발 금지)

1. (2026-08-17) --branch preview 사용 → 기기 미수신
2. (2026-09-04) --branch production 사용 → production-v2 채널 기기 미수신

**Why:** eas.json channel ≠ --branch 불일치 시 기기가 OTA를 수신하지 못함. 기억에 의존하면 틀림 — 반드시 eas.json을 매번 확인.
**How to apply:** OTA 발행 직전 `cat eas.json | grep channel` 실행 → 해당 값을 --branch에 사용. 다른 값 사용 시 즉시 중단.

---

## 보고서 형식 헌법 (2026-08-16 사용자 지정, 2026-08-16 GPT 호환 확장)

### 원칙

크레딧을 사용하는 모든 작업(구현·수정·배포·조사)이 완료되면 반드시 보고서 형식으로 보고한다.
보고서는 GPT에 그대로 붙여넣어도 완벽하게 해석 가능해야 한다.

### 형식 규칙

1. **보고서 전체를 코드블록(``` ```)으로 감싼다** — 사용자가 복사 버튼 한 번으로 전체를 복사할 수 있어야 한다.
2. **코드블록 맨 첫 부분에 작업 메타 정보를 반드시 기재한다** (GPT가 컨텍스트를 파악할 수 있도록):
   - `PROJECT` : 프로젝트명
   - `DATE` : 작업 날짜
   - `VERSION` : 앱/서버 버전 (알 수 있는 경우)
   - `REQUESTED_BY` : 사용자가 요청한 내용 한 줄 요약
   - `WORK_TYPE` : client-only / server+client / server-only / deploy-only / investigation
   - `FILES_CHANGED` : 변경된 파일 목록
3. **구분선(`---`)** 으로 메타 영역과 보고 내용을 분리한다.
4. **항목은 `KEY = VALUE` 형식**으로 정렬한다.
5. **성공 선언**은 보고서 마지막 줄에 `작업명_COMPLETE ✅` 형태로 표기한다.
6. 보고서 외 추가 설명이 필요하면 코드블록 **밖**에 짧게 붙인다.

### 보고서 템플릿 (전체 구조)

```
PROJECT              = SWIMNOTE
DATE                 = YYYY-MM-DD
VERSION              = 앱 1.6.3 / 서버 vX.X
REQUESTED_BY         = [사용자 요청 내용 한 줄 요약]
WORK_TYPE            = client-only / server+client / server-only / deploy-only / investigation
FILES_CHANGED        = artifacts/swim-app/app/(admin)/x-subscription.tsx

---

ROOT_CAUSE           =
HTTP_STATUS          =
CONTENT_TYPE         =
SERVER_CHANGE        = NO / YES
DB_CHANGE            = NO / YES
TEST_RESULT          =
COMMIT_SHA           =
RENDER_DEPLOY        =
PRODUCTION_OTA       =
PREVIEW_OTA          =

TASK_COMPLETE ✅
```

**Why:** 사용자가 보고서를 GPT에 직접 붙여넣어 분석하므로, GPT가 프로젝트 컨텍스트·버전·요청 내용을 첫 줄에서 파악할 수 있어야 한다. 2026-08-16 사용자 명시 지정.

**How to apply:** 모든 작업 완료 응답의 코드블록 최상단에 PROJECT~FILES_CHANGED 메타 섹션을 먼저 기재. 그 다음 `---` 구분 후 보고 항목. 조사(investigation) 결과도 동일하게 적용.
