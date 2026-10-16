import { describe, expect, it } from "vitest";
// @ts-expect-error Small build-only ESM helper has no runtime renderer dependency.
import { assemblyCommand } from "./integration-delivery.mjs";

const zip = "SWIMNOTE-OFFICE-F03-F04-win32-x64-unpacked.zip";
const parts = [zip + ".part01", zip + ".part02"];
const hash = "a".repeat(64);

describe("F03/F04 delivery script static safety contract (not Windows execution)", () => {
  it("uses relative inputs, CRLF and ordinary Windows PowerShell without policy overrides", () => {
    const script = assemblyCommand(zip, parts, hash);
    expect(script).toContain('pushd "%~dp0"\r\n');
    expect(script).toContain("powershell.exe -NoLogo -NoProfile -Command");
    expect(script.replaceAll("\r\n", "")).not.toContain("\n");
    expect(script).not.toMatch(/ExecutionPolicy|RunAs|Invoke-WebRequest|DownloadString|https?:\/\/|[A-Z]:\\/i);
    expect(script).not.toContain("Start-Process");
    expect(script.split("\r\n").every((line: string) => line.length < 8191)).toBe(true);
    expect(script).toContain("$ErrorActionPreference='Stop'; $tmp=$null; try {");
  });
  it("uses a separate F05 output folder and retains the corrected statement separators", () => {
    const script = assemblyCommand("SWIMNOTE-OFFICE-F05-win32-x64-unpacked.zip",
      ["SWIMNOTE-OFFICE-F05-win32-x64-unpacked.zip.part01"], hash, "F05-Windows");
    expect(script).toContain("$destination=Join-Path $root 'F05-Windows';");
    expect(script).not.toContain("F03-F04");
    expect(script).toContain("$ErrorActionPreference='Stop'; $tmp=$null; try {");
    expect(() => assemblyCommand(zip, parts, hash, "../escape")).toThrow();
  });
  it("checks missing parts before creating output and verifies SHA before extraction or opening the folder", () => {
    const script = assemblyCommand(zip, parts, hash);
    const sequence = ["Missing part:", "[IO.File]::Open($candidate", "Get-FileHash",
      "SHA-256 mismatch", "[IO.File]::Move", "Expand-Archive", "Required EXE missing",
      "Invoke-Item -LiteralPath $application"];
    const positions = sequence.map(s => script.indexOf(s));
    expect(positions.every(n => n >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(script).toContain(`$actual -cne '${hash}'`);
    expect(script).toContain("catch { if ($tmp");
    expect(script).toContain("exit 1");
    expect(script).toContain("if errorlevel 1");
    expect(script).toContain("No application was launched.");
  });
  it("preserves existing output and never executes the application automatically", () => {
    const script = assemblyCommand(zip, parts, hash);
    expect(script).toContain("Output already exists");
    expect(script).toContain("[IO.FileMode]::CreateNew");
    expect(script).not.toContain("-Force");
    expect(script).not.toMatch(/Invoke-Item[^\r\n]*\.exe['"]/);
    for (const part of parts) expect(script).toContain(`'${part}'`);
  });
  it.each(["../escape.zip", "test';evil.zip", "C:\\test.zip", "test%USER%.zip"])(
    "rejects unsafe filenames %s", name => {
      expect(() => assemblyCommand(name, parts, hash)).toThrow();
    },
  );
});
