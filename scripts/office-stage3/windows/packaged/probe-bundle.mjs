/** Focused relocation/bundling probe only. Not the unchanged Linux acceptance suite. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { localCredentials } from "../normal/credentials.mjs";
const repo = path.resolve(import.meta.dirname, "../../../..");
const attempt = path.resolve(process.argv[2]);
if (!attempt.startsWith(path.join(repo, "generated-artifacts/office-windows-packaged-auth/")))
  throw new Error("Explicit new packaged build required");
const isolation = path.join(attempt, "isolation"), identity = JSON.parse(fs.readFileSync(path.join(isolation, "package-identity.json"), "utf8"));
const folder = path.join(attempt, "probe-run-" + crypto.randomBytes(12).toString("hex"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|HOME|TMPDIR|LANG)$/i.test(k)));
const wait = ms => new Promise(r => setTimeout(r, ms));
const run = (exe, args, options = {}) => {
  const result = spawnSync(exe, args, { env, encoding: "utf8", windowsHide: true, timeout: 30000, ...options });
  if (result.error || result.status !== 0) throw new Error("Probe command failed: " + path.basename(exe) + " output withheld");
  return result.stdout;
};
for (const port of [55440, 20411]) await new Promise((resolve, reject) => {
  const server = net.createServer(); server.once("error", reject);
  server.listen(port, "127.0.0.1", () => server.close(resolve));
});
fs.mkdirSync(folder, { mode: 0o700 });
const state = localCredentials(identity.parentId);
for (const [name, data] of Object.entries({
  "private.json": state, "prepared.json": { candidateId: identity.parentId },
  "fault-control.json": { writes: true, dropNext: false, failRead: null },
})) fs.writeFileSync(path.join(folder, name), JSON.stringify(data), { flag: "wx", mode: 0o600 });
const pw = path.join(folder, "init-password.txt");
fs.writeFileSync(pw, state.dbPassword + "\n", { flag: "wx", mode: 0o600 });
run("initdb", ["-D", path.join(folder, "db"), "-U", "office_fixture", "--encoding=UTF8",
  "--locale=C", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--pwfile=" + pw]);
fs.unlinkSync(pw);
let db, api;
const steps = [];
const sql = (database, input) => run("psql", ["-X", "-w", "-v", "ON_ERROR_STOP=1",
  "-h", "127.0.0.1", "-p", "55440", "-U", "office_fixture", "-d", database], {
  input, env: { ...env, PGPASSWORD: state.dbPassword, PGCLIENTENCODING: "UTF8" },
});
try {
  db = spawn("postgres", ["-D", path.join(folder, "db"), "-h", "127.0.0.1", "-p", "55440",
    "-k", ""], { env, stdio: "ignore" });
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { sql("postgres", "SELECT 1"); ready = true; break; } catch { await wait(100); }
  }
  assert.equal(ready, true);
  sql("postgres", "CREATE DATABASE office_stage3_acceptance;");
  sql("office_stage3_acceptance", "BEGIN;\n" + fs.readFileSync(path.join(isolation, "schema.sql"), "utf8") + "\nCOMMIT;");
  run(process.execPath, [path.join(isolation, "normal-seed.mjs"), "--isolated-only", "--run", folder]);
  steps.push("Relocated dependency-bundled seed initializes isolated schema without node_modules");
  const session = "probe-" + crypto.randomBytes(12).toString("hex");
  api = spawn(process.execPath, [path.join(isolation, "normal-entry.mjs"), "--isolated-only",
    "--run", folder, "--session", session], { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      const body = await (await fetch("http://127.0.0.1:20411/isolation/status")).json();
      assert.equal(body.session, session); assert.equal(body.candidateId, identity.parentId);
      assert.equal(body.paidCalls, 0); ready = true; break;
    } catch { await wait(100); }
  }
  assert.equal(ready, true);
  steps.push("Relocated dependency-bundled API returns matching startup session and candidate identity");
  const call = async (route, body, token) => {
    const response = await fetch("http://127.0.0.1:20411/api" + route, {
      method: body ? "POST" : "GET", headers: {
        Origin: "app://office", ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200, "Expected successful synthetic auth call");
    return response.json();
  };
  const account = state.accounts[0];
  const login = await call("/auth/login", { email: account.identifier, password: account.password, web_login: true });
  assert.equal(login.web_pin_required, true);
  const pin = await call("/auth/web-pin/verify", { web_session: login.web_session, web_pin: account.pin });
  assert.equal(typeof pin.token, "string");
  await call("/auth/me", null, pin.token);
  steps.push("Bundled real login + PIN + authenticated me work without external package installation");
  const record = JSON.parse(fs.readFileSync(path.join(isolation, "replay-records.json"), "utf8"))[0];
  const interpreted = await call("/office/interpret", record.input, pin.token);
  assert.ok(interpreted);
  steps.push("Relocated replay-records path resolves; recorded model only, no paid SDK");
} finally {
  if (api?.exitCode === null) {
    api.send({ type: "stop-isolated-api" });
    for (let n = 0; n < 50 && api.exitCode === null; n++) await wait(100);
    assert.equal(api.exitCode, 0, "Owned API must exit gracefully through new IPC shutdown");
    steps.push("New parent IPC shutdown exits owned API cleanly");
  }
  if (db?.exitCode === null) {
    const pid = Number(fs.readFileSync(path.join(folder, "db/postmaster.pid"), "utf8").split("\n")[0]);
    assert.equal(pid, db.pid);
    run("pg_ctl", ["-D", path.join(folder, "db"), "stop", "-m", "fast", "-w", "-t", "15"]);
  }
  for (const port of [55440, 20411]) await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
const result = { packageId: identity.packageId, passed: true, platform: process.platform, node: process.version,
  scope: "Targeted new packaging/bundle relocation checks; NOT Windows/DPAPI/native acceptance",
  newPaidCalls: 0, steps, ownedServicesStopped: true };
fs.writeFileSync(path.join(attempt, "targeted-bundle-evidence.json"), JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result));
