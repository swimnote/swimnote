import { packager } from "@electron/packager";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, stat, readdir, copyFile, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { sourceIdentity, dashboard, repo, output, sha } from "./verification-source.mjs";
import { assemblyCommand, instructions } from "./integration-delivery.mjs";

const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve("@electron/packager"))("@electron/asar");
const identity = JSON.parse(await readFile(path.join(output, "source-identity.json"), "utf8"));
if (JSON.stringify(await sourceIdentity()) !== JSON.stringify(identity)) throw new Error("Source changed after build identity was frozen");
const stage = path.join(output, "stage");
await mkdir(stage, { recursive: false });
const mainFiles = ["main.cjs", "preload.cjs", "security.cjs", "session-ipc.cjs", "token-store.cjs"];
await mkdir(path.join(stage, "desktop"));
for (const file of mainFiles) {
  await copyFile(path.join(dashboard, "dist-desktop/app/desktop", file), path.join(stage, "desktop", file));
}
async function copyRenderer(source, destination) {
  await mkdir(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Symlink prohibited in package");
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyRenderer(from, to);
    else {
      if (!/\.(html|js|css|svg|png|woff2)$/.test(entry.name)) throw new Error("Unexpected renderer file");
      await copyFile(from, to);
    }
  }
}
await copyRenderer(path.join(dashboard, "dist-desktop/app/renderer"), path.join(stage, "renderer"));
const pkg = JSON.parse(await readFile(path.join(dashboard, "package.json"), "utf8"));
await writeFile(path.join(stage, "package.json"), JSON.stringify({
  name: "swimnote-office", productName: "SWIMNOTE OFFICE", version: pkg.version,
  private: true, type: "commonjs", main: "desktop/main.cjs",
}, null, 2));
await writeFile(path.join(stage, "verification-source.json"), JSON.stringify(identity, null, 2));
const jsFiles = (await readdir(path.join(stage, "renderer/assets"))).filter(n => n.endsWith(".js"));
if (!jsFiles.length || !(await Promise.all(jsFiles.map(n =>
  readFile(path.join(stage, "renderer/assets", n), "utf8")))).some(s => s.includes(identity.buildId))) {
  throw new Error("Frozen verification ID missing from renderer build");
}
// The guard is exclusively for this approved packager invocation, not prior renderer builds.
await writeFile(path.join(output, "windows-package-attempt.json"),
  JSON.stringify({ attemptedAt: new Date().toISOString(), source: identity, platform: "win32", arch: "x64" }),
  { flag: "wx" });
const electronVersion = pkg.devDependencies.electron.replace(/^[~^]/, "");
const paths = await packager({
  dir: stage, out: output, name: "SwimnoteOffice", executableName: "SwimnoteOffice",
  platform: "win32", arch: "x64", electronVersion, asar: true, overwrite: false, prune: false,
  win32metadata: { CompanyName: "SWIMNOTE", FileDescription: "SWIMNOTE OFFICE F03 F04 internal verification" },
});
if (paths.length !== 1) throw new Error("Expected one package");
const unpacked = paths[0];
const archive = path.join(unpacked, "resources/app.asar");
const entries = asar.listPackage(archive).map(s => s.replaceAll("\\", "/").replace(/^\/+/, ""));
for (const entry of entries) {
  if (/(\.env|node_modules|attached_assets|\.test\.|\.map$|\.log$|office-session\.bin|\.git(?:\/|$))/i.test(entry)) {
    throw new Error("Forbidden package entry: " + entry);
  }
}
for (const file of mainFiles) {
  const stored = asar.extractFile(archive, "desktop/" + file);
  if (sha(stored) !== sha(await readFile(path.join(stage, "desktop", file)))) throw new Error("ASAR main mismatch");
}
if (JSON.parse(asar.extractFile(archive, "verification-source.json").toString()).diffId !== identity.diffId) {
  throw new Error("ASAR identity mismatch");
}
const exe = await readFile(path.join(unpacked, "SwimnoteOffice.exe"));
const pe = exe.readUInt32LE(0x3c);
if (exe.toString("ascii", 0, 2) !== "MZ" || exe.readUInt32LE(pe) !== 0x4550 ||
    exe.readUInt16LE(pe + 4) !== 0x8664 || exe.readUInt16LE(pe + 24) !== 0x20b) {
  throw new Error("Expected PE32+ AMD64 EXE");
}
for (const file of ["resources/app.asar", "chrome_100_percent.pak", "icudtl.dat", "v8_context_snapshot.bin", "ffmpeg.dll"]) {
  if (!(await stat(path.join(unpacked, file))).size) throw new Error("Missing required runtime file");
}
await writeFile(path.join(unpacked, "F03-F04-READ-ME.txt"), instructions, "utf8");
await writeFile(path.join(unpacked, "F03-F04-SOURCE.json"), JSON.stringify(identity, null, 2));
const zipName = "SWIMNOTE-OFFICE-F03-F04-win32-x64-unpacked.zip";
const zipPath = path.join(output, zipName);
execFileSync("zip", ["-q", "-r", zipPath, path.basename(unpacked)], { cwd: output, stdio: "inherit" });
const hash = createHash("sha256");
for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest("hex");
const bytes = (await stat(zipPath)).size;
await writeFile(zipPath + ".sha256", `${sha256}  ${zipName}\n`);
const result = { zip: path.relative(repo, zipPath), bytes, sha256, source: identity,
  electronVersion, platform: "win32", arch: "x64", unsigned: true,
  format: "PE32+ AMD64", asarEntries: entries, windowsExecution: "NOT VERIFIED",
  requiredRuntimeFiles: "PASS", finalMainFilesMatchCompiledSource: true, packagerInvocations: 1 };
if (bytes > 100 * 1024 * 1024) {
  const chunkSize = 80 * 1024 * 1024;
  const parts = [];
  const input = await open(zipPath, "r");
  try {
    for (let offset = 0, n = 1; offset < bytes; offset += chunkSize, n++) {
      const buffer = Buffer.alloc(Math.min(chunkSize, bytes - offset));
      let read = 0;
      while (read < buffer.length) {
        const next = await input.read(buffer, read, buffer.length - read, offset + read);
        if (!next.bytesRead) throw new Error("Unexpected ZIP EOF");
        read += next.bytesRead;
      }
      const name = `${zipName}.part${String(n).padStart(2, "0")}`;
      await writeFile(path.join(output, name), buffer, { flag: "wx" });
      parts.push(name);
    }
  } finally { await input.close(); }
  const rebuilt = createHash("sha256");
  for (const part of parts) for await (const chunk of createReadStream(path.join(output, part))) rebuilt.update(chunk);
  if (rebuilt.digest("hex") !== sha256) throw new Error("Part reassembly mismatch");
  const command = assemblyCommand(zipName, parts, sha256);
  await writeFile(path.join(output, "START-F03-F04.cmd"), command, "ascii");
  await writeFile(path.join(output, "F03-F04-READ-ME.txt"), instructions, "utf8");
  result.delivery = [];
  for (let n = 0; n < parts.length; n++) {
    const name = `SWIMNOTE-OFFICE-F03-F04-DOWNLOAD-${n + 1}-of-${parts.length}.zip`;
    const files = n === 0 ? [parts[n], "START-F03-F04.cmd", "F03-F04-READ-ME.txt", zipName + ".sha256"] : [parts[n]];
    execFileSync("zip", ["-q", "-0", path.join(output, name), ...files], { cwd: output });
    const size = (await stat(path.join(output, name))).size;
    if (size > 100 * 1024 * 1024) throw new Error("Delivery limit exceeded");
    result.delivery.push({ file: path.relative(repo, path.join(output, name)), bytes: size });
  }
  result.deliveryPartsRecombineToOriginalHash = true;
}
await writeFile(path.join(output, "windows-package-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
