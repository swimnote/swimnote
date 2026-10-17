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

OFFICE 사용자 Windows 검증의 전달물은 필요한 런타임·격리 API·합성 DB가 포함된 설치본 또는 압축 실행본이다. 사용자는 다운로드→설치/해제→실행→결과 전달만 하며, 소스 ZIP·개발 도구 설치·pnpm 재시도·소스 빌드를 사용자에게 요구하지 않는다.

**Why:** 사용자가 소스 전달본의 반복 설치 중단 뒤 이 방침을 재차 명시했다. 격리 검증본의 빌드·패키징 허용은 운영 배포·공개 게시·코드 서명·유료 CI·저장소 push 승인과 다르다.

**How to apply:** 기존 제작 도구를 우선 재사용하고 고정 후보에 packaging/runtime glue만 별도 식별자로 추가한다. 기존 설치본의 세션·설치 경로·DB와 분리하며, Windows 실실행 불가는 NOT RUN으로 유지한다.

Windows PostgreSQL app-local 패키징은 PE import 목록뿐 아니라 bootstrap catalog의 `$libdir` 참조까지 확인한다. Node/Electron 포함만으로 PostgreSQL의 Microsoft C++ 런타임도 충족된다고 가정하지 않는다.

**Why:** ICU가 C++ 런타임 DLL을 추가로 요구하고, bootstrap의 인코딩 변환 DLL은 정적 PE import에 나타나지 않는다. Linux에서 의존성을 검사할 때는 Windows 파일명 대소문자 비구분도 반영해야 한다.

**How to apply:** 공식 Windows 배포물에서 필요한 app-local 런타임과 bootstrap library를 포함하고 import closure·catalog 참조·실제 설치본 추출 해시를 구분해 확인한다. 이 정적 검사는 Windows loader/ACL/실행 수용 증거가 아니다.

Windows PostgreSQL CLI의 파일 경로 처리를 Node의 Unicode 파일 I/O와 동일시하지 않는다. `initdb` 종료 코드 1만으로 비영문 경로·권한·보안 제품 중 하나를 원인으로 확정하지 않는다.

**Why:** PostgreSQL 공식 메일링리스트에는 비영문 프로필 아래의 password-file 절대 경로가 CRT에서 잘못 해석되는 사례가 있다. 출력 원문을 보관하지 않은 기존 진단은 최초 실패 도구만 증명하며, 이후 incomplete-preparation은 별도 후속 상태다.

**How to apply:** native 도구 인자는 상대 ASCII 파일명과 명시적 cwd를 우선 검토한다. 도구 분류명은 PostgreSQL 원문이 아니므로, 분류만으로 원인을 확정하지 말고 비밀값을 제외한 제한된 오류 문구도 남긴다. Linux Unicode 경로 검사는 Windows 코드페이지 수용 증거가 아니다. 참조: https://www.postgresql.org/message-id/CAB1XC2Lw8_zTa%3Dv2Rxu%3DhRik1vbTgk0yfC-PT1eODWjHuhgbMg%40mail.gmail.com

상대 pwfile·DB 인자만으로 PostgreSQL 내부의 모든 경로가 ASCII가 되지는 않는다. PostgreSQL 16 initdb는 설치 위치로부터 absolute share 경로를 구하고 post-bootstrap SQL의 sql_features COPY에 사용한다. 이 단계의 encoding 분류와 공식 유사 사례는 조사 가설이지 해당 PC의 원인 확정이 아니다.

**Why:** 사용자는 상대 경로 보완 후에도 post-bootstrap 인코딩 분류가 발생했으며, 한글 경로를 근본 원인으로 단정하지 말라고 명시했다. 공식 보고에는 Windows 설치 binary 경로의 비ASCII 문자로 유사 오류가 발생한 사례가 있으나 버전·PC별 재현 증거는 별도다.

**How to apply:** 근거 없는 encoding/locale 변경이나 SQL_ASCII 전환을 피한다. 원인 미확정 후보는 진단 보완본으로 표시하고 초기화 성공·API 준비·실제 Windows 수용을 구분한다. 참조: https://www.postgresql.org/message-id/16926-e4ef345545d185ab%40postgresql.org

Windows의 LANG/LC_ALL과 프로세스 ANSI code page는 별개다. DB를 UTF-8로 만들고 상대 ASCII 인자를 주어도, 프로세스 시작 전 argv/environ 및 내부에서 구한 절대 경로는 각 실행 파일의 ACP 영향을 받는다. 부모 Electron/Node의 Unicode 처리가 자식 native 프로세스의 ACP를 바꾸지는 않는다.

**Why:** 실제 PostgreSQL 인코딩 오류가 확보된 뒤 조사에서 ASCII 역할명·비밀번호·locale 인자와 ASCII 초기화 자료를 확인했다. PostgreSQL 개발자 설명과 Microsoft 문서는 이와 별도로 native 경로의 ACP 경계를 명시한다. 특정 실패 바이트만으로 사용자 PC의 코드페이지·경로를 확정할 수는 없다.

**How to apply:** per-process UTF-8 선언을 사용할 때 서로 경로 바이트를 주고받는 native 실행 파일을 함께 검토한다. 시스템 코드페이지·사용자 계정명 변경을 요구하지 않는다. manifest의 정적 존재·코드 영역 보존·실제 Windows loader 적용은 다른 증거이며, Linux에 잘못된 바이트를 주입해 같은 오류를 재현해도 사용자 PC의 원인 확정이나 Windows 해결 PASS가 아니다. 참조: https://www.postgresql.org/message-id/CA%2BhUKGL%3DF0pSLLf3nLpA_-sBwYsLg7s%3DFD6YFo_PDvS84FE_hw%40mail.gmail.com ; https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page

초기화 성공·DB 프로세스 생성·DB 준비 완료·정상 종료는 각각 별도 증거다. 과거 진단에 PID와 잠금만 있고 생성 시각 소유 기록이 없으면, 나중에 같은 PID·경로를 발견해도 과거 소유권을 소급 확정하거나 종료하지 않는다.

**Why:** 사용자는 초기화를 통과한 뒤 DB 시작 실패와 잔여 잠금을 보고했지만 당시 PostgreSQL 출력·종료 코드가 수집되지 않았다. PID 재사용과 실패 직후의 실제 정리 결과를 구분하지 않으면 잘못된 프로세스를 종료하거나 원인을 허위 확정할 수 있다.

**How to apply:** 공유 진단에는 제한된 비밀값 제거 출력·spawn/exit·readiness 사유와 종료 후 상태를 연결한다. 현재 child 문맥 또는 당시 생성한 소유 기록에 실행 경로·생성 시각·DB 디렉터리가 모두 맞을 때만 정상 종료를 허용한다. 재연결 자원은 다른 검증 앱 인스턴스가 사용 중일 수 있으므로, 실행 실패 정리에서 자동 종료하지 않고 앱 내 명시적 종료 조작을 받는다. 불명 자원·실패 DB·이전 잠금은 보존하고 앱 안에서 읽기 전용 상태 확인과 안전한 안내를 제공한다. 진단 보완 설치본을 만들었다는 사실은 Windows 기동 해결이나 수용 PASS가 아니다.

API 번들 바이트 비교와 빌드 메타데이터 수집 순서 비교는 구분한다. 허용하는 소스 경로 라벨 정규화는 정확한 두 후보 경로에 한정한다.

**Why:** 병렬 번들러의 seam 발견 순서만 달라도 메타데이터 배열은 바뀌지만 API 번들은 동일할 수 있다. 이를 업무 계약 변경으로 오인하거나, 반대로 광범위한 정규화로 실제 코드 차이를 숨기면 안 된다.

**How to apply:** 실제 entry·seed·writer 번들은 제한된 경로 정규화 후 바이트로 대조한다. 수집 순서가 의미 없는 seam 증거만 importer/dependency 키로 정렬해 별도 비교하고, 그 처리를 실행 코드·업무 데이터의 순서에 적용하지 않는다.
