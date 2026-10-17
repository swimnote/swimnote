const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { IsolatedRuntime, cleanEnv, systemError, assertPlainDirectory, BASE } = require("./runtime.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-package-contract-"));
const identity = { packageId: "OFFICE-WIN-PACKAGED-contract", parentId: BASE };
const runtime = () => new IsolatedRuntime({ resources: root, localData: root, identity });

test("inherited operating credentials, Node injection and PATH are not passed to child tools", () => {
  assert.deepEqual(cleanEnv({ SYSTEMROOT: "C:\\Windows", LOCALAPPDATA: "C:\\local", PATH: "unsafe",
    JWT_SECRET: "secret", DATABASE_URL: "operating", NODE_OPTIONS: "--require evil", NODE_PATH: "bad",
    PGHOST: "remote", PGPASSWORD: "operating", OPENAI_API_KEY: "paid" }),
  { SYSTEMROOT: "C:\\Windows", LOCALAPPDATA: "C:\\local" });
});
test("embedded child PATH only contains the packaged PostgreSQL bin", () => {
  const r = runtime(), env = r.childEnv();
  assert.equal(env.PATH, path.join(root, "postgres", "bin"));
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.DATABASE_URL, undefined);
});
test("Linux cannot accidentally start this Windows supervisor", async () => {
  if (process.platform === "win32") return;
  const r = runtime();
  await assert.rejects(r.start(), { code: "WINDOWS_X64_REQUIRED" });
  assert.equal(fs.existsSync(r.root), false);
});
test("error diagnostics have an explicit credential-free field allowlist", () => {
  const r = runtime();
  const secret = "UNSHAREABLE-TEST-SECRET";
  r.credentials = { dbPassword: secret, accounts: [{ password: secret, pin: "9999" }] };
  const result = r.diagnose(Object.assign(new Error(secret), {
    code: "LOCAL_COMMAND_FAILED", stdout: secret, stderr: secret, stack: secret,
    nativeCode: "secret should not be copied", tool: "../" + secret, sql: secret, exitCode: 12,
  }));
  const text = fs.readFileSync(result.file, "utf8"), data = JSON.parse(text);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("secret should not be copied"), false);
  assert.equal(data.code, "LOCAL_COMMAND_FAILED");
  assert.equal(data.tool, undefined);
  assert.equal(data.exitCode, 12);
  assert.equal(data.nativeCode, "UNCLASSIFIED");
});
test("no stop command or process lookup occurs for absent child handles", async () => {
  const r = runtime();
  await r.stop();
  assert.equal(r.stage, "stopped");
});
test("API graceful stop is sent only to the owned ChildProcess IPC handle", async () => {
  const r = runtime(), messages = [];
  r.api = { pid: 123, exitCode: null, connected: true, send(message) {
    messages.push(message); this.exitCode = 0;
  }, kill() { throw new Error("Unexpected forced stop"); } };
  await r.stop();
  assert.deepEqual(messages, [{ type: "stop-isolated-api" }]);
});
test("postmaster PID mismatch rejects shutdown instead of stopping an unknown DB", async () => {
  const r = runtime();
  r.run = fs.mkdtempSync(path.join(root, "owned-run-"));
  fs.mkdirSync(path.join(r.run, "db"));
  fs.writeFileSync(path.join(r.run, "db/postmaster.pid"), "456\n");
  r.db = { pid: 123, exitCode: null };
  await assert.rejects(r.stop(), { code: "DB_OWNERSHIP_MISMATCH" });
});
test("reparse/symlink directories are rejected", () => {
  const actual = fs.mkdtempSync(path.join(root, "actual-")), link = path.join(root, "link");
  fs.symlinkSync(actual, link, "dir");
  assert.throws(() => assertPlainDirectory(link), { code: "UNSAFE_DIRECTORY" });
});
test("unknown free-text exception codes are not copied into diagnostics", () => {
  assert.equal(systemError({ code: "Authorization: Bearer private" }), "UNCLASSIFIED");
  assert.equal(systemError({ code: "EACCES" }), "EACCES");
});
