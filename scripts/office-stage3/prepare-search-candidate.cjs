// Explicit source allowlist only. No checkout/reset, staging, commit, operating server or network.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto"), os = require("node:os");
const root = path.resolve(__dirname, "../..");
const out = path.join(root, "generated-artifacts/office-stage3-search-recheck/candidate");
const base = "e3018d51262091981b444fb30ab476520f45ddcd";
const git = args => cp.execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
if (fs.existsSync(out)) throw new Error("Preserve candidate; choose an explicitly reviewed new candidate, never overwrite");
const previous = ["office-stage3-preflight", "office-stage3-safety"].map(dir => {
  const folder = path.join(root, "generated-artifacts", dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "candidate-manifest.json")));
  const actual = sha(fs.readFileSync(path.join(folder, "server-candidate.patch")));
  if (actual !== manifest.patchSha256) throw new Error("Previous patch/manifest mismatch");
  return { directory: dir, patchSha256: actual };
});
const baseline = JSON.parse(fs.readFileSync(path.join(root, "generated-artifacts/office-stage3-preflight/candidate-manifest.json")));
const runtime = [
  "artifacts/api-server/src/lib/office-command.ts", "artifacts/api-server/src/lib/office-interpret.ts",
  "artifacts/api-server/src/lib/office-search.ts", "artifacts/api-server/src/lib/office-legacy-guard.ts",
  "artifacts/api-server/src/lib/office-http.ts", "artifacts/api-server/src/lib/office-model.ts",
  "artifacts/api-server/src/routes/office.ts", "artifacts/api-server/src/routes/index.ts",
  "artifacts/api-server/src/routes/students.ts", "artifacts/api-server/src/routes/admin.ts",
];
const draft = "scripts/office-stage3/receipts.draft.sql";
const tracked = new Set(git(["ls-files"]).toString().split("\n"));
const diff = file => {
  if (tracked.has(file)) return git(["diff", "--binary", "--full-index", base, "--", file]);
  const r = cp.spawnSync("git", ["diff", "--no-index", "--binary", "--full-index", "--", "/dev/null", file], { cwd: root });
  if (r.status !== 1) throw new Error("Expected added source: " + file);
  return r.stdout;
};
const changed = git(["diff", "--name-only", base, "--", "artifacts/api-server/src"]).toString().split("\n")
  .filter(f => f && !/\.test\.tsx?$/.test(f));
if (changed.some(f => !runtime.includes(f))) throw new Error("Unreviewed runtime outside allowlist");
for (const dependency of baseline.unchangedPrerequisites)
  if (sha(fs.readFileSync(path.join(root, dependency.file))) !== dependency.sha256 ||
      sha(git(["show", base + ":" + dependency.file])) !== dependency.sha256) throw new Error("Dependency drift");
const patch = Buffer.concat([...runtime, draft].map(diff));
fs.mkdirSync(out, { recursive: true });
const patchFile = path.join(out, "server-candidate.patch");
fs.writeFileSync(patchFile, patch, { flag: "wx" });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "office-candidate-check-"));
const tar = git(["archive", base, "--", "artifacts/api-server/src"]);
cp.execFileSync("tar", ["-x", "-C", temp], { input: tar });
cp.execFileSync("git", ["apply", "--check", patchFile], { cwd: temp });
const describe = file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) });
for (const file of [...runtime, draft]) {
  const dest = path.join(out, "source", file); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, file), dest);
}
const hash = sha(patch), manifest = {
  candidateId: "OFFICE-S3-SEARCH-" + hash.slice(0, 16), patchSha256: hash, patchBase: base,
  identityIsDeployableCommit: false, observedHead: git(["rev-parse", "HEAD"]).toString().trim(),
  branch: git(["branch", "--show-current"]).toString().trim(), previousCandidatesPreserved: previous,
  applyCheckOnArchivedBase: "PASS; temporary directory only; not applied to workspace",
  runtimeServerFiles: runtime.map(describe), unappliedMigrationDraft: describe(draft),
  unchangedPrerequisites: baseline.unchangedPrerequisites,
  buildInputs: ["artifacts/api-server/build.ts", "artifacts/api-server/package.json", "pnpm-lock.yaml"].map(describe),
  executionPaths: {
    workspaceDev: "tsx ./src/index.ts",
    packageStart: "node dist/index.mjs",
    repositoryRenderBlueprint: "node_modules/.bin/tsx artifacts/api-server/src/index.ts",
    liveRenderConfiguration: "NOT QUERIED; operating access prohibited",
    decision: "Source execution does not need tracked dist. A dist-based launch requires rebuilding the approved source candidate before release.",
  },
  trackedDist: { ...describe("artifacts/api-server/dist/index.mjs"), included: false,
    reason: "Tracked dist predates this correction. Excluded from source candidate; only a reviewed dist-based launch needs regeneration. Repository Render blueprint uses source. Never treat this tracked bundle or all of HEAD as the candidate." },
  exclusions: ["all fixture/test auth/isolated addresses and runners", "mobile/ENGINE", "test files", "tracked dist/index.mjs",
    "full-workspace compiled evidence (not candidate payload)", "operating metadata/env/secrets"],
  gates: { renderer: false, electronMain: false, operatingNewExecutionDefault: false, operatingAIDefault: false,
    receiptRead: "independent, current authentication/role/Pool/owner required",
    isolatedAcceptance: "explicit process-only true; not a product switch" },
  hold: ["schema/privilege/retention approval", "legacy writer coverage boundary", "Windows product-auth integration",
    "approved baseline+patch build, review and deployment authorization; no commit created"],
};
fs.writeFileSync(path.join(out, "candidate-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ candidateId: manifest.candidateId, sha256: hash, runtimeFiles: runtime.length,
  migrationDrafts: 1, trackedDistIncluded: false, archivedBaseApplyCheck: "PASS", previousCandidatesPreserved: true }));
