---
name: OFFICE packaging evidence
description: Electron metadata normalization and the boundary between source, installer and Windows acceptance evidence
---

Electron Packager 20.3.0 removes the build-only `private` property from the staged package.json. Use a staged runtime manifest without that property when enforcing byte-for-byte ASAR equality; do not weaken the executable/renderer file allowlist or bypass unexpected metadata differences.

**Why:** Strict Stage 2 payload verification stopped before installer compilation because the packager removed only this property. Application compilation and application-file hashes were not the failure.

**How to apply:** Treat pre-installer packaging/check failures separately from actual installer invocations. Preserve failed and previously delivered output directories, use a newly frozen identity when source changes, and never represent a successful Linux extraction/hash check as Windows UI acceptance.

서버 후보는 승인된 source allowlist와 파일·patch 해시로 식별한다. 추적 bundle을 임의 삭제·복원하거나 현재 HEAD 전체를 후보로 취급하지 않는다. Source 실행과 bundle 실행이 다르면 빌드 산출물 포함 여부도 구분한다.

**Why:** 사용자는 후보 정리에서 기존 변경·후보 보존과 source/dist 실제 실행 경로의 구분을 명시했다. package start와 저장소 배포 설정이 서로 다른 경로를 사용할 수 있으며, 저장소 설정만으로 실제 운영 설정을 확정할 수 없다.

**How to apply:** 기존 후보를 보존하고 새 patch를 기준 source에 적용 가능한지 확인한다. 새 컴파일 증거는 ignored 디렉터리에 만들며, 승인 candidate로부터 재현한 배포 산출물과 전체 workspace의 참고 빌드를 구분한다.

Replit 내부 loopback API는 사용자 Windows의 localhost가 아니다. Linux 브라우저에서 합성 Bearer뿐 아니라 실제 제품 로그인으로 발급받은 토큰을 사용해도, Windows Electron의 DPAPI·preload/IPC·네이티브 수용 증거를 대신하지 않는다.

**Why:** 사용자는 접근할 수 없는 loopback 주소를 전달 가능한 환경으로 표현하거나 환경 준비 전에 설치본부터 만드는 것을 금지했다.

**How to apply:** Windows가 실제로 접근할 API의 위치·bind·단일 Origin·서버 인증·검증 수명·종료·비용을 먼저 정한다. 로컬 PC 구성이면 그 PC에서 API/DB가 실행돼야 한다. test 전용 pinning이 필요해도 wildcard·임의 proxy·제품 인증 alias로 제한을 완화하지 않는다.

응답 유실 검증은 서버 커밋 증거와 UI 불명 상태를 따로 관찰한다. 클라이언트/브라우저가 전송을 재시도할 수 있으므로 단순 네트워크 오류 발생만으로 재실행 없음이나 UI 불명 처리를 PASS로 판정하지 않는다.

**Why:** 서버에서는 완료된 응답을 끊었더라도 브라우저가 같은 요청의 성공 응답을 다시 받아 UI가 성공으로 표시될 수 있다. 업무 중복 방지와 불명 UI의 검증 목표는 서로 다르다.

**How to apply:** 실제 전송 방식에서 receipt/발급 수·업무 event 수·최종 UI 상태를 함께 확인한다. 네트워크 실패 주입은 격리 transport에서만 하고 제품 API에 테스트 endpoint나 인증 우회를 추가하지 않는다.

격리 API를 사용하는 검증 후보는 기존 운영 설치본의 userData·single-instance namespace를 공유하지 않는다.

**Why:** 설치본끼리 설정을 보존하는 제품 정책과 달리, 검증 환경이 운영 DPAPI token·자동 로그인 설정을 읽으면 합성 인증 검증이 오염되거나 기존 로그인 상태가 손상될 수 있다.

**How to apply:** preload·IPC·DPAPI 구현은 유지하되 검증 후보의 저장 위치·실행 이름만 분리한다. 운영 인증정보를 복사하지 않으며 정상 합성 인증이 없으면 업무 실행을 HOLD한다.

대상 OS용 lockfile 준비와 기존 호스트 의존성을 재사용한 컴파일은 별도 증거다.

**Why:** Linux용 workspace override는 Windows 네이티브 의존성을 제외할 수 있다. Windows 패키지가 들어 있는 별도 lock을 만들었어도 기존 Linux node_modules로 컴파일한 결과가 그 lock의 새 Windows 설치 성공을 증명하지 않는다.

**How to apply:** 기존 workspace lock을 보존하고 대상용 의존성을 따로 동결한다. 실제 사용한 빌드 도구체인을 기록하고 Windows 설치·실행 검증은 미검증으로 남긴다.

Windows 설치 실패에서는 의존성 lifecycle 차단과 패키지 관리자 자체의 네이티브 실행을 구분한다. `ignore-scripts`는 pnpm/Node worker까지 비활성화하지 않는다. Windows 종료 코드만으로 보안 제품 차단이나 특정 의존성 결함을 확정하지 않는다.

**Why:** 사용자는 동일한 frozen 설치가 여러 우회 조건에서 비정상 종료된 뒤, 같은 설치 재시도 대신 원인별 증거 수집을 요구했다. `0xC0000409`는 fail-fast 계열 코드이며 원인 모듈·하위 코드 없이 버퍼 오버런으로 단정할 수 없다.

**How to apply:** 후보 파일과 실제 Windows pnpm 진입점을 구분해 확인하고, 설치 재시도·보안 완화·버전 변경 없이 기존 WER/정책 이벤트의 시각·모듈·프로세스 상관관계를 먼저 조사한다. 이벤트 부재나 조회 권한 부족은 원인 배제 근거가 아니다.
