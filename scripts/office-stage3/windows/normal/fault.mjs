import fs from "node:fs";
import path from "node:path";
import { ROOT, assertRunDirectory, readJSON, cleanEnv } from "../common.mjs";
import { spawnSync } from "node:child_process";
const at = process.argv.indexOf("--run");
const folder = assertRunDirectory(process.argv[at + 1] ?? "");
const command = process.argv[2], value = process.argv[3];
const file = path.join(folder, "fault-control.json");
const config = readJSON(file);
if (command === "WritesOn") config.writes = true;
else if (command === "WritesOff") config.writes = false;
else if (command === "DropNextResponse") config.dropNext = true;
else if (command === "FailNextRead") config.failRead = "next";
else if (command === "FailMembersReadOn") config.failMembersRead = true;
else if (command === "FailMembersReadOff") config.failMembersRead = false;
else if (command === "DropResponse" || command === "FailRead") {
  if (!/^os1_[a-f0-9-]{36}$/.test(value ?? "")) throw new Error("Exact local request ID required");
  config[command === "DropResponse" ? "dropRequest" : "failRead"] = value;
} else if (command === "Clear") { config.dropRequest = null; config.dropNext = false; config.failRead = null; config.failMembersRead = false; }
else if (command === "StaleMemo") {
  if (value !== "fixture_member") throw new Error("Only the known synthetic member writer is allowed");
  const result = spawnSync(process.execPath, [path.join(ROOT, "build-evidence/normal-writer.mjs"), "--isolated-only", "--run", folder],
    { env: cleanEnv(), stdio: "ignore" });
  if (result.status !== 0) throw new Error("Synthetic writer failed");
  console.log("Synthetic memo revision changed; stale UI submission must conflict"); process.exit(0);
} else throw new Error("Unknown local fault command");
fs.writeFileSync(file + ".next", JSON.stringify(config), { mode: 0o600 });
fs.renameSync(file + ".next", file);
console.log("Local isolated fault setting updated; no credential or token logged");
