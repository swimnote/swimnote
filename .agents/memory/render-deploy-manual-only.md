---
name: Render 배포 — Replit 책임 영구 규칙
description: 서버 코드 변경 시 Render Production 배포까지 Replit이 완료 책임 (2026-09-08 영구 변경)
---

## 규칙 (2026-09-08 영구 변경)

서버 코드가 수정되는 모든 작업에서 Render Production 배포는 **Replit 작업 범위에 기본 포함**.

**기본 실행 체인:**
코드 수정 → 테스트 → git main push → Render deploy trigger → 완료 대기 → /health SHA 확인 → smoke test

**PASS 조건:**
main HEAD SHA == Render LIVE /health commit SHA

사용자가 검증된 특정 commit을 배포 대상으로 고정한 경우에는 **지정 TARGET SHA == Render LIVE SHA == 실제 commit을 반환하는 Production health SHA**를 검증한다. 로컬 HEAD가 이후 첨부파일·문서 commit으로 앞서 있어도 배포 대상을 HEAD로 바꾸지 않는다.

**Why:** 검증된 소스 뒤에 추가된 무관한 commit을 함께 배포하면 사용자가 승인한 배포 범위를 벗어난다.
**How to apply:** 로컬 HEAD·원격 HEAD·승인 TARGET을 구분해 보고한다. 필요한 push는 승인 TARGET의 정상 fast-forward만 사용하고, Render 요청에 commitId를 명시한다. SHA를 맞추려고 reset이나 force push하지 않는다.

선행 commit에 다른 작업의 지시문이나 에이전트 메모가 있다는 이유만으로 배포를 HOLD하지 않는다. 실제 실행 코드·빌드 입력·운영 동작에 영향을 주는 범위 밖 변경인지 구분한다.

**Why:** 사용자는 운영에 영향 없는 문서와 실제 unrelated 구현 변경을 구분하도록 명시했다. 문서만을 이유로 검증 완료본 배포를 막으면 승인된 작업을 불필요하게 중단한다.
**How to apply:** 승인 TARGET까지의 파일·commit 차이를 확인하고 실행 영향이 없는 자료는 보고만 한다. 실제 범위 밖 실행 변경이 있으면 HOLD한다.

특정 TARGET의 모바일 OTA도 EAS에 기록되는 source SHA가 TARGET과 일치해야 한다. 로컬 HEAD가 이후 문서 commit으로 앞선 경우 TARGET의 detached worktree에서 발행할 수 있다.

**Why:** 같은 JS 소스라도 이후 HEAD에서 발행하면 EAS의 source SHA가 사용자 승인 SHA와 달라진다.
**How to apply:** 기존 이력을 reset·rebase하지 않고 TARGET 작업 디렉터리와 해당 소스의 번들을 사용한다. 두 플랫폼의 gitCommitHash·runtimeVersion·branch를 발행 결과에서 확인한다.

"GitHub push 완료" / "Render 배포 트리거됨" / "수동 배포 필요" 상태에서 완료보고 금지.

**완료보고 필수 항목:**
1. main HEAD SHA
2. migration 실행 여부
3. Render deploy 결과
4. Render LIVE SHA
5. /health commit
6. Production smoke 결과
7. APP 변경 여부
8. OTA 필요 여부/OTA ID
9. 잔존 blocker

**Why:** 2026-09-08 사용자 영구 지시. 이전 "수동 전용" 규칙 완전 대체.
**How:** RENDER_API_KEY secret으로 Render API 직접 호출하여 deploy trigger.
실패 시: build log 확인 → 최소 수정 → 재배포 → /health 재확인.

## OTA 구분
서버 코드만 변경: Render deploy만 (OTA 하지 않음)
APP JS/TS 변경: OTA 필요 시 별도 수행
서버+APP 동시: Render LIVE 먼저 확정 → smoke → 이후 OTA
Android OTA: 별도 지시 없으면 금지
