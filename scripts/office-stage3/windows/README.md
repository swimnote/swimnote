# Windows 격리 통합 준비 — 정상 인증 HOLD / 설치본 아님

## 현재 판정

이 자료는 사용자 PC에서 실행할 **새 로컬 합성 DB와 진단 API**의 도구·고정 후보를 제공한다.
현재 API는 `/isolation/status` 진단만 제공하고 로그인·업무 요청에는
`503 ISOLATED_AUTH_NOT_READY`를 반환한다. `LaunchDesktop`도 정상 인증이 없어 의도적으로 중단한다.
따라서 **전체 통합 실행 환경 준비 완료 또는 Windows 수용 PASS가 아니다.**
Agent는 Linux x64에서 소스/계약/컴파일만 확인했다. 사용자 Windows에 접근하지 않았다.
기존 운영 설치본이나 운영 계정을 이 환경에 연결하지 않는다.

## 인증 차단의 근거와 최소 해결 조건

현재 seed는 `office_acceptance`의 합성 회원·반·receipt·fixture principal만 만든다.
정상 인증용 `users`, `swimming_pools`, PIN/TOTP·탈퇴/권한 확인 데이터가 없다.
제품 `routes/auth.ts`는 `@workspace/db`의 `superAdminDb`, `db`, schema와
로그인 limiter·bcrypt/JWT·PIN/TOTP·event logger·SMS/parent hook 등 폭넓은 의존성을 import한다.
`middlewares/auth.ts`도 `superAdminDb`로 현재 사용자·권한/탈퇴 상태를 확인한다.
기존 `lib/db/src/index.ts`는 운영 DSN을 요구하므로 이 도구에서는 import하지 않는다.
운영 app/index를 시작해 이 의존성을 채우는 방식은 이번 승인 범위를 벗어난다.

최소 후속 조건:
1. 제품의 실제 로그인/PIN/TOTP·JWT 검증·현재 actor/Pool 재검증을 그대로 사용하는
   **격리 전용 DB adapter/스키마 계약**을 분리·검증한다. 운영 DSN fallback과 startup 부작용은 금지.
2. 새 로컬 비밀번호/PIN 및 필요한 JWT 서명키는 사용자 PC에서만 생성하고 제한 ACL로 보관한다.
   지금 도구가 생성하는 DB 비밀번호는 로그인 계정이나 JWT가 아니다.
3. 합성 Pool 승인/활성 상태와 주 계정·제한 계정만 seed하고,
   로그인 실패·세션 만료/회수·타 Pool·role 제한을 실제 handler로 확인한다.
4. `auth/me`, `pools/my-pools`, `pools/x-mode`와 업무 조회 어댑터를 실제 DB 계약으로 연결한다.
5. 인증 준비 증거가 생긴 **새 후보**에서만 API auth barrier와 LaunchDesktop HOLD를 교체한다.
   현재 후보를 임의 편집해 해시 검사를 우회하지 않는다.

이 차단은 제품 인증이 불가능하다는 뜻이 아니라 **격리 인증 구성이 현재 미구현**이라는 뜻이다.
합성 Bearer, AuthContext alias, 미들웨어 skip, 가짜 성공 JWT를 대안으로 제공하지 않는다.

## 런타임과 사전 수동 준비

- Windows 10/11 **x64**, 일반 사용자 실행. 관리자 권한 기본 사용 없음.
- PowerShell **7.4+**. Windows 기본 PowerShell 5.1은 wrapper에서 거부한다.
- 호스트 Node **24.13+ / 24.x**, pnpm **10.26.1**.
- PostgreSQL **16.10+ / 16.x**의 `postgres.exe`, `initdb.exe`, `psql.exe`, `pg_ctl.exe`가 PATH에 있어야 한다.
  기존 Windows PostgreSQL 서비스를 정지·변경하지 않는다. 새 별도 cluster만 만든다.
- Electron **44.7.2**: 기존 Desktop package/설치된 metadata가 버전 근거다.
  embedded Node 버전과 호스트 Node 버전은 다르다.
- Vite·React·TypeScript·tsx·pg 등 직접 의존성은 `package.json`에 현재 설치 버전으로 고정했고
  별도 `pnpm-lock.yaml`을 동봉한다. 이는 원본 lock을 수정한 것이 아니다.

위 런타임이 없으면 사용자가 설치 방법과 시스템 PATH 변경을 검토한 후 **별도로 수동 설치**한다.
도구는 다운로드·설치·승격·방화벽·서비스 등록·실행 정책 변경을 하지 않는다.
전달 폴더는 원본 monorepo 밖의 새 디렉터리에 푼다. 관리자 터미널은 쓰지 않는다.

의존성 다운로드를 사용자가 명시적으로 선택할 때만 새 폴더에서:

```powershell
pnpm --version # 10.26.1 확인
pnpm install --frozen-lockfile --ignore-scripts
```

이 명령은 네트워크 다운로드를 사용한다. Electron 실제 개발 실행에 필요한 Windows binary는
현재 `LaunchDesktop`이 HOLD이므로 아직 다운로드할 필요가 없다.
인증 해소 후에도 필요하면 별도 승인하에 `node node_modules/electron/install.js`를 수동 실행한다.
서명·installer·배포 명령은 제공하지 않는다.

원본 workspace의 Unix `preinstall`과 Windows 네이티브 의존성 제외 override는
Windows 준비에 그대로 사용할 수 없다. 그래서 standalone 도구 workspace를 만들고
원본 manifest/lock은 `provenance/`에 변경 없이 별도 보관했다.

## 구체적인 명령

새 전달 폴더 루트의 PowerShell 7에서 실행한다. 스크립트 차단 시 조직 정책을 우회하지 말고 중단한다.
인증 미구현 상태이므로 **사용자에게 아래 작업 전부를 지금 실행하도록 요구하지 않는다.**

```powershell
$Tool = ".\scripts\office-stage3\windows\Office-Isolated.ps1"
& $Tool VerifyCandidate
& $Tool BuildDesktop
& $Tool Prepare
# Prepare가 출력한 비밀값 없는 RunDirectory를 그대로 복사한다.
$Run = "C:\Users\<사용자>\AppData\Local\SwimNoteOffice-Isolated\run-<24자리>"
& $Tool Start -RunDirectory $Run # foreground supervisor; 이 창을 유지
```

별도 PowerShell 창:

```powershell
$Tool = ".\scripts\office-stage3\windows\Office-Isolated.ps1"
$Run = "<Prepare가 출력한 실제 경로>"
& $Tool Check -RunDirectory $Run
& $Tool LaunchDesktop -RunDirectory $Run # 현재는 정상 인증 HOLD로 중단하는 것이 정상
& $Tool Stop -RunDirectory $Run
```

합성 DB를 지우려는 경우에만, Stop을 먼저 확인하고 별도로:

```powershell
& $Tool DeleteData -RunDirectory $Run -ConfirmSyntheticDataDeletion
```

이 명령은 해당 run이 만든 cluster·로컬 DB 비밀번호만 삭제한다. 로그와 기존 제품 userData는 보존한다.
새 비밀번호는 Prepare 시 생성하며 로그·명령줄에 출력하지 않는다.
새 run 디렉터리에 현재 Windows SID만 허용하는 상속 ACL을 설정한 **후** 자격증명을 쓴다.
공유/침해된 OS 사용자 또는 관리자에 대한 완전한 비밀 격리를 보장하지 않는다.

## 시작·포트·소유권·종료

- PostgreSQL **127.0.0.1:55440**, API **127.0.0.1:20411**만 bind한다.
  renderer는 Vite 공개 서버가 아니라 실제 Electron의 `app://office` protocol이다.
- 포트가 점유돼 있으면 Prepare/Start가 실패한다. 점유자를 죽이거나 포트를 자동 변경하지 않는다.
- Prepare는 매번 새 난수 run을 만들고 기존 파일·DB를 덮어쓰지 않는다.
  SQL seed/receipt draft는 Start가 처음 만든 전용 DB에 한 번만 transaction으로 적용한다.
- Node supervisor는 자신이 spawn한 ChildProcess만 종료한다. DB는 소유 PID 대조 후 `pg_ctl stop`한다.
  Stop은 해당 supervisor의 session 디렉터리에 종료 신호만 쓴다. 외부 PID kill/tree kill은 없다.
- `Stop`은 양쪽 포트가 닫혔는지 확인한다. 다른 프로세스가 새로 점유하면 실패로 보고한다.
- 창 강제 종료·PC 종료 시 정상 정리를 보장하지 않는다. stale active lock이 남으면 자동 해제/재실행하지 않는다.
  run·process identity를 확인해야 하며, 임의 기존 프로세스를 종료해서는 안 된다.
- 부모의 운영 환경변수는 child에 전달하지 않는다. 명시한 Windows 실행용 변수만 전달한다.
  URL·운영 Secret·운영 계정은 읽거나 가져오지 않는다.

## 제품/검증 경계와 빌드

원본 제품 파일은 바꾸지 않는다. 후보 사본에만 검증 overlay를 적용한다:
- renderer API, main origin, HTML/main CSP를 단일 `http://127.0.0.1:20411`로 고정.
- main/renderer Stage 3 gate만 후보에서 활성. API 해석/실행은 OFF이고 인증 barrier 유지.
- `app://office` sender·IPC·preload·sandbox/contextIsolation/webSecurity·요청 경로/메서드 제한을 유지.
- 후보별 별도 이름/userData를 사용해 기존 제품의 DPAPI·세션·창 설정을 읽거나 덮어쓰지 않음.
- preload·session IPC·token store 코드는 원본과 동일. 실제 Windows DPAPI는 미검증.

`BuildDesktop`은 새 `build-evidence/`에만 main/preload 및 renderer를 컴파일한다.
기존 출력이 있으면 실패하며 삭제·재사용하지 않는다. 재빌드가 필요하면 새 폴더에 전달본을 푼다.
입력 metafile·명령·출력 해시는 `build-evidence/build-manifest.json`에 기록한다.
API 컴파일본은 참고 증거일 뿐 실행 진입점이 아니다. Start는 고정된 `tsx`로 승인 source와 격리 도구를 실행한다.
추적 `dist/index.mjs`는 포함·수정하지 않는다. `build-evidence`는 installer가 아니다.

## 응답 재생

`replay-records.json`은 기존 6개 실제 응답의 원문/입력만 선별한 합성 자료다.
새 모델 응답이 아니며 SDK·API key·네트워크 fallback은 없다.
`replay.mjs`는 입력 text/memberId가 완전히 일치할 때만 응답하고 미등록 입력은 실패한다.
실제 `createOfficeRouter`의 model 인자로 주입하지만 현재 정상 인증이 없어 HTTP 업무 경로는 503이다.
원본 interpretation handler·command/receipt service는 동일 source를 사용한다.
제품 routes·model transport·build에는 이 재생 분기나 test endpoint를 추가하지 않았다.
서버 후보 10개 source/미적용 draft의 해시는 이전 승인 후보와 동일하다.

## 증거와 남은 Gate

Windows 체크리스트는 `WINDOWS-CHECKLIST.md`를 따른다.
`events.jsonl`, `sessions/<id>/api-ready.json`, `stopped.json`, build manifest는 비밀값 없는 자료다.
`private.json`, PostgreSQL data 디렉터리, JWT·PIN·비밀번호·세션 파일을 업로드하지 않는다.
실행 시간/종료/오류가 아닌 실제 업무 수용 증거는 UI·현재 DB/receipt 확인을 별도로 수집한다.
진단 API는 프레임워크/DB 원시 오류 로그를 저장하지 않아 비밀번호 혼입을 방지한다.

운영 schema/role/grant/보존 정책·운영 startup/배포 source는 UNKNOWN이다.
미협조 legacy writer·전역 정원/중복 보장도 이전 Gate 그대로다.
이번 Windows 준비가 운영 metadata 승인이나 legacy Gate 해소가 아니다.
