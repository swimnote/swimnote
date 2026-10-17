"use strict";
// Packaging-only supervisor. Never imported by the operating API or mobile app.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const BASE = "OFFICE-WIN-AUTH-fad5704318bc64c4";
const PORTS = [55440, 20411];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const fresh = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
const systemError = error => /^[A-Z][A-Z0-9_]{1,45}$/.test(error?.code ?? "") ? error.code : "UNCLASSIFIED";
const cleanEnv = source => Object.fromEntries(Object.entries(source).filter(([key]) =>
  /^(SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH)$/i.test(key)));

function assertPlainDirectory(folder) {
  const absolute = path.resolve(folder);
  const info = fs.lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase())
    throw Object.assign(new Error("Directory boundary rejected"), { code: "UNSAFE_DIRECTORY" });
}
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    env: cleanEnv(process.env), encoding: "utf8", windowsHide: true,
    timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options,
  });
  // Deliberately never forward command output: seed/SQL errors could contain secrets.
  if (result.error || result.status !== 0) {
    const error = Object.assign(new Error("Local command failed"), {
      code: "LOCAL_COMMAND_FAILED", tool: path.basename(executable), exitCode: result.status,
      nativeCode: systemError(result.error),
    });
    throw error;
  }
  return result.stdout.trim();
}
async function vacant(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", () => reject(Object.assign(new Error("Port occupied"), { code: "PORT_OCCUPIED", port })));
    socket.listen(port, "127.0.0.1", () => socket.close(resolve));
  });
}
function restrict(folder) {
  const system = path.join(process.env.SYSTEMROOT, "System32");
  const sid = command(path.join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"]).match(/S-1-\d+(?:-\d+)+/g);
  if (!sid || sid.length !== 1) throw Object.assign(new Error("SID unavailable"), { code: "SID_UNAVAILABLE" });
  command(path.join(system, "icacls.exe"), [folder, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`]);
}
class IsolatedRuntime {
  constructor({ resources, localData, identity, nodeVersion = process.version }) {
    this.resources = resources;
    this.identity = identity;
    this.root = path.join(localData, "SwimNoteOffice-Isolated", identity.packageId);
    this.stage = "preflight";
    this.nodeVersion = nodeVersion;
    this.session = crypto.randomBytes(12).toString("hex");
    this.stopping = false;
  }
  tool(name) { return path.join(this.resources, "postgres", "bin", name + ".exe"); }
  get node() { return path.join(this.resources, "node", "node.exe"); }
  get isolation() { return path.join(this.resources, "isolation"); }
  childEnv(extra = {}) {
    return { ...cleanEnv(process.env), PATH: path.join(this.resources, "postgres", "bin"), ...extra };
  }
  sql(database, input) {
    return command(this.tool("psql"), ["-X", "-w", "-v", "ON_ERROR_STOP=1",
      "-h", "127.0.0.1", "-p", "55440", "-U", "office_fixture", "-d", database], {
      input, env: this.childEnv({ PGCLIENTENCODING: "UTF8", PGPASSWORD: this.credentials.dbPassword }),
    });
  }
  async start() {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw Object.assign(new Error("Windows x64 required"), { code: "WINDOWS_X64_REQUIRED" });
    if (!process.env.LOCALAPPDATA || !process.env.SYSTEMROOT)
      throw Object.assign(new Error("Windows profile unavailable"), { code: "PROFILE_UNAVAILABLE" });
    const manifest = json(path.join(this.isolation, "runtime-manifest.json"));
    for (const [file, expected] of Object.entries(manifest)) {
      if (path.isAbsolute(file) || file.includes("\\") || file.split("/").some(p => !p || p === "." || p === ".."))
        throw Object.assign(new Error("Runtime manifest rejected"), { code: "RUNTIME_MANIFEST_INVALID" });
      if (crypto.createHash("sha256").update(fs.readFileSync(path.join(this.resources, file))).digest("hex") !== expected)
        throw Object.assign(new Error("Runtime file changed"), { code: "RUNTIME_INTEGRITY_FAILED" });
    }
    for (const port of PORTS) await vacant(port);
    fs.mkdirSync(this.root, { recursive: true });
    assertPlainDirectory(this.root);
    restrict(this.root); // BEFORE generating any credentials.
    const selected = path.join(this.root, "selected-run.json");
    if (fs.existsSync(selected)) {
      const state = json(selected);
      if (state.packageId !== this.identity.packageId || !/^run-[a-f0-9]{24}$/.test(state.run))
        throw Object.assign(new Error("Run identity mismatch"), { code: "RUN_IDENTITY_MISMATCH" });
      this.run = path.join(this.root, state.run);
      assertPlainDirectory(this.run);
      this.credentials = json(path.join(this.run, "private.json"));
      if (this.credentials.candidateId !== BASE || !fs.existsSync(path.join(this.run, "initialized.json")) ||
          json(path.join(this.run, "initialized.json")).packageId !== this.identity.packageId)
        throw Object.assign(new Error("Incomplete prior preparation"), { code: "INCOMPLETE_PREPARATION" });
    } else {
      this.stage = "prepare";
      this.run = path.join(this.root, "run-" + crypto.randomBytes(12).toString("hex"));
      fs.mkdirSync(this.run);
      restrict(this.run);
      const { localCredentials } = require("../normal/credentials.mjs");
      this.credentials = localCredentials(BASE);
      fresh(path.join(this.run, "private.json"), this.credentials);
      fresh(path.join(this.run, "prepared.json"), { candidateId: BASE, packageId: this.identity.packageId });
      fresh(path.join(this.run, "fault-control.json"), { writes: true, dropRequest: null, dropNext: false, failRead: null });
      fresh(selected, { packageId: this.identity.packageId, run: path.basename(this.run) });
      fs.writeFileSync(path.join(this.run, "login-info.txt"), [
        "SWIMNOTE OFFICE - 격리 검증 전용 / 외부 공유 금지",
        "기본 PIN 로그인: fixture_pool / Pool ID: fixture_pool",
        ...this.credentials.accounts.map(a => [
          `계정: ${a.id}`, `로그인 ID: ${a.identifier ?? a.email}`, `비밀번호: ${a.password}`,
          a.pin ? `PIN: ${a.pin}` : "", a.totpSecret ? "TOTP: 앱에서 Ctrl+Shift+L → 현재 TOTP 보기" : "",
        ].filter(Boolean).join("\r\n")),
      ].join("\r\n\r\n"), { flag: "wx", mode: 0o600 });
      const passwordFile = path.join(this.run, "init-password.txt");
      fs.writeFileSync(passwordFile, this.credentials.dbPassword + "\n", { flag: "wx", mode: 0o600 });
      try {
        command(this.tool("initdb"), ["-D", path.join(this.run, "db"), "-U", "office_fixture",
          "--encoding=UTF8", "--locale=C", "--auth-host=scram-sha-256",
          "--auth-local=scram-sha-256", "--pwfile=" + passwordFile], { env: this.childEnv() });
      } finally { fs.unlinkSync(passwordFile); }
      this.needsSeed = true;
    }
    const active = path.join(this.run, "active.json");
    // Existing locks are preserved; never infer ownership just from a recycled PID.
    fresh(active, { packageId: this.identity.packageId, candidateId: BASE,
      session: this.session, pid: process.pid, createdAt: new Date().toISOString() });
    this.ownsLock = true;
    this.stage = "start-database";
    this.db = spawn(this.tool("postgres"), ["-D", path.join(this.run, "db"), "-h", "127.0.0.1", "-p", "55440",
      "-c", "log_statement=none", "-c", "log_min_error_statement=panic"], {
      env: this.childEnv(), stdio: "ignore", windowsHide: true,
    });
    this.db.on("error", () => { this.dbFailed = true; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (this.dbFailed || this.db.exitCode !== null) throw Object.assign(new Error("DB start failed"), { code: "DB_START_FAILED" });
      try {
        const pid = Number(fs.readFileSync(path.join(this.run, "db", "postmaster.pid"), "utf8").split("\n")[0]);
        if (pid !== this.db.pid) throw Object.assign(new Error("DB PID mismatch"), { code: "DB_OWNERSHIP_MISMATCH" });
        this.sql("postgres", "SELECT 1;");
        ready = true; break;
      } catch (error) {
        if (error.code === "DB_OWNERSHIP_MISMATCH") throw error;
        await wait(250);
      }
    }
    if (!ready) throw Object.assign(new Error("DB readiness timeout"), { code: "DB_READINESS_TIMEOUT" });
    if (this.needsSeed) {
      this.stage = "seed-synthetic-only";
      this.sql("postgres", "CREATE DATABASE office_stage3_acceptance;");
      const seed = fs.readFileSync(path.join(this.isolation, "schema.sql"), "utf8");
      this.sql("office_stage3_acceptance", "BEGIN;\n" + seed + "\nCOMMIT;");
      command(this.node, [path.join(this.isolation, "normal-seed.mjs"), "--isolated-only", "--run", this.run],
        { env: this.childEnv() });
      fresh(path.join(this.run, "initialized.json"), { candidateId: BASE, packageId: this.identity.packageId });
    }
    this.sql("office_stage3_acceptance", `SET search_path=office_acceptance;
      DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM isolation_marker
      WHERE key='normal_auth' AND value='real-handlers-local-db') THEN
      RAISE EXCEPTION 'Wrong isolated identity'; END IF; END $$;`);
    this.stage = "start-api";
    this.api = spawn(this.node, [path.join(this.isolation, "normal-entry.mjs"), "--isolated-only",
      "--run", this.run, "--session", this.session], {
      env: this.childEnv(), stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
    });
    this.api.on("error", () => { this.apiFailed = true; });
    ready = false;
    for (let n = 0; n < 100; n++) {
      if (this.apiFailed || this.api.exitCode !== null) throw Object.assign(new Error("API start failed"), { code: "API_START_FAILED" });
      try {
        const response = await fetch("http://127.0.0.1:20411/isolation/status", { signal: AbortSignal.timeout(1000), redirect: "error" });
        const status = await response.json();
        if (!response.ok || status.candidateId !== BASE || status.session !== this.session || status.normalAuthReady !== true ||
            status.isolated !== true || status.paidCalls !== 0)
          throw Object.assign(new Error("API identity mismatch"), { code: "API_IDENTITY_MISMATCH" });
        ready = true; break;
      } catch (error) {
        if (error.code === "API_IDENTITY_MISMATCH") throw error;
        await wait(250);
      }
    }
    if (!ready) throw Object.assign(new Error("API readiness timeout"), { code: "API_READINESS_TIMEOUT" });
    this.stage = "ready";
    this.health = setInterval(() => {
      if (!this.stopping && (this.db?.exitCode !== null || this.api?.exitCode !== null)) {
        clearInterval(this.health);
        this.onFailure?.(Object.assign(new Error("Owned service stopped"), { code: "OWNED_SERVICE_EXITED" }));
      }
    }, 1500);
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.health);
    this.stage = "stop-owned-services";
    if (this.api?.pid && this.api.exitCode === null && !this.apiFailed) {
      if (this.api.connected) this.api.send({ type: "stop-isolated-api" }, () => {});
      for (let n = 0; n < 40 && this.api.exitCode === null; n++) await wait(100);
      if (this.api.exitCode === null) {
        this.api.kill(); // Only this exact ChildProcess, never a supplied/recovered PID.
        for (let n = 0; n < 40 && this.api.exitCode === null; n++) await wait(100);
      }
      if (this.api.exitCode === null) throw Object.assign(new Error("API stop timeout"), { code: "API_STOP_TIMEOUT" });
    }
    if (this.db?.pid && this.db.exitCode === null && !this.dbFailed) {
      const pid = Number(fs.readFileSync(path.join(this.run, "db", "postmaster.pid"), "utf8").split("\n")[0]);
      if (pid !== this.db.pid) throw Object.assign(new Error("DB ownership mismatch"), { code: "DB_OWNERSHIP_MISMATCH" });
      command(this.tool("pg_ctl"), ["-D", path.join(this.run, "db"), "stop", "-m", "fast", "-w", "-t", "15"],
        { env: this.childEnv(), timeout: 20000 });
      for (let n = 0; n < 30 && this.db.exitCode === null; n++) await wait(100);
      if (this.db.exitCode === null) throw Object.assign(new Error("DB stop timeout"), { code: "DB_STOP_TIMEOUT" });
    }
    if (this.ownsLock) {
      for (const port of PORTS) await vacant(port);
      const file = path.join(this.run, "active.json");
      if (json(file).session !== this.session) throw Object.assign(new Error("Lock mismatch"), { code: "LOCK_OWNERSHIP_MISMATCH" });
      fs.unlinkSync(file);
      this.ownsLock = false;
    }
    this.stage = "stopped";
  }
  diagnose(error) {
    // Explicit allowlist: never stringify error/stack, env, SQL, credentials or child output.
    const details = { packageId: this.identity.packageId, candidateId: BASE,
      at: new Date().toISOString(), platform: process.platform, arch: process.arch,
      electronHostNode: this.nodeVersion, stage: this.stage, code: systemError(error),
      tool: /^[A-Za-z0-9_.-]+$/.test(error?.tool ?? "") ? error.tool : undefined,
      exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : undefined,
      nativeCode: error?.nativeCode ? systemError({ code: error.nativeCode }) : undefined,
      port: PORTS.includes(error?.port) ? error.port : undefined,
      ownedApiPid: this.api?.pid, ownedDbPid: this.db?.pid, lockRetained: !!this.ownsLock,
      windowsAcceptance: "NOT RUN by build environment", paidCalls: 0 };
    const folder = path.join(this.root, "diagnostics");
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `diagnostic-${Date.now()}-${this.session}.json`);
    fresh(file, details);
    return { file, code: details.code };
  }
}
module.exports = { IsolatedRuntime, cleanEnv, systemError, assertPlainDirectory, BASE, PORTS };
