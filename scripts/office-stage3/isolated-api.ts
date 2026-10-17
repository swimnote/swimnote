/** Test entrypoint ONLY. Does not import API app/index/routes/office or @workspace/db. */
import express from "../../artifacts/api-server/node_modules/express/index.js";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { OfficeCommandService, OfficeError } from "../../artifacts/api-server/src/lib/office-command.js";
import { createOfficeRouter } from "../../artifacts/api-server/src/lib/office-http.js";
import rateLimit from "../../artifacts/api-server/node_modules/express-rate-limit/dist/index.mjs";
import { approvedModel, context } from "./real-ai.js";
const { Pool } = createRequire(new URL("../package.json", import.meta.url))("pg");
if (!process.argv.includes("--isolated-only")) throw new Error("Isolated-only flag required");
// Deliberately no environment DSN, credentials, URL override or remote host option.
const pool = new Pool({ host: "127.0.0.1", port: 55440, database: "office_stage3_acceptance",
  user: "office_fixture", options: "-c search_path=office_acceptance", connectionTimeoutMillis: 2000 });
const check = (await pool.query("SELECT current_database() AS name,inet_server_addr()::text AS host")).rows[0];
if (check.name !== "office_stage3_acceptance" || check.host !== "127.0.0.1/32") throw new Error("Not the isolated acceptance DB");
const marker = await pool.query("SELECT value FROM isolation_marker WHERE key='synthetic_only'");
if (marker.rows[0]?.value !== "office-stage3-acceptance") throw new Error("Synthetic-only marker missing");
const token = randomBytes(32).toString("hex");
const out = fileURLToPath(new URL("../../generated-artifacts/office-stage3-isolated/", import.meta.url));
mkdirSync(out, { recursive: true });
const actor = { userId: "fixture_admin", poolId: "fixture_pool", role: "pool_admin" };
const evalTokens = Object.fromEntries(Array.from({ length: 4 }, (_, i) => ["fixture_eval_" + i, randomBytes(32).toString("hex")]));
const probeToken = randomBytes(32).toString("hex");
const sessions = new Map([[token, actor], ...Object.entries(evalTokens).map(([userId, t]) => [t, { ...actor, userId }] as const),
  [probeToken, { ...actor, userId: "fixture_probe" }]]);
for (const principal of sessions.values()) await pool.query(`INSERT INTO fixture_principals(id,active,role,pool_id)
  VALUES ($1,true,'pool_admin','fixture_pool') ON CONFLICT(id) DO NOTHING`, [principal.userId]);
writeFileSync(out + "fixture-session.json", JSON.stringify({ token, evalTokens, probeToken }), { mode: 0o600 });
const model = process.argv.includes("--real-ai-approved") ? await approvedModel() :
  async () => { throw new Error("Paid model forbidden without explicit approval"); };
const app = express(); app.disable("x-powered-by"); app.use(express.json({ limit: "12kb" }));
app.use((req: any, res: any, next: any) => {
  if (req.headers.origin && req.headers.origin !== "http://127.0.0.1:20412") return res.sendStatus(403);
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:20412");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  const principal = sessions.get(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
  if (!principal) return res.sendStatus(401);
  req.user = principal;
  context.run({ actor: principal.userId, caseId: String(req.headers["x-fixture-case"] ?? "browser").slice(0, 80) }, next);
});
const authority = async (req?: any) => {
  const principal = req?.user ?? actor;
  const row = (await pool.query("SELECT active,role,pool_id FROM fixture_principals WHERE id=$1", [principal.userId])).rows[0];
  if (!row?.active || row.role !== "pool_admin" || row.pool_id !== principal.poolId)
    throw new OfficeError(403, "FORBIDDEN", "Fixture authority revoked");
  return principal;
};
app.use("/api/office", createOfficeRouter({ service: new OfficeCommandService(pool), auth: [(_req: any, _res: any, next: any) => next()],
  actor: authority, model, notify: async () => {} }));
// Evaluation ONLY: raw model behavior for requests production preflight already blocks.
// This response cannot enter ActionCore as a proposal. No business service is called.
app.post("/fixture/model-probe", rateLimit({ windowMs: 600000, limit: 6,
  keyGenerator: (req: any) => req.user.userId }), async (req: any, res: any) => {
  if (req.user.userId !== "fixture_probe") return res.sendStatus(403);
  try { await authority(req); res.json({ kind: "evaluation-only", raw: await model(req.body) }); }
  catch { res.status(502).json({ error: "Probe failed; no retry" }); }
});
app.post("/fixture/control", (req: any, res: any) => {
  if (req.user.userId !== "fixture_admin" || Object.keys(req.body).some(k => k !== "writes") ||
      typeof req.body.writes !== "boolean") return res.sendStatus(403);
  process.env.OFFICE_STAGE3_ENABLED = String(req.body.writes); res.json({ ok: true });
});
app.get("/api/students", async (_req: any, res: any) => {
  await authority(_req);
  const groups = (await pool.query("SELECT * FROM class_groups")).rows;
  const rows = (await pool.query("SELECT s.*,md5(row_to_json(s)::text) AS office_revision FROM students s")).rows;
  res.json(rows.map((s: any) => ({ ...s,
    class_group_name: groups.find((g: any) => g.id === s.class_group_id)?.name ?? null,
    assignedClasses: groups.filter((g: any) => s.assigned_class_ids.includes(g.id)).map((g: any) => ({ ...g, class_name: g.name })),
    office_stage3_enabled: process.env.OFFICE_STAGE3_ENABLED === "true" })));
});
app.get("/api/class-groups", async (_req: any, res: any) => { await authority(_req); res.json((await pool.query("SELECT * FROM class_groups")).rows); });
app.get("/api/admin/dashboard-stats", async (_req: any, res: any) => { await authority(_req); res.json({}); });
app.get("/api/admin/growth-reports/students/:id", async (_req: any, res: any) => { await authority(_req); res.json({ success: true, reports: [] }); });
// No legacy route, login endpoint, provider, public listener, production account or upload handler.
const server = app.listen(20411, "127.0.0.1", () => process.stdout.write("Isolated fixture API on loopback 20411; session token not logged\n"));
process.on("SIGTERM", () => server.close(() => { void pool.end(); }));
