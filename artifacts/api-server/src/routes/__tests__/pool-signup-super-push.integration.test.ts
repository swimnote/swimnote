/**
 * RUN_POOL_SIGNUP_FIXTURE=1 enables this isolated real-PostgreSQL suite.
 * Start only the hardcoded localhost fixture DB; never use a production URL.
 * Actual handler/notification AST statements are executed with only external
 * hashing/JWT/templates/ops/provider dependencies replaced. No full auth audit.
 */
import express from "express";
import request from "supertest";
import ts from "typescript";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, fixturePool } from "./helpers/pool-signup-fixture";
import { usersTable } from "../../../../../lib/db/src/schema/users";

vi.mock("@workspace/db", async () => {
  const { db } = await import("./helpers/pool-signup-fixture");
  return { db, superAdminDb: db };
});
vi.mock("../../lib/event-logger.js", () => ({ logOperationalError: vi.fn() }));
import { sendPushToSuperAdmins } from "../../lib/push-service";

function statement(file: string, match: (n: any) => boolean) {
  const text = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = ast.statements.find(match);
  if (!node) throw Error("SOURCE_STATEMENT_NOT_FOUND");
  return transformSync(node.getText(ast).replace(/^export\s+/, "").replace(/\bimport\(/g, "loadModule("),
    { loader: "ts", format: "cjs", target: "node20" }).code;
}
const quiet = { log() {}, warn() {}, error() {} };
const notify = new Function("superAdminDb", "sql", "sendPushToSuperAdmins", "console",
  statement("../../utils/notify.ts", n => ts.isFunctionDeclaration(n) && n.name?.text === "notifySuperAdmin") +
  "\nreturn notifySuperAdmin;")(db, sql, sendPushToSuperAdmins, quiet);
const registerCode = statement("../auth.ts", n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.arguments[0]?.text === "/register");
const tokenCode = ["/push-token"].flatMap(path => ["post", "delete"].map(method =>
  statement("../push-token.ts", n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.arguments[0]?.text === path && n.expression.expression.name?.text === method))).join("\n");
let tasks: Promise<any>[] = [];
let provider: ReturnType<typeof vi.fn>;
const signup = { email: "fixture_admin", password: "fixture_password", name: "Fixture Admin", role: "pool_admin",
  phone: "01000000000", pool_name: "Fixture Pool", pool_address: "Fixture Address",
  pool_phone: "01000000000", pool_owner_name: "Fixture Owner" };
function app() {
  const router = express.Router();
  const loadModule = async (path: string) => {
    if (path === "../lib/opsAlerts.js") return { createOpsAlert: async () => {} };
    if (path === "../utils/notify.js") return { notifySuperAdmin: (p: any) => {
      const task = notify(p); tasks.push(task); return task;
    }};
    throw Error("UNEXPECTED_DYNAMIC_IMPORT");
  };
  new Function("router", "signupLimiter", "superAdminDb", "db", "usersTable", "eq", "sql", "hashPassword",
    "signToken", "insertDefaultTemplates", "loadModule", "err", "console", registerCode)(
      router, (_r: any, _s: any, next: any) => next(), db, db, usersTable,
      (a: any, b: any) => sql`${a} = ${b}`, sql, async () => "fixture_hash", () => "fixture_jwt",
      async () => {}, loadModule, (res: any, status: number, message: string) => res.status(status).json({ message }), quiet);
  const tokenRouter = express.Router();
  new Function("router", "requireAuth", "db", "sql", "console", tokenCode)(
    tokenRouter, (req: any, _res: any, next: any) => { req.user = { userId: req.headers["x-fixture-user"] }; next(); }, db, sql, quiet);
  return express().use(express.json()).use("/api/auth", router).use("/api", tokenRouter);
}
async function settle() {
  await new Promise(r => setTimeout(r, 10));
  await Promise.all(tasks);
}
async function counts() {
  return (await fixturePool.query(`SELECT
    (SELECT count(*)::int FROM swimming_pools) AS pools,
    (SELECT count(*)::int FROM users WHERE id LIKE 'user_%') AS admins,
    (SELECT count(*)::int FROM teacher_invites) AS invites,
    (SELECT count(*)::int FROM super_admin_notifications) AS notifications`)).rows[0];
}
async function seedSuper(token = true) {
  await fixturePool.query(`INSERT INTO users(id,email,password_hash,name,role) VALUES
    ('fixture_super','fixture_super','hash','Fixture','super_admin')`);
  if (token) await fixturePool.query(`INSERT INTO push_tokens(id,user_id,token) VALUES
    ('fixture_super_token','fixture_super','ExpoPushToken[fixture-super]')`);
}
function event(poolId: string) {
  return { type: "POOL_SIGNUP", title: "수영장 신규 가입", body: "Fixture Pool 수영장이 새로 가입했습니다.",
    poolId, refId: poolId, refType: "pool", idempotencyKey: "pool_signup_" + poolId };
}

describe.skipIf(process.env.RUN_POOL_SIGNUP_FIXTURE !== "1")("pool signup → super push / isolated PostgreSQL", () => {
  beforeAll(async () => {
    if ((await fixturePool.query("SELECT current_database() AS db")).rows[0].db !== "swimnote_push_fixture") throw Error("UNSAFE_FIXTURE");
    await fixturePool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TYPE user_role AS ENUM ('super_admin','pool_admin','teacher','parent');
      CREATE TABLE users(id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,name text NOT NULL,
        phone text,role user_role DEFAULT 'parent',swimming_pool_id text,is_activated boolean DEFAULT true,
        is_admin_self_teacher boolean DEFAULT false,phone_verified boolean DEFAULT false,created_by text,
        permissions jsonb,roles text[] DEFAULT '{}',totp_secret text,totp_enabled boolean DEFAULT false,
        kakao_id text,apple_id text,withdrawal_requested_at timestamp,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
      CREATE TABLE swimming_pools(id text PRIMARY KEY,name text,name_en text UNIQUE,address text,phone text,
        owner_name text,owner_email text,admin_name text,admin_email text,admin_phone text,
        approval_status text,subscription_status text,trial_end_at timestamptz,created_at timestamptz DEFAULT now(),
        deactivated_at timestamptz,deletion_scheduled_at timestamptz);
      CREATE TABLE teacher_invites(id text PRIMARY KEY,swimming_pool_id text,name text,phone text,position text,
        invite_token text UNIQUE,invite_status text,invited_by text,user_id text,approved_at timestamptz,
        approved_by text,approved_role text,created_at timestamptz,requested_at timestamptz);
      CREATE TABLE super_admin_notifications(id text PRIMARY KEY,type text,title text,body text,pool_id text,
        ref_id text,ref_type text,is_read boolean,idempotency_key text,created_at timestamptz);
      CREATE UNIQUE INDEX fixture_notif_key ON super_admin_notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE push_tokens(id text PRIMARY KEY,user_id text,parent_account_id text,token text UNIQUE,updated_at timestamptz);
      CREATE TABLE push_settings(id text,user_id text,parent_account_id text,notification_type text,is_enabled boolean);
      CREATE TABLE push_logs(id text PRIMARY KEY,target_user_id text,role text,type text,status text,message text,
        triggered_by text,created_at timestamptz,pool_id text,recipient_count integer,error_message text);
      CREATE FUNCTION fixture_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'FIXTURE_INSERT_FAILURE'; END $$;`);
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    tasks = [];
    await fixturePool.query("TRUNCATE users,swimming_pools,teacher_invites,super_admin_notifications,push_tokens,push_settings,push_logs");
    provider = vi.fn(async (url: any, init: any) => {
      if (String(url) !== "https://exp.host/--/api/v2/push/send") throw Error("NON_FIXTURE_NETWORK_FORBIDDEN");
      return { ok: true, status: 200, json: async () => ({ data: JSON.parse(init.body).map(() => ({ status: "ok", id: "fixture_ticket" })) }) };
    });
    vi.stubGlobal("fetch", provider);
  });
  afterAll(async () => { vi.unstubAllGlobals(); await fixturePool.end(); });

  it("normal signup commits pool/admin/invite and dispatches once with safe persisted evidence", async () => {
    await seedSuper();
    expect((await request(app()).post("/api/auth/register").send(signup)).status).toBe(201);
    await settle();
    expect(await counts()).toEqual({ pools: 1, admins: 1, invites: 1, notifications: 1 });
    expect(provider).toHaveBeenCalledTimes(1);
    const logs = (await fixturePool.query("SELECT * FROM push_logs ORDER BY created_at")).rows;
    expect(logs).toHaveLength(1);
    const result = JSON.parse(logs[0].message);
    expect(result).toMatchObject({ dispatch_attempted: true, recipient_count: 1, provider_status: "accepted", accepted_count: 1 });
    expect(result.event_key).toMatch(/^pool_signup_pool_/);
    expect(JSON.stringify(logs)).not.toContain("Fixture Pool");
    expect(JSON.stringify(logs)).not.toContain("ExpoPushToken");
  });
  it("sequential signup event replay preserves one notification and one dispatch", async () => {
    await seedSuper();
    const response = await request(app()).post("/api/auth/register").send(signup); await settle();
    await notify(event(response.body.user.swimming_pool_id));
    expect((await counts()).notifications).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("concurrent DB insert contenders grant only one dispatch", async () => {
    await seedSuper();
    await Promise.all(Array.from({ length: 6 }, () => notify(event("fixture_same_pool"))));
    expect((await counts()).notifications).toBe(1); expect(provider).toHaveBeenCalledTimes(1);
  });
  it("no registered token preserves inbox and records skip", async () => {
    await seedSuper(false);
    expect((await request(app()).post("/api/auth/register").send(signup)).status).toBe(201); await settle();
    expect((await counts()).notifications).toBe(1); expect(provider).not.toHaveBeenCalled();
    expect((await fixturePool.query("SELECT status,error_message FROM push_logs")).rows[0])
      .toEqual({ status: "skipped", error_message: "NO_REGISTERED_TOKEN" });
  });
  it("identical HTTP request is rejected without another dispatch", async () => {
    await seedSuper(); const server = app();
    expect((await request(server).post("/api/auth/register").send(signup)).status).toBe(201); await settle();
    expect((await request(server).post("/api/auth/register").send(signup)).status).toBe(400); await settle();
    expect(await counts()).toEqual({ pools: 1, admins: 1, invites: 1, notifications: 1 }); expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each(["swimming_pools", "users", "teacher_invites"])("%s insert failure rolls back all core data, no notification or push", async table => {
    await seedSuper();
    await fixturePool.query(`CREATE TRIGGER fixture_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_reject_insert()`);
    try {
      expect((await request(app()).post("/api/auth/register").send(signup)).status).toBe(500); await settle();
      expect(await counts()).toEqual({ pools: 0, admins: 0, invites: 0, notifications: 0 }); expect(provider).not.toHaveBeenCalled();
    } finally { await fixturePool.query(`DROP TRIGGER fixture_fail ON ${table}`); }
  });
  it("no visibility/hook before COMMIT; dispatch follows successful COMMIT", async () => {
    await seedSuper();
    let staged!: () => void, release!: () => void;
    const stagedPromise = new Promise<void>(r => { staged = r; });
    const releasePromise = new Promise<void>(r => { release = r; });
    const actual = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation((cb: any) => actual(async tx => {
      const value = await cb(tx); staged(); await releasePromise; return value;
    }));
    const pending = request(app()).post("/api/auth/register").send(signup).then(r => r);
    await stagedPromise;
    try {
      expect(await counts()).toEqual({ pools: 0, admins: 0, invites: 0, notifications: 0 });
      expect(tasks).toHaveLength(0); expect(provider).not.toHaveBeenCalled();
    } finally { release(); }
    expect((await pending).status).toBe(201); await settle();
    expect(await counts()).toEqual({ pools: 1, admins: 1, invites: 1, notifications: 1 });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each(["rejected", "unknown", "missing_ticket", "network", "http_rejected", "bad_json"])("provider %s leaves signup/inbox intact, no ambiguous retry", async mode => {
    await seedSuper();
    provider.mockImplementation(async () => {
      if (mode === "network") throw Error("FIXTURE_NETWORK");
      if (mode === "unknown" || mode === "http_rejected") return { ok: false, status: mode === "unknown" ? 503 : 400 };
      return { ok: true, status: 200, json: async () => {
        if (mode === "bad_json") throw Error("FIXTURE_BAD_JSON");
        return { data: mode === "missing_ticket" ? [] : [{ status: "error", details: { error: "InvalidCredentials" } }] };
      }};
    });
    expect((await request(app()).post("/api/auth/register").send(signup)).status).toBe(201); await settle();
    expect(await counts()).toEqual({ pools: 1, admins: 1, invites: 1, notifications: 1 });
    expect(provider).toHaveBeenCalledTimes(1);
    const result = JSON.parse((await fixturePool.query("SELECT message FROM push_logs WHERE status='failed'")).rows[0].message);
    expect(result.provider_status).toBe(["rejected", "http_rejected"].includes(mode) ? "rejected" : "unknown");
    expect(result.provider_error).toBeTruthy();
  });
  it("notification insertion failure cannot roll back the committed signup", async () => {
    await seedSuper();
    await fixturePool.query("CREATE TRIGGER fixture_fail BEFORE INSERT ON super_admin_notifications FOR EACH ROW EXECUTE FUNCTION fixture_reject_insert()");
    try {
      expect((await request(app()).post("/api/auth/register").send(signup)).status).toBe(201); await settle();
      expect(await counts()).toEqual({ pools: 1, admins: 1, invites: 1, notifications: 0 });
      expect(provider).not.toHaveBeenCalled();
    } finally { await fixturePool.query("DROP TRIGGER fixture_fail ON super_admin_notifications"); }
  });
  it.each(["inactive", "withdrawal"])("signup excludes %s super admin despite a registered token", async state => {
    await seedSuper();
    await fixturePool.query(state === "inactive" ? "UPDATE users SET is_activated=false" :
      "UPDATE users SET withdrawal_requested_at=now()");
    expect((await request(app()).post("/api/auth/register").send(signup)).status).toBe(201); await settle();
    expect((await counts()).notifications).toBe(1); expect(provider).not.toHaveBeenCalled();
  });
  it("both pools' admins, teacher, legacy/modern parent excluded; source pool payload retained", async () => {
    await seedSuper();
    for (const [id, role, pid] of [["fixture_admin_a", "pool_admin", "pool_a"], ["fixture_admin_b", "pool_admin", "pool_b"],
      ["fixture_teacher", "teacher", "pool_a"], ["fixture_parent", "parent", "pool_b"]]) {
      await fixturePool.query("INSERT INTO users(id,email,password_hash,name,role,swimming_pool_id) VALUES($1,$1,'hash','Fixture',$2,$3)", [id, role, pid]);
      await fixturePool.query("INSERT INTO push_tokens(id,user_id,token) VALUES($1,$2,$3)", [id + "_token", id, "ExpoPushToken[" + id + "]"]);
    }
    await fixturePool.query("INSERT INTO push_tokens(id,parent_account_id,token) VALUES('fixture_pa','fixture_pa','ExpoPushToken[modern-parent]')");
    const response = await request(app()).post("/api/auth/register").send(signup); await settle();
    const messages = JSON.parse(provider.mock.calls[0][1].body);
    expect(messages.map((m: any) => m.to)).toEqual(["ExpoPushToken[fixture-super]"]);
    expect(messages[0].data.pool_id).toBe(response.body.user.swimming_pool_id);
  });
  it("current-device DELETE preserves other devices; POST rebind/idempotency uses authenticated user", async () => {
    const server = app(), token = "ExpoPushToken[device-T]";
    const post = (user: string, t: string) => request(server).post("/api/push-token").set("x-fixture-user", user).send({ token: t });
    await post("fixture_A", token); await post("fixture_A", "ExpoPushToken[other-device]");
    expect((await request(server).delete("/api/push-token").set("x-fixture-user", "fixture_B").send({ token })).status).toBe(200);
    expect((await fixturePool.query("SELECT count(*)::int AS n FROM push_tokens")).rows[0].n).toBe(2);
    expect((await request(server).delete("/api/push-token").set("x-fixture-user", "fixture_A").send({ token })).status).toBe(200);
    expect((await fixturePool.query("SELECT token FROM push_tokens")).rows).toEqual([{ token: "ExpoPushToken[other-device]" }]);
    await post("fixture_B", token); await post("fixture_B", token); await post("fixture_B", "ExpoPushToken[device-T2]");
    expect((await fixturePool.query("SELECT count(*)::int AS n FROM push_tokens WHERE user_id='fixture_B'")).rows[0].n).toBe(2);
    await post("fixture_A", token);
    expect((await fixturePool.query("SELECT user_id FROM push_tokens WHERE token=$1", [token])).rows[0].user_id).toBe("fixture_A");
  });
});
