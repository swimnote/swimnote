import { describe, expect, it } from "vitest";
// @ts-expect-error Packaging-only JavaScript helper
import { renderInstaller, f07Instructions } from "./installer-config.mjs";
// @ts-expect-error Packaging-only JavaScript helper
import { assemblyCommand } from "./integration-delivery.mjs";

const input = { payloadDir: "/tmp/payload", outputFile: "/tmp/setup.exe",
  packageId: "F06-" + "a".repeat(12) + "-" + "b".repeat(12),
  files: ["SwimnoteOffice.exe", "resources/app.asar", "locales/ko.pak"] };
describe("F06 internal installer static contract, not Windows execution", () => {
  it("uses per-user Unicode x64-gated installation and current-user shortcuts/ARP", () => {
    const script = renderInstaller(input);
    expect(script).toContain("Unicode true");
    expect(script).toContain("RequestExecutionLevel user");
    expect(script).toContain('${RunningX64}');
    expect(script).toContain('$LOCALAPPDATA\\Programs\\SWIMNOTE OFFICE');
    expect(script).toContain("SetShellVarContext current");
    expect(script).toContain('CreateShortCut "$DESKTOP\\');
    expect(script).toContain('CreateShortCut "$SMPROGRAMS\\');
    expect(script).toContain('WriteRegStr HKCU');
    expect(script).not.toContain("HKLM");
    expect(script).toContain("MUI_FINISHPAGE_RUN_NOTCHECKED");
  });
  it("guards concurrent installation, running apps and ownership before writing/deleting", () => {
    const script = renderInstaller(input);
    expect(script).toContain("CreateMutexW");
    expect(script).toContain('IMAGENAME eq SwimnoteOffice.exe');
    expect(script).toContain('!insertmacro Guard ""');
    expect(script).toContain('!insertmacro Guard "un."');
    expect(script).toContain('!insertmacro VerifyMarker');
    expect(script).not.toMatch(/taskkill|Stop-Process|TerminateProcess/i);
  });
  it("deletes only manifest files and owned shortcuts, never userData or unknown trees", () => {
    const script = renderInstaller(input);
    for (const file of input.files) expect(script).toContain(`Delete "$INSTDIR\\${file.replaceAll("/", "\\")}"`);
    expect(script).not.toMatch(/RMDir\s+\/r|Delete\s+.*\*|DeleteRegKey HKLM|\\CurrentVersion\\Run/);
    expect(script).not.toContain("$APPDATA");
    expect(script).not.toContain("office-session.bin");
    expect(f07Instructions).toContain("재설치·제거는 userData 설정과 암호화 인증정보를 보존");
  });
  it.each(["../personal", "sub/../file", "file$0", 'file"'])("rejects unsafe manifest path %s", name => {
    expect(() => renderInstaller({ ...input, files: [name] })).toThrow();
  });
  it("uses the corrected delivery helper without setup autorun or policy overrides", () => {
    const script = assemblyCommand("SWIMNOTE-OFFICE-F06-installer.zip",
      ["SWIMNOTE-OFFICE-F06-installer.zip.part01"], "a".repeat(64),
      "F06-Windows", "SWIMNOTE-OFFICE-F06", "SWIMNOTE-OFFICE-F06-Setup.exe");
    expect(script).toContain("$ErrorActionPreference='Stop'; $tmp=$null; try {");
    expect(script).toContain("Run SWIMNOTE-OFFICE-F06-Setup.exe as your normal user.");
    expect(script).not.toMatch(/Start-Process|RunAs|ExecutionPolicy|Invoke-WebRequest/);
    expect(script).not.toMatch(/Invoke-Item[^\r\n]*\.exe['"]/);
    expect(() => assemblyCommand("x.zip", ["p"], "a".repeat(64), "x", "../x", "x.exe")).toThrow();
  });
});
