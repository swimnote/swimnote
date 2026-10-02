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

## 무쓰기 배포 증거의 범위

검증용 read-only 거래의 쓰기 0건과 Production 서버 전체의 쓰기 0건을 구분한다. 일부 테이블의 fingerprint 보존만으로 전체 DB 무쓰기를 주장하지 않는다.

**Why:** 승인된 소스를 변경하지 않아도 서버 재시작 시 기존 seed·backfill·자동 초기화가 실행될 수 있다. 완료 로그의 처리 건수는 실제 변경 행 수와 다를 수 있다.
**How to apply:** migration·DB 쓰기 금지 지시가 있으면 배포 전에 기존 startup 동작까지 포함하는지 확인한다. 보고에서는 직접 실행한 쓰기·migration, 자동 초기화, 실제 확인한 fingerprint 범위를 각각 명시한다.

## Fingerprint 비교 기준의 보존

과거 운영 데이터와 동일하다는 판정에는 비교 기준 digest와 계산 범위·산식이 필요하다. 인원수가 같거나 이전 보고에 MATCH라고 적혀 있다는 사실만으로 fingerprint 동일성을 대체하지 않는다. 후속 운영의 승인 조건에 쓰이는 기준값은 완료보고에 명시하고, 임시 폴더에만 보관하지 않는다.

**Why:** 환경 교체 후 임시 검증 자료가 사라지면, 이전 보고에 비교 결과만 있고 실제 기준값이 없는 경우 후속 작업의 사전 동일성 조건을 재검증할 수 없다.
**How to apply:** 운영 사전 조회는 read-only로 수행하고 현재 digest와 과거 비교 가능 여부를 분리해 보고한다. 과거 기준값이 없으면 미검증으로 표시하고, 동일성 확인을 전제로 승인된 쓰기는 HOLD한다. 새로 측정한 값을 과거 값과 일치한다고 주장하지 않는다.

## OTA 구분
서버 코드만 변경: Render deploy만 (OTA 하지 않음)
APP JS/TS 변경: OTA 필요 시 별도 수행
서버+APP 동시: Render LIVE 먼저 확정 → smoke → 이후 OTA
Android OTA: 별도 지시 없으면 금지
