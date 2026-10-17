import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { ROOT, DB, run, vacant, verifyCandidate, cleanEnv, readJSON, restrictDirectory, assertRunDirectory, sha } from "./common.mjs";
import { buildCandidate } from "./build.mjs";

const action = process.argv[2];
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 only; no service started");
if (!/^v24\./.test(process.version) || Number(process.versions.node.split(".")[1]) < 13)
  throw new Error("Host Node 24.13+ (24.x) required");
const manifest = verifyCandidate();
const at = process.argv.indexOf("--run");
let folder = at >= 0 ? assertRunDirectory(process.argv[at + 1]) : null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
const log = event => fs.appendFileSync(path.join(folder, "events.jsonl"),
  JSON.stringify({ at: new Date().toISOString(), event, candidateId: manifest.candidateId }) + "\n");
const privateState = () => {
  const state = readJSON(path.join(folder, "private.json"));
  if (state.candidateId !== manifest.candidateId) throw new Error("Run/candidate mismatch");
  return state;
};
function runtimes() {
  // Explicit external command, not automatic download/install. Avoid pnpm.cmd shell execution.
  const pg = run("postgres.exe", ["--version"]);
  if (!/\b16\.(?:1[0-9]|[2-9][0-9])\b/.test(pg)) throw new Error("PostgreSQL 16.10+ (16.x) required on PATH");
  for (const exe of ["initdb.exe", "psql.exe", "pg_ctl.exe"]) run(exe, ["--version"]);
  return { node: process.version, postgres: pg };
}
function ownBuild() {
  const report = readJSON(path.join(ROOT, "build-evidence/build-manifest.json"));
  if (report.candidateId !== manifest.candidateId) throw new Error("Build/candidate mismatch");
  for (const file of report.files) if (sha(fs.readFileSync(path.join(ROOT, file.path))) !== file.sha256)
    throw new Error("Build file changed");
  return report;
}
async function status() {
  const response = await fetch("http://127.0.0.1:20411/isolation/status", {
    signal: AbortSignal.timeout(2000), redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || body.candidateId !== manifest.candidateId || body.isolated !== true ||
      body.normalAuthReady !== false || body.paidCalls !== 0) throw new Error("Unexpected API identity");
  return body;
}

if (action === "VerifyCandidate") {
  console.log(JSON.stringify({ candidateId: manifest.candidateId, integrity: "PASS", normalAuth: "HOLD" }));
} else if (action === "BuildDesktop") {
  await buildCandidate();
  console.log("Verification build completed; NOT a Windows login/DPAPI acceptance result");
} else if (action === "Prepare") {
  if (folder) throw new Error("Prepare always creates a new run; it never overwrites an existing folder");
  const versions = runtimes();
  await vacant(DB.port); await vacant(20411);
  const parent = path.join(process.env.LOCALAPPDATA, "SwimNoteOffice-Isolated");
  fs.mkdirSync(parent, { recursive: true });
  if (fs.lstatSync(parent).isSymbolicLink() ||
      fs.realpathSync.native(parent).toLowerCase() !== path.resolve(parent).toLowerCase()) throw new Error("Parent reparse path rejected");
  folder = path.join(parent, "run-" + crypto.randomBytes(12).toString("hex"));
  fs.mkdirSync(folder);
  restrictDirectory(folder); // Abort BEFORE generating any credentials if ACL setup fails.
  const state = { candidateId: manifest.candidateId, dbPassword: crypto.randomBytes(32).toString("base64url") };
  writeJSON(path.join(folder, "private.json"), state);
  const pwfile = path.join(folder, "init-password.txt");
  fs.writeFileSync(pwfile, state.dbPassword + "\n", { flag: "wx", mode: 0o600 });
  try {
    run("initdb.exe", ["-D", path.join(folder, "db"), "-U", DB.user, "--encoding=UTF8",
      "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--pwfile=" + pwfile]);
  } finally { fs.unlinkSync(pwfile); }
  writeJSON(path.join(folder, "prepared.json"), { candidateId: manifest.candidateId, versions, normalAuthReady: false });
  log("prepared-no-services-started");
  console.log(`RunDirectory: ${folder}\nPreparation only. Normal auth HOLD; no credential values logged.`);
} else {
  if (!folder) throw new Error("Explicit -RunDirectory required");
  privateState();
  const activeFile = path.join(folder, "active.json");
  if (action === "Check") {
    ownBuild();
    if (!fs.existsSync(activeFile)) console.log("Prepared; services NOT RUN; normal auth HOLD");
    else {
      console.log(JSON.stringify(await status(), null, 2));
      const denied = await fetch("http://127.0.0.1:20411/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "app://office" },
        body: JSON.stringify({ email: "not-an-account", password: "not-a-password" }), redirect: "error",
      });
      if (denied.status !== 503 || (await denied.json()).code !== "ISOLATED_AUTH_NOT_READY")
        throw new Error("Auth barrier mismatch");
      log("diagnostic-check-auth-hold");
    }
  } else if (action === "LaunchDesktop") {
    ownBuild();
    await status();
    // Deliberately no --force or arbitrary URL override.
    throw new Error("HOLD: canonical synthetic authentication is not ready. Electron launch blocked; no product credentials can be reused.");
  } else if (action === "Stop") {
    if (!fs.existsSync(activeFile)) throw new Error("No owned active session; no process was stopped");
    const active = readJSON(activeFile);
    if (!/^session-[a-f0-9]{24}$/.test(active.sessionId)) throw new Error("Invalid active identity");
    fs.writeFileSync(path.join(folder, "sessions", active.sessionId, "stop.request"), "stop", { flag: "wx" });
    for (let n = 0; n < 120 && fs.existsSync(activeFile); n++) await wait(250);
    if (fs.existsSync(activeFile)) throw new Error("Supervisor did not confirm stop; no fallback PID kill was attempted");
    await vacant(DB.port); await vacant(20411);
    log("owned-services-closed");
    console.log("Owned supervisor confirmed shutdown; both ports closed. Synthetic data retained.");
  } else if (action === "DeleteData") {
    if (!process.argv.includes("--confirm-synthetic-data-deletion")) throw new Error("Explicit deletion confirmation required");
    if (fs.existsSync(activeFile)) throw new Error("Stop owned services first");
    await vacant(DB.port); await vacant(20411);
    const dbDir = path.join(folder, "db");
    if (fs.lstatSync(dbDir).isSymbolicLink()) throw new Error("DB path junction rejected");
    // Only this tool's uniquely created cluster and its private credential. Preserve logs.
    fs.rmSync(dbDir, { recursive: true });
    fs.unlinkSync(path.join(folder, "private.json"));
    log("explicit-synthetic-data-deletion");
    console.log("This run's synthetic cluster/credential deleted; evidence logs retained.");
  } else if (action === "Start") {
    runtimes(); ownBuild();
    await vacant(DB.port); await vacant(20411);
    const sessionId = "session-" + crypto.randomBytes(12).toString("hex");
    fs.mkdirSync(path.join(folder, "sessions"), { recursive: true });
    const session = path.join(folder, "sessions", sessionId);
    fs.mkdirSync(session);
    writeJSON(activeFile, { sessionId, supervisorPid: process.pid }); // Exclusive lock; stale lock requires inspection.
    let dbProcess, apiProcess, stopping = false;
    const shouldStop = () => fs.existsSync(path.join(session, "stop.request")) || stopping;
    process.on("SIGINT", () => { stopping = true; });
    process.on("SIGTERM", () => { stopping = true; });
    const state = privateState();
    const childEnv = cleanEnv();
    const sql = (database, input) => run("psql.exe", ["-X", "-w", "-v", "ON_ERROR_STOP=1",
      "-h", DB.host, "-p", String(DB.port), "-U", DB.user, "-d", database],
      { input, env: { ...childEnv, PGCLIENTENCODING: "UTF8", PGPASSWORD: state.dbPassword }, timeout: 30000 });
    try {
      dbProcess = spawn("postgres.exe", ["-D", path.join(folder, "db"), "-h", DB.host, "-p", String(DB.port)],
        { env: childEnv, stdio: "ignore", windowsHide: true });
      let spawnFailure = false;
      dbProcess.on("error", () => { spawnFailure = true; });
      let ready = false;
      for (let n = 0; n < 60 && !shouldStop(); n++) {
        if (spawnFailure || dbProcess.exitCode !== null) throw new Error("Owned PostgreSQL failed to start");
        try { sql("postgres", "SELECT 1;"); ready = true; break; } catch { await wait(250); }
      }
      if (!ready) throw new Error("Owned DB readiness timeout");
      const initialized = path.join(folder, "initialized.json");
      if (!fs.existsSync(initialized)) {
        sql("postgres", `CREATE DATABASE ${DB.database};`);
        const inputs = ["seed-isolated.sql", "receipts.draft.sql", "search-seed.sql"].map(name =>
          fs.readFileSync(path.join(ROOT, "scripts/office-stage3", name), "utf8")).join("\n");
        sql(DB.database, "BEGIN;\n" + inputs + "\nCOMMIT;");
        writeJSON(initialized, { candidateId: manifest.candidateId, syntheticOnly: true });
      }
      sql(DB.database, "SET search_path=office_acceptance; DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM isolation_marker WHERE key='synthetic_only' AND value='office-stage3-acceptance') THEN RAISE EXCEPTION 'Wrong DB'; END IF; END $$;");
      // Run source through the locked local tsx CLI; no operating API bootstrap or dist.
      const tsx = path.join(ROOT, "node_modules/tsx/dist/cli.mjs");
      apiProcess = spawn(process.execPath, [tsx, path.join(ROOT, "scripts/office-stage3/windows/api.ts"),
        "--isolated-only", "--run", folder, "--session", sessionId],
        { env: childEnv, stdio: "ignore", windowsHide: true });
      apiProcess.on("error", () => { stopping = true; });
      let apiReady = false;
      for (let n = 0; n < 60 && !shouldStop(); n++) {
        try { await status(); apiReady = true; break; } catch { await wait(250); }
      }
      if (!apiReady) throw new Error("Isolated API readiness failed");
      log("started-diagnostic-only-auth-hold");
      console.log("Owned local DB/API started. Keep this terminal open. Normal auth HOLD; no Electron launch or paid inference.");
      while (!shouldStop()) {
        if (apiProcess.exitCode !== null || dbProcess.exitCode !== null) throw new Error("Owned child exited");
        await wait(250);
      }
    } finally {
      let closed = true;
      if (apiProcess && apiProcess.exitCode === null) {
        apiProcess.kill(); // The exact ChildProcess created above, never a supplied PID.
        for (let n = 0; n < 40 && apiProcess.exitCode === null; n++) await wait(100);
        if (apiProcess.exitCode === null) closed = false;
      }
      if (dbProcess && dbProcess.pid && dbProcess.exitCode === null) {
        const pid = Number(fs.readFileSync(path.join(folder, "db/postmaster.pid"), "utf8").split("\n")[0]);
        if (pid !== dbProcess.pid) throw new Error("DB ownership mismatch; refused pg_ctl shutdown");
        run("pg_ctl.exe", ["-D", path.join(folder, "db"), "stop", "-m", "fast", "-w", "-t", "15"]);
      }
      if (closed) {
        writeJSON(path.join(session, "stopped.json"), { at: new Date().toISOString(), normalAuthReady: false });
        fs.unlinkSync(activeFile);
        log("supervisor-closed-owned-children");
      }
    }
  } else throw new Error("Unknown action");
}
