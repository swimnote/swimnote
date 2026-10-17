/** Explicit allowlist export. Never checks out, resets, stages, commits or starts a service. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ROOT, readJSON, sha, verifyCandidate } from "./common.mjs";

const nameAt = process.argv.indexOf("--candidate-dir");
const candidateDir = nameAt < 0 ? "candidate" : process.argv[nameAt + 1];
if (!/^candidate(?:-[a-z0-9-]+)?$/.test(candidateDir ?? "")) throw new Error("Invalid new candidate directory name");
const output = path.join(ROOT, "generated-artifacts/office-windows-isolated-prep", candidateDir);
const git = args => execFileSync("git", args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
const serverRoot = path.join(ROOT, "generated-artifacts/office-stage3-search-recheck/candidate");
const sourceManifest = readJSON(path.join(serverRoot, "candidate-manifest.json"));
const tools = "scripts/office-stage3/windows";
const normalSources = [
  "artifacts/api-server/src/routes/auth.ts", "artifacts/api-server/src/routes/pools.ts",
  "artifacts/api-server/src/lib/auth.ts", "artifacts/api-server/src/middlewares/auth.ts",
  "artifacts/api-server/src/middlewares/rate-limit.ts", "artifacts/api-server/src/lib/auth-error-codes.ts",
  "artifacts/api-server/src/lib/xmode.ts", "artifacts/api-server/src/lib/event-logger.ts",
  "artifacts/api-server/src/config/ai-model-config.ts", "artifacts/api-server/src/migrations/pool-db-membership.ts",
  "artifacts/api-server/src/utils/filename.ts",
  "lib/db/src/schema/users.ts", "lib/db/src/schema/pools.ts", "lib/db/src/schema/parent-accounts.ts",
];
const walk = folder => fs.readdirSync(path.join(ROOT, folder), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(folder + "/" + entry.name) : [folder + "/" + entry.name]);
const put = (relative, bytes) => {
  const file = path.join(output, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx" });
};
if (process.argv.includes("--seal")) {
  if (fs.existsSync(path.join(output, "candidate-manifest.json"))) throw new Error("Candidate already sealed; preserve it");
  if (!fs.existsSync(path.join(output, "pnpm-lock.yaml"))) throw new Error("Standalone lockfile required");
  const draft = readJSON(path.join(output, "draft-manifest.json"));
  const evidence = readJSON(path.join(output, "normal-auth-evidence.json"));
  if (evidence.passed !== true || evidence.newPaidCalls !== 0) throw new Error("Actual normal authentication evidence required before sealing");
  for (const entry of evidence.sourceHashes ?? []) if (!draft.selectedSource.some(file => file.file === entry.file && file.sha256 === entry.sha256))
    throw new Error("Linux proof not from selected candidate source");
  const inventory = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", "build-evidence"].includes(entry.name)) return [];
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? inventory(file) : [file];
  });
  const files = inventory(output).sort().map(file => ({
    path: path.relative(output, file).replaceAll("\\", "/"), sha256: sha(fs.readFileSync(file)),
  }));
  put("candidate-manifest.json", JSON.stringify({ ...draft, files, normalAuthReady: true,
    authEvidenceSha256: sha(fs.readFileSync(path.join(output, "normal-auth-evidence.json"))),
    standaloneLockSha256: sha(fs.readFileSync(path.join(output, "pnpm-lock.yaml"))) }, null, 2) + "\n");
  verifyCandidate(output);
  console.log(JSON.stringify({ candidateId: draft.candidateId,
    manifestSha256: sha(fs.readFileSync(path.join(output, "candidate-manifest.json"))),
    overlayPatchSha256: draft.overlayPatchSha256, files: files.length }));
  process.exit(0);
}
if (fs.existsSync(output)) throw new Error("Candidate exists; never overwrite");
if (sourceManifest.candidateId !== "OFFICE-S3-SEARCH-3d1e7e03a84c9152" ||
    sha(fs.readFileSync(path.join(serverRoot, "server-candidate.patch"))) !== sourceManifest.patchSha256)
  throw new Error("Server candidate mismatch");
for (const entry of [...sourceManifest.runtimeServerFiles, sourceManifest.unappliedMigrationDraft, ...sourceManifest.unchangedPrerequisites])
  if (sha(fs.readFileSync(path.join(ROOT, entry.file))) !== entry.sha256)
    throw new Error("Server candidate or prerequisite drift: " + entry.file);
const dashboard = "artifacts/swimnote-dashboard";
const selection = [
  ...walk(dashboard + "/src").filter(file => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)),
  ...walk(dashboard + "/public"),
  ...walk(dashboard + "/desktop").filter(file => /(?:\.cts|\/contracts\.ts|\/tsconfig\.json)$/.test(file)),
  dashboard + "/desktop.html", dashboard + "/vite.desktop.config.ts",
  ...sourceManifest.runtimeServerFiles.map(entry => entry.file),
  ...normalSources,
  ...sourceManifest.unchangedPrerequisites.map(entry => entry.file),
  "scripts/office-stage3/receipts.draft.sql", "scripts/office-stage3/seed-isolated.sql", "scripts/office-stage3/search-seed.sql",
  ...walk(tools).filter(file => !/\.test\.mjs$/.test(file)),
];
const files = [...new Set(selection)].sort();
const original = files.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(ROOT, file))) }));
const candidateId = "OFFICE-WIN-AUTH-" + sha(JSON.stringify({ original, server: sourceManifest.patchSha256,
  origin: "http://127.0.0.1:20411", normalAuthReady: false })).slice(0, 16);
const transformations = [];
const changed = new Map();
function replace(file, source, from, to) {
  if (source.split(from).length !== 2) throw new Error("Expected exact single transform: " + file);
  transformations.push({ file, reason: from.includes("isAllowedAuthRequest") ? "Verification-only main gate"
    : from.includes("let mainWindow") ? "Separate userData and single-instance namespace"
    : "Verification-only fixed configuration" });
  return source.replace(from, to);
}
for (const file of files) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  let text = bytes.toString("utf8");
  if (file === dashboard + "/desktop/security.cts" || file === dashboard + "/desktop.html")
    text = replace(file, text, "https://swimnote-api.onrender.com", "http://127.0.0.1:20411");
  if (file === dashboard + "/desktop/main.cts") {
    text = replace(file, text, "isAllowedAuthRequest(details.url, details.method)", "isAllowedAuthRequest(details.url, details.method, true)");
    text = replace(file, text, "let mainWindow: BrowserWindow | null = null;",
      `// Verification copy ONLY: never touch installed product sessions.\napp.setName("${candidateId}");\napp.setPath("userData", path.join(app.getPath("appData"), "SwimNoteOffice-Windows-Isolated", "${candidateId}"));\nlet mainWindow: BrowserWindow | null = null;`);
  }
  if (file === dashboard + "/src/lib/office-stage3-policy.ts")
    text = replace(file, text, "OFFICE_STAGE3_ACTIVE = false", "OFFICE_STAGE3_ACTIVE = true");
  if (file === dashboard + "/vite.desktop.config.ts") {
    text = replace(file, text, "https://swimnote-api.onrender.com/api", "http://127.0.0.1:20411/api");
    text = replace(file, text, 'let verificationId = "개발 미지정";', `let verificationId = "${candidateId}";`);
    text = replace(file, text, '"dist-desktop/app/renderer"', '"../../build-evidence/app/renderer"');
  }
  if (text !== bytes.toString("utf8")) { changed.set(file, text); put(file, text); }
  else put(file, bytes);
}
for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", dashboard + "/package.json"])
  put("provenance/" + file, fs.readFileSync(path.join(ROOT, file)));
for (const file of ["package.json", "pnpm-lock.yaml", "candidate-manifest.json"])
  put("provenance/previous-windows/" + file, fs.readFileSync(path.join(ROOT,
    "generated-artifacts/office-windows-isolated-prep/candidate-utf8", file)));
put("server-candidate.patch", fs.readFileSync(path.join(serverRoot, "server-candidate.patch")));
put("server-candidate-manifest.json", fs.readFileSync(path.join(serverRoot, "candidate-manifest.json")));
const rows = fs.readFileSync(path.join(ROOT, "generated-artifacts/office-stage3-search-recheck/model-attempts.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const recorded = rows.filter(row => row.event === "response").map(row => {
  const attempt = rows.find(item => item.event === "attempt" && item.seq === row.seq);
  JSON.parse(row.raw);
  return { input: attempt.input, raw: row.raw, provenance: "Recorded real search recheck response; not fresh inference" };
});
if (recorded.length !== 6) throw new Error("Expected six preserved responses");
put("replay-records.json", JSON.stringify(recorded, null, 2) + "\n");

// Standalone tool workspace: no root Unix preinstall hook or Windows-native-package exclusions.
// Direct versions are copied from installed package metadata, never replaced with 'latest'.
const packageRoots = ["artifacts/swimnote-dashboard", "artifacts/api-server", "lib/db", "scripts", ""].map(dir =>
  createRequire(path.join(ROOT, dir, "package.json")));
function version(name) {
  for (const require of packageRoots) {
    try {
      let entry;
      try { entry = require.resolve(name + "/package.json"); }
      catch { entry = require.resolve(name); }
      let dir = path.dirname(entry);
      while (dir !== path.dirname(dir)) {
        const manifestFile = path.join(dir, "package.json");
        if (fs.existsSync(manifestFile)) {
          const pkg = readJSON(manifestFile);
          if (pkg.name === name) return pkg.version;
        }
        dir = path.dirname(dir);
      }
    } catch { /* Try the next existing workspace package, not a network fallback. */ }
  }
  throw new Error("Cannot establish installed version: " + name);
}
const dependencies = Object.fromEntries([
  "react", "react-dom", "wouter", "lucide-react", "xlsx", "zod", "clsx", "class-variance-authority", "tailwind-merge",
  "@radix-ui/react-slot", "@tanstack/react-query", "express", "express-rate-limit", "pg",
  "vite", "@vitejs/plugin-react", "@tailwindcss/vite", "tailwindcss", "typescript", "tsx", "esbuild", "electron",
  "@types/node", "@types/react", "@types/react-dom",
  "drizzle-orm", "drizzle-zod", "bcryptjs", "jsonwebtoken", "otplib", "qrcode", "multer",
].map(name => [name, version(name)]));
put("package.json", JSON.stringify({
  name: "swimnote-office-windows-isolated-tools", version: "0.0.0", private: true, type: "module",
  packageManager: "pnpm@10.26.1", engines: { node: ">=24.13.0 <25" }, dependencies,
}, null, 2) + "\n");
put("pnpm-workspace.yaml", "packages:\n  - .\nautoInstallPeers: false\nonlyBuiltDependencies: []\nsupportedArchitectures:\n  os: [win32, linux]\n  cpu: [x64]\n");
put(".npmrc", "ignore-scripts=true\nauto-install-peers=false\n");

// Patch only the derivative Desktop configuration, against the observed baseline.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "office-win-overlay-"));
const patches = [];
for (const [file, text] of changed) {
  for (const prefix of ["a", "b"]) fs.mkdirSync(path.dirname(path.join(temp, prefix, file)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), path.join(temp, "a", file));
  fs.writeFileSync(path.join(temp, "b", file), text);
  const result = spawnSync("git", ["diff", "--no-index", "--binary", "--", "a/" + file, "b/" + file], { cwd: temp });
  if (result.status !== 1) throw new Error("Overlay diff failed");
  patches.push(result.stdout.toString().replaceAll("a/a/" + file, "a/" + file).replaceAll("b/b/" + file, "b/" + file));
}
const overlay = patches.join("");
put("desktop-verification-overlay.patch", overlay);
const apply = path.join(temp, "apply");
fs.mkdirSync(apply);
for (const file of changed.keys()) {
  fs.mkdirSync(path.dirname(path.join(apply, file)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), path.join(apply, file));
}
execFileSync("git", ["apply", "--check", path.join(output, "desktop-verification-overlay.patch")], { cwd: apply });
put("draft-manifest.json", JSON.stringify({
  candidateId, baselineHead: git(["rev-parse", "HEAD"]).toString().trim(),
  branch: git(["branch", "--show-current"]).toString().trim(), selectedSource: original,
  serverCandidate: { id: sourceManifest.candidateId, patchSha256: sourceManifest.patchSha256,
    manifestSha256: sha(fs.readFileSync(path.join(serverRoot, "candidate-manifest.json"))) },
  overlayPatchSha256: sha(overlay), overlayApplyCheck: "PASS; temporary copy only",
  transformations, normalAuthReady: false, windowsExecution: "NOT RUN", normalSources,
  settings: { apiOrigin: "http://127.0.0.1:20411", rendererOrigin: "app://office",
    db: "127.0.0.1:55440/office_stage3_acceptance", rendererMainGates: "true in verification copy only",
    apiExecutionAndInterpretation: "Actual product auth; new local schema marker required; recorded-only model" },
  runtime: { hostNode: "24.13+ (24.x)", pnpm: "10.26.1", postgres: "16.10+ (16.x)",
    powershell: "7.4+", electron: dependencies.electron, versionBasis: "Existing installed package metadata; Windows not executed" },
  excluded: ["mobile", "ENGINE", "operating API entrypoint execution", "tracked dist", "node_modules", "secrets",
    "installer", "operating DB connection", "fixture auth alias"],
}, null, 2) + "\n");
console.log("Unsealed candidate prepared: " + candidateId + "\nResolve standalone lockfile explicitly, then --seal.");
