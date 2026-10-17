import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { ROOT, sha, cleanEnv, vacant, verifyCandidate } from "./common.mjs";
import { replayModel } from "./replay.mjs";

const candidate = path.join(ROOT, "generated-artifacts/office-windows-isolated-prep/candidate-utf8");
const require = createRequire(path.join(ROOT, "artifacts/api-server/package.json"));
const esbuild = require("esbuild");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "office-win-tools-test-"));
fs.symlinkSync(path.join(ROOT, "node_modules/.pnpm/node_modules"), path.join(temp, "node_modules"), "dir");
const appOutput = path.join(temp, "app.cjs");
await esbuild.build({
  entryPoints: [path.join(ROOT, "scripts/office-stage3/windows/api-app.ts")],
  outfile: appOutput, platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "silent",
});
const interpretOutput = path.join(temp, "interpret.cjs");
await esbuild.build({
  entryPoints: [path.join(ROOT, "artifacts/api-server/src/lib/office-interpret.ts")],
  outfile: interpretOutput, platform: "node", format: "cjs", bundle: true, logLevel: "silent",
});
const { diagnosticApp } = require(appOutput);
const { interpretOffice } = require(interpretOutput);

test("candidate inventory, overlay and original server hashes match", () => {
  const manifest = verifyCandidate(candidate);
  assert.equal(sha(fs.readFileSync(path.join(candidate, "desktop-verification-overlay.patch"))), manifest.overlayPatchSha256);
  const server = JSON.parse(fs.readFileSync(path.join(candidate, "server-candidate-manifest.json")));
  for (const item of server.runtimeServerFiles) {
    assert.equal(sha(fs.readFileSync(path.join(candidate, item.file))), item.sha256);
    assert.equal(sha(fs.readFileSync(path.join(ROOT, item.file))), item.sha256);
  }
  assert.equal(sha(fs.readFileSync(path.join(candidate, "pnpm-lock.yaml"))), manifest.standaloneLockSha256);
});
test("verification copy changes only fixed pins/gates; preload and token store unchanged", () => {
  const manifest = verifyCandidate(candidate);
  for (const name of ["preload.cts", "session-ipc.cts", "token-store.cts", "contracts.ts"]) {
    const file = "artifacts/swimnote-dashboard/desktop/" + name;
    assert.equal(sha(fs.readFileSync(path.join(candidate, file))), sha(fs.readFileSync(path.join(ROOT, file))));
  }
  const main = fs.readFileSync(path.join(candidate, "artifacts/swimnote-dashboard/desktop/main.cts"), "utf8");
  for (const marker of ["sandbox: true", "webSecurity: true", "contextIsolation: true", "isTrustedRendererURL", manifest.candidateId])
    assert.ok(main.includes(marker));
  assert.ok(!fs.readFileSync(path.join(ROOT, "artifacts/swimnote-dashboard/src/lib/office-stage3-policy.ts"), "utf8").includes("OFFICE_STAGE3_ACTIVE = true"));
});
test("standalone lock retains native Windows binaries; no inherited exclusions or Unix preinstall", () => {
  const lock = fs.readFileSync(path.join(candidate, "pnpm-lock.yaml"), "utf8");
  for (const name of ["@esbuild/win32-x64", "@rollup/rollup-win32-x64-msvc", "@tailwindcss/oxide-win32-x64-msvc"])
    assert.ok(lock.includes(name), name);
  const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json")));
  assert.equal(pkg.scripts?.preinstall, undefined);
  assert.equal(pkg.pnpm?.overrides, undefined);
});
test("recorded raw responses pass real interpretation; unmatched input never falls back", async () => {
  const model = replayModel(candidate);
  const records = JSON.parse(fs.readFileSync(path.join(candidate, "replay-records.json")));
  assert.equal(records.length, 6);
  assert.match(records[0].raw, /이름/);
  const first = await interpretOffice(model, records[0].input);
  assert.equal(first.kind, "search");
  assert.equal(first.search, "합성 검증 회원");
  for (const record of records) assert.equal((await interpretOffice(model, record.input)).kind, "search");
  await assert.rejects(model({ text: "unrecorded" }), /No exact recorded/);
});
test("clean child environment contains no DB/JWT/provider variable names", () => {
  const env = cleanEnv();
  assert.ok(!Object.keys(env).some(key => /SECRET|TOKEN|DATABASE|^PG|JWT|API_KEY/i.test(key)));
});
test("occupied ports are rejected, not terminated", async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await assert.rejects(vacant(server.address().port), /occupied/); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
test("Windows controller refuses Linux before starting or preparing anything", () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/office-stage3/windows/control.mjs"), "Prepare"],
    { encoding: "utf8", env: cleanEnv() });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Windows x64 only/);
});
test("PowerShell lifecycle surface is static only; no download/elevation/policy relaxation", () => {
  const ps = fs.readFileSync(path.join(ROOT, "scripts/office-stage3/windows/Office-Isolated.ps1"), "utf8");
  for (const action of ["Prepare", "Start", "Check", "Stop", "DeleteData", "LaunchDesktop"]) assert.ok(ps.includes(`"${action}"`));
  assert.ok(!/Invoke-WebRequest|Start-Process|RunAs|ExecutionPolicy\s+Bypass|iex\s+/i.test(ps));
  const control = fs.readFileSync(path.join(ROOT, "scripts/office-stage3/windows/control.mjs"), "utf8");
  assert.ok(control.includes('apiProcess.kill()'));
  assert.ok(!/taskkill|process\.kill\(/.test(control));
  assert.ok(control.includes('"--confirm-synthetic-data-deletion"'));
  assert.ok(control.includes('PGCLIENTENCODING: "UTF8"'));
});

test("actual isolated router fails closed for all auth/business paths and rejects bad origin/host", async t => {
  let sqlCalls = 0, modelCalls = 0;
  const pool = { query: () => { sqlCalls++; throw new Error("DB trap"); }, connect: () => { sqlCalls++; throw new Error("DB trap"); } };
  const app = diagnosticApp(pool, async () => { modelCalls++; throw new Error("No model"); }, "test-candidate");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = (route, method = "GET", overrides = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: route, method,
      headers: { Host: "127.0.0.1:20411", Origin: "app://office", "Content-Type": "application/json", ...overrides } }, res => {
      let body = ""; res.on("data", data => { body += data; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); if (method === "POST") req.write("{}"); req.end();
  });
  try {
    await t.test("diagnostic clearly reports auth HOLD and zero paid calls", async () => {
      const res = await request("/isolation/status");
      assert.equal(res.status, 200);
      assert.equal(JSON.parse(res.body).normalAuthReady, false);
      assert.equal(JSON.parse(res.body).paidCalls, 0);
      assert.equal(res.headers["access-control-allow-origin"], "app://office");
    });
    for (const [route, method] of [
      ["/api/auth/login", "POST"], ["/api/auth/me", "GET"], ["/api/office/interpret", "POST"],
      ["/api/office/requests", "POST"], ["/api/office/command", "POST"], ["/api/office/commands/os1_old", "GET"],
    ]) await t.test("auth barrier " + route, async () => {
      const res = await request(route, method, { Authorization: "Bearer old-fixture-or-token" });
      assert.equal(res.status, 503);
      assert.equal(JSON.parse(res.body).code, "ISOLATED_AUTH_NOT_READY");
    });
    await t.test("untrusted origin and alternate host rejected", async () => {
      assert.equal((await request("/isolation/status", "GET", { Origin: "null" })).status, 403);
      assert.equal((await request("/isolation/status", "GET", { Origin: "http://localhost:20412" })).status, 403);
      assert.equal((await request("/isolation/status", "GET", { Host: "localhost:20411" })).status, 403);
    });
    assert.equal(sqlCalls, 0); assert.equal(modelCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
