"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const PRIOR = "OFFICE-WIN-PACKAGED-11ee5f9eb3c7e6be";
const samePath = (a, b) => typeof a === "string" && typeof b === "string" &&
  path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
function windowsArgs(text) {
  if (typeof text !== "string" || text.length > 8192) return [];
  const args = []; let i = 0;
  while (i < text.length) {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
    if (i === text.length) break;
    let arg = "", quote = false;
    while (i < text.length && (quote || !/\s/.test(text[i]))) {
      let slashes = 0;
      while (text[i] === "\\") { slashes++; i++; }
      if (text[i] === '"') {
        arg += "\\".repeat(Math.floor(slashes / 2));
        if (slashes % 2) arg += '"'; else quote = !quote;
        i++;
      } else { arg += "\\".repeat(slashes); if (i < text.length) arg += text[i++]; }
    }
    if (quote) return [];
    args.push(arg);
  }
  return args;
}
function processInfo(pid, environment) {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: "UNKNOWN" };
  // Object.entries(process.env) preserves Windows spelling (often "SystemRoot").
  // A plain copied env object does not retain process.env's case-insensitive lookup.
  const systemRoot = Object.entries(environment).find(([key]) => key.toUpperCase() === "SYSTEMROOT")?.[1];
  if (typeof systemRoot !== "string" || !systemRoot) return { state: "UNKNOWN" };
  // Fixed read-only OS query. No caller-supplied shell text or process termination commands.
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); try { " +
    "$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$env:OFFICE_PROBE_PID); " +
    "if ($null -eq $p) { @{state='ABSENT'} | ConvertTo-Json -Compress; exit 0 }; " +
    "@{state='PRESENT';pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;" +
    "executable=$p.ExecutablePath;commandLine=$p.CommandLine;" +
    "createdAt=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress " +
    "} catch { exit 1 }";
  const result = spawnSync(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...environment, OFFICE_PROBE_PID: String(pid) }, encoding: "utf8",
      windowsHide: true, timeout: 8000, maxBuffer: 65536,
    });
  if (result.error || result.status !== 0) return { state: "UNKNOWN" };
  try {
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    if (value.state === "ABSENT") return { state: "ABSENT" };
    const createdAtMs = Date.parse(value.createdAt);
    if (value.state !== "PRESENT" || value.pid !== pid || !Number.isFinite(createdAtMs) ||
        typeof value.executable !== "string" || typeof value.commandLine !== "string")
      return { state: "UNKNOWN" };
    return { state: "PRESENT", pid, parentPid: value.parentPid, createdAtMs,
      executable: value.executable, commandLine: value.commandLine };
  } catch { return { state: "UNKNOWN" }; }
}
function pidInfo(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (text.length > 8192) return null;
    const [pid, directory, started] = text.split(/\r?\n/);
    if (!/^[1-9]\d{0,9}$/.test(pid) || !/^\d{9,12}$/.test(started) || !directory) return null;
    return { pid: Number(pid), directory, startedMs: Number(started) * 1000 };
  } catch { return null; }
}
function ownership({ info, pidFile, expected, child, record, lock, now = Date.now() }) {
  const verdict = { processState: info.state, executableMatch: false, startTimeMatch: false,
    dataDirectoryMatch: false, argumentsMatch: false, verified: false, reason: "IDENTITY_UNAVAILABLE" };
  if (info.state === "ABSENT") { verdict.reason = "PROCESS_ABSENT"; return verdict; }
  if (info.state !== "PRESENT") return verdict;
  const args = windowsArgs(info.commandLine);
  verdict.executableMatch = samePath(info.executable, expected.executable) && samePath(args[0], expected.executable);
  verdict.argumentsMatch = args.length === expected.args.length + 1 &&
    expected.args.every((arg, i) => args[i + 1] === arg);
  if (!pidFile) { verdict.reason = "PID_FILE_UNAVAILABLE"; return verdict; }
  verdict.dataDirectoryMatch = samePath(pidFile.directory, expected.directory);
  verdict.startTimeMatch = Math.abs(info.createdAtMs - pidFile.startedMs) <= 5000;
  const liveHandle = child && child.pid === info.pid && child.exitCode === null && !child.signalCode &&
    info.parentPid === expected.parentPid && info.createdAtMs >= expected.requestedAt - 2000 &&
    info.createdAtMs <= now + 2000;
  const retainedRecord = record && lock && record.packageId === expected.packageId &&
    record.session === lock.session && record.pid === info.pid && record.createdAtMs === info.createdAtMs &&
    samePath(record.executable, expected.executable) && samePath(record.directory, expected.directory) &&
    samePath(record.cwd, expected.cwd) && record.argsHash === crypto.createHash("sha256").update(JSON.stringify(expected.args)).digest("hex");
  verdict.verified = !!(pidFile.pid === info.pid && verdict.executableMatch && verdict.argumentsMatch &&
    verdict.dataDirectoryMatch && verdict.startTimeMatch && (liveHandle || retainedRecord));
  verdict.reason = verdict.verified ? "OWNERSHIP_VERIFIED" :
    !verdict.executableMatch || !verdict.argumentsMatch || !verdict.dataDirectoryMatch || !verdict.startTimeMatch ||
    pidFile.pid !== info.pid ? "IDENTITY_MISMATCH" : "START_RECORD_MISSING";
  return verdict;
}
function publicOwnership(status) {
  return {
    scope: status.scope === "PREVIOUS" ? "PREVIOUS" : "CURRENT",
    processState: ["ABSENT", "PRESENT", "UNKNOWN"].includes(status.processState) ? status.processState : "UNKNOWN",
    reason: ["NO_RESOURCE", "OWNED_CHILD_EXITED", "NO_DB_PID_EVIDENCE", "PROCESS_ABSENT",
      "IDENTITY_UNAVAILABLE", "PID_FILE_UNAVAILABLE", "IDENTITY_MISMATCH", "START_RECORD_MISSING",
      "OWNERSHIP_VERIFIED", "EXECUTABLE_OR_DIRECTORY_UNVERIFIED", "INSPECTION_FAILED", "LEGACY_METADATA_ONLY"]
      .includes(status.reason) ? status.reason : "IDENTITY_UNAVAILABLE",
    pid: Number.isSafeInteger(status.pid) && status.pid > 0 ? status.pid : undefined,
    createdAtMs: Number.isSafeInteger(status.createdAtMs) && status.createdAtMs > 0 ? status.createdAtMs : undefined,
    executableMatch: status.executableMatch === true, startTimeMatch: status.startTimeMatch === true,
    dataDirectoryMatch: status.dataDirectoryMatch === true, argumentsMatch: status.argumentsMatch === true,
    verified: status.verified === true, hasRetainedLock: status.hasRetainedLock === true,
  };
}
module.exports = { PRIOR, samePath, windowsArgs, processInfo, pidInfo, ownership, publicOwnership };
