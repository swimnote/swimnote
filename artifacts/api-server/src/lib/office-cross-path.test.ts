import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import express from "express";
import { OfficeCommandService, assertOfficeRequestWindow, OFFICE_RECONFIRM_MS } from "./office-command.js";
import { interpretOffice, OFFICE_BUSINESS_POLICY } from "./office-interpret.js";

// Every transitive DB import resolves here. An uninitialized fixture is fatal, not a production fallback.
const state = vi.hoisted(() => ({ db: null as any, pool: null as any, modelCalls: 0, options: null as any, modelFailure: false, truncated: false }));
vi.mock("@workspace/db", () => ({
  get db() { if (!state.db) throw new Error("Operating DB forbidden"); return state.db; },
  get superAdminDb() { if (!state.db) throw new Error("Operating DB forbidden"); return state.db; },
  get pool() { if (!state.pool) throw new Error("Operating DB forbidden"); return state.pool; },
}));
vi.mock("../middlewares/auth.js", () => {
  const role = (...roles: string[]) => (req: any, res: any, next: any) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  return { requireAuth: (req: any, _res: any, next: any) => { req.user = { userId: req.headers.authorization ?? "admin_fixture", role: "pool_admin" }; next(); },
    requireRole: role, requirePermission: () => (_q: any, _s: any, next: any) => next(), requireXMode: (_q: any, _s: any, next: any) => next() };
});
vi.mock("./pool-event-logger.js", () => ({ logPoolEvent: async () => {} }));
vi.mock("../utils/change-logger.js", () => ({ logChange: async () => {} }));
vi.mock("../utils/messenger-system.js", () => ({ createSystemMessage: async () => {} }));
vi.mock("./auto-link-v2.js", () => ({ triggerAutoLinkOnStudentV2: async () => {} }));
vi.mock("./parent-approval-hooks.js", () => ({ onParentApproved: async () => {} }));
vi.mock("./pg-realtime.js", () => ({ notifyPoolEvent: async () => {} }));
vi.mock("./objectStorage.js", () => ({ uploadToR2: () => { throw new Error("Upload forbidden"); }, getPresignedUrl: () => { throw new Error("Storage forbidden"); } }));
vi.mock("../routes/ai.js", () => ({ getOpenAI: () => ({ chat: { completions: { create: async (body: any, options: any) => {
  state.modelCalls++; state.options = { body, options };
  if (state.modelFailure) throw new Error("synthetic timeout — not a network call");
  return { choices: [{ finish_reason: state.truncated ? "length" : "stop", message: { content: JSON.stringify({ kind: "clarify", question: "합성 회원을 선택하세요." }) } }] };
} } } }) }));
const { Pool } = createRequire(new URL("../../../../lib/db/package.json", import.meta.url))("pg");
let pool: any, server: any, base = "", service: OfficeCommandService;
let paused: null | { reached: () => void; wait: Promise<void> } = null;
const actor = { userId: "admin_fixture", poolId: "pool_fixture", role: "pool_admin" };
const rid = (suffix: string) => `oc1_${Date.now()}_${suffix}`;
const rev = async (id = "member_one") => (await pool.query("SELECT md5(row_to_json(s)::text) AS revision FROM students s WHERE id=$1", [id])).rows[0].revision;
const command = async (id = "member_one", extra = {}) => ({ action: "update", memberId: id, requestId: rid(crypto.randomUUID()),
  expectedRevision: await rev(id), changes: { memo: "OFFICE 합성" }, ...extra });
const http = async (method: string, path: string, body?: unknown, user = "admin_fixture") => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
};
function pauseLegacyRead() {
  let release!: () => void, reached!: () => void;
  const ready = new Promise<void>(r => { reached = r; });
  paused = { reached, wait: new Promise<void>(r => { release = r; }) };
  return { ready, release };
}
beforeAll(async () => {
  const settings = { host: "127.0.0.1", port: 55439, database: "office_stage3_fixture", user: "office_fixture", max: 12, connectionTimeoutMillis: 2000 };
  pool = new Pool(settings);
  expect((await pool.query("SELECT current_database() AS db,inet_server_addr()::text AS host")).rows[0])
    .toEqual({ db: "office_stage3_fixture", host: "127.0.0.1/32" });
  await pool.query("DROP SCHEMA IF EXISTS office_cross_fixture CASCADE; CREATE SCHEMA office_cross_fixture");
  await pool.end(); pool = new Pool({ ...settings, options: "-c search_path=office_cross_fixture" });
  // Full column sets for actual Drizzle handlers. Non-receipt nullable fixture columns are not production-schema evidence.
  for (const table of [schema.studentsTable, schema.classGroupsTable, schema.usersTable]) {
    const config = getTableConfig(table);
    await pool.query(`CREATE TABLE "${config.name}" (${config.columns.map(c =>
      `"${c.name}" ${/^[a-z_]+$/.test(c.getSQLType()) && !["text", "integer", "boolean", "jsonb", "date", "timestamp", "real"].includes(c.getSQLType()) ? "text" : c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`).join(",")})`);
  }
  await pool.query(`CREATE TABLE student_class_history(id text PRIMARY KEY, student_id text,
    class_group_id text, swimming_pool_id text, enrolled_at date, left_at date, created_at timestamptz DEFAULT now())`);
  const migration = readFileSync(new URL("../../../../lib/db/drizzle/0001_sad_piledriver.sql", import.meta.url), "utf8");
  const receiptDdl = migration.match(/CREATE TABLE "pool_event_logs" \([\s\S]*?\n\);/)?.[0];
  if (!receiptDdl) throw new Error("Receipt migration definition missing");
  await pool.query(receiptDdl);
  const originalQuery = pool.query.bind(pool);
  pool.query = async (...args: any[]) => {
    const text = typeof args[0] === "string" ? args[0] : args[0].text;
    const result = await originalQuery(...args);
    if (paused && /^select /i.test(text.trim()) && (/from "students"/i.test(text) || /FROM students s WHERE id\s*=/i.test(text)) && !/AS revision FROM/.test(text)) {
      const p = paused; paused = null; p.reached(); await p.wait;
    }
    return result;
  };
  state.pool = pool; state.db = drizzle(pool, { schema }); service = new OfficeCommandService(pool);
  const app = express(); app.use(express.json());
  app.use("/students", (await import("../routes/students.js")).default);
  app.use("/admin", (await import("../routes/admin.js")).default);
  app.use("/office", (await import("../routes/office.js")).default);
  server = await new Promise<any>(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);
beforeEach(async () => {
  paused = null; state.modelCalls = 0; state.modelFailure = false; state.truncated = false;
  vi.stubEnv("OFFICE_STAGE3_ENABLED", "true"); vi.stubEnv("OFFICE_STAGE3_AI_ENABLED", "false");
  await pool.query(`TRUNCATE students,class_groups,users,student_class_history,pool_event_logs;
    INSERT INTO users(id,name,role,swimming_pool_id) VALUES ('admin_fixture','합성 관리자','pool_admin','pool_fixture'),('other_admin','합성 다른 관리자','pool_admin','pool_fixture');
    INSERT INTO class_groups(id,swimming_pool_id,name,schedule_days,schedule_time,capacity,is_deleted,is_one_time)
      VALUES ('class_a','pool_fixture','A','월수금','16:00',10,false,false),('class_b','pool_fixture','B','화목','17:00',10,false,false),
        ('class_c','pool_fixture','C','토','10:00',1,false,false),('class_d','pool_fixture','D','일','11:00',10,false,false);
    INSERT INTO students(id,swimming_pool_id,name,status,parent_user_id,class_group_id,assigned_class_ids,weekly_count,updated_at)
      VALUES ('member_one','pool_fixture','합성 동명','active','synthetic_parent','class_a','["class_a","class_b"]',3,clock_timestamp()),
             ('member_two','pool_fixture','합성 동명','active','synthetic_parent','class_a','["class_a","class_b"]',3,clock_timestamp());
    INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at)
      VALUES ('h1a','member_one','class_a','pool_fixture','2026-01-01'),('h1b','member_one','class_b','pool_fixture','2026-01-01'),
             ('h2a','member_two','class_a','pool_fixture','2026-01-01'),('h2b','member_two','class_b','pool_fixture','2026-01-01');`);
});
afterAll(async () => { vi.unstubAllEnvs(); if (server) await new Promise<void>(r => server.close(() => r())); if (pool) await pool.end(); });
describe("actual legacy handlers + OFFICE, isolated SQL only", () => {
  for (const path of ["/students/member_one", "/admin/students/member_one/info"]) {
    it(`${path}: stale server snapshot after OFFICE commit returns 409, does not overwrite`, async () => {
      const c = await command(), p = pauseLegacyRead();
      const legacy = http("PATCH", path, { memo: "legacy 합성" });
      await p.ready; await service.execute(actor, c); p.release();
      expect((await legacy).status).toBe(409);
      expect((await pool.query("SELECT memo FROM students WHERE id='member_one'")).rows[0].memo).toBe("OFFICE 합성");
    });
    it(`${path}: legacy commit first invalidates OFFICE row revision`, async () => {
      const c = await command();
      expect((await http("PATCH", path, { memo: "legacy 먼저" })).status).toBe(200);
      await expect(service.execute(actor, c)).rejects.toMatchObject({ code: "CONFLICT" });
    });
  }
  for (const legacyPath of ["assign", "move-class"]) {
    it(`last seat: actual legacy ${legacyPath} + OFFICE cannot both commit`, async () => {
      const c = await command("member_one", { action: "move", changes: undefined, fromClassId: "class_a", toClassId: "class_c" });
      // JSON omission matches real HTTP parsing.
      Reflect.deleteProperty(c, "changes");
      const body = legacyPath === "assign" ? { assigned_class_ids: ["class_c", "class_b"] }
        : { from_class_id: "class_a", to_class_id: "class_c" };
      const [a, b] = await Promise.all([
        http("POST", "/office/command", c),
        http(legacyPath === "assign" ? "PATCH" : "POST", "/students/member_two/" + legacyPath, body),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(+(await pool.query("SELECT count(*) AS n FROM student_class_history WHERE class_group_id='class_c' AND left_at IS NULL")).rows[0].n).toBe(1);
    });
  }
  it("same member, different membership: a stale legacy move cannot discard OFFICE's other change", async () => {
    const c = await command("member_one", { action: "move", changes: undefined, fromClassId: "class_a", toClassId: "class_c" });
    Reflect.deleteProperty(c, "changes");
    const p = pauseLegacyRead(), legacy = http("POST", "/students/member_one/move-class", { from_class_id: "class_b", to_class_id: "class_d" });
    await p.ready; await service.execute(actor, c); p.release();
    expect((await legacy).status).toBe(409);
    const row = (await pool.query("SELECT assigned_class_ids,weekly_count,schedule_labels FROM students WHERE id='member_one'")).rows[0];
    expect(row).toEqual({ assigned_class_ids: ["class_c", "class_b"], weekly_count: 3, schedule_labels: "토10·화17·목17" });
    expect((await pool.query("SELECT class_group_id FROM student_class_history WHERE student_id='member_one' AND left_at IS NULL ORDER BY class_group_id")).rows)
      .toEqual([{ class_group_id: "class_b" }, { class_group_id: "class_c" }]);
  });
  it("gate OFF preserves existing legacy assignment behavior; not a global safety claim", async () => {
    vi.stubEnv("OFFICE_STAGE3_ENABLED", "false");
    await pool.query("UPDATE class_groups SET capacity=0 WHERE id='class_c'");
    expect((await http("PATCH", "/students/member_one/assign", { assigned_class_ids: ["class_c", "class_b"] })).status).toBe(200);
  });
  it("boundary: an unversioned old-client form submitted AFTER OFFICE commit is not protected by server-read CAS", async () => {
    const staleForm = { name: "합성 동명" };
    await service.execute(actor, await command("member_one", { changes: { name: "OFFICE 새 이름" } }));
    // No client revision exists in the legacy request. Requiring one breaks old clients and needs separate rollout approval.
    expect((await http("PATCH", "/students/member_one", staleForm)).status).toBe(200);
    expect((await pool.query("SELECT name FROM students WHERE id='member_one'")).rows[0].name).toBe("합성 동명");
  });
  it("same visible values but changed microsecond timestamp still reject stale OFFICE revision", async () => {
    const c = await command();
    await pool.query("UPDATE students SET updated_at=updated_at + interval '1 microsecond' WHERE id='member_one'");
    await expect(service.execute(actor, c)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("full row restoration (ABA) reuses a content fingerprint; this is not a monotonic version", async () => {
    const old = await rev(); const original = (await pool.query("SELECT updated_at::text AS t FROM students WHERE id='member_one'")).rows[0].t;
    await pool.query("UPDATE students SET memo='changed',updated_at=clock_timestamp() WHERE id='member_one'");
    expect(await rev()).not.toBe(old);
    await pool.query("UPDATE students SET memo=NULL,updated_at=$1::timestamp WHERE id='member_one'", [original]);
    expect(await rev()).toBe(old);
  });
});
describe("receipt lifecycle / policy / model-call preparation (SDK mock only)", () => {
  it("actual migrated NOT NULL receipt contract rolls business write back on a receipt constraint failure", async () => {
    await pool.query("ALTER TABLE pool_event_logs ADD CONSTRAINT fixture_reject CHECK (source <> 'office_stage3')");
    const c = await command(), old = await rev();
    try { await expect(service.execute(actor, c)).rejects.toThrow(); expect(await rev()).toBe(old); }
    finally { await pool.query("ALTER TABLE pool_event_logs DROP CONSTRAINT fixture_reject"); }
  });
  it("concurrent identical request => one receipt; altered payload rejected; same-Pool other actor cannot read it", async () => {
    const c = await command(); const [a, b] = await Promise.all([service.execute(actor, c), service.execute(actor, c)]);
    expect(a).toEqual(b);
    await expect(service.execute(actor, { ...c, changes: { memo: "different" } })).rejects.toMatchObject({ code: "REQUEST_REUSED" });
    expect(await service.status({ ...actor, userId: "other_admin" }, c.requestId)).toBeNull();
    expect(await service.status({ ...actor, poolId: "other_pool" }, c.requestId)).toBeNull();
    expect((await pool.query("SELECT count(*) AS n FROM pool_event_logs")).rows[0].n).toBe("1");
  });
  it("JSON key order does not change request identity; event consumers still receive a generic student event", async () => {
    const c = await command(); const a = await service.execute(actor, c);
    const reordered = Object.fromEntries(Object.entries(c).reverse());
    expect(await service.execute(actor, reordered)).toEqual(a);
    expect((await pool.query("SELECT event_type,entity_type,source FROM pool_event_logs")).rows)
      .toEqual([{ event_type: "member_update", entity_type: "student", source: "office_stage3" }]);
  });
  it("expired request is 410 before DB access, including after receipt deletion; missing receipt is not nonexecution", async () => {
    const c = await command(); await service.execute(actor, c); await pool.query("DELETE FROM pool_event_logs");
    expect(await service.status(actor, c.requestId)).toBeNull();
    await expect(service.execute(actor, c)).rejects.toMatchObject({ code: "CONFLICT" });
    const expired = `oc1_${Date.now() - OFFICE_RECONFIRM_MS - 1000}_expired`;
    expect(() => assertOfficeRequestWindow(expired)).toThrow();
    await expect(service.execute(actor, { ...c, requestId: expired, expectedRevision: await rev() })).rejects.toMatchObject({ status: 410 });
    expect((await http("GET", "/office/commands/" + expired)).status).toBe(410);
  });
  it("status lookup SQL failure is an error, never a not-executed/null outcome", async () => {
    const broken = new OfficeCommandService({ connect: async () => ({ query: async () => { throw new Error("synthetic lookup failure"); }, release() {} }) });
    await expect(broken.status(actor, rid("lookup"))).rejects.toThrow("synthetic lookup failure");
  });
  it("single ordinary command uses app-owned temporary restriction, rejects arrays/compound/unsupported/model policy", async () => {
    const response = await interpretOffice(async () => ({ kind: "command", command: { action: "update", changes: { memo: "합성" } } }), { text: "메모 수정", memberId: "member_one" });
    expect(response).toMatchObject({ confirmation: "required", policy: OFFICE_BUSINESS_POLICY });
    expect(OFFICE_BUSINESS_POLICY.singleOrdinaryUpdateOrMove).toBe("validate-then-execute");
    for (const result of [
      [{ kind: "command" }], { kind: "commands", commands: [] },
      { kind: "command", command: { action: "delete" } },
      { kind: "command", confirmation: "none", command: { action: "update", changes: { memo: "x" } } },
    ]) await expect(interpretOffice(async () => result, { text: "합성", memberId: "member_one" })).rejects.toThrow();
    expect(await interpretOffice(async () => ({ kind: "clarify", question: "어느 반인가요?" }), { text: "옮겨줘", memberId: "member_one" })).toMatchObject({ kind: "clarify" });
  });
  it("real interpretation handler passes timeout/output/retry options to mock SDK; gate OFF calls none", async () => {
    expect((await http("POST", "/office/interpret", { text: "합성" })).status).toBe(503); expect(state.modelCalls).toBe(0);
    vi.stubEnv("OFFICE_STAGE3_AI_ENABLED", "true");
    expect((await http("POST", "/office/interpret", { text: "합성 동명 검색" }, "model_fixture")).status).toBe(403);
    // Existing DB actor scope requires the authenticated fixture user.
    expect((await http("POST", "/office/interpret", { text: "합성 동명 검색" })).status).toBe(200);
    expect(state.options.options).toEqual({ timeout: 12000, maxRetries: 0 });
    expect(state.options.body).toMatchObject({ model: "gpt-4o-mini", max_tokens: 512 });
    expect(state.modelCalls).toBe(1);
  });
  it("interpretation timeout and truncated mock output never retry or execute business writes", async () => {
    vi.stubEnv("OFFICE_STAGE3_AI_ENABLED", "true");
    state.modelFailure = true;
    expect((await http("POST", "/office/interpret", { text: "합성 요청" }, "other_admin")).status).toBe(500);
    expect(state.modelCalls).toBe(1);
    state.modelFailure = false; state.truncated = true;
    expect((await http("POST", "/office/interpret", { text: "합성 요청" }, "other_admin")).status).toBe(502);
    expect(state.modelCalls).toBe(2);
    expect((await pool.query("SELECT count(*) AS n FROM pool_event_logs")).rows[0].n).toBe("0");
  });
  it("six interpretation attempts per actor/10 minutes/process, then 429 with no SDK call", async () => {
    vi.stubEnv("OFFICE_STAGE3_AI_ENABLED", "true");
    await pool.query("INSERT INTO users(id,role,swimming_pool_id) VALUES ('rate_actor','pool_admin','pool_fixture')");
    for (let n = 0; n < 6; n++) expect((await http("POST", "/office/interpret", { text: "합성" }, "rate_actor")).status).toBe(200);
    expect((await http("POST", "/office/interpret", { text: "합성" }, "rate_actor")).status).toBe(429);
    expect(state.modelCalls).toBe(6);
  });
});
