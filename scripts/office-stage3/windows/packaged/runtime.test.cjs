const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { IsolatedRuntime, cleanEnv, systemError, assertPlainDirectory, BASE,
  classifyInitdbFailure, initdbInvocation, safeInitdbMessage, collectInitdbMessages,
  writeInitdbPassword, supportsUtf8ProcessCodePage } = require("./runtime.cjs");
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
  assert.equal(invocation.args[invocation.args.indexOf("-U") + 1], "office_fixture");
});
test("UTF8 process manifests require Windows 10 1903 or newer and never change system locale", () => {
  for (const version of ["10.0.18362", "10.0.19045", "10.0.22631"])
    assert.equal(supportsUtf8ProcessCodePage(version), true);
  for (const version of ["10.0.17763", "6.3.9600", "unknown"])
    assert.equal(supportsUtf8ProcessCodePage(version), false);
});
test("initdb errors emit known categories, progress and constrained messages, never raw output", () => {
  const secret = "UNSHAREABLE-TEST-SECRET";
  const result = classifyInitdbFailure({
    stdout: "creating subdirectories ... ok\nrunning bootstrap script ... ok\nperforming post-bootstrap initialization ...",
    stderr: `child process was terminated by exception 0xC0000005\n${secret}`,
  });
  assert.equal(result.category, "INITDB_CHILD_EXCEPTION");
  assert.equal(result.phase, "POST_BOOTSTRAP");
  assert.equal(result.exception, "0XC0000005");
  assert.deepEqual(result.messages, []);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(classifyInitdbFailure({ stderr: `initdb: error: could not open file "C:/합성/init-password.txt" for reading: No such file or directory` }).category, "INITDB_PASSWORD_FILE_UNREADABLE");
  assert.equal(classifyInitdbFailure({ stderr: 'could not open file "share/postgres.bki" for reading: No such file' }).category, "INITDB_INPUT_FILE_UNREADABLE");
  assert.equal(classifyInitdbFailure({ stderr: "program postgres was not the same version as initdb" }).category, "POSTGRES_VERSION_CHECK_FAILED");
  assert.equal(classifyInitdbFailure({ stderr: "unknown output " + secret }).category, "INITDB_UNCLASSIFIED");
});
test("encoding category is a text classification, not proof of a path or locale cause", () => {
  for (const phrase of ["invalid byte sequence", "character x has no equivalent", "could not convert to UTF8"]) {
    assert.equal(classifyInitdbFailure({ stderr: phrase }).category, "INITDB_ENCODING_FAILED");
  }
  const r = runtime();
  r.stage = "prepare-initdb";
  const initdb = classifyInitdbFailure({
    stdout: "running bootstrap script ... ok\nperforming post-bootstrap initialization ...",
    stderr: '2026-10-17 [123] FATAL: invalid byte sequence for encoding "UTF8": 0xb0 0xa1\nchild process exited with exit code 1',
  });
  const result = r.diagnose({ code: "LOCAL_COMMAND_FAILED", tool: "initdb.exe", exitCode: 1, initdb });
  const data = JSON.parse(fs.readFileSync(result.file));
  assert.equal(data.initdbCategory, "INITDB_ENCODING_FAILED");
  assert.equal(data.initdbPhase, "POST_BOOTSTRAP");
  assert.deepEqual(data.initdbMessages, [
    { stream: "stderr", severity: "FATAL", text: 'invalid byte sequence for encoding "UTF8": 0xb0 0xa1' },
    { stream: "stderr", severity: "CHILD", text: "child process exited with exit code 1" },
  ]);
  assert.equal(data.initdbCapture.incomplete, false);
  assert.equal(data.initdbCapture.stderrBytes > 0, true);
});
test("password bytes are ASCII UTF8 without BOM and with a single LF; invalid values fail closed", () => {
  const file = path.join(root, "password-format-test");
  writeInitdbPassword(file, "A".repeat(43));
  assert.deepEqual(fs.readFileSync(file), Buffer.from("A".repeat(43) + "\n", "ascii"));
  assert.throws(() => writeInitdbPassword(file + "-invalid", "한글\r\npassword"), { code: "INITDB_PASSWORD_FORMAT_REJECTED" });
  assert.equal(fs.existsSync(file + "-invalid"), false);
});
test("message excerpts exclude credentials, paths, SQL, connection strings, identifiers and nonASCII text", () => {
  const secret = "TEST_SECRET_abcdefgh", pin = "9876";
  const messages = collectInitdbMessages({ stderr: [
    `FATAL: could not open file "C:\\Users\\홍길동\\${secret}": Permission denied`,
    `DETAIL: character "${secret}" has no equivalent in encoding "UTF8"`,
    `ERROR: ${pin} Bearer ${secret}`,
    `ERROR: ALTER USER fixture_pool WITH PASSWORD '${secret}'`,
    `ERROR: postgresql://user:${secret}@remote.example.invalid/db`,
    `HINT: unrecognized arbitrary words ${secret} ${pin} 홍길동 C:\\Users\\개인\\DB`,
    'CONTEXT: COPY information_schema.sql_features, line 1',
    `STATEMENT: ALTER USER fixture_pool WITH PASSWORD '${secret}'`,
  ].join("\n") }, [secret, pin]);
  const text = JSON.stringify(messages);
  for (const value of [secret, pin, "홍길동", "C:\\", "fixture_pool", "remote.example", "개인", "arbitrary", "STATEMENT", "CONTEXT"])
    assert.equal(text.includes(value), false, value);
  assert.equal(text.includes("could not open file"), true);
  assert.equal(text.includes("has no equivalent in encoding"), true);
});
test("capture is bounded, preserves stream and severity, reports incomplete capture, and re-sanitizes at export", () => {
  const result = classifyInitdbFailure({ stdout: "ERROR: " + "unknown ".repeat(2000),
    stderr: Array(20).fill("FATAL: could not read file 'private'").join("\n"), error: { code: "ENOBUFS" } });
  assert.equal(result.messages.length, 8);
  assert.equal(result.capture.incomplete, true);
  assert.equal(result.messages.every(m => m.stream === "stderr" && m.text.length <= 240), true);
  const r = runtime(), secret = "PRIVATE-PASSWORD";
  r.credentials = { dbPassword: secret, pin: "1234" };
  const output = r.diagnose({ code: "LOCAL_COMMAND_FAILED", initdb: {
    messages: [{ stream: "stderr", severity: "FATAL", text: `could not open "${secret}" 1234` },
      { stream: secret, severity: "ERROR", text: secret }],
    capture: { stdoutBytes: secret, stderrBytes: -1, incomplete: secret },
  } });
  const text = fs.readFileSync(output.file, "utf8");
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("1234"), false);
});
test("known secrets are removed even when they match an error-vocabulary or encoding token", () => {
  assert.equal(JSON.stringify(safeInitdbMessage('FATAL: invalid byte sequence for encoding "UTF8": 0xff', ["UTF8"])).includes("UTF8"), false);
  assert.equal(JSON.stringify(safeInitdbMessage("ERROR: could not open password", ["password"])).includes("password"), false);
});
test("supervisor captures a failed initdb command without selecting or reusing its incomplete DB (simulated child, NOT Windows execution)", async () => {
  const vm = require("node:vm");
  const local = fs.mkdtempSync(path.join(root, "supervisor-한글 space-"));
  const resources = path.join(local, "resources");
  fs.mkdirSync(path.join(resources, "isolation"), { recursive: true });
  fs.writeFileSync(path.join(resources, "isolation/runtime-manifest.json"), "{}");
  const credentials = { candidateId: BASE, dbPassword: "A".repeat(43), jwtKey: "B".repeat(96),
    accounts: [{ id: "synthetic", password: "C".repeat(43), pin: "9876" }] };
  let invocations = 0;
  const module = { exports: {} };
  const sandbox = {
    module, Buffer, setTimeout, setInterval, clearInterval,
    process: { platform: "win32", arch: "x64", version: "simulated", pid: 321, env: {
      SYSTEMROOT: path.join(local, "Windows"), LOCALAPPDATA: local, PGPASSWORD: "INHERITED_PRIVATE",
      DATABASE_URL: "OPERATING_PRIVATE", NODE_OPTIONS: "--unsafe",
    } },
    require(name) {
      if (name === "../normal/credentials.mjs") return { localCredentials: () => credentials };
      if (name === "node:os") return { release: () => "10.0.22631" };
      if (name === "node:net") return { createServer: () => ({
        once() {}, listen(_port, _host, callback) { callback(); }, close(callback) { callback(); },
      }) };
      if (name === "node:child_process") return {
        spawn() { throw new Error("No DB/API may start after initdb failure"); },
        spawnSync(executable, args, options) {
          if (path.basename(executable) === "whoami.exe") return { status: 0, stdout: "S-1-5-21-1234", stderr: "" };
          if (path.basename(executable) === "icacls.exe") return { status: 0, stdout: "", stderr: "" };
          assert.equal(path.basename(executable), "initdb.exe");
          invocations++;
          assert.equal(options.env.LANG, "C");
          assert.equal(options.env.LC_ALL, "C");
          for (const key of ["PGCLIENTENCODING", "PGPASSWORD", "DATABASE_URL", "NODE_OPTIONS"])
            assert.equal(options.env[key], undefined);
          assert.equal(options.diagnosticSecrets, undefined);
          assert.equal(args.includes("--encoding=UTF8"), true);
          assert.deepEqual(fs.readFileSync(path.join(options.cwd, "init-password.txt")),
            Buffer.from(credentials.dbPassword + "\n", "utf8"));
          fs.mkdirSync(path.join(options.cwd, "db"));
          fs.writeFileSync(path.join(options.cwd, "db/failed-evidence"), "retain");
          return { status: 1,
            stdout: "running bootstrap script ... ok\nperforming post-bootstrap initialization ...",
            stderr: `FATAL: invalid byte sequence for encoding "UTF8": 0xb0 0xa1\nDETAIL: "${credentials.dbPassword}" 9876\nchild process exited with exit code 1` };
        },
      };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "runtime.cjs"), "utf8"), sandbox);
  const Runtime = module.exports.IsolatedRuntime;
  const r = new Runtime({ resources, localData: local, identity });
  let failure;
  try { await r.start(); } catch (error) { failure = error; }
  assert.equal(failure.code, "LOCAL_COMMAND_FAILED");
  assert.equal(r.stage, "prepare-initdb");
  const diagnostic = r.diagnose(failure);
  const text = fs.readFileSync(diagnostic.file, "utf8"), data = JSON.parse(text);
  assert.equal(data.initdbMessages[0].text, 'invalid byte sequence for encoding "UTF8": 0xb0 0xa1');
  for (const value of [credentials.dbPassword, credentials.jwtKey, credentials.accounts[0].password, "9876", local])
    assert.equal(text.includes(value), false);
  assert.equal(data.lockRetained, false);
  assert.equal(data.initdbInputProfile.explicitAsciiRole, true);
  assert.equal(data.initdbInputProfile.runPathHasNonAscii, true);
  assert.equal(data.initdbInputProfile.effectiveProcessCodePage, "NOT_MEASURED");
  assert.equal(fs.existsSync(path.join(r.run, "init-password.txt")), false);
  assert.equal(fs.existsSync(path.join(r.run, "db/failed-evidence")), true);
  assert.equal(fs.existsSync(path.join(r.root, "selected-run.json")), false);
  assert.equal(fs.existsSync(path.join(r.run, "initialized.json")), false);
  const retry = new Runtime({ resources, localData: local, identity });
  await assert.rejects(retry.start(), { code: "INCOMPLETE_PREPARATION" });
  assert.equal(retry.diagnose({ code: "INCOMPLETE_PREPARATION" }).file, diagnostic.file);
  assert.equal(invocations, 1);
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
