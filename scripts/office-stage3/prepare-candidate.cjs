// Read-only git inspection + ignored outputs. No stage/commit/push, server import or network.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "generated-artifacts/office-stage3-safety");
const base = "e3018d51262091981b444fb30ab476520f45ddcd";
const previousHash = "a5c5903f36ebcf5ed9a9da8bb8080e6220955b876c4d02f819a108c1e808b36c";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const git = args => cp.execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
if (sha(fs.readFileSync(path.join(root, "generated-artifacts/office-stage3-preflight/server-candidate.patch"))) !== previousHash)
  throw new Error("Previous candidate was changed");
const runtime = [
  "artifacts/api-server/src/lib/office-command.ts", "artifacts/api-server/src/lib/office-interpret.ts",
  "artifacts/api-server/src/lib/office-legacy-guard.ts", "artifacts/api-server/src/lib/office-http.ts",
  "artifacts/api-server/src/lib/office-model.ts", "artifacts/api-server/src/routes/office.ts",
  "artifacts/api-server/src/routes/index.ts", "artifacts/api-server/src/routes/students.ts",
  "artifacts/api-server/src/routes/admin.ts",
];
const draft = "scripts/office-stage3/receipts.draft.sql";
const tracked = new Set(git(["ls-files"]).toString().split("\n"));
const chunks = [];
for (const file of [...runtime, draft]) {
  if (tracked.has(file)) chunks.push(git(["diff", "--binary", "--full-index", base, "--", file]));
  else {
    const r = cp.spawnSync("git", ["diff", "--no-index", "--binary", "--full-index", "--", "/dev/null", file], { cwd: root });
    if (r.status !== 1) throw new Error("Expected added-file diff: " + file);
    chunks.push(r.stdout);
  }
}
const patch = Buffer.concat(chunks), hash = sha(patch);
const previous = JSON.parse(fs.readFileSync(path.join(root, "generated-artifacts/office-stage3-preflight/candidate-manifest.json")));
for (const p of previous.unchangedPrerequisites) {
  if (sha(fs.readFileSync(path.join(root, p.file))) !== p.sha256 ||
      sha(git(["show", base + ":" + p.file])) !== p.sha256) throw new Error("Dependency drift: " + p.file);
}
const changes = git(["diff", "--name-only", base, "--", "artifacts/api-server/src"]).toString().trim().split("\n")
  .filter(f => f && !/\.test\.ts$/.test(f));
if (changes.some(f => !runtime.includes(f))) throw new Error("Unreviewed API runtime drift");
const describe = file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) });
const companions = [...new Set([
  ...git(["diff", "--name-only", "HEAD"]).toString().split("\n"),
  ...git(["ls-files", "--others", "--exclude-standard"]).toString().split("\n"),
])].filter(f => /^(artifacts\/swimnote-dashboard\/|lib\/api-|scripts\/office-stage3\/)/.test(f));
const manifest = {
  candidateId: "OFFICE-S3-SAFETY-" + hash.slice(0, 16), patchSha256: hash, patchBase: base,
  identityIsDeployableCommit: false, branch: git(["branch", "--show-current"]).toString().trim(),
  observedHead: git(["rev-parse", "HEAD"]).toString().trim(),
  previousCandidatePreserved: previousHash, priorHealthEvidenceOnly: previous.healthEvidence,
  runtimeServerFiles: runtime.map(describe), unappliedMigrationDraft: describe(draft),
  unchangedPrerequisites: previous.unchangedPrerequisites, companions: companions.map(describe),
  schema: "NEW RECEIPT TABLE REQUIRED; DRAFT ONLY; NO OPERATING EXECUTION",
  protocol: "server-issued os1_UUID; admission 5min; reconciliation 24h; missing row never admits execution",
  gates: { newExecutionDefault: false, aiDefault: false, receiptRead: "independent, current auth/role/Pool required",
    electronAndRendererWriteDefault: false },
  evidence: { reusedPriorTests: "155 + prior 45, historical evidence not whole-suite rerun",
    affectedCurrentTests: 69, actualModelCalls: 0, apiBaselineErrors: 1156, newNormalizedDiagnostics: 0 },
  hold: ["operating metadata/privilege/retention review and migration approval",
    "all relevant writers excluded from first acceptance DB/API", "real synthetic model acceptance",
    "product Windows native/auth/installer integrated acceptance", "approved source commit and deployment approval",
    "matching client/main/API/schema before any activation; old-server rollback may remove receipt endpoint"],
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "server-candidate.patch"), patch);
fs.writeFileSync(path.join(out, "candidate-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ candidateId: manifest.candidateId, sha256: hash, patchBytes: patch.length, runtimeFiles: runtime.length,
  draftFiles: 1, previousCandidatePreserved: true }));
