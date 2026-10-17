# SWIMNOTE OFFICE — 정상 격리 인증 후보 실행 안내

이 전달본은 **source 후보**다. 설치본·서명본·운영 배포본이 아니다.
Linux 정상 인증 통합·브라우저 증거와 Windows 네이티브 수용은 별개다.
Windows 설치/실행/DPAPI/실기기 수용은 모두 **NOT RUN**.
이전 후보 및 이전 ZIP은 보존한다. 새 빈 폴더에 새 ZIP을 해제한다.

## 1. 수동 준비 — 관리자 권한/실행 정책 변경 없음

사용자가 직접 준비: Windows x64, PowerShell 7.4+, 호스트 Node 24.13 이상 24.x,
pnpm 10.26.1, PostgreSQL 16.10 이상 16.x (`postgres`, `initdb`, `psql`, `pg_ctl` PATH).
기존 운영 `.env`·DB·계정·로그인 정보를 복사하지 않는다.
프로젝트 workspace가 아니라 **ZIP 해제 루트**에서 실행한다.
회사 정책이 PowerShell 실행을 막으면 우회하지 말고 중단한다.

```powershell
node --version
pnpm --version
postgres --version
$PSVersionTable.PSVersion
pnpm install --frozen-lockfile --ignore-scripts
# 위 설치는 lifecycle scripts를 실행하지 않는다. 다음 다운로드도 사용자가 별도로 결정한다.
node .\node_modules\electron\install.js
node .\scripts\office-stage3\windows\normal\runtime-info.mjs
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action VerifyCandidate
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action BuildDesktop
```

Electron 버전은 package.json·standalone lock에 고정된다. 호스트 Node와 Electron
embedded Node는 다르며 runtime-info의 각각의 실측값을 기록한다.
Linux 기존 의존성 재사용 빌드는 새 standalone 설치 증거가 아니다.
새 임시 Linux 폴더의 frozen 설치·빌드도 Windows native 설치 증거가 아니다.

`build-evidence`가 이미 있으면 덮어쓰지 않는다. 새 ZIP을 새 폴더에 해제해서 빌드한다.
추적 `dist/index.mjs`를 지우거나 복원하지 않는다. 재생 모델만 포함되며 paid fallback은 없다.

## 2. 새 실행 디렉터리 및 시작

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Prepare
# 출력된 RunDirectory를 그대로 대입한다. 경로는 비밀이 아니지만 private 파일은 비밀이다.
$Run = '<출력된 RunDirectory>'
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Start -RunDirectory $Run
```

Start 창은 열린 채 둔다. 새 PowerShell 창을 같은 ZIP 루트에서 열고:

```powershell
$Run = '<동일한 RunDirectory>'
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Check -RunDirectory $Run
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action ShowLogin -RunDirectory $Run
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action LaunchDesktop -RunDirectory $Run
```

ShowLogin은 ACL 보호 폴더의 로컬 파일을 Notepad로 연다. **내용·스크린샷 업로드 금지**.
`fixture_admin`: 지정 ID `fixture_pool` + 새 비밀번호 + 4자리 PIN.
`isolation_other`: 다른 Pool의 정상 관리자. 다른 사용자·Pool을 같은 Pool로 매핑하지 않는다.
teacher/inactive/withdrawn/offpool/TOTP도 별도 합성 계정이며 로그인 정보는 로컬 파일에만 있다.
TOTP 계정의 단기 코드는 별도 창에서 다음 명령으로 로컬 확인한다:

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action ShowOTP -RunDirectory $Run
```

**PIN 경계:** 제품 users Drizzle 선언에는 migration의 web_pin_hash가 없다.
PIN 주 계정은 실제 raw SQL Pool ID 로그인 분기를 사용한다.
격리 envelope는 주 계정 이메일(대소문자·공백 포함)과 non-web 로그인 요청을 거부한다.
이 제한을 운영 버그 수정 또는 모든 로그인 형태의 PIN 검증 완료로 해석하지 않는다.

실제 제품 login/PIN/TOTP/JWT/auth middleware, auth/me, my-pools, x-mode를 사용한다.
Desktop 업무 조회는 현재 인증 사용자·역할·활성 Pool로 제한된 합성 DB adapter다.
제품 운영 app/index, 운영 DB bootstrap, SMS/parent hook/push/payment/upload는 실행하지 않는다.
SSE/provider 실발송은 제공하지 않는다. command 후 정상 재조회로 변경을 확인한다.
사용자 비활성: login에서 토큰이 나올 수 있으나 현재 사용자 조회에서 401.
탈퇴 유예: GET 유지, write 423. Pool 비활성: login 403. 제품 실제 동작을 그대로 구분한다.
로그아웃은 실제 client token/query/session 정리다. 서버 logout/refresh/revocation endpoint는 없다.

## 3. 오류 주입 — 제품 endpoint·방화벽·proxy 변경 없음

별도 PowerShell 창에서 실행한다. 이 도구의 보호된 run 파일/합성 writer만 조작한다.

### A. 실제 커밋 후 실행 응답 전달 유실

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName DropNextResponse -RunDirectory $Run
```

`fixture_member`(합성 검증 회원)의 메모를 **현재와 다른 값**으로 저장한다.
다음 성공 command만 실제 커밋 후 partial 응답을 내보내고 연결을 종료한다.
Chrome의 pre-header 자동 재시도 때문에 단순 socket reset을 사용하지 않는다.
UI는 결과 불명, 자동 재발급/재실행 없음, 로컬 DB의 완료 receipt와 event 1회를 확인한다.
같은 카드의 상태 확인으로 복구한다. 새 저장 버튼으로 재실행하지 않는다.
1회 전달 유실 뒤 자동 해제되며 안전한 전체 해제 명령은 아래 Clear다.

### B. 신규 실행 OFF, 기존 receipt는 유지

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName WritesOff -RunDirectory $Run
```

새 issuance/command는 `503 NOT_ENABLED`. 이는 이전 인증 미준비 503과 다르다.
기존 결과는 현재 JWT·사용자·역할·Pool/소유자 검증 후 조회한다.
불명 카드의 상태 확인도 가능하다. 복구:

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName WritesOn -RunDirectory $Run
```

### C. 실제 세션 교체

카드·미전송 초안·합성 로컬 첨부를 만든다. 제품 로그아웃 메뉴를 사용한다.
이탈 확인 창이 있으면 사용자가 명시적으로 로그아웃을 결정한다.
ShowLogin의 `isolation_other`로 새 로그인한다. 이전 카드·초안·첨부가 없어야 하고
이전 Pool receipt 접근은 403/404여야 한다. 다른 계정의 JWT를 만들어 넣지 않는다.
합성 첨부는 선택만 한다. 업로드/발송을 실행하지 않는다.

### D. stale revision 및 결과 조회만 실패

회원 편집 화면에서 변경을 입력하되 저장 전:

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName StaleMemo -FaultValue fixture_member -RunDirectory $Run
```

원래 편집본 저장이 revision conflict(409)여야 한다. writer의 메모를 덮어쓰면 안 된다.
새로고침하고 현재 revision을 확인한 뒤 새 작업을 사용자가 결정한다.

완료되었으나 아직 결과를 열지 않은 카드가 있을 때:

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName FailMembersReadOn -RunDirectory $Run
```

결과 열기는 실제 `/students?pool_all` 조회에 실패하여 미열람이어야 한다.
같은 endpoint를 사용하는 목록 갱신도 이 동안 실패할 수 있다. 쓰기/receipt는 변하지 않는다.

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName FailMembersReadOff -RunDirectory $Run
```

이후 **사용자가 같은 결과를 다시 열어** 현재 데이터를 확인한다. 자동 열람 완료 금지.
receipt 상태 조회만 다음 1회 실패시키려면 `-FaultName FailNextRead`를 쓴다.

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Fault -FaultName Clear -RunDirectory $Run
```

Clear는 응답/조회 fault를 해제한다. execution gate는 별도 WritesOn/Off 상태를 유지한다.

## 4. 종료·삭제·stale lock

이번 검증 Desktop 창을 **정상 종료**한다. LaunchDesktop 창이 종료를 확인한 후:

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action Stop -RunDirectory $Run
# 합성 DB·비밀까지 지우겠다고 별도 결정했을 때만:
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action DeleteData -RunDirectory $Run -ConfirmSyntheticDataDeletion
```

Stop은 이번 supervisor가 보유한 ChildProcess와 동일 postmaster.pid의 DB만 정리한다.
다른 포트 점유자·임의 PID를 죽이지 않는다. Desktop 창이 남아 있으면 먼저 정상 종료하라고 거부한다.
DeleteData는 이 run의 합성 cluster/private/login-info/단기 OTP만 삭제한다. 증거 로그는 남는다.

강제 종료로 active lock이 남았으면 **다시 Start하거나 lock을 바로 지우지 않는다**:

```powershell
.\scripts\office-stage3\windows\Office-Isolated.ps1 -Action DiagnoseLock -RunDirectory $Run
Get-Content (Join-Path $Run 'desktop-active.json') -ErrorAction SilentlyContinue
Get-Content (Join-Path $Run 'db\postmaster.pid') -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 55440,20411 -ErrorAction SilentlyContinue
```

출력의 supervisor script 경로·candidate ID·session ID·생성 시각을 CIM의 executable/
command line/creation time과 대조하고, Desktop/PG PID와 data path도 대조한다.
PID만 같다는 이유로 소유권을 인정하지 않는다. 알 수 없는 프로세스가 있으면 중단한다.
확인된 이번 자원을 정상 종료한 뒤 두 포트가 비고 해당 프로세스가 모두 종료되었음을
직접 확인했을 때만, stale active/desktop-active 파일을 별도 증거 이름으로 이동한 후 재시작한다.
소유권 확인 없이 lock 삭제·PID 종료·자동 재시작하는 기능은 제공하지 않는다.

## 5. 제출 가능한 증거 / 제출 금지

가능: 후보 ID/해시, 비밀 없는 Check/runtime/build 결과, WINDOWS-CHECKLIST 판정,
합성 업무 화면의 비밀 없는 스크린샷, fault-events/event 로그.
금지: private.json/login-info/otp 파일, DB data, 토큰/세션/userData, 운영 자격증명,
명령줄에 비밀번호/PIN/JWT 입력, credential 창 캡처.
새 유료 모델 호출 0회. 기존 기록 6개 외 입력은 명시적으로 실패한다.
