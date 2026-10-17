/** ISOLATION TOOL ONLY. No product app/index, DB bootstrap or fixture-auth import. */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { DB, ROOT, readJSON, assertRunDirectory, verifyCandidate } from "./common.mjs";
import { replayModel } from "./replay.mjs";
import { diagnosticApp } from "./api-app.js";

if (process.platform !== "win32" || !process.argv.includes("--isolated-only"))
  throw new Error("Windows isolated-only entrypoint");
const root = ROOT;
const manifest = verifyCandidate(root);
const folder = assertRunDirectory(process.argv[process.argv.indexOf("--run") + 1] ?? "");
const sessionId = process.argv[process.argv.indexOf("--session") + 1] ?? "";
if (!/^session-[a-f0-9]{24}$/.test(sessionId)) throw new Error("Invalid session identity");
const state = readJSON(path.join(folder, "private.json"));
if (state.candidateId !== manifest.candidateId) throw new Error("Run/candidate mismatch");
// Explicit fields ONLY. Never spread inherited process.env into DB configuration.
const pool = new pg.Pool({ ...DB, password: state.dbPassword, max: 3,
  connectionTimeoutMillis: 2000, options: "-c search_path=office_acceptance" });
const identity = (await pool.query("SELECT current_database() AS db, inet_server_addr()::text AS host")).rows[0];
if (identity.db !== DB.database || identity.host !== "127.0.0.1/32") throw new Error("Wrong DB");
const marker = (await pool.query("SELECT value FROM isolation_marker WHERE key='synthetic_only'")).rows[0];
if (marker?.value !== "office-stage3-acceptance") throw new Error("Synthetic marker absent");
const app = diagnosticApp(pool, replayModel(root), manifest.candidateId);
// Defaults stay OFF. No interpretation or writes can bypass the auth barrier.
process.env.OFFICE_STAGE3_ENABLED = "false";
process.env.OFFICE_STAGE3_AI_ENABLED = "false";
const server = app.listen(20411, "127.0.0.1", () => {
  fs.writeFileSync(path.join(folder, "sessions", sessionId, "api-ready.json"),
    JSON.stringify({ pid: process.pid, candidateId: state.candidateId }), { flag: "wx" });
  console.log("Isolated diagnostic API ready; canonical auth HOLD; business blocked; paid calls zero");
});
const close = () => server.close(() => { void pool.end(); });
process.on("SIGTERM", close);
process.on("SIGINT", close);
