import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir, copyFile, stat, open } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { sourceIdentity, output, repo, sha, verificationStage } from "./verification-source.mjs";
import { renderInstaller, f07Instructions, SETUP_NAME, APP_ID, RUNTIME_ID } from "./installer-config.mjs";
import { assemblyCommand } from "./integration-delivery.mjs";

if (verificationStage !== "F06") throw new Error("Use --f06");
const identity = JSON.parse(await readFile(path.join(output, "source-identity.json"), "utf8"));
if (JSON.stringify(await sourceIdentity()) !== JSON.stringify(identity)) throw new Error("Source freeze mismatch");
const approved = path.join(repo, "generated-artifacts/office-f05-fix");
const result = JSON.parse(await readFile(path.join(approved, "windows-package-result.json"), "utf8"));
if (result.source.buildId !== RUNTIME_ID || !result.finalMainFilesMatchCompiledSource) throw new Error("Unexpected runtime");
const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve("@electron/packager"))("@electron/asar");
const archive = path.join(approved, "SwimnoteOffice-win32-x64/resources/app.asar");
const manifest = JSON.parse(asar.extractFile(archive, "verification-artifacts.json").toString());
for (const [file, hash] of Object.entries(manifest.files)) {
  if (sha(asar.extractFile(archive, file)) !== hash ||
      sha(await readFile(path.join(repo, "artifacts/swimnote-dashboard/dist-desktop/app", file))) !== hash) {
    throw new Error("Approved runtime / compiled output mismatch: " + file);
  }
}
const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString());
if (pkg.name !== "swimnote-office" || pkg.productName !== "SWIMNOTE OFFICE") throw new Error("Identity changed");
const payload = path.join(output, "payload");
await mkdir(payload, { recursive: false });
async function copyTree(from, to) {
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error("Symlink not allowed");
    if (e.isFile() && e.name === "F05-FIX-READ-ME.txt") continue; // Replaced by focused F07 instructions in this new payload only.
    const src = path.join(from, e.name), dest = path.join(to, e.name);
    if (e.isDirectory()) { await mkdir(dest); await copyTree(src, dest); }
    else await copyFile(src, dest);
  }
}
await copyTree(path.join(approved, "SwimnoteOffice-win32-x64"), payload);
await writeFile(path.join(payload, "F06-SOURCE.json"), JSON.stringify({
  ...identity, runtimeId: RUNTIME_ID, runtimeSource: result.source,
  appId: APP_ID, runtimeVersion: pkg.version, installerVersion: "0.0.0.6",
  userDataPolicy: "Existing Electron productName and userData unchanged; retained on reinstall/uninstall",
}, null, 2));
await writeFile(path.join(payload, "F07-READ-ME.txt"), f07Instructions);
async function inventory(dir, prefix = "") {
  const hashes = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + e.name;
    if (e.isDirectory()) Object.assign(hashes, await inventory(path.join(dir, e.name), name + "/"));
    else {
      if (/(\.env(?:\.|$)|\.test\.|\.log$|attached_assets|node_modules|office-session\.bin|office-login-preferences\.json)/i.test(name)) throw new Error("Forbidden payload file");
      hashes[name] = sha(await readFile(path.join(dir, e.name)));
    }
  }
  return hashes;
}
const hashes = await inventory(payload);
await writeFile(path.join(output, "payload-manifest.json"), JSON.stringify(hashes, null, 2));
const deliveryFolder = path.join(output, "SWIMNOTE-OFFICE-F06");
await mkdir(deliveryFolder);
const exe = path.join(deliveryFolder, SETUP_NAME);
const script = renderInstaller({ payloadDir: payload, outputFile: exe, packageId: identity.buildId, files: Object.keys(hashes).sort() });
const scriptPath = path.join(output, "installer.nsi");
await writeFile(scriptPath, script);
// Preprocessing does not emit an installer. The one-shot guard precedes the sole compilation.
execFileSync("makensis", ["-PPO", scriptPath], { stdio: ["ignore", "ignore", "inherit"] });
if (JSON.stringify(await sourceIdentity()) !== JSON.stringify(identity)) throw new Error("Source changed before compile");
await writeFile(path.join(output, "installer-attempt.json"), JSON.stringify({
  source: identity, runtimeId: RUNTIME_ID, installerInvocations: 1,
}), { flag: "wx" });
execFileSync("makensis", ["-V3", scriptPath], { stdio: "inherit" });
const binary = await readFile(exe), pe = binary.readUInt32LE(0x3c);
if (binary.toString("ascii", 0, 2) !== "MZ" || binary.readUInt32LE(pe) !== 0x4550 ||
    binary.readUInt16LE(pe + 4) !== 0x14c) throw new Error("Expected NSIS PE32 bootstrap");
const cert = pe + 24 + 96 + 4 * 8;
if (binary.readUInt32LE(cert) || binary.readUInt32LE(cert + 4)) throw new Error("Unexpected signature");
execFileSync("7z", ["t", exe], { stdio: "inherit" });
const extracted = path.join(output, "extracted-verification");
execFileSync("7z", ["x", "-y", "-o" + extracted, exe], { stdio: "inherit" });
const extractedHashes = await inventory(extracted);
for (const [file, hash] of Object.entries(hashes)) {
  const matches = Object.entries(extractedHashes).filter(([name, value]) =>
    (name === file || name.endsWith("/" + file)) && value === hash);
  if (matches.length !== 1) throw new Error("Installer payload mismatch: " + file);
}
await writeFile(path.join(deliveryFolder, "F06-SOURCE.json"), await readFile(path.join(payload, "F06-SOURCE.json")));
await writeFile(path.join(deliveryFolder, "F07-READ-ME.txt"), f07Instructions);
const installerHash = sha(binary);
await writeFile(exe + ".sha256", `${installerHash}  ${SETUP_NAME}\n`);
const zipName = "SWIMNOTE-OFFICE-F06-installer.zip", zip = path.join(output, zipName);
execFileSync("zip", ["-q", "-0", "-r", zip, path.basename(deliveryFolder)], { cwd: output });
execFileSync("unzip", ["-tq", zip], { stdio: "inherit" });
const zipHash = sha(await readFile(zip)), bytes = (await stat(zip)).size;
await writeFile(zip + ".sha256", `${zipHash}  ${zipName}\n`);
const delivery = [];
if (bytes > 100 * 1024 * 1024) {
  const chunk = 80 * 1024 * 1024, parts = [], input = await open(zip, "r");
  try {
    for (let offset = 0, n = 1; offset < bytes; offset += chunk, n++) {
      const b = Buffer.alloc(Math.min(chunk, bytes - offset));
      let read = 0;
      while (read < b.length) {
        const next = await input.read(b, read, b.length - read, offset + read);
        if (!next.bytesRead) throw new Error("Unexpected EOF");
        read += next.bytesRead;
      }
      const name = `${zipName}.part${String(n).padStart(2, "0")}`;
      await writeFile(path.join(output, name), b, { flag: "wx" });
      parts.push(name);
    }
  } finally { await input.close(); }
  await writeFile(path.join(output, "START-F06.cmd"), assemblyCommand(
    zipName, parts, zipHash, "F06-Windows", "SWIMNOTE-OFFICE-F06", SETUP_NAME,
  ), "ascii");
  await writeFile(path.join(output, "F07-READ-ME.txt"), f07Instructions);
  for (let i = 0; i < parts.length; i++) {
    const name = `SWIMNOTE-OFFICE-F06-DOWNLOAD-${i + 1}-of-${parts.length}.zip`;
    const files = i ? [parts[i]] : [parts[i], "START-F06.cmd", "F07-READ-ME.txt", zipName + ".sha256"];
    execFileSync("zip", ["-q", "-0", path.join(output, name), ...files], { cwd: output });
    const size = (await stat(path.join(output, name))).size;
    if (size > 100 * 1024 * 1024) throw new Error("Delivery limit exceeded");
    delivery.push({ file: path.relative(repo, path.join(output, name)), bytes: size });
  }
} else delivery.push({ file: path.relative(repo, zip), bytes });
if (JSON.stringify(await sourceIdentity()) !== JSON.stringify(identity)) throw new Error("Final source mismatch");
await writeFile(path.join(output, "installer-result.json"), JSON.stringify({
  source: identity, runtimeId: RUNTIME_ID, installer: path.relative(repo, exe), bytes: binary.length,
  sha256: installerHash, archive: path.relative(repo, zip), archiveBytes: bytes, archiveSha256: zipHash,
  unsigned: true, bootstrap: "PE32 i386 NSIS Unicode", payloadArchitecture: "AMD64 x64",
  installerInvocations: 1, payloadFilesVerified: Object.keys(hashes).length, delivery,
  windowsInstallUninstall: "NOT VERIFIED",
}, null, 2) + "\n");
console.log(await readFile(path.join(output, "installer-result.json"), "utf8"));
