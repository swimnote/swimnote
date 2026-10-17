const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { DatabaseMonitor, databaseReason } = require("./database-monitor.cjs");
const { windowsArgs, ownership, publicOwnership } = require("./database-ownership.cjs");
const { safeInitdbMessage, databaseInvocation, BASE } = require("./runtime.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-db-start-contract-"));
const secret = "PRIVATE_SYNTHETIC_TEST_PASSWORD";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function child(pid = 8348) {
  const value = new EventEmitter();
  Object.assign(value, { pid, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  value.stdout.setEncoding = value.stderr.setEncoding = () => {};
  value.kill = () => { throw new Error("Forced termination is prohibited in this test"); };
  return value;
}
test("startup log capture survives chunk boundaries, removes secrets and records close/exit separately", () => {
  const c = child(), monitor = new DatabaseMonitor(line => safeInitdbMessage(line, [secret]));
  monitor.attach(c);
  c.emit("spawn");
  c.stderr.emit("data", 'FATAL: could not open file "C:\\Users\\개인\\db": Permission denied\nDETAIL: "' + secret.slice(0, 10));
  c.stderr.emit("data", secret.slice(10) + '"\n');
  c.stdout.emit("data", "LOG: database system is ready to accept connections\n");
  c.exitCode = 1; c.emit("exit", 1, null); c.emit("close");
  const snapshot = monitor.snapshot(), text = JSON.stringify(snapshot);
  assert.equal(snapshot.failureKind, "EARLY_EXIT");
  assert.equal(snapshot.exitCode, 1);
  assert.equal(snapshot.outputClosed, true);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("개인"), false);
  assert.equal(text.includes("C:\\"), false);
  assert.equal(text.includes("Permission denied"), true);
  assert.equal(text.includes("ready to accept connections"), true);
});
test("spawn failures and signal exits are distinguished from readiness failures", () => {
  const failed = child(undefined); failed.pid = undefined;
  const monitor = new DatabaseMonitor(line => safeInitdbMessage(line));
  monitor.attach(failed); failed.emit("error", { code: "EACCES", message: secret });
  assert.equal(monitor.snapshot().failureKind, "SPAWN_ERROR");
  assert.equal(monitor.snapshot().nativeCode, "EACCES");
  const signaled = child(), other = new DatabaseMonitor(line => safeInitdbMessage(line));
  other.attach(signaled); signaled.emit("spawn"); signaled.signalCode = "SIGTERM"; signaled.emit("exit", null, "SIGTERM");
  assert.equal(other.snapshot().failureKind, "SIGNAL_EXIT");
  assert.equal(other.snapshot().signal, "SIGTERM");
});
test("logs are drained but retained output is bounded", () => {
  const monitor = new DatabaseMonitor(line => safeInitdbMessage(line));
  monitor.append("stderr", "FATAL: could not open file\n".repeat(2000));
  monitor.append("stdout", "x".repeat(100000));
  assert.equal(monitor.snapshot().messages.length, 24);
  assert.equal(monitor.pending.stdout.length <= 8192, true);
  assert.equal(monitor.snapshot().truncated, true);
});
test("readiness reports authentication, refusal, startup, configuration, port and timeout independently", () => {
  for (const [text, reason] of [
    ['FATAL: password authentication failed for user "synthetic"', "AUTHENTICATION_FAILED"],
    ["connection refused", "CONNECTION_REFUSED"], ["database system is starting up", "SERVER_STARTING"],
    ['invalid value for parameter "setting"', "CONFIGURATION_ERROR"],
    ["could not bind IPv4 socket: Address already in use", "PORT_IN_USE"],
  ]) assert.equal(databaseReason(text), reason);
  assert.equal(databaseReason("", "ETIMEDOUT"), "QUERY_TIMEOUT");
  const monitor = new DatabaseMonitor(line => safeInitdbMessage(line));
  monitor.probe("AUTHENTICATION_FAILED", { exitCode: 2, nativeCode: "ETIMEDOUT",
    databaseMessages: [{ severity: "FATAL", text: `password authentication failed for user "${secret}"` }] });
  assert.equal(monitor.snapshot().readiness.lastExitCode, 2);
  assert.equal(JSON.stringify(monitor.snapshot()).includes(secret), false);
});

const executable = "C:\\Users\\합성 사용자\\Programs\\postgres.exe";
const directory = "C:\\Users\\합성 사용자\\run\\db";
const args = databaseInvocation("unused").args;
const commandLine = [executable, ...args].map(s => '"' + s.replace(/"/g, '\\"') + '"').join(" ");
const now = Date.now();
const expected = { executable, directory, args, cwd: "C:\\Users\\합성 사용자\\run",
  packageId: "test-package", parentPid: 1234, requestedAt: now - 1000 };
const info = { state: "PRESENT", pid: 8348, parentPid: 1234, createdAtMs: now,
  executable, commandLine };
const pidFile = { pid: 8348, directory, startedMs: Math.floor(now / 1000) * 1000 };
test("Windows command-line parsing handles spaces, Unicode and quoted backslashes", () => {
  assert.deepEqual(windowsArgs(commandLine), [executable, ...args]);
  assert.deepEqual(windowsArgs('"C:\\program path\\postgres.exe" -D "C:\\run\\db"'), ["C:\\program path\\postgres.exe", "-D", "C:\\run\\db"]);
  assert.deepEqual(windowsArgs('"unterminated'), []);
});
test("read-only Windows process query supports copied SystemRoot spelling and decodes Unicode JSON", () => {
  let invoked = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "database-ownership.cjs"), "utf8"), {
    module, Buffer,
    require(name) {
      if (name === "node:child_process") return { spawnSync(exe, argv, options) {
        invoked++;
        assert.equal(exe.startsWith("C:\\Windows"), true);
        assert.equal(argv.includes("-NoProfile"), true);
        assert.equal(argv.at(-1).includes("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)"), true);
        assert.equal(options.env.OFFICE_PROBE_PID, "8348");
        assert.equal(options.windowsHide, true);
        assert.equal(options.timeout, 8000);
        return { status: 0, stdout: JSON.stringify({ ...info, createdAt: new Date(now).toISOString() }) };
      } };
      return require(name);
    },
  });
  const result = module.exports.processInfo(8348, { SystemRoot: "C:\\Windows" });
  assert.equal(result.state, "PRESENT");
  assert.equal(result.executable, executable);
  assert.equal(result.createdAtMs, now);
  assert.equal(module.exports.processInfo(8348, {}).state, "UNKNOWN");
  assert.equal(module.exports.processInfo("8348; Stop-Process", { SystemRoot: "C:\\Windows" }).state, "UNKNOWN");
  assert.equal(invoked, 1);
});
test("a matching live ChildProcess needs executable, start time, argv and data directory proof", () => {
  const c = child();
  assert.equal(ownership({ info, pidFile, expected, child: c, now }).verified, true);
  for (const altered of [
    { info: { ...info, executable: "C:\\other\\postgres.exe" } },
    { info: { ...info, createdAtMs: now + 60000 } },
    { info: { ...info, parentPid: 9999 } },
    { info: { ...info, commandLine: commandLine + " --single" } },
    { pidFile: { ...pidFile, directory: "C:\\other\\db" } },
    { pidFile: { ...pidFile, pid: 9999 } },
  ]) assert.equal(ownership({ info, pidFile, expected, child: c, now, ...altered }).verified, false);
});
test("legacy PID/path/time metadata without a captured ownership record does not authorize shutdown", () => {
  const result = ownership({ info, pidFile, expected, now });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "START_RECORD_MISSING");
});
test("persisted ownership rejects recycled PIDs, changed sessions, paths and argument hashes", () => {
  const record = { packageId: expected.packageId, session: "session-a", pid: info.pid, createdAtMs: info.createdAtMs,
    executable, directory, cwd: expected.cwd, argsHash: hash(JSON.stringify(args)) };
  const lock = { session: "session-a" };
  assert.equal(ownership({ info, pidFile, expected, record, lock, now }).verified, true);
  for (const changed of [
    { createdAtMs: now - 60000 }, { directory: "C:\\other\\db" }, { session: "other" }, { argsHash: "changed" },
    { packageId: "other" }, { cwd: "C:\\other" },
  ]) assert.equal(ownership({ info, pidFile, expected, record: { ...record, ...changed }, lock, now }).verified, false);
  const text = JSON.stringify(publicOwnership({ ...ownership({ info, pidFile, expected, record, lock, now }),
    commandLine, secret, reason: secret, executable, directory }));
  for (const value of [secret, "合成", "C:\\\\", commandLine]) assert.equal(text.includes(value), false);
});

function sandbox(mode = "exit") {
  const local = fs.mkdtempSync(path.join(root, "supervisor-"));
  const resources = path.join(local, "resources");
  fs.mkdirSync(path.join(resources, "isolation"), { recursive: true });
  fs.mkdirSync(path.join(resources, "postgres/bin"), { recursive: true });
  fs.writeFileSync(path.join(resources, "postgres/bin/postgres.exe"), "synthetic executable");
  fs.writeFileSync(path.join(resources, "isolation/runtime-manifest.json"),
    JSON.stringify({ "postgres/bin/postgres.exe": hash("synthetic executable") }));
  const credentials = { candidateId: BASE, dbPassword: "A".repeat(43), accounts: [], jwtKey: secret };
  const calls = [], module = { exports: {} };
  let db, r;
  const context = {
    module, Buffer, setTimeout: (fn, delay) => setTimeout(fn, Math.min(delay, 1)),
    setInterval: () => 1, clearInterval() {},
    process: { platform: "win32", arch: "x64", version: "simulated", pid: 1234,
      env: { SYSTEMROOT: path.join(local, "Windows"), LOCALAPPDATA: local } },
    require(name) {
      if (name === "../normal/credentials.mjs") return { localCredentials: () => credentials };
      if (name === "node:os") return { release: () => "10.0.22631" };
      if (name === "node:net") return { createServer: () => ({
        once() {}, listen(_port, _host, callback) { callback(); }, close(callback) { callback(); },
      }) };
      if (name === "node:child_process") return {
        spawn(exe, argv, options) {
          calls.push({ kind: "spawn", exe, argv, options });
          db = child();
          fs.writeFileSync(path.join(options.cwd, "db/postmaster.pid"),
            `${mode === "pid-mismatch" ? 9999 : db.pid}\n${path.join(options.cwd, "db")}\n${Math.floor(Date.now() / 1000)}\n`);
          queueMicrotask(() => {
            if (mode === "spawn-error") { db.pid = undefined; db.emit("error", { code: "EACCES" }); db.emit("close"); return; }
            db.emit("spawn");
            if (mode === "exit") {
              db.stderr.emit("data", `FATAL: could not open file "C:\\private\\${secret}": Permission denied\n`);
              db.exitCode = 1; db.emit("exit", 1, null); db.emit("close");
            }
          });
          return db;
        },
        spawnSync(exe, argv, options) {
          calls.push({ kind: "command", exe, argv });
          const tool = path.basename(exe);
          if (tool === "whoami.exe") return { status: 0, stdout: "S-1-5-21-1234", stderr: "" };
          if (tool === "initdb.exe") fs.mkdirSync(path.join(options.cwd, "db"));
          if (tool === "psql.exe") return { status: 2, stdout: "",
            stderr: `psql: FATAL: password authentication failed for user "${secret}"` };
          if (tool === "pg_ctl.exe") {
            db.exitCode = 0; db.emit("exit", 0, null); db.emit("close");
            fs.unlinkSync(path.join(options.cwd, "db/postmaster.pid"));
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "runtime.cjs"), "utf8"), context);
  r = new module.exports.IsolatedRuntime({ resources, localData: local,
    identity: { packageId: "OFFICE-WIN-PACKAGED-db-test", parentId: BASE } });
  return { r, calls, local, resources, get db() { return db; } };
}
test("actual supervisor distinguishes early exit and exposes sanitized logs/exit instead of losing them", async () => {
  const { r, calls } = sandbox("exit");
  await assert.rejects(r.start(), { code: "DB_START_FAILED" });
  const diagnostic = JSON.parse(fs.readFileSync(r.diagnose({ code: "DB_START_FAILED" }).file));
  assert.equal(diagnostic.stage, "start-database");
  assert.equal(diagnostic.database.exitCode, 1);
  assert.equal(diagnostic.database.failureKind, "EARLY_EXIT");
  assert.equal(diagnostic.database.messages.some(m => m.text.includes("Permission denied")), true);
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  await r.stop({ preserveEvidence: true });
  assert.equal(r.shutdownOutcome, "OWNED_DB_ALREADY_EXITED");
  assert.equal(fs.existsSync(path.join(r.run, "active.json")), true);
  assert.equal(fs.existsSync(path.join(r.run, `stopped-session-${r.session}.json`)), true);
  assert.equal(calls.filter(c => c.kind === "spawn").length, 1);
  assert.equal(calls.some(c => c.exe.endsWith("pg_ctl.exe")), false);
});
test("spawn error keeps native code and is not an authentication or readiness timeout", async () => {
  const { r } = sandbox("spawn-error");
  await assert.rejects(r.start(), { code: "DB_START_FAILED" });
  assert.equal(r.dbMonitor.snapshot().failureKind, "SPAWN_ERROR");
  assert.equal(r.dbMonitor.snapshot().nativeCode, "EACCES");
});
test("authentication readiness timeout preserves failure reason and does not restart or seed", async () => {
  const { r, calls } = sandbox("auth");
  await assert.rejects(r.start(), { code: "DB_READINESS_TIMEOUT" });
  assert.equal(r.dbMonitor.snapshot().readiness.lastReason, "AUTHENTICATION_FAILED");
  assert.equal(r.dbMonitor.snapshot().readiness.lastExitCode, 2);
  assert.equal(calls.filter(c => c.kind === "spawn").length, 1);
  assert.equal(fs.existsSync(path.join(r.run, "initialized.json")), false);
  assert.equal(fs.existsSync(path.join(r.root, "selected-run.json")), false);
});
test("PID mismatch and unverified resources are preserved without pg_ctl or forced lock removal", async () => {
  const { r, calls } = sandbox("pid-mismatch");
  await assert.rejects(r.start(), { code: "DB_OWNERSHIP_MISMATCH" });
  r.queryProcess = () => ({ ...info, executable: "C:\\unrelated.exe" });
  await assert.rejects(r.stop({ preserveEvidence: true }), { code: "DB_OWNERSHIP_UNVERIFIED" });
  assert.equal(calls.some(c => c.exe.endsWith("pg_ctl.exe")), false);
  assert.equal(fs.existsSync(path.join(r.run, "active.json")), true);
  assert.equal(r.shutdownOutcome, "UNVERIFIED_RESOURCE_PRESERVED");
});
test("verified current DB is stopped normally only after repeat identity checks; lock evidence remains", async () => {
  const state = sandbox("auth"), { r, calls } = state;
  await assert.rejects(r.start(), { code: "DB_READINESS_TIMEOUT" });
  let checks = 0;
  r.queryProcess = () => {
    checks++;
    return { state: "PRESENT", pid: r.db.pid, parentPid: 1234, createdAtMs: r.dbRequestedAt,
      executable: r.tool("postgres"), commandLine: [r.tool("postgres"), ...databaseInvocation(r.run).args].map(s => `"${s}"`).join(" ") };
  };
  const status = r.inspectResources();
  assert.equal(status.canStop, true);
  await r.stop({ preserveEvidence: true });
  assert.equal(calls.filter(c => c.exe.endsWith("pg_ctl.exe")).length, 1);
  assert.equal(checks >= 3, true);
  assert.equal(r.shutdownOutcome, "VERIFIED_DB_STOPPED");
  assert.equal(fs.existsSync(path.join(r.run, "active.json")), true);
  assert.equal(fs.existsSync(path.join(r.run, `db-owner-${r.session}.json`)), true);
});
test("identity changing between inspection and stop prevents the stop command", async () => {
  const { r, calls } = sandbox("auth");
  await assert.rejects(r.start(), { code: "DB_READINESS_TIMEOUT" });
  let checks = 0;
  r.queryProcess = () => ({ state: "PRESENT", pid: r.db.pid, parentPid: 1234,
    createdAtMs: r.dbRequestedAt, executable: ++checks === 1 ? r.tool("postgres") : "C:\\recycled.exe",
    commandLine: [r.tool("postgres"), ...databaseInvocation(r.run).args].map(s => `"${s}"`).join(" ") });
  await assert.rejects(r.stop({ preserveEvidence: true }), { code: "DB_OWNERSHIP_UNVERIFIED" });
  assert.equal(calls.some(c => c.exe.endsWith("pg_ctl.exe")), false);
  assert.equal(fs.existsSync(path.join(r.run, "active.json")), true);
});
test("reattached DB requires explicit stop consent and its absence is confirmed using the captured owner record", async () => {
  const { r, calls } = sandbox("auth");
  await assert.rejects(r.start(), { code: "DB_READINESS_TIMEOUT" });
  const originalChild = r.db, startTime = r.dbRequestedAt;
  r.queryProcess = () => originalChild.exitCode !== null ? { state: "ABSENT" } :
    { state: "PRESENT", pid: originalChild.pid, parentPid: 1234, createdAtMs: startTime,
      executable: r.tool("postgres"), commandLine: [r.tool("postgres"), ...databaseInvocation(r.run).args].map(s => `"${s}"`).join(" ") };
  r.recordDatabaseOwner(r.inspectResources().resources[0]);
  r.db = undefined; r.ownsLock = false; r.session = "c".repeat(24); // Simulated later app instance.
  assert.equal(r.inspectResources().canStop, true);
  const lock = fs.readFileSync(path.join(r.run, "active.json"));
  await r.stop({ preserveEvidence: true });
  assert.equal(calls.some(c => c.exe.endsWith("pg_ctl.exe")), false);
  await r.stop({ preserveEvidence: true, allowRetained: true });
  assert.equal(calls.filter(c => c.exe.endsWith("pg_ctl.exe")).length, 1);
  assert.equal(r.shutdownOutcome, "VERIFIED_DB_STOPPED");
  assert.equal(r.inspectResources().resources[0].processState, "ABSENT");
  assert.deepEqual(fs.readFileSync(path.join(r.run, "active.json")), lock);
});
test("legacy retained evidence is inspected read-only; even matching PID/path/start cannot authorize old-package shutdown", () => {
  const { r, local, calls } = sandbox();
  const prior = "OFFICE-WIN-PACKAGED-11ee5f9eb3c7e6be";
  const priorRoot = path.join(local, "SwimNoteOffice-Isolated", prior);
  const runName = "run-" + "a".repeat(24), run = path.join(priorRoot, runName);
  fs.mkdirSync(path.join(run, "db"), { recursive: true });
  fs.writeFileSync(path.join(priorRoot, "preparing-run.json"), JSON.stringify({ packageId: prior, run: runName }));
  const lock = { packageId: prior, session: "b".repeat(24), pid: 1111 };
  fs.writeFileSync(path.join(run, "active.json"), JSON.stringify(lock));
  fs.writeFileSync(path.join(run, "db/postmaster.pid"), `8348\n${path.join(run, "db")}\n${Math.floor(now / 1000)}\n`);
  const exe = path.join(local, "Programs", "SWIMNOTE OFFICE Isolated", prior, "resources/postgres/bin/postgres.exe");
  r.queryProcess = () => ({ state: "PRESENT", pid: 8348, createdAtMs: now, executable: exe,
    commandLine: [exe, ...databaseInvocation(run).args].map(s => `"${s}"`).join(" ") });
  const before = fs.readFileSync(path.join(run, "active.json"));
  const status = r.inspectResources();
  assert.equal(status.resources[0].scope, "PREVIOUS");
  assert.equal(status.resources[0].startTimeMatch, true);
  assert.equal(status.resources[0].dataDirectoryMatch, true);
  assert.equal(status.resources[0].verified, false);
  assert.equal(status.canStop, false);
  assert.deepEqual(fs.readFileSync(path.join(run, "active.json")), before);
  assert.equal(calls.length, 0);
});
test("status diagnostics retain the original preparation failure without concealing new resource/shutdown status", () => {
  const { r } = sandbox();
  r.newPreparation = true; r.stage = "start-database";
  const first = r.diagnose({ code: "DB_START_FAILED" });
  const original = fs.readFileSync(first.file);
  r.shutdownOutcome = "UNVERIFIED_RESOURCE_PRESERVED";
  const next = r.diagnose({ code: "INCOMPLETE_PREPARATION" }, { currentStatus: true });
  assert.notEqual(next.file, first.file);
  const data = JSON.parse(fs.readFileSync(next.file));
  assert.equal(data.originalPreparationDiagnostic, path.basename(first.file));
  assert.equal(data.originalPreparationCode, "DB_START_FAILED");
  assert.equal(data.shutdownOutcome, "UNVERIFIED_RESOURCE_PRESERVED");
  assert.deepEqual(fs.readFileSync(first.file), original);
});

const { createRequire } = require("node:module");
const frozenRequire = createRequire("/tmp/office-normal-frozen-tXEGHG/candidate/package.json");
for (const verified of [false, true]) test(`native error dialog ${verified ? "allows verified-only normal stop" : "allows only read-only refresh"} without DB restart (simulated Electron)`, async () => {
  const esbuild = frozenRequire("esbuild");
  const compiled = esbuild.transformSync(fs.readFileSync(path.join(__dirname, "integration.cts"), "utf8"),
    { loader: "ts", format: "cjs", target: "node22", define: { __PACKAGED_ID__: '"UI-TEST"' } }).code;
  const actions = [verified ? "소유 확인된 DB 정상 종료" : "상태 다시 확인", "진단 폴더 열기", "종료"];
  let starts = 0, stops = 0, refreshes = 0, reveals = 0, quits = 0;
  const FakeRuntime = class {
    constructor() { this.stage = "start-database"; }
    async start() { starts++; throw Object.assign(new Error("synthetic"), { code: "DB_START_FAILED" }); }
    async stop(options) {
      assert.equal(options.preserveEvidence, true); stops++; this.stage = "stopped";
      assert.equal(options.allowRetained === true, stops > 1);
      if (verified && stops === 1) throw Object.assign(new Error("Proof not yet available"), { code: "DB_OWNERSHIP_UNVERIFIED" });
    }
    diagnose() { assert.equal(this.failureStage, "start-database"); return { file: "/diagnostic-only.json", code: "DB_START_FAILED" }; }
    inspectResources() { refreshes++; return { canStop: verified && stops === 1, resources: [
      { scope: "PREVIOUS", processState: "PRESENT", verified: false, reason: "START_RECORD_MISSING" },
    ] }; }
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, process: { resourcesPath: "/resources", env: { LOCALAPPDATA: "/local" } },
    require(name) {
      if (name === "electron") return {
        app: { on() {}, quit() { quits++; } },
        shell: { showItemInFolder() { reveals++; } },
        dialog: { async showMessageBox(options) {
          assert.equal(options.buttons.includes("소유 확인된 DB 정상 종료"), verified && stops === 1);
          const action = actions.shift();
          assert.equal(options.buttons.includes(action), true);
          return { response: options.buttons.indexOf(action) };
        } },
      };
      if (name === "node:fs") return { readFileSync: () => '{"packageId":"UI-TEST"}' };
      if (name === "otplib") return { generateSync() {} };
      if (name === "./runtime.cjs") return { IsolatedRuntime: FakeRuntime };
      return require(name);
    },
  });
  await assert.rejects(module.exports.startIsolation(), /Isolated startup stopped/);
  assert.equal(starts, 1); assert.equal(stops, verified ? 2 : 1); assert.equal(refreshes, 3);
  assert.equal(reveals, 1); assert.equal(quits, 1);
});
