import fs from "node:fs";
import path from "node:path";
import express from "express";
import { pool, runDirectory, privateState } from "./database.js";
import authRouter from "../../../../artifacts/api-server/src/routes/auth.js";
import poolsRouter from "../../../../artifacts/api-server/src/routes/pools.js";
import officeRouter from "../../../../artifacts/api-server/src/routes/office.js";
import { requireAuth, requireDbRoleCheck } from "../../../../artifacts/api-server/src/middlewares/auth.js";
const marker = await pool.query("SELECT value FROM isolation_marker WHERE key='normal_auth'");
if (marker.rows[0]?.value !== "real-handlers-local-db") throw new Error("Normal auth schema not initialized");
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12kb" }));
const controlFile = path.join(runDirectory, "fault-control.json");
const control = () => JSON.parse(fs.readFileSync(controlFile, "utf8"));
app.use((req, res, next) => {
  const allowedOrigins = process.argv.includes("--linux-browser") ? ["app://office", "http://127.0.0.1:20412"] : ["app://office"];
  if (req.headers.host !== "127.0.0.1:20411" || req.headers.origin && !allowedOrigins.includes(req.headers.origin))
    return void res.sendStatus(403);
  if (req.headers.origin) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});
app.get("/isolation/status", (_req, res) => res.json({
  candidateId: privateState.candidateId, isolated: true, normalAuthReady: true,
  executionReady: control().writes, modelMode: "recorded-only", paidCalls: 0,
}));
// Exact routes only. Product router registers more handlers but they are unreachable here.
const authPaths = new Map([["POST /login", true], ["POST /web-pin/verify", true], ["POST /totp/verify-login", true], ["GET /me", true]]);
app.use("/api/auth", (req, res, next) => {
  if (!authPaths.has(req.method + " " + req.path)) return void res.sendStatus(404);
  // Current product Drizzle users declaration omits migrated web_pin_hash.
  // A PIN account must use its canonical Pool slug (raw SQL product branch), never email to bypass PIN.
  if (req.path === "/login" && req.body?.web_login !== true)
    return void res.status(400).json({ code: "WEB_LOGIN_REQUIRED" });
  const identifier = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const pinAccount = privateState.accounts.find((a: any) => a.pin && identifier === a.email);
  if (req.path === "/login" && pinAccount) return void res.status(400).json({ code: "USE_SYNTHETIC_LOGIN_ID", error: "로컬 안내의 합성 로그인 ID를 사용하세요." });
  next();
}, authRouter);
app.use("/api/pools", (req, res, next) => ["GET /my-pools", "GET /x-mode"].includes(req.method + " " + req.path) ? next() : void res.sendStatus(404), poolsRouter);
app.use("/api/office", requireAuth as any, requireDbRoleCheck as any, (req: any, res, next) => {
  const config = control();
  process.env.OFFICE_STAGE3_ENABLED = String(config.writes);
  process.env.OFFICE_STAGE3_AI_ENABLED = "true"; // Recorded-only transport; no SDK exists in this bundle.
  if (config.failRead && req.user?.poolId === "fixture_pool" && req.method === "GET" && (config.failRead === "next" || req.path === "/commands/" + config.failRead)) {
    if (config.failRead === "next") { const latest = control(); latest.failRead = null; fs.writeFileSync(controlFile, JSON.stringify(latest)); }
    return void current(req, res, () => res.status(503).json({ code: "ISOLATED_READ_FAULT" }));
  }
  // Suppress delivery only after actual handler commits and calls res.json successfully.
  if ((config.dropRequest === req.body?.requestId || config.dropNext && req.body?.memberId === "fixture_member") &&
      req.method === "POST" && req.path === "/command") {
    const send = res.json.bind(res);
    res.json = ((body: any) => {
      if (res.statusCode < 300) {
        fs.appendFileSync(path.join(runDirectory, "fault-events.jsonl"), JSON.stringify({ event: "committed-response-dropped", requestId: req.body.requestId }) + "\n");
        const latest = control(); latest.dropRequest = null; latest.dropNext = false;
        fs.writeFileSync(controlFile, JSON.stringify(latest));
        // Flush a partial response before closing. A bare pre-header reset may be
        // transparently retried by Chromium and would NOT exercise the unknown UI state.
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Length", "1000000");
        res.flushHeaders();
        res.write('{"interrupted":');
        setTimeout(() => res.destroy(), 100);
        return res;
      }
      return send(body);
    }) as any;
  }
  next();
}, officeRouter);
const current = async (req: any, res: any, next: any) => {
  const rows = (await pool.query(`SELECT u.id,u.swimming_pool_id FROM users u JOIN swimming_pools p ON p.id=u.swimming_pool_id
    WHERE u.id=$1 AND u.is_activated AND u.withdrawal_requested_at IS NULL AND p.deactivated_at IS NULL
      AND u.role='pool_admin' AND u.roles @> ARRAY['pool_admin']::text[] AND u.swimming_pool_id=$2`, [req.user.userId, req.user.poolId])).rows;
  if (!rows.length) return void res.sendStatus(403);
  req.isolatedPool = rows[0].swimming_pool_id; next();
};
app.use("/api", requireAuth as any, requireDbRoleCheck as any, current);
app.get("/api/students", async (req: any, res) => {
  if (control().failMembersRead && req.isolatedPool === "fixture_pool")
    return void res.status(503).json({ code: "ISOLATED_RESULT_READ_FAULT" });
  const groups = (await pool.query("SELECT * FROM class_groups WHERE swimming_pool_id=$1", [req.isolatedPool])).rows;
  const rows = (await pool.query("SELECT *,md5(row_to_json(s)::text) AS office_revision FROM students s WHERE swimming_pool_id=$1", [req.isolatedPool])).rows;
  res.json(rows.map(s => ({ ...s, class_group_name: groups.find(g => g.id === s.class_group_id)?.name ?? null,
    assignedClasses: groups.filter(g => s.assigned_class_ids.includes(g.id)).map(g => ({ ...g, class_name: g.name })),
    office_stage3_enabled: control().writes })));
});
app.get("/api/class-groups", async (req: any, res) => res.json((await pool.query("SELECT * FROM class_groups WHERE swimming_pool_id=$1", [req.isolatedPool])).rows));
app.get("/api/admin/dashboard-stats", (_req, res) => res.json({}));
app.get("/api/admin/growth-reports/students/:id", (_req, res) => res.json({ success: true, reports: [] }));
app.use((_req, res) => { res.sendStatus(404); });
const server = app.listen(20411, "127.0.0.1", () => console.log("Normal isolated auth API ready; replay only; credentials not logged"));
process.on("SIGTERM", () => server.close(() => { void pool.end(); }));
