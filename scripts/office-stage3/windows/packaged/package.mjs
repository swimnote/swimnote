import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "../../../..");
const attempt = process.argv[2] ?? "attempt-07";
if (!/^attempt-\d{2}$/.test(attempt)) throw new Error("Explicit new attempt name required");
const deliveryRoot = path.join(repo, "generated-artifacts/office-windows-packaged-auth");
const output = path.join(deliveryRoot, attempt);
const base = path.join(repo, "generated-artifacts/office-windows-isolated-prep/candidate-normal-auth");
const frozen = "/tmp/office-normal-frozen-tXEGHG/candidate";
const source = path.join(output, "source");
const sourceZip = path.join(repo, "generated-artifacts/office-windows-isolated-prep/OFFICE-WIN-AUTH-fad5704318bc64c4-source.zip");
const parentId = "OFFICE-WIN-AUTH-fad5704318bc64c4";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const hash = file => sha(fs.readFileSync(file));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
};
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: repo, ...options });
function files(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) throw new Error("No symlinks in payload: " + prefix + e.name);
    return e.isDirectory() ? files(path.join(dir, e.name), prefix + e.name + "/") : [prefix + e.name];
  });
}
function cp(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
function replace(file, oldText, newText) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(oldText) || text.indexOf(oldText) !== text.lastIndexOf(oldText)) throw new Error("Expected exactly one replacement: " + file);
  fs.writeFileSync(file, text.replace(oldText, newText));
}
const baseline = read(path.join(base, "candidate-manifest.json"));
if (baseline.candidateId !== parentId || hash(sourceZip) !== "fe099940f540b679b872c76d2932ce6f2fdea4258467aa2f0a27848264a3f9ee" ||
    hash(path.join(base, "candidate-manifest.json")) !== "f0b2659ea4eb1ffc9cded0af38bb6f6f4f428178db842e15db7f3a0314a0e555")
  throw new Error("Fixed candidate identity mismatch");
for (const entry of baseline.files) if (hash(path.join(base, entry.path)) !== entry.sha256) throw new Error("Parent source changed");
const parentBuild = read(path.join(frozen, "build-evidence/build-manifest.json"));
if (parentBuild.candidateId !== parentId) throw new Error("Prior compiled evidence identity mismatch");
for (const entry of parentBuild.files) if (hash(path.join(frozen, entry.path)) !== entry.sha256) throw new Error("Prior build changed");
if (fs.existsSync(source)) throw new Error("Output attempt already exists; preserve it");

const packagingFiles = ["runtime.cjs", "integration.cts", "package.mjs"];
const packageSource = Object.fromEntries(packagingFiles.map(name => [name, hash(path.join(import.meta.dirname, name))]));
const packageId = "OFFICE-WIN-PACKAGED-" + sha(JSON.stringify({ parentId, packageSource })).slice(0, 16);
const identity = {
  packageId, parentId, parentZipSha256: hash(sourceZip),
  parentManifestSha256: hash(path.join(base, "candidate-manifest.json")),
  headAtPackaging: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim(),
  packagingFiles: packageSource, node: "24.13.0", electron: "44.7.2", postgres: "16.15",
  scope: "Unsigned isolated Windows x64 verification only; Windows execution NOT RUN",
};
write(path.join(output, "package-identity.json"), identity);
fs.cpSync(base, source, { recursive: true, errorOnExist: true, force: false });
for (const name of packagingFiles) cp(path.join(import.meta.dirname, name), path.join(source, "scripts/office-stage3/windows/packaged", name));
// Build resolution only: use the already verified frozen dependency installation, never current HEAD modules.
fs.symlinkSync(path.join(frozen, "node_modules"), path.join(source, "node_modules"), "dir");
const require = createRequire(path.join(source, "package.json"));
const esbuild = require("esbuild");
const compiled = path.join(output, "compiled");
fs.mkdirSync(path.join(compiled, "desktop"), { recursive: true });
for (const name of ["preload", "security", "session-ipc", "token-store"])
  cp(path.join(frozen, "build-evidence/app/desktop", name + ".cjs"), path.join(compiled, "desktop", name + ".cjs"));
fs.cpSync(path.join(frozen, "build-evidence/app/renderer"), path.join(compiled, "renderer"), { recursive: true, errorOnExist: true, force: false });

const desktopMain = path.join(source, "artifacts/swimnote-dashboard/desktop/main.cts");
replace(desktopMain, 'import { app,', 'import { startIsolation, registerLocalHelp, showLocalHelp, packagingFailure, packagedId } from "../../../scripts/office-stage3/windows/packaged/integration.cjs";\nimport { app,');
replace(desktopMain, `app.setName("${parentId}");`, "app.setName(packagedId);");
replace(desktopMain, `"SwimNoteOffice-Windows-Isolated", "${parentId}"`, '"SwimNoteOffice-Windows-Isolated", packagedId');
replace(desktopMain, '  win.removeMenu();', '  win.removeMenu();\n  registerLocalHelp(win);');
replace(desktopMain, '    await createWindow();', '    await startIsolation();\n    await createWindow();\n    await showLocalHelp();');
replace(desktopMain, '  }).catch(() => {\n    dialog.showErrorBox("SWIMNOTE OFFICE", "OFFICE 시작에 실패했습니다. 검증 결과로 이 오류를 전달해주세요.");\n    app.exit(1);\n  });', '  }).catch(packagingFailure);');

const desktopResult = await esbuild.build({
  entryPoints: [desktopMain], outfile: path.join(compiled, "desktop/main.cjs"),
  absWorkingDir: source, bundle: true, platform: "node", target: "node22", format: "cjs",
  define: { __PACKAGED_ID__: JSON.stringify(packageId) },
  external: ["electron", "./security.cjs", "./token-store.cjs", "./session-ipc.cjs"],
  plugins: [{ name: "packaged-typescript-sibling", setup(build) {
    build.onResolve({ filter: /packaged\/integration\.cjs$/ }, () => ({
      path: path.join(source, "scripts/office-stage3/windows/packaged/integration.cts"),
    }));
  } }], metafile: true, logLevel: "info",
});
write(path.join(output, "desktop-build-inputs.json"), desktopResult.metafile);

const normalBuild = path.join(source, "scripts/office-stage3/windows/normal/build.mjs");
replace(normalBuild, 'packages: "external",', 'external: ["pg-native"],');
replace(path.join(source, "scripts/office-stage3/windows/normal/database.ts"),
  "export const candidateRoot = __ISOLATED_ROOT__;",
  'export const candidateRoot = path.dirname(require("node:url").fileURLToPath(import.meta.url));');
const entry = path.join(source, "scripts/office-stage3/windows/normal/entry.ts");
replace(entry, '  candidateId: privateState.candidateId, isolated: true, normalAuthReady: true,',
  '  candidateId: privateState.candidateId, isolated: true, normalAuthReady: true,\n  session: process.argv[process.argv.indexOf("--session") + 1],');
replace(entry, 'process.on("SIGTERM", () => server.close(() => { void pool.end(); }));',
  'const stopLocal = () => server.close(() => { void pool.end().finally(() => { if (process.connected) process.disconnect(); }); });\n' +
  'process.on("SIGTERM", stopLocal);\nprocess.on("message", (message: any) => { if (message?.type === "stop-isolated-api") stopLocal(); });');
const { buildNormal } = await import(normalBuild);
const isolation = path.join(output, "isolation");
await buildNormal(source, isolation);
write(path.join(isolation, "schema.sql"), ["seed-isolated.sql", "receipts.draft.sql", "search-seed.sql"]
  .map(name => fs.readFileSync(path.join(source, "scripts/office-stage3", name), "utf8")).join("\n"));
cp(path.join(base, "replay-records.json"), path.join(isolation, "replay-records.json"));
write(path.join(isolation, "package-identity.json"), identity);

// Record exact parent→packaged changes; selected product handlers are untouched.
const delta = [];
for (const e of baseline.files) {
  const after = hash(path.join(source, e.path));
  if (after !== e.sha256) delta.push({ path: e.path, before: e.sha256, after });
}
const selected = baseline.selectedSource.map(e => {
  const name = e.file;
  const current = path.join(repo, name);
  return { file: name, parentSha256: e.sha256,
    currentHeadWorkingFileSha256: fs.existsSync(current) ? hash(current) : null,
    includedFrom: "fixed candidate; never current HEAD" };
});
write(path.join(output, "source-delta.json"), { parentId, packageId, changedParentFiles: delta, selectedSourceHeadComparison: selected,
  reusedBuildManifestSha256: hash(path.join(frozen, "build-evidence/build-manifest.json")),
  reusedRenderer: files(path.join(compiled, "renderer")).map(file => ({ file, sha256: hash(path.join(compiled, "renderer", file)) })),
});

const stage = path.join(output, "stage");
fs.mkdirSync(stage);
fs.cpSync(compiled, stage, { recursive: true, errorOnExist: true, force: false });
write(path.join(stage, "package.json"), { name: "swimnote-office-isolated-verification", productName: packageId,
  version: "0.0.1", description: "SWIMNOTE OFFICE isolated Windows verification", main: "desktop/main.cjs" });
const packagerRequire = createRequire(path.join(repo, "artifacts/swimnote-dashboard/package.json"));
const { packager } = await import(packagerRequire.resolve("@electron/packager"));
const packaged = await packager({
  dir: stage, out: output, name: "SwimnoteOfficeIsolated", executableName: "SwimnoteOfficeIsolated",
  platform: "win32", arch: "x64", electronVersion: identity.electron, asar: true, overwrite: false, prune: false,
  download: { cacheRoot: path.join(repo, ".cache/electron") },
  win32metadata: { CompanyName: "SWIMNOTE", FileDescription: "SWIMNOTE OFFICE ISOLATED VERIFICATION - NOT PRODUCTION" },
});
if (packaged.length !== 1) throw new Error("Expected one Windows package");
const payload = packaged[0], resources = path.join(payload, "resources");
fs.cpSync(isolation, path.join(resources, "isolation"), { recursive: true, errorOnExist: true, force: false });
const vendor = path.join(deliveryRoot, "vendor");
run("python", ["-c", `
import zipfile,pathlib
vendor=pathlib.Path(${JSON.stringify(vendor)})
resources=pathlib.Path(${JSON.stringify(resources)})
with zipfile.ZipFile(vendor/'node-v24.13.0-win-x64.zip') as z:
 for name in ['node.exe','LICENSE']:
  out=resources/'node'/name;out.parent.mkdir(parents=True,exist_ok=True)
  out.write_bytes(z.read('node-v24.13.0-win-x64/'+name))
with zipfile.ZipFile(vendor/'postgresql-16.15-1-windows-x64-binaries.zip') as z:
 for info in z.infolist():
  n=info.filename
  if info.is_dir():continue
  corelibs=['plpgsql.dll','dict_snowball.dll','cyrillic_and_mic.dll','euc_cn_and_mic.dll',
   'euc_jp_and_sjis.dll','euc_kr_and_mic.dll','euc_tw_and_big5.dll','euc2004_sjis2004.dll',
   'latin2_and_win1250.dll','latin_and_mic.dll']
  keep=(n.startswith('pgsql/share/') or n.startswith('pgsql/lib/') and n.endswith('.dll')
    and (n.split('/')[-1] in corelibs or n.split('/')[-1].startswith('utf8_'))
   or n.startswith('pgsql/bin/') and n.endswith('.dll') and '/wx' not in n
   or n in ['pgsql/bin/'+exe+'.exe' for exe in ['postgres','initdb','pg_ctl','psql']]
   or n in ['pgsql/server_license.txt','pgsql/commandlinetools_3rd_party_licenses.txt'])
  if keep:
   out=resources/'postgres'/n.removeprefix('pgsql/');out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(z.read(n))
for dll in (vendor/'vc-minimum').glob('*.dll_amd64'):
 if dll.name not in ['concrt140.dll_amd64','msvcp140.dll_amd64','msvcp140_1.dll_amd64',
  'msvcp140_2.dll_amd64','msvcp140_atomic_wait.dll_amd64','msvcp140_codecvt_ids.dll_amd64',
  'vcruntime140.dll_amd64','vcruntime140_1.dll_amd64']:continue
 (resources/'postgres/bin'/dll.name.removesuffix('_amd64')).write_bytes(dll.read_bytes())
`]);

const licenses = path.join(resources, "licenses");
fs.mkdirSync(licenses);
cp(path.join(vendor, "vc-redist-extracted/u4"), path.join(licenses, "Microsoft-Visual-C-Runtime-license.rtf"));
write(path.join(output, "vendor-sources.json"), {
  node: { version: identity.node, url: "https://nodejs.org/dist/v24.13.0/node-v24.13.0-win-x64.zip",
    sha256: hash(path.join(vendor, "node-v24.13.0-win-x64.zip")) },
  postgres: { version: identity.postgres, url: "https://get.enterprisedb.com/postgresql/postgresql-16.15-1-windows-x64-binaries.zip",
    sha256: hash(path.join(vendor, "postgresql-16.15-1-windows-x64-binaries.zip")) },
  vcRuntime: { url: "https://aka.ms/vs/17/release/vc_redist.x64.exe", method: "App-local AMD64 DLLs extracted without running or installing the redistributable",
    sha256: hash(path.join(vendor, "vc_redist.x64.exe")) },
});
cp(path.join(base, "pnpm-lock.yaml"), path.join(licenses, "bundled-dependencies-lock.yaml"));
const moduleRoot = path.join(frozen, "node_modules/.pnpm");
for (const entry of fs.readdirSync(moduleRoot)) {
  const nodeModules = path.join(moduleRoot, entry, "node_modules");
  if (!fs.existsSync(nodeModules) || entry === "node_modules") continue;
  const visit = (folder, prefix = "") => {
    for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory() && e.name.startsWith("@")) visit(path.join(folder, e.name), e.name + "/");
      if (!e.isDirectory() || e.name.startsWith("@")) continue;
      const pkg = path.join(folder, e.name);
      for (const license of fs.readdirSync(pkg).filter(n => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n))) {
        if (!fs.statSync(path.join(pkg, license)).isFile()) continue;
        const dest = entry.replaceAll("/", "_") + "__" + prefix.replaceAll("/", "_") + e.name + "__" + license;
        cp(path.join(pkg, license), path.join(licenses, dest));
      }
    }
  };
  visit(nodeModules);
}
const asar = createRequire(packagerRequire.resolve("@electron/packager"))("@electron/asar");
const archive = path.join(resources, "app.asar");
for (const file of files(stage)) if (sha(asar.extractFile(archive, file)) !== hash(path.join(stage, file)))
  throw new Error("ASAR payload mismatch " + file);
// Static Windows loader closure: system/API-set DLLs are provided by Windows 10/11;
// all other imported DLLs must be app-local. No Windows binary is executed here.
const nativeReport = [];
const directoryNames = new Map();
const existsWindowsFile = (directory, filename) => {
  if (!directoryNames.has(directory)) directoryNames.set(directory, new Set(fs.readdirSync(directory).map(n => n.toLowerCase())));
  return directoryNames.get(directory).has(filename.toLowerCase());
};
const systemDll = /^(?:(?:api-ms-win-|ext-ms-win-)[A-Za-z0-9_-]+|kernel32|kernelbase|ntdll|advapi32|bcrypt(?:primitives)?|crypt32|cryptbase|user32|userenv|gdi32|gdi32full|dwmapi|dwrite|d3d11|dxgi|dxcore|imm32|ole32|oleaut32|combase|shell32|shlwapi|shcore|version|winmm|ws2_32|wldap32|secur32|sspicli|ncrypt|netapi32|iphlpapi|dnsapi|mswsock|msvcrt|ucrtbase|rpcrt4|setupapi|cfgmgr32|dbghelp|winhttp|wininet|normaliz|powrprof|propsys|psapi|rstrtmgr|uxtheme|wevtapi|wintrust|wtsapi32|hid|winspool|avrt|opengl32|usp10|sensapi|urlmon|credui|imagehlp|winsta|msimg32|comctl32|mpr|rasapi32|vssapi|msasn1|esent|dpapi|profapi|wkscli|samcli)\.dll$/i;
const bootstrapLibraries = [...new Set([
  ...fs.readFileSync(path.join(resources, "postgres/share/postgres.bki"), "utf8").matchAll(/\$libdir\/([A-Za-z0-9_]+)/g),
].map(m => m[1]))].concat(["plpgsql", "dict_snowball"]);
for (const lib of bootstrapLibraries) {
  if (!existsWindowsFile(path.join(resources, "postgres/lib"), lib + ".dll"))
    throw new Error("Missing PostgreSQL bootstrap library: " + lib);
}
write(path.join(output, "postgres-bootstrap-libraries.json"), bootstrapLibraries);
for (const relative of files(resources).filter(f => /\.(?:exe|dll)$/i.test(f))) {
  const file = path.join(resources, relative), data = fs.readFileSync(file);
  const offset = data.readUInt32LE(0x3c);
  if (data.toString("ascii", 0, 2) !== "MZ" || data.readUInt32LE(offset) !== 0x4550 ||
      data.readUInt16LE(offset + 4) !== 0x8664) throw new Error("Not AMD64 PE: " + relative);
  const imports = [...execFileSync("bash", ["-o", "pipefail", "-c",
    'objdump -p "$1" | awk \'/DLL Name:/ {print}\'', "_", file], { encoding: "utf8" })
    .matchAll(/DLL Name: (.+)/g)].map(m => m[1].trim());
  const unresolved = imports.filter(name => !systemDll.test(name) &&
    !existsWindowsFile(path.dirname(file), name) &&
    !existsWindowsFile(path.join(resources, "postgres/bin"), name) &&
    !(name.toLowerCase() === "postgres.exe" && relative.startsWith("postgres/lib/")));
  if (unresolved.length) throw new Error("Missing app-local dependency: " + relative + " -> " + unresolved.join(","));
  nativeReport.push({ file: relative, machine: "AMD64", imports, unresolved });
}
write(path.join(output, "native-dependency-report.json"), nativeReport);
const inventory = Object.fromEntries(files(payload).map(f => [f, hash(path.join(payload, f))]));
write(path.join(output, "payload-manifest.json"), inventory);
write(path.join(resources, "isolation", "runtime-manifest.json"),
  Object.fromEntries(Object.entries(inventory).filter(([f]) => f.startsWith("resources/node/") ||
    f.startsWith("resources/postgres/") || f.startsWith("resources/isolation/")).map(([f,h]) => [f.slice("resources/".length),h])));
const delivery = path.join(output, "delivery");
fs.mkdirSync(delivery);
const setup = path.join(delivery, packageId + "-Setup.exe");
const nsisPath = s => s.replaceAll("$", "$$").replaceAll('"', '$\\"');
const installed = files(payload).sort();
const installFiles = installed.map(file => `SetOutPath "$INSTDIR\\${path.posix.dirname(file).replaceAll("/", "\\")}"\nFile "${nsisPath(path.join(payload, file))}"`).join("\n");
const deleteFiles = installed.map(file => `Delete "$INSTDIR\\${file.replaceAll("/", "\\")}"`).join("\n");
const directories = [...new Set(installed.map(f => path.posix.dirname(f)).filter(d => d !== "."))].sort((a,b) => b.length-a.length);
const nsi = `Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "StrFunc.nsh"
\${UnStrStr}
Name "SWIMNOTE OFFICE 격리 검증본 (unsigned)"
OutFile "${nsisPath(setup)}"
InstallDir "$LOCALAPPDATA\\Programs\\SWIMNOTE OFFICE Isolated\\${packageId}"
SetCompressor /SOLID lzma
SetCompressorDictSize 16
CRCCheck on
VIProductVersion "0.0.0.1"
VIAddVersionKey "ProductName" "SWIMNOTE OFFICE ISOLATED VERIFICATION"
VIAddVersionKey "FileDescription" "Unsigned isolated Windows verification installer"
VIAddVersionKey "FileVersion" "0.0.0.1"
VIAddVersionKey "LegalCopyright" "SWIMNOTE"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "격리 검증 전용·미서명 설치본입니다.$\\r$\\nNode·pnpm·PostgreSQL 수동 설치가 필요 없습니다.$\\r$\\n운영 계정이나 기존 제품 세션을 사용하지 않습니다.$\\r$\\n보안 차단 시 우회하지 말고 중단하세요."
!define MUI_FINISHPAGE_RUN "$INSTDIR\\SwimnoteOfficeIsolated.exe"
!define MUI_FINISHPAGE_RUN_TEXT "격리 검증본 실행"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
Function .onInit
  SetShellVarContext current
  \${IfNot} \${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Windows x64 전용입니다."
    Abort
  \${EndIf}
  IfFileExists "$INSTDIR\\*.*" 0 fresh_install
  MessageBox MB_OK|MB_ICONSTOP "이 검증본 설치 폴더가 이미 있습니다. 덮어쓰지 않고 중단합니다. 기존 실행본과 증거를 보존하세요."
  Abort
  fresh_install:
FunctionEnd
Section
  ${installFiles}
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\\isolated-package.marker" w
  FileWrite $0 "${packageId}"
  FileClose $0
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortCut "$DESKTOP\\SWIMNOTE OFFICE 격리 검증본 ${packageId.slice(-8)}.lnk" "$INSTDIR\\SwimnoteOfficeIsolated.exe"
  CreateShortCut "$SMPROGRAMS\\SWIMNOTE OFFICE 격리 검증본 ${packageId.slice(-8)}.lnk" "$INSTDIR\\SwimnoteOfficeIsolated.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${packageId}" "DisplayName" "SWIMNOTE OFFICE 격리 검증본"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${packageId}" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
SectionEnd
Function un.onInit
  SetShellVarContext current
  nsExec::ExecToStack /TIMEOUT=10000 '"$SYSDIR\\tasklist.exe" /FI "IMAGENAME eq SwimnoteOfficeIsolated.exe" /FO CSV /NH'
  Pop $0
  Pop $1
  \${UnStrStr} $2 $1 "SwimnoteOfficeIsolated.exe"
  \${If} $0 != 0
  \${OrIf} $2 != ""
    MessageBox MB_OK|MB_ICONSTOP "격리 검증본이 실행 중이거나 실행 상태를 확인하지 못했습니다. 앱을 정상 종료한 뒤 제거하세요."
    Abort
  \${EndIf}
  FileOpen $0 "$INSTDIR\\isolated-package.marker" r
  IfErrors reject_uninstall
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "${packageId}" 0 reject_uninstall
  MessageBox MB_YESNO|MB_ICONQUESTION "검증본을 정상 종료했습니까? 프로그램만 제거하며 합성 DB·로그인 정보·진단·userData는 보존합니다." IDYES accept_uninstall
  reject_uninstall:
  Abort
  accept_uninstall:
FunctionEnd
Section "Uninstall"
  ${deleteFiles}
  ${directories.map(d => `RMDir "$INSTDIR\\${d.replaceAll("/", "\\")}"`).join("\n")}
  Delete "$INSTDIR\\isolated-package.marker"
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\\SWIMNOTE OFFICE 격리 검증본 ${packageId.slice(-8)}.lnk"
  Delete "$SMPROGRAMS\\SWIMNOTE OFFICE 격리 검증본 ${packageId.slice(-8)}.lnk"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${packageId}"
SectionEnd
`;
write(path.join(output, "installer.nsi"), nsi);
run("makensis", ["-V2", path.join(output, "installer.nsi")]);
run("7z", ["t", setup], { stdio: ["ignore", "ignore", "inherit"] });
write(setup + ".sha256", hash(setup) + "  " + path.basename(setup) + "\n");
write(path.join(delivery, "사용안내.txt"), `SWIMNOTE OFFICE 격리 검증본 (미서명 / Windows x64)
ID: ${packageId}
원본: ${parentId}

1. Setup.exe를 다운로드하고 일반 사용자로 설치합니다.
2. 설치 마지막 화면 또는 바탕화면의 'SWIMNOTE OFFICE 격리 검증본'으로 실행합니다.
3. 최초 준비는 자동입니다. Node, pnpm, PostgreSQL, 터미널 명령이 필요 없습니다.
4. 로컬 로그인 안내에서 '로그인 정보 열기'를 선택합니다.
   로그인 ID와 지정 Pool ID는 fixture_pool입니다. 비밀번호와 PIN은 이 PC에서 생성됩니다.
   안내 다시 열기: Ctrl+Shift+L. TOTP도 같은 창에서 현재 코드를 확인합니다.
5. 앱 창을 정상 종료하면 이번 앱이 시작한 API와 DB만 종료합니다.
   재실행 시 같은 합성 DB와 이 검증본 전용 로그인 설정을 사용합니다.

실패 시: 앱 오류 창의 '진단 폴더 열기'에서 diagnostic-*.json만 전달합니다.
진단 경로: %LOCALAPPDATA%\\SwimNoteOffice-Isolated\\${packageId}\\diagnostics
private.json/login-info.txt/OTP/DB/userData/토큰은 공유하지 마세요.
진단 파일은 설치본 최초 실행 전에는 생성되지 않습니다.
기존 포트 점유나 비정상 종료 흔적이 있으면 덮어쓰기·강제 종료하지 않고 중단합니다.
개발 도구 설치·제거·변경 또는 보안 해제·관리자 실행으로 우회하지 마세요.

운영 연결·실발송·결제·업로드·새 유료 모델 호출은 없습니다.
기록된 AI 입력 외 요청은 오류로 종료하며 네트워크 fallback하지 않습니다.
합성 로그인·업무의 기존 Linux 검증 증거를 재사용했습니다.
이 설치본의 Windows 설치·실행·DPAPI·IPC·업무 수용은 제작 환경에서 NOT RUN입니다.
`);
write(path.join(output, "build-result.json"), { ...identity, setup: path.relative(repo, setup),
  bytes: fs.statSync(setup).size, sha256: hash(setup), payloadFiles: installed.length,
  standaloneRuntime: true, noClientPackageInstall: true, asarExact: true, windowsExecution: "NOT RUN",
  sourceDelta: "source-delta.json" });
console.log(JSON.stringify({ packageId, setup, bytes: fs.statSync(setup).size, sha256: hash(setup) }));
