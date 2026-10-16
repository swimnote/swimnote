/** Windows built-ins only. No execution policy override, downloads, elevation or EXE autorun. */
export function assemblyCommand(zipName, parts, sha256, destinationName = "F03-F04-Windows") {
  if (!/^[A-Za-z0-9.-]+\.zip$/.test(zipName) || !/^[a-f0-9]{64}$/.test(sha256) ||
      !parts.length || parts.some(p => !/^[A-Za-z0-9.-]+$/.test(p)) ||
      !/^[A-Za-z0-9-]+$/.test(destinationName)) throw new Error("Unsafe delivery name");
  const code = [
    "$ErrorActionPreference='Stop';",
    "$tmp=$null;",
    "try {",
    "$root=(Get-Location).Path;",
    `$zip=Join-Path $root '${zipName}';`,
    `$destination=Join-Path $root '${destinationName}';`,
    "if ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath $destination)) { throw 'Output already exists. Use a new empty delivery folder.' };",
    `$parts=@(${parts.map(p => `'${p}'`).join(",")});`,
    "foreach ($part in $parts) { if (!(Test-Path -LiteralPath (Join-Path $root $part) -PathType Leaf)) { throw ('Missing part: '+$part) } };",
    "$candidate=$zip+'.joining.tmp';",
    "$out=[IO.File]::Open($candidate,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);",
    "$tmp=$candidate;",
    "try { foreach ($part in $parts) { $inputFile=[IO.File]::OpenRead((Join-Path $root $part)); try { $inputFile.CopyTo($out) } finally { $inputFile.Dispose() } } } finally { $out.Dispose() };",
    `$actual=(Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -cne '${sha256}') { throw 'SHA-256 mismatch. STOP. Do not run this package.' };`,
    "[IO.File]::Move($tmp,$zip); $tmp=$null;",
    "Expand-Archive -LiteralPath $zip -DestinationPath $destination;",
    "$application=Join-Path $destination 'SwimnoteOffice-win32-x64';",
    "if (!(Test-Path -LiteralPath (Join-Path $application 'SwimnoteOffice.exe') -PathType Leaf)) { throw 'Required EXE missing. STOP.' };",
    "Write-Host 'PASS: ZIP SHA-256 verified and extracted. Run SwimnoteOffice.exe as your normal user.';",
    "if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { Invoke-Item -LiteralPath $application };",
    "exit 0",
    "} catch { if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp }; Write-Host ('STOP: '+$_.Exception.Message); exit 1 }",
  ].join(" ");
  return `@echo off\r\nsetlocal\r\npushd "%~dp0"\r\nif errorlevel 1 exit /b 1\r\npowershell.exe -NoLogo -NoProfile -Command "${code}"\r\nif errorlevel 1 (\r\n  echo STOP - No application was launched.\r\n  popd\r\n  pause\r\n  exit /b 1\r\n)\r\npopd\r\npause\r\nexit /b 0\r\n`;
}

export const instructions = `SWIMNOTE OFFICE F03/F04 Windows 통합 검증본

unsigned Windows x64 unpacked 검증본입니다. 설치 프로그램·최종 출시본이 아닙니다.
실제 Windows 인증·DPAPI 성공 여부는 아직 미검증입니다.

분할 전달:
1. 전달 ZIP 두 개를 다운로드합니다.
2. 두 ZIP의 내용물을 같은 새 폴더에 모두 압축 해제합니다.
   그 폴더에 .part01, .part02, START-F03-F04.cmd가 함께 있어야 합니다.
3. START-F03-F04.cmd를 더블클릭합니다. 경로 입력은 필요 없습니다.
   결합·SHA-256 확인·압축 해제가 끝나면 프로그램 폴더가 열립니다.
   STOP이면 실행하지 마세요. 보안 정책·실행 정책·관리자 권한을 변경하지 마세요.
4. 열린 폴더의 SwimnoteOffice.exe를 일반 사용자로 실행합니다.
   보안 경고가 있으면 중단하고 자격증명을 가린 해당 화면만 전달합니다.
   Defender/SmartScreen 해제나 관리자 실행을 하지 마세요.

검증 순서 (기존 F02 창 동작 검사는 반복하지 않습니다):
1. toykids 계정의 기존 로그인/PIN/TOTP 절차를 진행합니다.
   자격증명은 사용자 PC에만 입력합니다. 운영 PIN·TOTP·권한·회원정보는 변경하지 않습니다.
2. 화면의 검증본 ID·실제 Origin(app://office)·Pool·역할·X 응답·OFFICE 허용을 확인합니다.
3. 로그인 유지 OFF로 로그인 후 종료/재실행 시 로그인 화면인지 확인합니다.
4. ON으로 다시 로그인해 안전 저장 성공 표시를 확인합니다.
   종료/재실행 후 서버 재검증을 거쳐 진입하는지 확인합니다.
   안전 저장 실패 또는 서버 확인 실패 시 진입하지 않는 것이 정상입니다.
5. 네트워크 끊김/복구 후 SSE 대기·재연결 상태 변화를 확인합니다.
   이 화면은 업무 조회 대상이 없습니다. 연결 복구가 업무 데이터 재동기화 성공은 아닙니다.
6. 로그아웃 후 재실행 시 자동 진입하지 않는지 확인합니다.
7. 보조 swimnote 계정은 일반 모드의 기존 접근 제한 안내만 확인합니다.
   X 권한 부여·권한 변경 실험은 하지 않습니다.

화면에 표시되는 저장 성공은 main의 저장 성공 응답입니다.
DPAPI의 실제 복원·삭제는 재실행과 로그아웃 결과로 제한 확인합니다.
암호문 파일·token·비밀번호·PIN·TOTP 원문을 제출하지 마세요.
오류나 경고가 있으면 불필요한 개인정보를 가린 해당 화면만 수집합니다.
실제 권한 회수·장시간 만료·부하 테스트는 이번 사용자 검사의 필수 항목이 아닙니다.
`;

export const f05Instructions = `SWIMNOTE OFFICE F05 Windows 조회 통합 검증본

unsigned Windows x64 unpacked입니다. installer·최종 출시본이 아닙니다.
제작·전달 검증과 실제 Windows 사용 수용은 별개입니다.
F05-SOURCE.json 및 앱 상단 검증본 ID를 기준으로 확인합니다.

준비:
전달된 DOWNLOAD ZIP 전부의 내용물을 같은 새 폴더에 압축 해제합니다.
.part01, .part02 등 모든 조각과 START-F05.cmd가 한 폴더에 있어야 합니다.
START-F05.cmd 실행 → 원본 SHA-256 확인·압축 해제 → 프로그램 폴더 열기.
기존 ZIP/출력 폴더가 있거나 누락·해시 불일치면 STOP합니다.
CMD는 EXE를 자동 실행하지 않습니다. SwimnoteOffice.exe를 직접 일반 사용자로 실행합니다.
보안 경고로 실행이 차단되면 중단합니다. 관리자 권한·정책 변경·추가 다운로드는 필요 없습니다.
Windows CMD→PowerShell 실실행은 제작 환경에서 미검증입니다.

순서대로 확인합니다. 한 번에 모든 화면을 제출할 필요는 없습니다.
1단계 — 로그인·Dashboard:
주 계정 toykids의 기존 인증 절차로 로그인합니다.
기존 PIN/TOTP를 요구하면 현재 절차만 따르고 설정은 변경하지 않습니다.
서버 재검증 완료·Pool 토이키즈스윔클럽·홈 현황·F05 검증본 ID를 확인합니다.

2단계 — 회원 조회:
홈의 회원목록 버튼 또는 왼쪽 회원 > 전체 회원으로 이동합니다.
이름/전화번호 검색·상태/반 필터를 사용합니다.
회원 행을 눌러 상세·발행 이력을 조회하고 X/ESC/바깥 클릭으로 닫습니다.
등록·수정·반 배정·연기·퇴원·삭제는 실행하지 않습니다.
실제 장애를 만들지 말고 자연스럽게 관측된 실패·재시도만 확인합니다.

3단계 — 네트워크:
검색·필터·Drawer를 유지한 채 네트워크를 잠시 끊었다 복구합니다.
SSE 중단/복구와 재조회 처리 중/완료 상태, 검색·필터·Drawer 보존을 확인합니다.
회원정보를 변경해 이벤트를 만들지 않습니다. 실제 운영 변경→SSE는 미검증입니다.

4단계 — 로그인 유지:
로그아웃 후 OFF로 로그인 → 정상 종료/재실행 → 로그인 화면을 확인합니다.
ON으로 로그인 → main 안전 저장 성공 표시 → 정상 종료/재실행 →
서버 재검증 후 진입을 확인합니다.
이어서 로그아웃하면 마지막 아이디·ON 선택만 남고 비밀번호는 비어 있어야 합니다.
ON이어도 로그아웃 뒤에는 재인증이 필요합니다.
마지막으로 보조 swimnote 계정의 기존 OFFICE 접근 정책만 확인합니다.

이미 확인한 창 크기·위치·중복 창 동작은 반복하지 않습니다.
테스트 회원 생성·권한/PIN/TOTP 변경은 금지합니다.
업무 쓰기·저장 버전 충돌·DPAPI 내부 구현 검증 완료를 뜻하지 않습니다.
필요한 화면만 보내고 회원 이름·전화번호·보호자 등 식별정보와 자격증명을 가립니다.
암호문 파일·token·비밀번호·PIN·TOTP 원문을 제출하지 마세요.
`;
