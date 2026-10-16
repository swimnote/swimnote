import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repo = path.resolve(dashboard, "../..");
export const verificationStage = process.argv.includes("--stage2") ? "STAGE2"
  : process.argv.includes("--f06") ? "F06"
  : process.argv.includes("--f05-fix") ? "F05-FIX"
  : process.argv.includes("--f05") ? "F05" : "F03-F04";
export const output = path.join(repo, verificationStage === "STAGE2" ? (process.argv.includes("--unified")
  ? "generated-artifacts/office-stage2-unified-delivery" : process.argv.includes("--readability")
    ? "generated-artifacts/office-stage2-readability-delivery" : "generated-artifacts/office-stage2-n01-n02-delivery")
  : verificationStage === "F06" ? "generated-artifacts/office-f06" : verificationStage === "F05-FIX"
  ? "generated-artifacts/office-f05-fix" : verificationStage === "F05"
    ? "generated-artifacts/office-f05" : "generated-artifacts/office-f03-f04");
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repo });

export async function sourceIdentity() {
  const head = git(["rev-parse", "HEAD"]).toString().trim();
  const diff = git(["diff", "--binary", "HEAD", "--"]);
  const newFiles = git(["ls-files", "--others", "--exclude-standard", "-z", "--",
    "artifacts/swimnote-dashboard/desktop", "artifacts/swimnote-dashboard/src/desktop"])
    .toString().split("\0").filter(Boolean).sort();
  const untracked = [];
  for (const file of newFiles) {
    untracked.push({ path: file, sha256: sha(await readFile(path.join(repo, file))) });
  }
  const trackedDiffSha256 = sha(diff);
  const diffId = sha(JSON.stringify({ trackedDiffSha256, untracked }));
  return { head, trackedDiffSha256, untracked, diffId,
    buildId: `${verificationStage}-${head.slice(0, 12)}-${diffId.slice(0, 12)}`,
    scope: "HEAD plus tracked binary diff and explicitly listed untracked Desktop source; attachments and generated output excluded",
    apiSource: verificationStage.startsWith("F05") || verificationStage === "F06" || verificationStage === "STAGE2" ? "08ad801188848a54b563be096fa38776678711a9" : "e3018d51262091981b444fb30ab476520f45ddcd" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(output, { recursive: true });
  const identity = await sourceIdentity();
  await writeFile(path.join(output, "source-identity.json"), JSON.stringify(identity, null, 2) + "\n");
  await writeFile(path.join(output, "source-tracked.diff"), git(["diff", "--binary", "HEAD", "--"]));
  console.log(JSON.stringify(identity));
}
