/** Approved single Stage 2 installer. No production calls, signing, credentials or old-output writes. */
import { packager } from "@electron/packager";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir, copyFile, stat, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { sourceIdentity, dashboard, repo, output, sha, verificationStage } from "./verification-source.mjs";
import { renderInstaller, APP_ID } from "./installer-config.mjs";
import { assemblyCommand } from "./integration-delivery.mjs";

if (verificationStage !== "STAGE2") throw new Error("Use --stage2");
const readability = process.argv.includes("--readability");
const finalLayout = process.argv.includes("--final-layout");
const manager = process.argv.includes("--manager") || finalLayout;
const unified = process.argv.includes("--unified") || manager;
const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve("@electron/packager"))("@electron/asar");
const run = (command, args, cwd = dashboard) => execFileSync(command, args, { cwd, stdio: "inherit" });
const fresh = (file, value) => writeFile(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function inventory(directory, prefix = "") {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlink prohibited: " + name);
    if (entry.isDirectory()) Object.assign(files, await inventory(file, name + "/"));
    else {
      if (/(\.env(?:\.|$)|\.test\.|\.log$|\.map$|attached_assets|node_modules|office-session\.bin|office-login-preferences\.json|\.git(?:\/|$))/i.test(name))
        throw new Error("Forbidden payload entry: " + name);
      files[name] = await hashFile(file);
    }
  }
  return files;
}
// Remember every old output's path/size/mtime, and hash the previously delivered F06 files.
const oldDirectories = (await readdir(path.dirname(output), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => path.join(path.dirname(output), entry.name));
async function oldSnapshot() {
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { const info = await lstat(file); files[path.relative(repo, file)] = [info.size, info.mtimeMs]; }
    }
  }
  for (const directory of oldDirectories) await visit(directory);
  return files;
}
const oldFiles = await oldSnapshot();
const oldResult = JSON.parse(await readFile(path.join(repo, "generated-artifacts/office-f06/installer-result.json"), "utf8"));
const oldHashes = {};
for (const file of [oldResult.installer, oldResult.archive, ...oldResult.delivery.map(item => item.file)])
  oldHashes[file] = await hashFile(path.join(repo, file));
if (oldHashes[oldResult.installer] !== oldResult.sha256 || oldHashes[oldResult.archive] !== oldResult.archiveSha256)
  throw new Error("Existing F06 delivery hash mismatch");
await mkdir(output, { recursive: false }); // Existing attempt/output is a hard stop, never overwritten.
const identity = await sourceIdentity();
await fresh(path.join(output, "source-identity.json"), identity);
await fresh(path.join(output, "preserved-output-baseline.json"), { files: oldFiles, sha256: oldHashes });
await fresh(path.join(output, "source-tracked.diff"), execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: repo }).toString());
async function frozen() {
  if (JSON.stringify(await sourceIdentity()) !== JSON.stringify(identity)) throw new Error("Frozen source mismatch");
}
const compiled = path.join(output, "compiled"), stage = path.join(output, "stage");
await mkdir(stage);
run("pnpm", ["exec", "vite", "build", "--config", "vite.desktop.config.ts", "--mode", finalLayout ? "stage2-final-layout" : manager ? "stage2-manager" : unified ? "stage2-unified" : readability ? "stage2-readability" : "stage2", "--outDir", path.join(compiled, "renderer")]);
run("pnpm", ["exec", "tsc", "-p", "desktop/tsconfig.json", "--outDir", path.join(compiled, "desktop")]);
await mkdir(path.join(stage, "desktop"));
const mainFiles = ["main.cjs", "preload.cjs", "security.cjs", "session-ipc.cjs", "token-store.cjs"];
for (const file of mainFiles) await copyFile(path.join(compiled, "desktop", file), path.join(stage, "desktop", file));
async function renderer(from, to) {
  await mkdir(to);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Renderer symlink");
    if (entry.isDirectory()) await renderer(path.join(from, entry.name), path.join(to, entry.name));
    else {
      if (!/\.(html|js|css|svg|png|woff2)$/.test(entry.name)) throw new Error("Unexpected renderer file");
      await copyFile(path.join(from, entry.name), path.join(to, entry.name));
    }
  }
}
await renderer(path.join(compiled, "renderer"), path.join(stage, "renderer"));
const compiledHashes = { ...await inventory(path.join(stage, "desktop"), "desktop/"), ...await inventory(path.join(stage, "renderer"), "renderer/") };
const js = (await readdir(path.join(stage, "renderer/assets"))).filter(name => name.endsWith(".js"));
const bundle = (await Promise.all(js.map(file => readFile(path.join(stage, "renderer/assets", file), "utf8")))).join("\n");
for (const value of [identity.buildId, "Stage 2 N01/N02", "office-workspace", unified ? "업무 입력" : "AI 중심", "앱 내 뒤로"])
  if (!bundle.includes(value)) throw new Error("Required identity/N01/N02 missing from renderer: " + value);
if (readability || unified) {
  for (const value of ["office-members-table-scroll", "회원표 가로 스크롤", "auto hidden"])
    if (!bundle.includes(value)) throw new Error("Readability fix missing from renderer: " + value);
  const css = (await Promise.all((await readdir(path.join(stage, "renderer/assets")))
    .filter(file => file.endsWith(".css")).map(file => readFile(path.join(stage, "renderer/assets", file), "utf8")))).join("\n");
  for (const value of ["office-members-table-scroll", "min-width:848px", "word-break:keep-all", unified ? "office-dock-log" : "office-workspace-footnote"])
    if (!css.includes(value)) throw new Error("Readability fix missing from CSS: " + value);
}
if (unified) {
  for (const value of ["office-dock-input", finalLayout ? "전송 불가 · 첨부는 로컬 선택만" : "전송 불가: AI가 아직 연결되지 않았습니다.", "메뉴 접기"])
    if (!bundle.includes(value)) throw new Error("Unified layout missing from renderer: " + value);
  for (const value of ["office-workspace-divider", "Side Workspace", "AI 중심"])
    if (bundle.includes(value)) throw new Error("Obsolete layout still in renderer: " + value);
}
if (manager) {
  for (const value of ["AI 매니저", "파일 선택", "크게 보기", "원래 크기", "검증본·인증 진단"])
    if (!bundle.includes(value)) throw new Error("Manager UI missing: " + value);
  for (const value of ["합성 검증 요청", "synthetic-only"])
    if (bundle.includes(value)) throw new Error("Synthetic task leaked into product bundle: " + value);
}
if (finalLayout) {
  for (const value of ["office-dock-footer", "office-breadcrumb-current", "첨부 도움말", "파일 안내", "사용 범위"])
    if (!bundle.includes(value)) throw new Error("Final layout missing from renderer: " + value);
  const css = (await Promise.all((await readdir(path.join(stage, "renderer/assets")))
    .filter(file => file.endsWith(".css")).map(file => readFile(path.join(stage, "renderer/assets", file), "utf8")))).join("\n");
  if (/\.office-dock-log\{[^}]*max-height:/.test(css)) throw new Error("Normal processing area still capped");
}
const pkg = JSON.parse(await readFile(path.join(dashboard, "package.json"), "utf8"));
await fresh(path.join(stage, "package.json"), {
  name: "swimnote-office", productName: "SWIMNOTE OFFICE", version: pkg.version,
  // Packager strips the build-only "private" key. Omit it here for strict byte-for-byte verification.
  type: "commonjs", main: "desktop/main.cjs",
});
await fresh(path.join(stage, "verification-source.json"), identity);
await fresh(path.join(stage, "verification-artifacts.json"), { source: identity, files: compiledHashes });
const stageHashes = await inventory(stage);
await frozen();
await fresh(path.join(output, "windows-package-attempt.json"), { source: identity, packagerInvocations: 1 });
const paths = await packager({
  dir: stage, out: output, name: "SwimnoteOffice", executableName: "SwimnoteOffice",
  platform: "win32", arch: "x64", electronVersion: pkg.devDependencies.electron.replace(/^[~^]/, ""),
  asar: true, overwrite: false, prune: false,
  win32metadata: { CompanyName: "SWIMNOTE", FileDescription: "SWIMNOTE OFFICE Stage 2 N01/N02 internal verification" },
});
if (paths.length !== 1) throw new Error("Expected exactly one Windows package");
const payload = paths[0], archive = path.join(payload, "resources/app.asar");
const entries = asar.listPackage(archive).map(entry => entry.replaceAll("\\", "/").replace(/^\/+/, ""));
for (const entry of entries)
  if (!["desktop", "renderer", "renderer/assets"].includes(entry) && !Object.hasOwn(stageHashes, entry))
    throw new Error("Unexpected ASAR entry: " + entry);
for (const [file, hash] of Object.entries(stageHashes))
  if (sha(asar.extractFile(archive, file)) !== hash) throw new Error("ASAR/compiled mismatch: " + file);
const executable = await readFile(path.join(payload, "SwimnoteOffice.exe"));
const pe = executable.readUInt32LE(0x3c);
if (executable.toString("ascii", 0, 2) !== "MZ" || executable.readUInt32LE(pe) !== 0x4550 ||
    executable.readUInt16LE(pe + 4) !== 0x8664 || executable.readUInt16LE(pe + 24) !== 0x20b)
  throw new Error("Expected AMD64 PE32+ runtime");
const readme = `SWIMNOTE OFFICE Stage 2 ${unified ? "통합 업무 레이아웃" : "N01/N02"} — 내부 검증용 unsigned Windows x64
검증본 ID: ${identity.buildId}
HEAD: ${identity.head}
DIFF ID: ${identity.diffId}

제작·전달 PASS와 Windows UI 수용 PASS는 별개입니다. AI 영역은 연결 전이며 채팅·모델 호출·업무 실행 기능이 없습니다.
화면 상단 검증본 ID와 STAGE2-SOURCE.json의 ID를 대조하세요. Shell F03 표시는 기반 Shell 단계이며 새 검증본 ID와 구분합니다.

전달 ZIP을 모두 같은 새 폴더에 압축 해제하고 START-STAGE2.cmd를 실행합니다.
CMD는 SHA-256 확인·압축 해제·폴더 열기만 합니다. 설치 EXE는 자동 실행하지 않습니다.
기존 ZIP/출력 폴더·조각 누락·해시 불일치면 STOP합니다.
기존 OFFICE를 정상 종료한 뒤 SWIMNOTE-OFFICE-STAGE2-Setup.exe를 일반 사용자로 직접 실행하세요.
관리자 실행·Defender/SmartScreen 해제·보안정책 변경은 하지 마세요. 보안 차단 시 중단하세요.
기존 F06의 사용자별 설치 경로·아이콘·실행 중 설치 차단·재설치·제거 정책을 유지합니다.
재설치·제거는 공유 userData 설정·암호화 인증정보를 보존합니다. 인증정보 제거는 앱의 명시적 로그아웃으로 수행합니다.
설치·제거·로그인 유지 전체 검사는 반복하지 않습니다. 로그인이 필요하면 기존 절차만 사용하세요.

현재 Windows 버전과 디스플레이 배율(%)을 먼저 기록하고 아래만 조회로 확인하세요.
${finalLayout ? `1. AI 크기 변경 때 업무 영역·회원 상세가 가려지지 않고 실제 공간이 줄어드는지.
2. 접기·크게 보기·원래 크기 복원과 입력창 하단 위치, 큰 빈 여백이나 잘린 문구가 없는지.
3. 메뉴·초안·로컬 첨부·검색/필터·선택·스크롤 유지와 클릭/키보드로 파일 안내 접근.
4. 홈 현황·회원목록 앞 검은 세로줄의 잔존 여부.
첨부는 최대 5개, 파일당 10MiB, 합계 25MiB의 로컬 선택이며 실제 읽기·업로드·보관·AI·업무 실행은 없습니다.
Windows 버전·실제 배율과 변경 항목만 확인합니다. 기존 인증·설치·제거 전체 검사는 반복하지 않습니다.` : manager ? `1. AI 매니저 카드: 드래그·키보드 높이 조절, 접기/펼치기·크게 보기/복원, 초안·로컬 첨부 유지. 버튼/Enter 미연결 전송 차단, Shift+Enter·한글 IME 확인.
2. 상단 진단·Sidebar AI 매니저 포커스와 공통 클릭 표시: hover/pressed/선택/키보드 포커스/실제 disabled. 정상 진단은 접히고 필요한 장애 표시는 유지.
3. 넓은/중간/좁은/낮은 창의 회원표·보기·Drawer·독립 스크롤 및 메뉴 왕복 상태 보존.
첨부는 최대 5개, 파일당 10MiB, 합계 25MiB의 로컬 선택일 뿐입니다. 파일 읽기·업로드·분석·보관·AI·업무 실행은 연결하지 않았습니다.
작업 카드의 상태·결과 열람은 합성 fixture에서만 검증했습니다. 실제 완료 사례가 아닙니다.
기존 인증·설치 수명주기 전체 검사를 반복하지 않습니다.` : unified ? `1. 전체 배치와 좁은 창 가독성: Sidebar 접기/펼치기, 기존 홈·회원·상세 위/처리 영역·입력창 아래 배치, 홈 4/2/1열, 회원표 내부 가로 스크롤과 보기 접근.
2. 메뉴 이동·검색/필터·상세·스크롤 상태 보존: 홈↔회원, 뒤로/앞으로·Breadcrumb, 선택 회원·Drawer와 가로/세로 스크롤.
3. 하단 입력 유지·독립 스크롤: 메뉴 이동·접기 후 초안·포커스 유지, 업무·처리 영역 독립 스크롤, 작은/낮은 창 입력 가림 없음.
입력은 가능하지만 AI 미연결 전송은 차단됩니다. 실제 AI·쓰기 기능 완료가 아닙니다.
이미 통과한 인증·설치 수명주기 전체 검사는 다시 요구하지 않습니다.` : readability ? `1. AI 중심 모드에서 업무 패널을 좁혔을 때 이름·상태·날짜가 글자 단위로 세로 줄바꿈되지 않는지.
2. 표 내부 가로 스크롤로 오른쪽 ‘보기’까지 접근 가능한지.
3. 패널을 다시 넓히면 표가 정상 표시되는지.
이미 통과한 Navigation·상태 보존·모드 전환·패널 복원·설치 수명주기 전체 검사는 다시 요구하지 않습니다.` : `1. 회원 검색·상태/반 필터·스크롤·상세 선택 후 홈→회원 복귀 시 상태 보존.
2. 상세→뒤로→앞으로 및 Breadcrumb.
3. 메뉴 접기/펼치기·같은 메뉴 재선택 시 상태 보존.
4. 업무집중↔AI 중심 전환 시 같은 회원·조회 상태 유지.
5. Side Workspace 마우스 크기 조절·접기·복원.
6. 창을 좁혔을 때 업무/AI 전환·닫기·복원 조작.
7. 조절 막대에서 좌우 화살표·Home·End, 숨겨진 영역의 포커스 처리.`}
${readability || unified ? "배율은 실제 확인한 값만 기록합니다." : "100/125/150%는 실제 수행한 배율만 보고합니다."} 운영 회원정보 변경·테스트 회원 생성은 하지 않습니다.
결과는 항목별 PASS/FAIL/미실시와 현재 배율로 알려주세요. 화면 공유 시 개인정보를 가리세요.
비밀번호·PIN·TOTP·token·암호화 저장파일을 보내지 마세요.

미검증: 이번 Windows UI 수용·CMD→PowerShell 직접 실행, 운영 변경→SSE·편집 보호·저장 충돌,
Windows 11·서명·공개 배포. 서버/API/DB 변경·Render 배포·OTA·자동업데이트 없음.
`;
await fresh(path.join(payload, "STAGE2-SOURCE.json"), { ...identity, appId: APP_ID, installerVersion: "0.0.0.7" });
await fresh(path.join(payload, "STAGE2-READ-ME.txt"), readme);
const payloadHashes = await inventory(payload);
await fresh(path.join(output, "payload-manifest.json"), payloadHashes);
const folderName = "SWIMNOTE-OFFICE-STAGE2", deliveryFolder = path.join(output, folderName);
await mkdir(deliveryFolder);
const setup = "SWIMNOTE-OFFICE-STAGE2-Setup.exe", installer = path.join(deliveryFolder, setup);
const nsi = path.join(output, "installer.nsi");
await fresh(nsi, renderInstaller({ payloadDir: payload, outputFile: installer, packageId: identity.buildId,
  files: Object.keys(payloadHashes).sort(), stage: "STAGE2" }));
execFileSync("makensis", ["-PPO", nsi], { stdio: ["ignore", "ignore", "inherit"] });
await frozen();
await fresh(path.join(output, "installer-attempt.json"), { source: identity, installerInvocations: 1 });
run("makensis", ["-V3", nsi]);
const binary = await readFile(installer), offset = binary.readUInt32LE(0x3c);
if (binary.toString("ascii", 0, 2) !== "MZ" || binary.readUInt32LE(offset) !== 0x4550 ||
    binary.readUInt16LE(offset + 4) !== 0x14c) throw new Error("Invalid NSIS bootstrap");
const cert = offset + 24 + 96 + 4 * 8;
if (binary.readUInt32LE(cert) || binary.readUInt32LE(cert + 4)) throw new Error("Unexpected installer signature");
run("7z", ["t", installer]);
const extracted = path.join(output, "extracted-verification");
run("7z", ["x", "-y", "-o" + extracted, installer]);
const extractedHashes = await inventory(extracted);
for (const [file, hash] of Object.entries(payloadHashes))
  if (Object.entries(extractedHashes).filter(([name, value]) => (name === file || name.endsWith("/" + file)) && value === hash).length !== 1)
    throw new Error("Installer payload mismatch: " + file);
const installerHash = sha(binary);
await fresh(installer + ".sha256", `${installerHash}  ${setup}\n`);
for (const file of ["STAGE2-SOURCE.json", "STAGE2-READ-ME.txt"])
  await copyFile(path.join(payload, file), path.join(deliveryFolder, file));
const zipName = `SWIMNOTE-OFFICE-${identity.buildId}.zip`, zip = path.join(output, zipName);
run("zip", ["-q", "-0", "-r", zip, folderName], output);
run("unzip", ["-tq", zip]);
const zipHash = await hashFile(zip), zipBytes = (await stat(zip)).size;
await fresh(zip + ".sha256", `${zipHash}  ${zipName}\n`);
run("split", ["-b", String(80 * 1024 * 1024), "-d", "--numeric-suffixes=1", "--suffix-length=2", zip, zip + ".part"]);
const parts = (await readdir(output)).filter(name => name.startsWith(zipName + ".part")).sort();
const reassembled = createHash("sha256");
for (const part of parts) for await (const chunk of createReadStream(path.join(output, part))) reassembled.update(chunk);
if (reassembled.digest("hex") !== zipHash) throw new Error("Part reassembly hash mismatch");
const command = assemblyCommand(zipName, parts, zipHash, identity.buildId + "-Windows", folderName, setup);
await fresh(path.join(output, "START-STAGE2.cmd"), command);
await fresh(path.join(output, "STAGE2-READ-ME.txt"), readme);
const delivery = [];
for (let i = 0; i < parts.length; i++) {
  const file = `SWIMNOTE-OFFICE-${identity.buildId}-DOWNLOAD-${i + 1}-of-${parts.length}.zip`;
  run("zip", ["-q", "-0", path.join(output, file), parts[i],
    ...(i === 0 ? ["START-STAGE2.cmd", "STAGE2-READ-ME.txt", zipName + ".sha256"] : [])], output);
  run("unzip", ["-tq", path.join(output, file)]);
  if ((await stat(path.join(output, file))).size > 100 * 1024 * 1024) throw new Error("Delivery limit exceeded");
  delivery.push({ file: path.relative(repo, path.join(output, file)), bytes: (await stat(path.join(output, file))).size,
    sha256: await hashFile(path.join(output, file)) });
}
// Verify the delivered envelopes, not only the pre-ZIP source parts.
const delivered = path.join(output, "delivery-extracted");
await mkdir(delivered);
for (const item of delivery) run("unzip", ["-q", path.join(repo, item.file), "-d", delivered]);
const joined = createHash("sha256");
for (const part of parts) for await (const chunk of createReadStream(path.join(delivered, part))) joined.update(chunk);
if (joined.digest("hex") !== zipHash || await readFile(path.join(delivered, "START-STAGE2.cmd"), "ascii") !== command)
  throw new Error("Delivered parts/CMD mismatch");
await frozen();
if (JSON.stringify(await oldSnapshot()) !== JSON.stringify(oldFiles)) throw new Error("Old outputs changed");
for (const [file, hash] of Object.entries(oldHashes))
  if (await hashFile(path.join(repo, file)) !== hash) throw new Error("Old delivery changed");
const result = {
  source: identity, installer: path.relative(repo, installer), bytes: binary.length, sha256: installerHash,
  archive: path.relative(repo, zip), archiveBytes: zipBytes, archiveSha256: zipHash, delivery,
  electronVersion: pkg.devDependencies.electron, payloadArchitecture: "AMD64 PE32+", unsigned: true,
  installerInvocations: 1, packagerInvocations: 1, compiledFilesVerified: Object.keys(compiledHashes).length,
  payloadFilesVerified: Object.keys(payloadHashes).length, sourceFreeze: "PASS", preservedOldOutputs: "PASS",
  compiledToAsarToInstaller: "PASS", excludedPrivateFiles: "PASS", deliveredPartsReassembly: "PASS",
  windowsUIAcceptance: "NOT VERIFIED", windowsCmdExecution: "NOT VERIFIED",
};
await fresh(path.join(output, "installer-result.json"), result);
console.log(JSON.stringify(result, null, 2));
