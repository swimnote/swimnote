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

Replit 내부 loopback API는 사용자 Windows의 localhost가 아니다. Linux 브라우저의 합성 Bearer 인증과 제품 Electron의 정상 로그인·DPAPI·preload/IPC 통과는 별도 증거다.

**Why:** 사용자는 접근할 수 없는 loopback 주소를 전달 가능한 환경으로 표현하거나 환경 준비 전에 설치본부터 만드는 것을 금지했다.

**How to apply:** Windows가 실제로 접근할 API의 위치·bind·단일 Origin·서버 인증·검증 수명·종료·비용을 먼저 정한다. 로컬 PC 구성이면 그 PC에서 API/DB가 실행돼야 한다. test 전용 pinning이 필요해도 wildcard·임의 proxy·제품 인증 alias로 제한을 완화하지 않는다.
