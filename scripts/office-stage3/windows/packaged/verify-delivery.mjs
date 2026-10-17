import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { inspectPe } from "./utf8-manifest.mjs";
const repo = path.resolve(import.meta.dirname, "../../../..");
const attempt = path.resolve(process.argv[2]);
if (!attempt.startsWith(path.join(repo, "generated-artifacts/office-windows-packaged-auth/")))
  throw new Error("Only a new isolated packaged output may be checked");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, object) => fs.writeFileSync(file, JSON.stringify(object, null, 2), { flag: "wx" });
const build = read(path.join(attempt, "build-result.json"));
const payload = path.join(attempt, "SwimnoteOfficeIsolated-win32-x64");
const setup = path.join(repo, build.setup);
if (hash(setup) !== build.sha256) throw new Error("Installer hash changed");
const extraction = path.join(attempt, "installer-extracted");
// Reuse preserved extraction after a verifier-only failure; never overwrite its files.
if (!fs.existsSync(extraction)) execFileSync("7z", ["x", "-y", "-o" + extraction, setup], { stdio: "ignore" });
const walk = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + "/") : [prefix + e.name]);
const actual = walk(extraction);
const expected = walk(payload), verified = [];
for (const file of expected) {
  const candidates = actual.filter(name => name === file);
  if (candidates.length !== 1 || hash(path.join(extraction, candidates[0])) !== hash(path.join(payload, file)))
    throw new Error("Installer file mismatch: " + file);
  verified.push({ file, sha256: hash(path.join(payload, file)) });
}
const forbidden = expected.filter(name => /(?:^|\/)(?:private\.json|login-info\.txt|userData|postmaster\.pid|PG_VERSION|node_modules|\.env(?:\.|$)|otp-|office-session\.bin)/i.test(name));
if (forbidden.length) throw new Error("Forbidden payload entries: " + forbidden.join(","));
const unpackedRuntimeManifest = read(path.join(extraction, actual.find(f => f.endsWith("resources/isolation/runtime-manifest.json"))));
for (const [file, sha] of Object.entries(unpackedRuntimeManifest)) {
  const matches = actual.filter(f => f.endsWith("resources/" + file));
  if (matches.length !== 1 || hash(path.join(extraction, matches[0])) !== sha) throw new Error("Runtime startup manifest mismatch");
}
const req = createRequire(path.join(repo, "artifacts/swimnote-dashboard/package.json"));
const asar = createRequire(req.resolve("@electron/packager"))("@electron/asar");
const archive = path.join(payload, "resources/app.asar");
const source = path.join(attempt, "source");
const compiledMain = asar.extractFile(archive, "desktop/main.cjs").toString("utf8");
const buildInputs = Object.keys(read(path.join(attempt, "desktop-build-inputs.json")).inputs);
for (const file of ["database-monitor.cjs", "database-ownership.cjs"])
  if (!buildInputs.some(input => input.endsWith("/" + file))) throw new Error("Missing DB startup supervisor module");
if (!compiledMain.includes("Get-CimInstance Win32_Process") ||
    !/stdio:\s*\[\s*"ignore",\s*"pipe",\s*"pipe"\s*\]/.test(compiledMain))
  throw new Error("Startup capture or process inspection missing from actual package");
const forbiddenURLs = ["https://swimnote-api.onrender.com", "https://swimnote.kr", "http://swimnote.kr"];
for (const url of forbiddenURLs) {
  if (compiledMain.includes(url)) throw new Error("Operating URL in packaged main");
  for (const name of ["normal-entry.mjs", "normal-seed.mjs"])
    if (fs.readFileSync(path.join(payload, "resources/isolation", name), "utf8").includes(url))
      throw new Error("Operating URL in bundled API");
}
const desktopFiles = ["preload", "security", "session-ipc", "token-store"];
const unchangedSecurity = [];
for (const file of desktopFiles) {
  const staged = fs.readFileSync(path.join(attempt, "compiled/desktop", file + ".cjs"));
  if (!asar.extractFile(archive, "desktop/" + file + ".cjs").equals(staged)) throw new Error("Security payload mismatch");
  unchangedSecurity.push(file);
}
const pe = fs.readFileSync(path.join(payload, "SwimnoteOfficeIsolated.exe"));
const peAt = pe.readUInt32LE(0x3c);
if (pe.readUInt32LE(peAt) !== 0x4550 || pe.readUInt16LE(peAt + 4) !== 0x8664)
  throw new Error("Electron runtime is not Windows AMD64");
const installer = fs.readFileSync(setup), at = installer.readUInt32LE(0x3c);
if (installer.readUInt32LE(at) !== 0x4550) throw new Error("Installer is not a Windows PE");
const optional = at + 24, certificate = optional + (installer.readUInt16LE(optional) === 0x20b ? 112 : 96) + 4 * 8;
if (installer.readUInt32LE(certificate) || installer.readUInt32LE(certificate + 4))
  throw new Error("Unexpected installer signing");
const processManifestEvidence = read(path.join(attempt, "postgres-utf8-process-manifests.json"));
for (const entry of processManifestEvidence) {
  const file = path.join(extraction, "resources/postgres/bin", entry.file);
  if (hash(file) !== entry.patchedSha256) throw new Error("Patched PostgreSQL executable hash mismatch");
  const bytes = fs.readFileSync(file), pe = inspectPe(bytes);
  if (!pe.xml.includes('<activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>') ||
      !pe.xml.includes("level='asInvoker'"))
    throw new Error("Extracted process manifest rejected");
  for (const section of entry.unchangedSections) {
    const actual = pe.sections.find(s => s.name === section.name);
    if (!actual || crypto.createHash("sha256").update(bytes.subarray(actual.rawOffset,
      actual.rawOffset + actual.rawSize)).digest("hex") !== section.sha256)
      throw new Error("Vendor executable section hash changed: " + section.name);
  }
}
const result = {
  packageId: build.packageId, setup: build.setup, bytes: build.bytes, sha256: build.sha256,
  extractedPayloadFilesMatch: verified.length, runtimeManifestVerified: Object.keys(unpackedRuntimeManifest).length,
  forbiddenPayloadFiles: forbidden, operatingUrlsInExecutableCode: [],
  windowsElectronMachine: "AMD64", postgresNativeImports: read(path.join(attempt, "native-dependency-report.json")).length,
  postgresBootstrapLibraries: read(path.join(attempt, "postgres-bootstrap-libraries.json")).length,
  unchangedSecurityModules: unchangedSecurity, installerSigning: "unsigned; no signing performed",
  normalAuthEvidenceReused: read(path.join(source, "normal-auth-evidence.json")).passed,
  utf8ProcessManifestsVerified: processManifestEvidence.map(entry => entry.file),
  postgresVendorCodeSectionsPreserved: true,
  databaseStartupMonitorAndOwnershipBundled: true,
  windowsInstallationExecutionDpapiIpcBusiness: "NOT RUN",
  verificationScope: "Static cross-package inspection and actual NSIS extraction on Linux; not Windows loader/execution proof",
};
write(path.join(attempt, "delivery-verification.json"), result);
write(path.join(attempt, "verified-payload-files.json"), verified);
console.log(JSON.stringify(result));
