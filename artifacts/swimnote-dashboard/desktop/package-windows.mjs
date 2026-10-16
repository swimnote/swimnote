import { packager } from "@electron/packager";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(dashboard, "../..");
const output = path.join(repo, "generated-artifacts/office-f02");
const marker = path.join(output, "windows-package-attempt.json");
await mkdir(output, { recursive: true });
try {
  await stat(marker);
  throw new Error("Windows packaging was already attempted. A second attempt requires explicit approval.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(marker, JSON.stringify({ attemptedAt: new Date().toISOString(), platform: "win32", arch: "x64" }) + "\n", { flag: "wx" });

const pkg = JSON.parse(await readFile(path.join(dashboard, "package.json"), "utf8"));
const stage = path.join(dashboard, "dist-desktop/app");
await stat(path.join(stage, "desktop/main.cjs"));
await stat(path.join(stage, "renderer/desktop.html"));
await writeFile(path.join(stage, "package.json"), JSON.stringify({
  name: "swimnote-office", productName: "SWIMNOTE OFFICE",
  version: pkg.version, private: true, type: "commonjs", main: "desktop/main.cjs",
}, null, 2) + "\n");
const electronVersion = pkg.devDependencies.electron.replace(/^[~^]/, "");
const paths = await packager({
  dir: stage, out: output, name: "SwimnoteOffice", executableName: "SwimnoteOffice",
  platform: "win32", arch: "x64", electronVersion, asar: true, overwrite: false,
  prune: false, win32metadata: { CompanyName: "SWIMNOTE", FileDescription: "SWIMNOTE OFFICE F02 internal verification" },
});
if (paths.length !== 1) throw new Error("Expected exactly one Windows x64 package");
const unpacked = paths[0];
const readme = `SWIMNOTE OFFICE F02 - Windows 10 Pro x64 internal verification

This is an unsigned unpacked build, not an installer or production release.
Do not enter real credentials or PINs. F02 deliberately blocks server requests.

1. Verify the ZIP SHA-256 using PowerShell: Get-FileHash <zip-path> -Algorithm SHA256
2. Extract the entire ZIP to a local folder. Do not run the EXE inside the ZIP.
3. Run SwimnoteOffice.exe as your normal user (no administrator permission).
4. If Windows security blocks execution, STOP and share the warning.
   Do not disable Defender/SmartScreen or change security policy.
5. Capture the login screen, bootstrap status and actual renderer Origin shown at top.
6. Launch the EXE a second time: the existing window should restore, not duplicate.
7. Resize/move, close with X or Alt+F4, then reopen: bounds should restore visibly.
8. Test refresh (Ctrl+R) without entering credentials; the local login screen should remain.
9. Report Windows version, display scaling, launch/refresh/second-instance/close results,
   plus sanitized error screenshots. Do not send credentials, PINs or auth tokens.

Windows 11 execution, signing, authentication, CORS, auto-update and Windows startup
integration are not verified or implemented in F02.
`;
await writeFile(path.join(unpacked, "F02-READ-ME.txt"), readme);
const zipName = "SWIMNOTE-OFFICE-F02-win32-x64-unpacked.zip";
const zipPath = path.join(output, zipName);
execFileSync("zip", ["-q", "-r", zipPath, path.basename(unpacked)], { cwd: output, stdio: "inherit" });
const hash = createHash("sha256");
for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest("hex");
await writeFile(zipPath + ".sha256", `${sha256}  ${zipName}\n`);
await writeFile(path.join(output, "windows-package-result.json"), JSON.stringify({
  zip: path.relative(repo, zipPath), sha256, bytes: (await stat(zipPath)).size,
  electronVersion, platform: "win32", arch: "x64", unsigned: true,
  windowsExecution: "NOT VERIFIED", configuredEntry: "app://office/admin/login",
  measuredPackagedOrigin: "NOT VERIFIED",
}, null, 2) + "\n");
console.log(JSON.stringify({ zip: path.relative(repo, zipPath), sha256, windowsExecution: "NOT VERIFIED" }));
