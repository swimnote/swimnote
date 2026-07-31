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
