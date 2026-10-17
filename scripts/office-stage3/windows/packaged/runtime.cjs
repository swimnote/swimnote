"use strict";
// Packaging-only supervisor. Never imported by the operating API or mobile app.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseMonitor, databaseReason } = require("./database-monitor.cjs");
const { PRIOR, processInfo, pidInfo, ownership, publicOwnership } = require("./database-ownership.cjs");

const BASE = "OFFICE-WIN-AUTH-fad5704318bc64c4";
const PORTS = [55440, 20411];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const fresh = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
const systemError = error => /^[A-Z][A-Z0-9_]{1,45}$/.test(error?.code ?? "") ? error.code : "UNCLASSIFIED";
const cleanEnv = source => Object.fromEntries(Object.entries(source).filter(([key]) =>
  /^(SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH)$/i.test(key)));
const INITDB_CATEGORIES = new Set([
  "INITDB_PASSWORD_FILE_UNREADABLE", "INITDB_PASSWORD_FILE_EMPTY",
  "POSTGRES_EXECUTABLE_NOT_FOUND", "POSTGRES_VERSION_CHECK_FAILED",
  "INITDB_PERMISSION_DENIED", "INITDB_ENCODING_FAILED", "INITDB_LIBRARY_LOAD_FAILED",
  "INITDB_INPUT_FILE_UNREADABLE", "INITDB_DATA_DIRECTORY_NOT_EMPTY",
  "INITDB_CHILD_EXCEPTION", "INITDB_CHILD_EXIT_FAILED", "INITDB_UNCLASSIFIED",
]);
const INITDB_PHASES = new Map([
  ["creating subdirectories", "CREATE_DIRECTORIES"],
  ["selecting dynamic shared memory", "SELECT_RUNTIME_SETTINGS"],
  ["creating configuration files", "CREATE_CONFIGURATION"],
  ["running bootstrap script", "BOOTSTRAP"],
  ["performing post-bootstrap initialization", "POST_BOOTSTRAP"],
  ["syncing data to disk", "SYNC_DATA"],
]);
// A vocabulary, not a general-purpose log redactor. Unknown text is never published.
const ERROR_WORDS = new Set(("invalid byte sequence for encoding character with has no equivalent in " +
  "could not convert from to read open file directory permission denied access is empty " +
  "does exist exists but regular failed failure system library load module specified found " +
  "input output data locale settings check child process exited exit code terminated by exception " +
  "password version same as initdb postgres error fatal panic warning detail hint " +
  "syntax at or near unexpected end of memory shared dynamic create initialize initialization " +
  "collation collations conversion COPY line " +
  "database ready accept connections connection refused authentication authorization supplied " +
  "server starting up bind socket address already use configuration parameter value " +
  "permissions lock listening shutdown checkpoint complete requested received request " +
  "terminating background worker startup recovery interrupted invalid record length " +
  "resources system startup process running stopped out of disk space limit " +
  "not available accepting the on at host port to socket shared memory").toLowerCase().split(/\s+/));
const ENCODINGS = /^(?:UTF8|SQL_ASCII|WIN(?:866|874|125[0-8])|LATIN(?:[1-9]|10)|EUC_(?:KR|JP|CN|TW|JIS_2004)|SJIS|SHIFT_JIS_2004|UHC|GBK|GB18030|BIG5|JOHAB|KOI8[RU])$/i;
function secretValues(value) {
  if (typeof value === "string") return value ? [value] : [];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(secretValues);
}
function safeInitdbMessage(line, secrets = []) {
  // Remove known local credentials BEFORE recognizing any message. No raw fallback.
  for (const value of [...new Set(secrets)].sort((a, b) => b.length - a.length))
    if (value) line = line.split(value).join("[redacted]");
  const match = line.match(/\b(ERROR|FATAL|PANIC|WARNING|DETAIL|HINT):\s*(.*)$/i);
  if (!match) {
    const child = line.match(/^child process exited with exit code (1|[2-9]\d{0,2})$/i);
    return child ? { severity: "CHILD", text: child[0] } : null;
  }
  const severity = match[1].toUpperCase();
  let text = match[2];
  // SQL/connection material is not eligible, even if some of its words are in the vocabulary.
  if (/\b(?:ALTER|SELECT|INSERT|UPDATE|DELETE|CREATE|DO)\b.*\b(?:USER|PASSWORD|FROM|TABLE|ROLE)\b/i.test(text) ||
      /(?:postgres(?:ql)?:\/\/|password\s*=|PGPASSWORD|Bearer\s)/i.test(text))
    return { severity, text: "[redacted]" };
  // Preserve the actual bounded PostgreSQL encoding phrase, including at most eight error bytes.
  const encodingError = text.match(/^(invalid byte sequence for encoding) "(.*?)":((?: 0x[0-9a-f]{2}(?![0-9a-f])){1,8})(?:\s|$)/i);
  if (encodingError && ENCODINGS.test(encodingError[2]))
    return { severity, text: `${encodingError[1]} "${encodingError[2]}":${encodingError[3]}` };
  // All other quoted identifiers, file paths, usernames and arbitrary tokens are withheld.
  text = text.replace(/"[^"]*"|'[^']*'/g, "[redacted]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+|(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s,;]*/gi, "[redacted]");
  const words = text.match(/\[redacted\]|[A-Za-z0-9_]+|[^\x00-\x7f]+/g) ?? [];
  text = words.map(word => ERROR_WORDS.has(word.toLowerCase()) ? word : "[redacted]")
    .join(" ").replace(/(?:\[redacted\] ){1,}\[redacted\]/g, "[redacted]").slice(0, 240);
  return { severity, text: text || "[redacted]" };
}
function collectInitdbMessages(result, secrets = []) {
  const messages = [];
  for (const stream of ["stderr", "stdout"]) {
    for (const line of String(result[stream] ?? "").split(/\r?\n/)) {
      const message = safeInitdbMessage(line, secrets);
      if (message) messages.push({ stream, ...message });
      if (messages.length === 8) return messages;
    }
  }
  return messages;
}
function classifyInitdbFailure(result, secrets = []) {
  // Raw stdout/stderr remain in memory only. Share only the constrained message excerpts below.
  const output = String(result.stdout ?? "") + "\n" + String(result.stderr ?? "");
  const text = output.toLowerCase();
  const rules = [
    ["INITDB_PASSWORD_FILE_EMPTY", /password file[^\r\n]*is empty/i],
    ["INITDB_PASSWORD_FILE_UNREADABLE", /could not read password from file|could not open file[^\r\n]*(?:init-password\.txt|passwd|pwfile)[^\r\n]*for reading/i],
    ["POSTGRES_EXECUTABLE_NOT_FOUND", /program "postgres"[^\r\n]*was not found/i],
    ["POSTGRES_VERSION_CHECK_FAILED", /not the same version as initdb/i],
    ["INITDB_PERMISSION_DENIED", /permission denied|access is denied/i],
    ["INITDB_ENCODING_FAILED", /invalid byte sequence|character.*has no equivalent|could not convert.*(?:utf|encoding)/i],
    ["INITDB_LIBRARY_LOAD_FAILED", /could not load library|specified module could not be found/i],
    ["INITDB_INPUT_FILE_UNREADABLE", /could not (?:open|read|access) (?:file|directory)/i],
    ["INITDB_DATA_DIRECTORY_NOT_EMPTY", /exists but is not empty/i],
    ["INITDB_CHILD_EXCEPTION", /child process[^\r\n]*exception/i],
    ["INITDB_CHILD_EXIT_FAILED", /child process exited with exit code/i],
  ];
  const category = rules.find(([, pattern]) => pattern.test(output))?.[0] ?? "INITDB_UNCLASSIFIED";
  let phase = "BEFORE_BOOTSTRAP", last = -1;
  for (const [phrase, value] of INITDB_PHASES) {
    const index = text.lastIndexOf(phrase);
    if (index > last) { last = index; phase = value; }
  }
  const exception = output.match(/child process[^\r\n]*exception (0x[a-f0-9]{8})(?![a-f0-9])/i)?.[1]?.toUpperCase();
  return { category, phase, exception, messages: collectInitdbMessages(result, secrets),
    capture: {
      stdoutBytes: Buffer.byteLength(String(result.stdout ?? ""), "utf8"),
      stderrBytes: Buffer.byteLength(String(result.stderr ?? ""), "utf8"),
      incomplete: !!result.error,
    } };
}
function initdbInvocation(run) {
  // libuv sets Windows cwd through the wide-character API. The PostgreSQL CRT receives only
  // ASCII relative file arguments, even when the user's profile name is non-ASCII.
  return { cwd: run, args: ["-D", "db", "-U", "office_fixture", "--encoding=UTF8", "--locale=C",
    "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--pwfile=init-password.txt", "--no-clean"] };
}
function writeInitdbPassword(file, password) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(password))
    throw Object.assign(new Error("Synthetic password format rejected"), { code: "INITDB_PASSWORD_FORMAT_REJECTED" });
  fs.writeFileSync(file, Buffer.from(password + "\n", "utf8"), { flag: "wx", mode: 0o600 });
}
function supportsUtf8ProcessCodePage(release) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(release);
  return !!match && (Number(match[1]) > 10 ||
    (Number(match[1]) === 10 && Number(match[3]) >= 18362));
}
function databaseInvocation(run) {
  return { cwd: run, args: ["-D", "db", "-h", "127.0.0.1", "-p", "55440",
    "-c", "log_statement=none", "-c", "log_min_error_statement=panic"] };
}

function assertPlainDirectory(folder) {
  const absolute = path.resolve(folder);
  const info = fs.lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase())
    throw Object.assign(new Error("Directory boundary rejected"), { code: "UNSAFE_DIRECTORY" });
}
function command(executable, args, options = {}) {
  const { diagnosticSecrets = [], databaseDiagnostic = false, ...spawnOptions } = options;
  const result = spawnSync(executable, args, {
    env: cleanEnv(process.env), encoding: "utf8", windowsHide: true,
    timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...spawnOptions,
  });
  // Never forward raw command output: seed/SQL errors could contain secrets.
  if (result.error || result.status !== 0) {
    const error = Object.assign(new Error("Local command failed"), {
      code: "LOCAL_COMMAND_FAILED", tool: path.basename(executable), exitCode: result.status,
      nativeCode: systemError(result.error),
       ...(path.basename(executable).toLowerCase() === "initdb.exe" ?
         { initdb: classifyInitdbFailure(result, diagnosticSecrets) } : {}),
      ...(databaseDiagnostic ? {
        databaseReason: databaseReason(String(result.stderr ?? "") + "\n" + String(result.stdout ?? ""), systemError(result.error)),
        databaseMessages: collectInitdbMessages(result, diagnosticSecrets),
      } : {}),
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
    this.localData = localData;
    this.identity = identity;
    this.root = path.join(localData, "SwimNoteOffice-Isolated", identity.packageId);
    this.stage = "preflight";
    this.nodeVersion = nodeVersion;
    this.session = crypto.randomBytes(12).toString("hex");
    this.stopping = false;
    this.queryProcess = pid => processInfo(pid, this.childEnv());
  }
  tool(name) { return path.join(this.resources, "postgres", "bin", name + ".exe"); }
  get node() { return path.join(this.resources, "node", "node.exe"); }
  get isolation() { return path.join(this.resources, "isolation"); }
  childEnv(extra = {}) {
    return { ...cleanEnv(process.env), PATH: path.join(this.resources, "postgres", "bin"),
      LANG: "C", LC_ALL: "C", ...extra };
  }
  sql(database, input, diagnostic = false) {
    return command(this.tool("psql"), ["-X", "-w", "-v", "ON_ERROR_STOP=1",
      "-h", "127.0.0.1", "-p", "55440", "-U", "office_fixture", "-d", database], {
      input, env: this.childEnv({ PGCLIENTENCODING: "UTF8", PGPASSWORD: this.credentials.dbPassword }),
      timeout: diagnostic ? 3000 : 120000, databaseDiagnostic: diagnostic,
      diagnosticSecrets: diagnostic ? secretValues(this.credentials) : [],
    });
  }
  async start() {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw Object.assign(new Error("Windows x64 required"), { code: "WINDOWS_X64_REQUIRED" });
    if (!supportsUtf8ProcessCodePage(os.release()))
      throw Object.assign(new Error("Windows UTF8 process codepage support required"), { code: "WINDOWS_UTF8_CODEPAGE_REQUIRED" });
    if (!process.env.LOCALAPPDATA || !process.env.SYSTEMROOT)
      throw Object.assign(new Error("Windows profile unavailable"), { code: "PROFILE_UNAVAILABLE" });
    const manifest = json(path.join(this.isolation, "runtime-manifest.json"));
    this.manifest = manifest;
    for (const [file, expected] of Object.entries(manifest)) {
      if (path.isAbsolute(file) || file.includes("\\") || file.split("/").some(p => !p || p === "." || p === ".."))
        throw Object.assign(new Error("Runtime manifest rejected"), { code: "RUNTIME_MANIFEST_INVALID" });
      if (crypto.createHash("sha256").update(fs.readFileSync(path.join(this.resources, file))).digest("hex") !== expected)
        throw Object.assign(new Error("Runtime file changed"), { code: "RUNTIME_INTEGRITY_FAILED" });
    }
    this.inspectResources();
    if (this.resourceStatus?.some(s => s.hasRetainedLock &&
        (s.processState === "UNKNOWN" || (s.processState === "PRESENT" && s.reason !== "IDENTITY_MISMATCH"))))
      throw Object.assign(new Error("Retained resources require inspection"), { code: "RETAINED_RESOURCES_HOLD" });
    for (const port of PORTS) await vacant(port);
    fs.mkdirSync(this.root, { recursive: true });
    assertPlainDirectory(this.root);
    restrict(this.root); // BEFORE generating any credentials.
    const selected = path.join(this.root, "selected-run.json");
    if (!fs.existsSync(selected) && fs.existsSync(path.join(this.root, "preparing-run.json")))
      throw Object.assign(new Error("Prior preparation retained"), { code: "INCOMPLETE_PREPARATION" });
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
      this.newPreparation = true;
      this.run = path.join(this.root, "run-" + crypto.randomBytes(12).toString("hex"));
      fs.mkdirSync(this.run);
      restrict(this.run);
      const { localCredentials } = require("../normal/credentials.mjs");
      this.credentials = localCredentials(BASE);
      fresh(path.join(this.run, "private.json"), this.credentials);
      fresh(path.join(this.run, "prepared.json"), { candidateId: BASE, packageId: this.identity.packageId });
      fresh(path.join(this.run, "fault-control.json"), { writes: true, dropRequest: null, dropNext: false, failRead: null });
      fresh(path.join(this.root, "preparing-run.json"), { packageId: this.identity.packageId, run: path.basename(this.run) });
      fs.writeFileSync(path.join(this.run, "login-info.txt"), [
        "SWIMNOTE OFFICE - 격리 검증 전용 / 외부 공유 금지",
        "기본 PIN 로그인: fixture_pool / Pool ID: fixture_pool",
        ...this.credentials.accounts.map(a => [
          `계정: ${a.id}`, `로그인 ID: ${a.identifier ?? a.email}`, `비밀번호: ${a.password}`,
          a.pin ? `PIN: ${a.pin}` : "", a.totpSecret ? "TOTP: 앱에서 Ctrl+Shift+L → 현재 TOTP 보기" : "",
        ].filter(Boolean).join("\r\n")),
      ].join("\r\n\r\n"), { flag: "wx", mode: 0o600 });
      const passwordFile = path.join(this.run, "init-password.txt");
      writeInitdbPassword(passwordFile, this.credentials.dbPassword);
      try {
        this.stage = "prepare-initdb";
        this.initdbInputProfile = {
          explicitAsciiRole: true, dbEncoding: "UTF8", locale: "C",
          passwordFile: "ASCII_UTF8_NO_BOM_LF", relativeDbAndPasswordPaths: true,
          resourcePathHasNonAscii: /[^\x00-\x7f]/.test(this.resources),
          runPathHasNonAscii: /[^\x00-\x7f]/.test(this.run),
          declaredProcessCodePage: "UTF-8", effectiveProcessCodePage: "NOT_MEASURED",
        };
        const invocation = initdbInvocation(this.run);
        command(this.tool("initdb"), invocation.args, { cwd: invocation.cwd, env: this.childEnv(),
          diagnosticSecrets: secretValues(this.credentials) });
      } finally { fs.unlinkSync(passwordFile); }
      this.needsSeed = true;
    }
    const active = path.join(this.run, "active.json");
    // Existing locks are preserved; never infer ownership just from a recycled PID.
    fresh(active, { packageId: this.identity.packageId, candidateId: BASE,
      session: this.session, pid: process.pid, createdAt: new Date().toISOString() });
    this.ownsLock = true;
    this.stage = "start-database";
    this.dbMonitor = new DatabaseMonitor(line => safeInitdbMessage(line, secretValues(this.credentials)));
    this.dbRequestedAt = Date.now();
    const dbInvocation = databaseInvocation(this.run);
    this.db = spawn(this.tool("postgres"), dbInvocation.args, {
      cwd: dbInvocation.cwd, env: this.childEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    this.dbMonitor.attach(this.db);
    let ready = false;
    const dbDeadline = Date.now() + 25000;
    for (let n = 0; n < 100 && Date.now() < dbDeadline; n++) {
      if (this.dbMonitor.failureKind) {
        await wait(100); // Drain a terminating child's final stderr, without restarting it.
        throw Object.assign(new Error("DB start failed"), { code: "DB_START_FAILED" });
      }
      try {
        const pidFile = pidInfo(path.join(this.run, "db", "postmaster.pid"));
        if (!pidFile) {
          this.dbMonitor.probe("PID_FILE_PENDING");
          await wait(250); continue;
        }
        if (pidFile.pid !== this.db.pid) {
          this.dbMonitor.probe("PID_MISMATCH");
          throw Object.assign(new Error("DB PID mismatch"), { code: "DB_OWNERSHIP_MISMATCH" });
        }
        this.sql("postgres", "SELECT 1;", true);
        const status = this.checkDatabase(this.currentContext(), this.db);
        if (!status.verified) throw Object.assign(new Error("DB identity not verified"), { code: "DB_OWNERSHIP_UNVERIFIED" });
        this.recordDatabaseOwner(status);
        this.dbMonitor.probe("READY");
        ready = true; break;
      } catch (error) {
        if (["DB_OWNERSHIP_MISMATCH", "DB_OWNERSHIP_UNVERIFIED"].includes(error.code)) throw error;
        this.dbMonitor.probe(error.databaseReason ?? (error.code === "ENOENT" ? "PID_FILE_PENDING" : "QUERY_FAILED"), error);
        await wait(250);
      }
    }
    if (!ready) throw Object.assign(new Error("DB readiness failed"), {
      code: this.dbMonitor.failureKind ? "DB_START_FAILED" : "DB_READINESS_TIMEOUT" });
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
    this.commitSelection();
    this.newPreparation = false;
    this.health = setInterval(() => {
      if (!this.stopping && (this.db?.exitCode !== null || this.api?.exitCode !== null)) {
        clearInterval(this.health);
        this.onFailure?.(Object.assign(new Error("Owned service stopped"), { code: "OWNED_SERVICE_EXITED" }));
      }
    }, 1500);
  }
  commitSelection() {
    if (!this.newPreparation) return;
    if (this.stage !== "ready" || json(path.join(this.run, "initialized.json")).packageId !== this.identity.packageId)
      throw Object.assign(new Error("Preparation is not committed"), { code: "INCOMPLETE_PREPARATION" });
    fresh(path.join(this.root, "selected-run.json"), { packageId: this.identity.packageId, run: path.basename(this.run) });
  }
  currentContext() {
    if (!this.run) return null;
    const lock = fs.existsSync(path.join(this.run, "active.json")) ? json(path.join(this.run, "active.json")) : null;
    return { scope: "CURRENT", root: this.root, run: this.run, resources: this.resources,
      executable: this.tool("postgres"), directory: path.join(this.run, "db"), lock,
      packageId: this.identity.packageId, requestedAt: this.dbRequestedAt,
      args: databaseInvocation(this.run).args };
  }
  retainedContext(root, packageId, resources, scope) {
    if (!fs.existsSync(root)) return null;
    assertPlainDirectory(root);
    const pointer = ["selected-run.json", "preparing-run.json"].find(name => fs.existsSync(path.join(root, name)));
    if (!pointer) return null;
    const state = json(path.join(root, pointer));
    if (state.packageId !== packageId || !/^run-[a-f0-9]{24}$/.test(state.run)) return null;
    const run = path.join(root, state.run); assertPlainDirectory(run);
    const lock = fs.existsSync(path.join(run, "active.json")) ? json(path.join(run, "active.json")) : null;
    if (!lock && scope !== "PREVIOUS") return null;
    if (lock && (lock.packageId !== packageId || !/^[a-f0-9]{24}$/.test(lock.session))) return null;
    let fallbackPid;
    const first = path.join(root, "first-preparation-failure.json");
    if (fs.existsSync(first)) {
      const name = json(first).file;
      if (/^diagnostic-\d+-[a-f0-9]{24}\.json$/.test(name ?? "")) {
        const file = path.join(root, "diagnostics", name);
        if (fs.existsSync(file) && fs.statSync(file).size < 65536) {
          const prior = json(file);
          if (prior.packageId === packageId && Number.isSafeInteger(prior.ownedDbPid)) fallbackPid = prior.ownedDbPid;
        }
      }
    }
    return { scope, root, run, resources, lock, packageId, fallbackPid,
      executable: path.join(resources, "postgres", "bin", "postgres.exe"),
      directory: path.join(run, "db"), args: databaseInvocation(run).args };
  }
  checkDatabase(context, child) {
    if (!context) return { scope: "CURRENT", processState: "ABSENT", verified: false, reason: "NO_RESOURCE" };
    let record;
    const recordFile = path.join(context.run, `db-owner-${context.lock?.session}.json`);
    if (fs.existsSync(recordFile)) record = json(recordFile);
    const pidFile = pidInfo(path.join(context.directory, "postmaster.pid"));
    const recordedPid = record?.packageId === context.packageId && record?.session === context.lock?.session &&
      Number.isSafeInteger(record.pid) && record.pid > 0 ? record.pid : undefined;
    const pid = child?.pid ?? pidFile?.pid ?? recordedPid ?? context.fallbackPid;
    if (child && (Number.isInteger(child.exitCode) || child.signalCode))
      return { scope: context.scope, processState: "ABSENT", verified: false, reason: "OWNED_CHILD_EXITED",
        pid, hasRetainedLock: true };
    if (!context.lock && context.scope !== "PREVIOUS") return { scope: context.scope, processState: "UNKNOWN", verified: false,
      reason: "IDENTITY_UNAVAILABLE", hasRetainedLock: false };
    if (!pid) return { scope: context.scope, processState: "UNKNOWN", verified: false,
      reason: "NO_DB_PID_EVIDENCE", hasRetainedLock: true };
    const info = this.queryProcess(pid);
    const result = ownership({ info, pidFile, child, record, lock: context.lock,
      expected: { ...context, cwd: context.run, parentPid: process.pid } });
    // Legacy installations lack a creation-time ownership record: never terminate them here.
    if (context.scope === "PREVIOUS" && result.verified) {
      result.verified = false; result.reason = "LEGACY_METADATA_ONLY";
    }
    if (result.verified) {
      try {
        assertPlainDirectory(context.run); assertPlainDirectory(context.directory);
        const expected = this.manifest?.["postgres/bin/postgres.exe"];
        if (!expected || crypto.createHash("sha256").update(fs.readFileSync(context.executable)).digest("hex") !== expected)
          throw new Error("Unverified executable");
      } catch { result.verified = false; result.reason = "EXECUTABLE_OR_DIRECTORY_UNVERIFIED"; }
    }
    return { scope: context.scope, ...result, pid, hasRetainedLock: !!context.lock,
      createdAtMs: Number.isFinite(info.createdAtMs) ? info.createdAtMs : undefined };
  }
  recordDatabaseOwner(status) {
    const file = path.join(this.run, `db-owner-${this.session}.json`);
    if (fs.existsSync(file)) return;
    fresh(file, { packageId: this.identity.packageId, session: this.session, pid: this.db.pid,
      createdAtMs: status.createdAtMs, executable: this.tool("postgres"), directory: path.join(this.run, "db"),
      cwd: this.run, argsHash: crypto.createHash("sha256").update(JSON.stringify(databaseInvocation(this.run).args)).digest("hex") });
  }
  inspectResources() {
    const statuses = [];
    try {
      const own = this.db ? this.currentContext() :
        this.retainedContext(this.root, this.identity.packageId, this.resources, "CURRENT");
      this.currentResidue = own;
      if (own) statuses.push(this.checkDatabase(own, this.db));
      const previousRoot = path.join(this.localData, "SwimNoteOffice-Isolated", PRIOR);
      const previousResources = path.join(this.localData, "Programs", "SWIMNOTE OFFICE Isolated", PRIOR, "resources");
      const previous = this.retainedContext(previousRoot, PRIOR, previousResources, "PREVIOUS");
      if (previous) statuses.push(this.checkDatabase(previous));
    } catch {
      statuses.push({ scope: "CURRENT", processState: "UNKNOWN", reason: "INSPECTION_FAILED",
        verified: false, hasRetainedLock: true });
    }
    this.resourceStatus = statuses.map(publicOwnership);
    return { resources: this.resourceStatus, canStop: statuses.some(s => s.scope === "CURRENT" && s.verified),
      shutdown: this.shutdownOutcome ?? "NOT_ATTEMPTED" };
  }
  async stop({ preserveEvidence = false, allowRetained = false } = {}) {
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
    // A failed launch may inspect another live instance. Only an explicit UI action may stop it.
    const context = this.db ? this.currentContext() : allowRetained ? this.currentResidue : null;
    if (context) {
      const status = this.checkDatabase(context, this.db);
      if (status.processState !== "ABSENT" && !status.verified) {
        this.shutdownOutcome = "UNVERIFIED_RESOURCE_PRESERVED";
        throw Object.assign(new Error("DB ownership unverified"), { code: "DB_OWNERSHIP_UNVERIFIED" });
      }
      if (status.verified) {
        if (this.db) this.recordDatabaseOwner(status);
        // Re-query immediately before signaling; PID alone never authorizes pg_ctl.
        if (!this.checkDatabase(context, this.db).verified)
          throw Object.assign(new Error("DB ownership changed"), { code: "DB_OWNERSHIP_UNVERIFIED" });
        command(this.tool("pg_ctl"), ["-D", "db", "stop", "-m", "fast", "-w", "-t", "15"],
          { cwd: context.run, env: this.childEnv(), timeout: 20000, databaseDiagnostic: true,
            diagnosticSecrets: secretValues(this.credentials) });
        for (let n = 0; n < 30 && this.db && this.db.exitCode === null && !this.db.signalCode; n++) await wait(100);
        if (this.checkDatabase(context, this.db).processState !== "ABSENT")
          throw Object.assign(new Error("DB stop unconfirmed"), { code: "DB_STOP_UNCONFIRMED" });
      }
      this.shutdownOutcome = status.verified ? "VERIFIED_DB_STOPPED" : "OWNED_DB_ALREADY_EXITED";
    }
    if (this.ownsLock) {
      for (const port of PORTS) await vacant(port);
      const file = path.join(this.run, "active.json");
      if (json(file).session !== this.session) throw Object.assign(new Error("Lock mismatch"), { code: "LOCK_OWNERSHIP_MISMATCH" });
      if (preserveEvidence) {
        const recordFile = path.join(this.run, `stopped-session-${this.session}.json`);
        if (!fs.existsSync(recordFile)) fresh(recordFile, {
          session: this.session, outcome: this.shutdownOutcome ?? "NO_DB_STARTED", activeLockPreserved: true });
      } else {
        fs.unlinkSync(file); // Normal release of this verified session only, never a stale lock.
        this.ownsLock = false;
      }
    }
    this.stage = "stopped";
  }
  diagnose(error, { currentStatus = false } = {}) {
    // Explicit allowlist: never stringify error/stack, env, SQL, credentials or raw child output.
    const secrets = secretValues(this.credentials);
    const messages = Array.isArray(error?.initdb?.messages) ? error.initdb.messages.slice(0, 8).flatMap(entry => {
      if (!["stderr", "stdout"].includes(entry?.stream) ||
          !["ERROR", "FATAL", "PANIC", "WARNING", "DETAIL", "HINT", "CHILD"].includes(entry?.severity) ||
          typeof entry?.text !== "string") return [];
      const sanitized = safeInitdbMessage(entry.severity === "CHILD" ? entry.text :
        `${entry.severity}: ${entry.text}`, secrets);
      return sanitized ? [{ stream: entry.stream, ...sanitized }] : [];
    }) : [];
    const details = { packageId: this.identity.packageId, candidateId: BASE,
      at: new Date().toISOString(), platform: process.platform, arch: process.arch,
      electronHostNode: this.nodeVersion, stage: this.failureStage ?? this.stage, code: systemError(error),
      database: this.dbMonitor?.snapshot(),
      shutdownOutcome: ["NOT_ATTEMPTED", "UNVERIFIED_RESOURCE_PRESERVED", "VERIFIED_DB_STOPPED",
        "OWNED_DB_ALREADY_EXITED", "STOP_FAILED"].includes(this.shutdownOutcome) ? this.shutdownOutcome : "NOT_ATTEMPTED",
      shutdownErrorCode: this.shutdownErrorCode ? systemError({ code: this.shutdownErrorCode }) : undefined,
      resourceInspection: this.resourceStatus?.map(publicOwnership),
      tool: /^[A-Za-z0-9_.-]+$/.test(error?.tool ?? "") ? error.tool : undefined,
      exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : undefined,
      nativeCode: error?.nativeCode ? systemError({ code: error.nativeCode }) : undefined,
      initdbCategory: INITDB_CATEGORIES.has(error?.initdb?.category) ? error.initdb.category : undefined,
      initdbPhase: ["BEFORE_BOOTSTRAP", ...INITDB_PHASES.values()].includes(error?.initdb?.phase) ? error.initdb.phase : undefined,
      childException: /^0X[A-F0-9]{8}$/.test(error?.initdb?.exception ?? "") ? error.initdb.exception : undefined,
      initdbMessages: messages.length ? messages : undefined,
      initdbMessagePolicy: error?.initdb ? "bounded PostgreSQL error excerpts; unknown values withheld; no raw log" : undefined,
      initdbInputProfile: this.initdbInputProfile ? {
        explicitAsciiRole: this.initdbInputProfile.explicitAsciiRole === true,
        dbEncoding: "UTF8", locale: "C", passwordFile: "ASCII_UTF8_NO_BOM_LF",
        relativeDbAndPasswordPaths: true,
        resourcePathHasNonAscii: this.initdbInputProfile.resourcePathHasNonAscii === true,
        runPathHasNonAscii: this.initdbInputProfile.runPathHasNonAscii === true,
        declaredProcessCodePage: "UTF-8", effectiveProcessCodePage: "NOT_MEASURED",
      } : undefined,
      initdbCapture: error?.initdb?.capture ? {
        stdoutBytes: Number.isSafeInteger(error.initdb.capture.stdoutBytes) && error.initdb.capture.stdoutBytes >= 0 ?
          error.initdb.capture.stdoutBytes : undefined,
        stderrBytes: Number.isSafeInteger(error.initdb.capture.stderrBytes) && error.initdb.capture.stderrBytes >= 0 ?
          error.initdb.capture.stderrBytes : undefined,
        incomplete: error.initdb.capture.incomplete === true,
      } : undefined,
      port: PORTS.includes(error?.port) ? error.port : undefined,
      ownedApiPid: this.api?.pid, ownedDbPid: this.db?.pid, lockRetained: !!this.ownsLock,
      windowsAcceptance: "NOT RUN by build environment", paidCalls: 0 };
    const folder = path.join(this.root, "diagnostics");
    fs.mkdirSync(folder, { recursive: true });
    this.lastDiagnosticAt = Math.max(Date.now(), (this.lastDiagnosticAt ?? 0) + 1);
    const file = path.join(folder, `diagnostic-${this.lastDiagnosticAt}-${this.session}.json`);
    const first = path.join(this.root, "first-preparation-failure.json");
    let originalFailure;
    if (details.code === "INCOMPLETE_PREPARATION" && fs.existsSync(first)) {
      const name = json(first).file;
      if (/^diagnostic-\d+-[a-f0-9]{24}\.json$/.test(name)) {
        const original = path.join(folder, name);
        if (fs.existsSync(original)) {
          const prior = json(original);
          if (prior.packageId === this.identity.packageId) {
            details.originalPreparationDiagnostic = name;
            details.originalPreparationCode = systemError({ code: prior.code });
            originalFailure = { file: original, code: details.originalPreparationCode, fromPriorPreparation: true };
          }
        }
      }
    }
    fresh(file, details);
    if (this.newPreparation && this.stage !== "stop-owned-services" && !fs.existsSync(first))
      fresh(first, { file: path.basename(file) });
    if (originalFailure && !currentStatus) return originalFailure;
    return { file, code: originalFailure?.code ?? details.code };
  }
}
module.exports = { IsolatedRuntime, cleanEnv, systemError, assertPlainDirectory, BASE, PORTS,
  classifyInitdbFailure, initdbInvocation, safeInitdbMessage, collectInitdbMessages, writeInitdbPassword,
  supportsUtf8ProcessCodePage, databaseInvocation };
