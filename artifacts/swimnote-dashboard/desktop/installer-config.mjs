import path from "node:path";

export const APP_ID = "com.swimnote.office.internal";
export const RUNTIME_ID = "F05-FIX-cbbf328c7aa7-3b4af4238756";
export const SETUP_NAME = "SWIMNOTE-OFFICE-F06-Setup.exe";
const quote = s => s.replaceAll("$", "$$").replaceAll('"', '$\\"');

export function renderInstaller({ payloadDir, outputFile, packageId, files, stage = "F06" }) {
  if (!["F06", "STAGE2", "MEMBER"].includes(stage) || !new RegExp(`^${stage}-[a-f0-9]{12}-[a-f0-9]{12}$`).test(packageId) || !files.length ||
      files.some(f => !/^[A-Za-z0-9_./ -]+$/.test(f) || f.startsWith("/") ||
        f.split("/").some(s => !s || s === "." || s === ".."))) throw new Error("Unsafe installer input");
  const label = stage === "MEMBER" ? "회원 상세 보완" : stage === "STAGE2" ? "Stage 2 N01/N02" : "F06";
  const version = stage === "MEMBER" ? "0.0.0.8" : stage === "STAGE2" ? "0.0.0.7" : "0.0.0.6";
  const displayVersion = stage === "MEMBER" ? "0.0.0-member-internal" : stage === "STAGE2" ? "0.0.0-stage2-internal" : "0.0.0-f06-internal";
  // Keep the F06 ownership marker, app ID, userData and removal rules for compatible reinstalls.
  const directories = [...new Set(files.map(f => path.posix.dirname(f)).filter(d => d !== "."))]
    .sort((a, b) => b.length - a.length);
  const installFiles = files.map(file => {
    const dir = path.posix.dirname(file);
    return `SetOutPath "$INSTDIR${dir === "." ? "" : "\\" + dir.replaceAll("/", "\\")}"\nFile "${quote(path.join(payloadDir, file))}"`;
  }).join("\n");
  const uninstallFiles = files.map(f => `Delete "$INSTDIR\\${f.replaceAll("/", "\\")}"`).join("\n");
  return `Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "StrFunc.nsh"
\${StrStr}
\${UnStrStr}
Name "SWIMNOTE OFFICE Internal ${label} (unsigned)"
OutFile "${quote(outputFile)}"
InstallDir "$LOCALAPPDATA\\Programs\\SWIMNOTE OFFICE"
SetCompressor /SOLID lzma
SetCompressorDictSize 16
CRCCheck on
VIProductVersion "${version}"
VIAddVersionKey "ProductName" "SWIMNOTE OFFICE Internal"
VIAddVersionKey "FileDescription" "Unsigned internal ${label} installer - Windows x64 only"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "ProductVersion" "${displayVersion}"
VIAddVersionKey "LegalCopyright" "SWIMNOTE"
VIAddVersionKey "Comments" "${packageId}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "내부 검증용 미서명 설치본입니다. Windows 10/11 x64 대상이며 고객 공개 배포본이 아닙니다.$\\r$\\n$\\r$\\n기존 OFFICE를 정상 종료해 주세요. 보안 차단 시 우회하지 말고 중단하세요.$\\r$\\n$\\r$\\n기존 OFFICE와 같은 사용자 설정·인증 저장소를 사용합니다."
!define MUI_FINISHPAGE_RUN "$INSTDIR\\SwimnoteOffice.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_RUN_TEXT "SWIMNOTE OFFICE 실행 (선택)"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "프로그램 파일과 실행 아이콘만 제거합니다.$\\r$\\n$\\r$\\n기존 실행본과 공유하는 사용자 설정·암호화 인증정보는 보존됩니다. 인증정보를 지우려면 취소하고 앱에서 먼저 로그아웃하세요."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

!macro Guard Prefix
  SetShellVarContext current
  SetRegView 64
  \${IfNot} \${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Windows x64 전용 설치본입니다."
    Abort
  \${EndIf}
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\\SWIMNOTE.OFFICE.Internal.Setup") p.r0 ?e'
  Pop $1
  \${If} $0 == 0
  \${OrIf} $1 == 183
    MessageBox MB_OK|MB_ICONSTOP "다른 OFFICE 설치 또는 제거가 진행 중입니다."
    Abort
  \${EndIf}
  nsExec::ExecToStack /TIMEOUT=10000 '"$SYSDIR\\tasklist.exe" /FI "IMAGENAME eq SwimnoteOffice.exe" /FO CSV /NH'
  Pop $0
  Pop $1
  \${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "OFFICE 실행 상태를 확인하지 못했습니다. 변경하지 않고 중단합니다."
    Abort
  \${EndIf}
  !if "\${Prefix}" == "un."
    \${UnStrStr} $2 $1 "SwimnoteOffice.exe"
  !else
    \${StrStr} $2 $1 "SwimnoteOffice.exe"
  !endif
  \${If} $2 != ""
    MessageBox MB_OK|MB_ICONSTOP "실행 중인 OFFICE를 정상 종료한 뒤 다시 진행하세요. 강제 종료하지 않습니다."
    Abort
  \${EndIf}
!macroend

!macro VerifyMarker
  ClearErrors
  FileOpen $0 "$INSTDIR\\office-internal.marker" r
  IfErrors marker_invalid
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "SWIMNOTE-OFFICE-INTERNAL-F06" marker_ok
  marker_invalid:
    MessageBox MB_OK|MB_ICONSTOP "설치 폴더의 소유 표시가 올바르지 않습니다. 파일을 변경하지 않고 중단합니다."
    Abort
  marker_ok:
!macroend

Function .onInit
  !insertmacro Guard ""
  IfFileExists "$INSTDIR\\*.*" 0 new_install
  !insertmacro VerifyMarker
  Goto init_done
  new_install:
    IfFileExists "$DESKTOP\\SWIMNOTE OFFICE Internal.lnk" shortcut_conflict
    IfFileExists "$SMPROGRAMS\\SWIMNOTE OFFICE Internal\\*.*" shortcut_conflict init_done
  shortcut_conflict:
    MessageBox MB_OK|MB_ICONSTOP "동일한 이름의 실행 아이콘이 이미 있습니다. 덮어쓰지 않고 중단합니다."
    Abort
  init_done:
FunctionEnd

Function un.onInit
  !insertmacro Guard "un."
  !insertmacro VerifyMarker
FunctionEnd

Section "SWIMNOTE OFFICE (필수)"
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\\office-internal.marker" w
  FileWrite $0 "SWIMNOTE-OFFICE-INTERNAL-F06"
  FileClose $0
  SetOverwrite on
  ${installFiles}
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\\SWIMNOTE OFFICE Internal"
  CreateShortCut "$DESKTOP\\SWIMNOTE OFFICE Internal.lnk" "$INSTDIR\\SwimnoteOffice.exe"
  CreateShortCut "$SMPROGRAMS\\SWIMNOTE OFFICE Internal\\SWIMNOTE OFFICE.lnk" "$INSTDIR\\SwimnoteOffice.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "DisplayName" "SWIMNOTE OFFICE (Internal ${label}, unsigned)"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "DisplayVersion" "${displayVersion}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "Publisher" "SWIMNOTE"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "DisplayIcon" "$INSTDIR\\SwimnoteOffice.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ${uninstallFiles}
  Delete "$DESKTOP\\SWIMNOTE OFFICE Internal.lnk"
  Delete "$SMPROGRAMS\\SWIMNOTE OFFICE Internal\\SWIMNOTE OFFICE.lnk"
  RMDir "$SMPROGRAMS\\SWIMNOTE OFFICE Internal"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}"
  Delete "$INSTDIR\\office-internal.marker"
  Delete "$INSTDIR\\Uninstall.exe"
  ${directories.map(d => `RMDir "$INSTDIR\\${d.replaceAll("/", "\\")}"`).join("\n")}
  RMDir "$INSTDIR"
SectionEnd
`;
}

export const f07Instructions = `SWIMNOTE OFFICE Internal F06 — unsigned Windows x64 installer
고객 공개 배포본·서명 완료본이 아닙니다. 실제 Windows 11 실행은 미검증입니다.
설치본 ID는 F06-SOURCE.json, 내부 실행 앱 ID는 기존 ${RUNTIME_ID}입니다.

준비: DOWNLOAD ZIP이 분할된 경우 모두 같은 새 폴더에 풀고 START-F06.cmd를 실행합니다.
CMD는 해시 확인·압축 해제·폴더 열기만 수행하고 EXE를 자동 실행하지 않습니다.
분할되지 않은 ZIP은 새 폴더에 압축 해제합니다.
SWIMNOTE-OFFICE-F06-Setup.exe를 일반 사용자로 직접 실행합니다.
보안 차단 시 중단하세요. 보안 기능 해제·관리자 실행·강제 우회를 요구하지 않습니다.

설치/제거 정책:
- 사용자별 %LOCALAPPDATA%\\Programs\\SWIMNOTE OFFICE에 설치합니다.
- 바탕화면·시작 메뉴 아이콘과 Windows 앱 목록의 제거 항목을 만듭니다.
- 실행 중인 SwimnoteOffice.exe가 있으면 종료를 요청하고 설치/제거를 중단합니다.
- 설치 완료 후 실행 체크는 기본 OFF이며 사용자 선택입니다.
- 자동 시작·자동 업데이트·tray는 추가하지 않습니다.
- 기존 실행본과 같은 %APPDATA%\\SWIMNOTE OFFICE userData를 그대로 공유합니다.
- 재설치·제거는 userData 설정과 암호화 인증정보를 보존합니다.
  인증정보를 제거하려면 제거 전에 앱에서 로그아웃하세요.
  로그아웃은 token을 삭제하되 마지막 아이디·로그인 유지 선택은 보존합니다.
- 프로그램 파일 목록과 전용 실행 아이콘만 제거하며 다른 파일은 광범위 삭제하지 않습니다.

F07: 이 설치본 하나로 단계별 확인합니다. 한 번에 모든 화면을 제출하지 않습니다.
1. 기존 실행본을 닫고 일반 사용자로 설치 → 바탕화면/시작 메뉴 실행 확인.
2. 로그인 유지 OFF로 로그인 → 정상 종료/재실행 시 로그인 화면 확인.
3. ON으로 로그인 → main 안전 저장 성공 → 정상 종료/재실행 → 서버 재검증 후 진입.
4. 명시적 로그아웃 → 재인증 필요·마지막 아이디/선택 보존·비밀번호 빈 상태 확인.
5. 로그인 후 검색·필터·Drawer를 둔 채 네트워크 끊김/복구·조회 상태·입력 보존 확인.
6. 보조 계정의 기존 OFFICE 접근 정책만 확인. 권한은 변경하지 않습니다.
7. 앱 실행 중 설치를 시작하면 중단되는지 확인 → 앱 정상 종료 →
   같은 설치본 재설치 → 설정 보존 확인 → 필요 시 먼저 로그아웃 → Windows 앱 목록에서 제거.

이미 통과한 홈·회원 검색·상태/반 필터·회원 상세·발행 이력·비활성 안내를 반복 요구하지 않습니다.
운영 변경→SSE·저장 충돌·DPAPI 내부 동작은 별도 미검증이며 PASS로 확대하지 않습니다.
운영 회원정보·권한·PIN·TOTP 변경이나 테스트 회원 생성을 하지 않습니다.
화면 공유 시 회원/보호자 식별정보를 가리고 token·비밀번호·PIN·TOTP·암호문 파일은 제출하지 마세요.
`;
