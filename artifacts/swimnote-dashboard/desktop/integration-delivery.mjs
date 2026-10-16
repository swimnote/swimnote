/** Windows built-ins only. No execution policy override, downloads, elevation or EXE autorun. */
export function assemblyCommand(zipName, parts, sha256) {
  if (!/^[A-Za-z0-9.-]+\.zip$/.test(zipName) || !/^[a-f0-9]{64}$/.test(sha256) ||
      !parts.length || parts.some(p => !/^[A-Za-z0-9.-]+$/.test(p))) throw new Error("Unsafe delivery name");
  const code = [
    "$ErrorActionPreference='Stop'",
    "$tmp=$null",
    "try {",
    "$root=(Get-Location).Path;",
    `$zip=Join-Path $root '${zipName}';`,
    "$destination=Join-Path $root 'F03-F04-Windows';",
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
