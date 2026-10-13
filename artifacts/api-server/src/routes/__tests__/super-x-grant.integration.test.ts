/**
 * RUN_X_GRANT_FIXTURE=1: actual route SQL + PC mutation + mobile confirmation/load
 * statements against isolated PostgreSQL. JWT and background worker are injected;
 * never mutate a real customer pool or call the AI engine.
 */
import express from "express";
import request from "supertest";
import ts from "typescript";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { xGrantDb as db, xGrantPool as pg } from "./helpers/x-grant-fixture";

vi.mock("@workspace/db", async () => {
  const { xGrantDb } = await import("./helpers/x-grant-fixture");
  return { superAdminDb: xGrantDb, db: xGrantDb };
});
import { resolvePoolMode } from "../../lib/xmode";
import { checkXPrerequisite } from "../../lib/xmode-readiness";
import { getXMemberLimit, getXPlan } from "../../lib/xPlanCatalog";
import { isFreeGrowthReportEligiblePool, evaluateStudentGrowthReportEligibility } from "../../lib/growth-report-eligibility";
import { buildXCurriculumScope, CurriculumScopeError } from "../../lib/parent-curriculum-scope-builder";

const root = new URL("../../../../", import.meta.url);
function extract(relative: string, match: (node: ts.Node) => boolean, wrap = (code: string) => code) {
  const source = readFileSync(new URL(relative, root), "utf8");
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  function visit(n: ts.Node) {
    if (!found && match(n)) found = n;
    if (!found) ts.forEachChild(n, visit);
  }
  visit(ast);
  if (!found) throw Error("SOURCE_STATEMENT_NOT_FOUND: " + relative);
  return transformSync(wrap(found.getText(ast).replace(/^export\s+/, "").replace(/\bimport\(/g, "loadModule(")),
    { loader: "tsx", format: "cjs", target: "node20" }).code;
}
const superFile = "api-server/src/routes/super.ts";
const mobileFile = "swim-app/app/(super)/operator-detail.tsx";
const pcFile = "swimnote-dashboard/src/pages/super/SuperPoolDetailPage.tsx";
const variable = (name: string) => (n: ts.Node) =>
  ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name);
const routeCode = extract(superFile, n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.arguments[0]?.getText() === '"/super/operators/:id/xmode"');
const roleCode = extract("api-server/src/middlewares/auth.ts",
  n => ts.isFunctionDeclaration(n) && n.name?.text === "requireRole");
const requireRole = new Function("superAdminDb", "sql", roleCode + "\nreturn requireRole;")(db, sql);
const setupAccess = new Function("superAdminDb", "sql",
  extract("api-server/src/routes/x-setup.ts",
    n => ts.isFunctionDeclaration(n) && n.name?.text === "hasXEntitlement")
  + "\nreturn hasXEntitlement;")(db, sql);
const isXMode = new Function(extract("swim-app/constants/xTheme.ts",
  n => ts.isFunctionDeclaration(n) && n.name?.text === "isXMode") + "\nreturn isXMode;")();
const quiet = { log() {}, warn() {}, error: vi.fn() };
let tasks: Promise<any>[] = [];
let cycle: ReturnType<typeof vi.fn>;
function app() {
  const router = express.Router();
  const loadModule = async (name: string) => {
    if (name.includes("xmode-readiness")) return { checkXPrerequisite };
    if (name.includes("xPlanCatalog")) return { getXMemberLimit, getXPlan };
    if (name.includes("growth-report-scheduler")) return {
      ensureCurrentMonthGrowthReportCycle: (...args: any[]) => {
        const task = cycle(...args);
        tasks.push(task.catch(() => {}));
        return task;
      },
    };
    throw Error("UNEXPECTED_DYNAMIC_IMPORT");
  };
  new Function("router", "requireAuth", "requireRole", "superAdminDb", "sql", "loadModule", "console", routeCode)(
    router, (req: any, _res: any, next: any) => {
      req.user = { userId: "fixture-super", role: req.headers["x-fixture-role"] ?? "super_admin" };
      next();
    }, requireRole, db, sql, loadModule, quiet);
  router.get("/super/operators/:id", async (req, res) => {
    res.json({ pool: (await pg.query("SELECT * FROM swimming_pools WHERE id=$1", [req.params.id])).rows[0] });
  });
  router.get("/pools/x-mode", async (req, res) => res.json(await resolvePoolMode(String(req.query.pool_id))));
  return express().use(express.json()).use("/api", router);
}
async function settle() {
  await new Promise(r => setTimeout(r, 10));
  await Promise.all(tasks);
}
async function row(id = "A") {
  return (await pg.query("SELECT * FROM swimming_pools WHERE id=$1", [id])).rows[0];
}
function pc(client: any, plan: string) {
  const error = vi.fn(), invalidate = vi.fn();
  const api = { patch: async (url: string, body: any) => {
    const res = await request(client).patch("/api" + url).send(body);
    if (res.status >= 400) throw { status: res.status, message: res.body.message ?? res.body.error };
    return res.body;
  }};
   const notice = vi.fn();
   const mutation = new Function("useMutation", "api", "id", "xPlanKey", "setXGrantError", "qc", "setXGrantNotice",
    extract(pcFile, variable("xGrantMut")) + "\nreturn xGrantMut;")(
     (config: any) => config, api, "A", plan, error, { invalidateQueries: invalidate }, notice);
   return { mutation, error, invalidate, notice };
}
function mobile(client: any, plan: string) {
  const alerts = vi.fn(), state = { pool: null as any };
  const apiRequest = async (_token: string, url: string, options: any = {}) => {
    const req = options.method === "PATCH" ? request(client).patch("/api" + url).send(JSON.parse(options.body))
      : request(client).get("/api" + url);
    const res = await req;
    return { ok: res.status < 400, status: res.status, json: async () => res.body, text: async () => JSON.stringify(res.body) };
  };
  const load = new Function("useCallback", "id", "token", "apiRequest", "setLoading", "setPool",
    "setTeachers", "setLogs", "setPolicy", "setSupport", "setPlans", "setRefreshing", "console",
    extract(mobileFile, variable("load")) + "\nreturn load;")(
    (fn: any) => fn, "A", "fixture", apiRequest, () => {}, (p: any) => { state.pool = p; },
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, quiet);
  const toggle = new Function("xmodeLoading", "xPlanKey", "Alert", "apiRequest", "token", "id",
    "setXmodeLoading", "load", "console",
    extract(mobileFile, n => ts.isFunctionDeclaration(n) && n.name?.text === "doXmodeToggle")
    + "\nreturn doXmodeToggle;")(false, plan, { alert: alerts }, apiRequest, "fixture", "A", () => {}, load, quiet);
  async function confirm(grant: boolean) {
    await toggle(grant);
    const buttons = alerts.mock.calls[0]?.[2];
    if (buttons) await buttons.find((b: any) => b.text === "확인").onPress();
  }
  return { confirm, alerts, state };
}

describe.skipIf(process.env.RUN_X_GRANT_FIXTURE !== "1")("super X grant / isolated PostgreSQL", () => {
  beforeAll(async () => {
    expect((await pg.query("SELECT current_database() AS db")).rows[0].db).toBe("swimnote_xgrant_fixture");
    await pg.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE TABLE swimming_pools(
        id text PRIMARY KEY,approval_status text DEFAULT 'approved',
        x_paid_entitlement boolean DEFAULT false,x_manual_entitlement boolean DEFAULT false,
        x_force_disabled boolean DEFAULT false,x_management_override boolean DEFAULT false,
        xmode_config_status text DEFAULT 'NOT_CONFIGURED',x_plan_key text,member_limit int,
        storage_mb int,base_storage_gb int,display_storage text,updated_at timestamptz,
        x_trial_started_at timestamptz,x_trial_ends_at timestamptz,x_trial_used_at timestamptz,
        subscription_tier text DEFAULT 'free',subscription_status text,
        payment_suspended_at timestamptz,base_manual_entitlement boolean DEFAULT false
      );
      CREATE TABLE curriculum_versions(id text,swimming_pool_id text,is_global_reference boolean,is_active boolean,archived_at timestamptz);
      CREATE TABLE curriculum_items(id text,curriculum_version_id text,title text,description text,sort_order int,is_active boolean);
      CREATE TABLE global_template_sets(status text);
      CREATE TABLE diary_templates(scope text,swimming_pool_id text,is_active boolean);
      CREATE TABLE audit_logs(entity_type text,entity_id text,entity_version bigint,action text,actor_type text,actor_id text,pool_id text,before_data jsonb,after_data jsonb,reason text);
      CREATE FUNCTION next_audit_version(text,text) RETURNS bigint LANGUAGE SQL AS 'SELECT 1::bigint';
    `);
  });
  beforeEach(async () => {
    await pg.query("TRUNCATE swimming_pools,curriculum_versions,curriculum_items,audit_logs; INSERT INTO swimming_pools(id) VALUES ('A'),('B'); INSERT INTO curriculum_versions VALUES ('cv-A','A',false,true,null)");
    tasks = [];
    quiet.error.mockClear();
    cycle = vi.fn(async (poolId: string, passedDb: any) => {
      expect(poolId).toBe("A");
      expect(passedDb).toBe(db);
      const { rows } = await passedDb.execute(sql`SELECT id FROM swimming_pools WHERE id=${poolId} AND x_manual_entitlement=true`);
      expect(rows).toHaveLength(1);
      return { opened: true };
    });
  });
  afterAll(async () => { await pg.end(); });

  it.each(["x300", "x500", "x1000"])("PC selected %s ON → real SQL → resolver x → OFF / data preserved", async plan => {
    const b = await row("B"), client = app(), { mutation, invalidate } = pc(client, plan);
    const result = await mutation.mutationFn(true);
    await mutation.onSuccess(result, true);
    await settle();
    expect(await row()).toMatchObject({ x_manual_entitlement: true, x_paid_entitlement: false, x_plan_key: plan, xmode_config_status: "READY", member_limit: getXMemberLimit(plan) });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x", xmode_entitlement: true });
    expect(isFreeGrowthReportEligiblePool(await row())).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["super", "pool-x-mode", "A"] });
    expect(cycle).toHaveBeenCalledWith("A", db);
    await mutation.mutationFn(false);
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "normal", xmode_entitlement: false });
    expect((await pg.query("SELECT count(*)::int AS n FROM curriculum_versions")).rows[0].n).toBe(1);
    expect(await row("B")).toEqual(b);
    expect((await pg.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(2);
  });

  it.each(["x300", "x500", "x1000"])("Mobile %s ON/OFF recognizes HTTP success and reloads canonical mode", async plan => {
    const b = await row("B"), client = app(), on = mobile(client, plan);
    await on.confirm(true); await settle();
    expect(on.alerts).toHaveBeenCalledTimes(2);
    expect(on.alerts).toHaveBeenLastCalledWith("완료", "X 모드가 활성화되었습니다.");
    expect(on.state.pool).toMatchObject({ x_plan_key: plan, x_manual_entitlement: true, x_paid_entitlement: false, x_mode: "x", xmode_entitlement: true });
    expect(cycle).toHaveBeenCalledWith("A", db);
    const off = mobile(client, plan);
    await off.confirm(false);
    expect(off.alerts).toHaveBeenCalledTimes(2);
    expect(off.alerts).toHaveBeenLastCalledWith("완료", "X 사용권이 회수되었습니다.");
    expect(off.state.pool).toMatchObject({ x_manual_entitlement: false, x_mode: "normal", xmode_entitlement: false });
    expect((await pg.query("SELECT count(*)::int AS n FROM curriculum_versions")).rows[0].n).toBe(1);
    expect(await row("B")).toEqual(b);
  });

  it.each(["x300", "x500", "x1000"])("PC %s before curriculum → 200 / mode=x / config preserved / immediate GR HOLD", async plan => {
    await pg.query("TRUNCATE curriculum_versions");
    const b = await row("B"), web = pc(app(), plan);
    const response = await web.mutation.mutationFn(true);
    await web.mutation.onSuccess(response, true); await settle();
    expect(response).toMatchObject({ action: "granted", x_manual_entitlement: true });
    expect(await row()).toMatchObject({ x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false,
      x_plan_key: plan, xmode_config_status: "NOT_CONFIGURED", member_limit: getXMemberLimit(plan), storage_mb: getXPlan(plan)!.storageMb });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x", xmode_entitlement: true });
    expect(web.notice).toHaveBeenLastCalledWith("X 모드가 활성화되었습니다.");
    expect(web.error).not.toHaveBeenCalledWith(expect.stringContaining("커리큘럼이 필요"));
    expect(await checkXPrerequisite("A", db)).toMatchObject({ ready: false, missing: ["LOCAL_CURRICULUM_NOT_ACTIVE"] });
    expect((await pg.query("SELECT count(*)::int AS n FROM curriculum_versions")).rows[0].n).toBe(0);
    expect(await row("B")).toEqual(b);
    expect(cycle).not.toHaveBeenCalled();
  });

  it.each(["x300", "x500", "x1000"])("Mobile %s without curriculum → X success / OFF succeeds / no GR bootstrap", async plan => {
    await pg.query("TRUNCATE curriculum_versions");
    const b = await row("B"), client = app(), on = mobile(client, plan);
    await on.confirm(true); await settle();
    expect(on.state.pool).toMatchObject({ x_manual_entitlement: true, x_paid_entitlement: false,
      x_plan_key: plan, x_mode: "x", xmode_config_status: "NOT_CONFIGURED" });
    expect(on.alerts).toHaveBeenLastCalledWith("완료", "X 모드가 활성화되었습니다.");
    const off = mobile(client, plan); await off.confirm(false); await settle();
    expect(off.state.pool).toMatchObject({ x_manual_entitlement: false, x_mode: "normal" });
    expect(off.alerts).toHaveBeenLastCalledWith("완료", "X 사용권이 회수되었습니다.");
    expect(cycle).not.toHaveBeenCalled();
    expect(await row("B")).toEqual(b);
  });

  it("manual X reaches the actual X setup upload gate; later local data works without another grant; OFF preserves it", async () => {
    await pg.query("TRUNCATE curriculum_versions");
    const client = app();
    const grant = await request(client).patch("/api/super/operators/A/xmode")
      .send({ xmode_entitlement: true, x_plan_key: "x300" });
    expect(grant.status).toBe(200);
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x" });
    const mode = await resolvePoolMode("A");
    expect(isXMode(mode!.mode)).toBe(true); // Actual mobile X setup route guard.
    expect(await setupAccess("A")).toBe(true);
    expect(await setupAccess("B")).toBe(false);
    await expect(buildXCurriculumScope("A")).rejects.toMatchObject({ code: "CURRICULUM_NOT_REGISTERED" });
    // Canonical data produced by existing upload/activate flow; no entitlement rewrite.
    await pg.query(`INSERT INTO curriculum_versions VALUES ('late-A','A',false,true,null);
      INSERT INTO curriculum_items VALUES ('item-A','late-A','실제 등록 교육과정','fixture content',1,true)`);
    expect(await checkXPrerequisite("A", db)).toMatchObject({ ready: true });
    const scope = await buildXCurriculumScope("A");
    expect(scope.curriculum_items.map(item => item.id)).toEqual(["item-A"]);
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x" });
    expect((await row()).x_manual_entitlement).toBe(true);
    await request(client).patch("/api/super/operators/A/xmode").send({ xmode_entitlement: false });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "normal" });
    expect((await pg.query("SELECT count(*)::int AS n FROM curriculum_items")).rows[0].n).toBe(1);
  });

  it("real Parent AI scope gate returns 422 before engine/quota; empty Growth Report evidence remains excluded", async () => {
    await pg.query("TRUNCATE curriculum_versions");
    await request(app()).patch("/api/super/operators/A/xmode").send({ xmode_entitlement: true, x_plan_key: "x300" });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x" });
    const engine = vi.fn(), json = vi.fn(), res = { status: vi.fn(), json };
    res.status.mockReturnValue(res);
    const gateCode = extract("api-server/src/routes/parent-curriculum.ts",
      n => ts.isTryStatement(n) && n.tryBlock.getText().includes("curriculumScope = await buildXCurriculumScope(poolId)"),
      code => `async function parentGate(res) { let curriculumScope; ${code}; await engine(curriculumScope); }`);
    const gate = new Function("buildXCurriculumScope", "CurriculumScopeError", "poolId", "console", "engine",
      gateCode + "\nreturn parentGate;")(buildXCurriculumScope, CurriculumScopeError, "A", quiet, engine);
    await gate(res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "CURRICULUM_NOT_REGISTERED" }));
    expect(engine).not.toHaveBeenCalled();
    expect(evaluateStudentGrowthReportEligibility({ attendanceCount: 3, sourceEventCount: 0, reregistered: true }))
      .toMatchObject({ eligible: false, exclusion_code: "NO_SOURCE_DATA" });
    expect(cycle).not.toHaveBeenCalled();
  });

  it("paid-only without curriculum remains x_pending; revoking manual cannot bypass paid readiness", async () => {
    await pg.query("TRUNCATE curriculum_versions; UPDATE swimming_pools SET x_paid_entitlement=true WHERE id='A'");
    expect(await checkXPrerequisite("A", db)).toMatchObject({ ready: false });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x_pending" });
    const client = app();
    await request(client).patch("/api/super/operators/A/xmode").send({ xmode_entitlement: true, x_plan_key: "x300" });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x" });
    await request(client).patch("/api/super/operators/A/xmode").send({ xmode_entitlement: false });
    expect(await row()).toMatchObject({ x_paid_entitlement: true, x_manual_entitlement: false, xmode_config_status: "NOT_CONFIGURED" });
    expect(await resolvePoolMode("A")).toMatchObject({ mode: "x_pending" });
  });

  it("missing pool is still a prerequisite blocker, not covered by the SUPERADMIN exception", async () => {
    const before = await row(), b = await row("B");
    const res = await request(app()).patch("/api/super/operators/missing-pool/xmode")
      .send({ xmode_entitlement: true, x_plan_key: "x300" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "X_PREREQUISITE_NOT_MET", missing: ["POOL_NOT_FOUND"] });
    expect(await row()).toEqual(before);
    expect(await row("B")).toEqual(b);
    expect(cycle).not.toHaveBeenCalled();
  });

  it("background cycle failure never rolls back grant or becomes a mobile grant error", async () => {
    cycle.mockImplementation(async () => { throw Error("fixture background failure"); });
    const m = mobile(app(), "x500");
    await m.confirm(true); await settle();
    expect(m.alerts).toHaveBeenCalledTimes(2);
    expect(m.state.pool.x_mode).toBe("x");
    expect((await row()).x_manual_entitlement).toBe(true);
    expect(quiet.error).toHaveBeenCalled();
  });

  it.each(["pool_admin", "teacher", "parent_account"])("real role guard blocks %s before curriculum lookup", async role => {
    await pg.query("TRUNCATE curriculum_versions");
    const before = await row();
    const res = await request(app()).patch("/api/super/operators/A/xmode").set("x-fixture-role", role)
      .send({ xmode_entitlement: true, x_plan_key: "x300" });
    expect(res.status).toBe(403); expect(await row()).toEqual(before);
  });

  it("no selected plan sends no mobile request and exposes selection guidance", async () => {
    const m = mobile(app(), "");
    await m.confirm(true);
    expect(m.alerts).toHaveBeenCalledWith("X 플랜 선택", "X300, X500, X1000 중 부여할 플랜을 선택해주세요.");
    expect((await row()).x_manual_entitlement).toBe(false);
    expect(cycle).not.toHaveBeenCalled();
  });
});
