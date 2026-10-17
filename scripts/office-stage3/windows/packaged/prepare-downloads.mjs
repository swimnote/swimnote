/** Reuse existing built-in Windows joining flow; no development commands for users. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { assemblyCommand } from "../../../../artifacts/swimnote-dashboard/desktop/integration-delivery.mjs";
const repo = path.resolve(import.meta.dirname, "../../../..");
const attempt = path.resolve(process.argv[2]);
if (!attempt.startsWith(path.join(repo, "generated-artifacts/office-windows-packaged-auth/")))
  throw new Error("Only isolated output allowed");
const build = JSON.parse(fs.readFileSync(path.join(attempt, "build-result.json"), "utf8"));
const verified = JSON.parse(fs.readFileSync(path.join(attempt, "delivery-verification.json"), "utf8"));
if (build.sha256 !== verified.sha256) throw new Error("Delivery not verified");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const setup = path.join(repo, build.setup), folder = path.dirname(setup), basename = path.basename(setup);
const wrapper = path.join(attempt, build.packageId + "-installer.zip");
execFileSync("zip", ["-q", "-0", "-r", wrapper, path.basename(folder)], { cwd: attempt });
const archive = fs.readFileSync(wrapper), archiveSha256 = hash(wrapper);
const chunk = 80 * 1024 * 1024, parts = [];
for (let offset = 0, n = 1; offset < archive.length; offset += chunk, n++) {
  const name = path.basename(wrapper) + ".part" + String(n).padStart(2, "0");
  fs.writeFileSync(path.join(attempt, name), archive.subarray(offset, offset + chunk), { flag: "wx" });
  parts.push(name);
}
const cmd = "START-ISOLATED.cmd";
const code = assemblyCommand(path.basename(wrapper), parts, archiveSha256, "Isolated-Windows-Setup", path.basename(folder), basename);
fs.writeFileSync(path.join(attempt, cmd), code, { flag: "wx", encoding: "ascii" });
fs.copyFileSync(path.join(folder, "사용안내.txt"), path.join(attempt, "사용안내.txt"), fs.constants.COPYFILE_EXCL);
const delivery = [];
for (let i = 0; i < parts.length; i++) {
  const name = build.packageId + `-DOWNLOAD-${i + 1}-of-${parts.length}.zip`;
  const entries = i ? [parts[i]] : [parts[i], cmd, "사용안내.txt"];
  execFileSync("zip", ["-q", "-0", path.join(attempt, name), ...entries], { cwd: attempt });
  if (fs.statSync(path.join(attempt, name)).size > 100 * 1024 * 1024) throw new Error("Download part too large");
  delivery.push({ file: path.relative(repo, path.join(attempt, name)),
    bytes: fs.statSync(path.join(attempt, name)).size, sha256: hash(path.join(attempt, name)) });
}
fs.writeFileSync(path.join(attempt, "downloads.json"), JSON.stringify({
  packageId: build.packageId, installer: { file: build.setup, bytes: build.bytes, sha256: build.sha256 },
  wrapper: path.relative(repo, wrapper), archiveSha256, parts, delivery,
  windowsCmdPowerShellExecution: "NOT RUN; built-in joining only, no policy override or developer tool installation",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify(delivery));
