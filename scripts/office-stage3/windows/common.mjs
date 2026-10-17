import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
export const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8"));
export const DB = Object.freeze({ host: "127.0.0.1", port: 55440, database: "office_stage3_acceptance", user: "office_fixture" });
export const cleanEnv = () => Object.fromEntries(Object.keys(process.env).filter(key =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH)$/i.test(key))
  .map(key => [key, process.env[key]]));
export function vacant(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} occupied; no process was terminated`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
export function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    env: cleanEnv(), encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 30000, ...options,
  });
  // Do not forward stdout/stderr: a dependency may accidentally log credentials.
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${path.basename(executable)} (output withheld)`);
  return result.stdout.trim();
}
export function restrictDirectory(folder) {
  if (process.platform !== "win32") throw new Error("Windows ACL operation requires Windows");
  const sid = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"]);
  if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) throw new Error("Cannot establish current Windows SID");
  run("icacls.exe", [folder, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
}
export function assertRunDirectory(folder) {
  const absolute = path.resolve(folder);
  const allowed = path.join(process.env.LOCALAPPDATA ?? "!", "SwimNoteOffice-Isolated");
  if (path.dirname(absolute).toLowerCase() !== path.resolve(allowed).toLowerCase() ||
      !/^run-[a-f0-9]{24}$/.test(path.basename(absolute))) throw new Error("Not a tool-owned run directory");
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase())
    throw new Error("Run directory junction/symlink rejected");
  return absolute;
}
export function verifyCandidate(root = ROOT) {
  const manifest = readJSON(path.join(root, "candidate-manifest.json"));
  for (const entry of manifest.files) {
    if (entry.path.includes("\\") || entry.path.split("/").includes("..") || path.isAbsolute(entry.path))
      throw new Error("Unsafe manifest path");
    const file = path.join(root, entry.path);
    if (fs.lstatSync(file).isSymbolicLink() || sha(fs.readFileSync(file)) !== entry.sha256)
      throw new Error(`Candidate integrity failure: ${entry.path}`);
  }
  const legacy = manifest.candidateId === "OFFICE-WIN-ISOLATED-e2b7a63369cd6c18" && manifest.normalAuthReady === false;
  if (manifest.serverCandidate.id !== "OFFICE-S3-SEARCH-3d1e7e03a84c9152" ||
      manifest.settings.apiOrigin !== "http://127.0.0.1:20411" ||
      manifest.settings.rendererOrigin !== "app://office" || !legacy && (manifest.normalAuthReady !== true ||
      sha(fs.readFileSync(path.join(root, "normal-auth-evidence.json"))) !== manifest.authEvidenceSha256))
    throw new Error("Candidate contract mismatch");
  if (!legacy) {
    const evidence = readJSON(path.join(root,"normal-auth-evidence.json"));
    if (!evidence.passed || evidence.newPaidCalls !== 0 || !evidence.sourceHashes?.length) throw new Error("Missing auth proof");
    for (const entry of evidence.sourceHashes) {
      if (!manifest.selectedSource.some(file => file.file === entry.file && file.sha256 === entry.sha256))
        throw new Error("Auth proof/source mismatch");
    }
  }
  return manifest;
}
