const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { IsolatedRuntime, cleanEnv, systemError, assertPlainDirectory, BASE,
  classifyInitdbFailure, initdbInvocation } = require("./runtime.cjs");
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
test("initdb uses ASCII relative arguments with a Unicode wide-character cwd and preserves partial data", () => {
  const run = "C:\\Users\\합성사용자\\AppData\\Local\\run-test";
  const invocation = initdbInvocation(run);
  assert.equal(invocation.cwd, run);
  assert.equal(invocation.args.includes(run), false);
  assert.equal(invocation.args.every(a => /^[\x20-\x7e]+$/.test(a)), true);
  assert.equal(invocation.args.includes("--pwfile=init-password.txt"), true);
  assert.equal(invocation.args[invocation.args.indexOf("-D") + 1], "db");
  assert.equal(invocation.args.includes("--no-clean"), true);
  assert.equal(invocation.args.includes("--auth-host=scram-sha-256"), true);
});
test("initdb errors emit only known categories and progress, never raw output", () => {
  const secret = "UNSHAREABLE-TEST-SECRET";
  const result = classifyInitdbFailure({
    stdout: "creating subdirectories ... ok\nrunning bootstrap script ... ok\nperforming post-bootstrap initialization ...",
    stderr: `child process was terminated by exception 0xC0000005\n${secret}`,
  });
  assert.deepEqual(result, { category: "INITDB_CHILD_EXCEPTION", phase: "POST_BOOTSTRAP", exception: "0XC0000005" });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(classifyInitdbFailure({ stderr: `initdb: error: could not open file "C:/합성/init-password.txt" for reading: No such file or directory` }).category, "INITDB_PASSWORD_FILE_UNREADABLE");
  assert.equal(classifyInitdbFailure({ stderr: 'could not open file "share/postgres.bki" for reading: No such file' }).category, "INITDB_INPUT_FILE_UNREADABLE");
  assert.equal(classifyInitdbFailure({ stderr: "program postgres was not the same version as initdb" }).category, "POSTGRES_VERSION_CHECK_FAILED");
  assert.equal(classifyInitdbFailure({ stderr: "unknown output " + secret }).category, "INITDB_UNCLASSIFIED");
});
test("arbitrary initdb fields cannot escape the diagnostic allowlist", () => {
  const r = runtime(), secret = "UNSHAREABLE-TEST-SECRET";
  const result = r.diagnose({ code: "LOCAL_COMMAND_FAILED", initdb: {
    category: secret, phase: secret, exception: secret, output: secret,
  } });
  const data = fs.readFileSync(result.file, "utf8");
  assert.equal(data.includes(secret), false);
});
test("selection is published only after a completed seed and ready API", () => {
  const r = runtime();
  fs.mkdirSync(r.root, { recursive: true });
  r.run = fs.mkdtempSync(path.join(r.root, "run-"));
  r.newPreparation = true;
  r.stage = "prepare-initdb";
  assert.throws(() => r.commitSelection(), { code: "INCOMPLETE_PREPARATION" });
  assert.equal(fs.existsSync(path.join(r.root, "selected-run.json")), false);
  fs.writeFileSync(path.join(r.run, "initialized.json"), JSON.stringify({ packageId: identity.packageId }));
  r.stage = "ready";
  r.commitSelection();
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.root, "selected-run.json"))).run, path.basename(r.run));
});
test("a later incomplete-preparation diagnostic links to the preserved first failure", () => {
  const own = fs.mkdtempSync(path.join(root, "first-evidence-"));
  const r = new IsolatedRuntime({ resources: root, localData: own, identity });
  r.newPreparation = true;
  r.stage = "prepare-initdb";
  const original = r.diagnose({ code: "LOCAL_COMMAND_FAILED", tool: "initdb.exe", exitCode: 1,
    initdb: { category: "INITDB_PASSWORD_FILE_UNREADABLE", phase: "BEFORE_BOOTSTRAP" } });
  const later = new IsolatedRuntime({ resources: root, localData: own, identity });
  const retry = later.diagnose({ code: "INCOMPLETE_PREPARATION" });
  assert.equal(retry.file, original.file);
  assert.equal(retry.code, "LOCAL_COMMAND_FAILED");
  assert.equal(retry.fromPriorPreparation, true);
  assert.equal(fs.readdirSync(path.dirname(original.file)).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(original.file)).initdbCategory, "INITDB_PASSWORD_FILE_UNREADABLE");
});
