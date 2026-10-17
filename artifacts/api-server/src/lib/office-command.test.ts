import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { officeModelMessages, OFFICE_MODEL_INPUT_LIMIT } from "./office-model.js";
import { OfficeCommandService, parseOfficeCommand, type OfficeSql, type OfficeReceipt } from "./office-command.js";
import { interpretOffice } from "./office-interpret.js";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";

// No DB module/env imports. Explicit loopback-only fixture, never an operating URL.
const { Pool } = createRequire(new URL("../../../../lib/db/package.json", import.meta.url))("pg");
const fixture = vi.hoisted(() => ({ pool: null as any, events: 0, modelCalls: 0 }));
vi.mock("@workspace/db", () => ({
  get pool() { if (!fixture.pool) throw new Error("DB import before isolated fixture is ready"); return fixture.pool; },
  db: { execute: async (statement: any) => {
    const params = new PgDialect().sqlToQuery(statement).params;
    return { rows: [{ swimming_pool_id: params.includes("foreign") ? "pool_other" : "pool_fixture" }] };
  } },
}));
vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ error: "No fixture auth" });
    req.user = { userId: req.headers.authorization, role: req.headers.authorization === "teacher" ? "teacher" : "pool_admin" };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden" }),
}));
vi.mock("./pg-realtime.js", () => ({ notifyPoolEvent: async () => { fixture.events++; } }));
vi.mock("../routes/ai.js", () => ({ getOpenAI: () => { fixture.modelCalls++; throw new Error("Actual AI is forbidden in fixture"); } }));
let pool: any, service: OfficeCommandService, server: any, origin = "";
const actor = { userId: "admin_fixture", poolId: "pool_fixture", role: "pool_admin" };
const rid = (suffix: string) => `oc1_${Date.now()}_${suffix}`;
const revision = async (id = "member_one") => (await pool.query("SELECT md5(row_to_json(s)::text) AS revision FROM students s WHERE id=$1", [id])).rows[0].revision;
const issue = async (raw: any) => ({ ...raw, ...await service.issue(actor, raw) });
const command = async (overrides = {}) => issue({ action: "update", requestId: rid("request_one"), memberId: "member_one",
  expectedRevision: await revision(), changes: { memo: "합성 변경" }, ...overrides });
describe("server-issued admission and minimal durable receipts", () => {
  it("unissued plausible UUID cannot execute; caller timestamp cannot mint authority", async () => {
    const c = await command();
    for (const requestId of ["os1_00000000-0000-0000-0000-000000000001", `oc1_${Date.now() + 999999}_future`])
      await expect(service.execute(actor, { ...c, requestId })).rejects.toMatchObject({ status: 410 });
    expect((await pool.query("SELECT count(*) AS n FROM pool_event_logs")).rows[0].n).toBe("0");
  });
  it("deleting the general event leaves durable duplicate prevention and minimal status", async () => {
    const c = await command({ changes: { name: "합성 이름 비저장", memo: "합성 메모 비저장" } });
    const first = await service.execute(actor, c);
    await pool.query("DELETE FROM pool_event_logs");
    expect(await service.execute(actor, c)).toEqual({ ...first, changes: [] });
    expect(await service.status(actor, c.requestId)).toEqual({ ...first, changes: [] });
  });
  it("deleting the dedicated record fails closed, even after restoring the entire old member row", async () => {
    const old = (await pool.query("SELECT * FROM students WHERE id='member_one'")).rows[0];
    const c = await command(); await service.execute(actor, c);
    await pool.query("DELETE FROM office_command_receipts");
    await pool.query("UPDATE students SET memo=$1,updated_at=$2 WHERE id='member_one'", [old.memo, old.updated_at]);
    const before = await revision();
    expect(await service.status(actor, c.requestId)).toBeNull();
    await expect(service.execute(actor, c)).rejects.toMatchObject({ code: "REQUEST_UNCONFIRMED", status: 410 });
    expect(await revision()).toBe(before);
  });
  it("re-issuance cannot resurrect a deleted caller-selected ID", async () => {
    const c = await command(); await service.execute(actor, c);
    await pool.query("DELETE FROM office_command_receipts");
    const fresh = await service.issue(actor, c);
    expect(fresh.requestId).not.toBe(c.requestId);
    await expect(service.execute(actor, c)).rejects.toMatchObject({ code: "REQUEST_UNCONFIRMED" });
  });
  it("deadlines are server stored: five-minute admission, 24-hour reconciliation", async () => {
    const c = await command();
    const row = (await pool.query(`SELECT extract(epoch from execute_before-issued_at)::int AS execute_seconds,
      extract(epoch from confirm_before-issued_at)::int AS confirm_seconds FROM office_command_receipts WHERE request_id=$1`, [c.requestId])).rows[0];
    expect(row).toEqual({ execute_seconds: 300, confirm_seconds: 86400 });
    await pool.query("UPDATE office_command_receipts SET execute_before=clock_timestamp()-interval '1 second',issued_at=clock_timestamp()-interval '10 minutes' WHERE request_id=$1", [c.requestId]);
    await expect(service.execute(actor, c)).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
    expect(await service.status(actor, c.requestId)).toBeNull(); // Not evidence of non-execution.
  });
  it("completed result remains readable past admission, but neither read nor execution passes reconciliation expiry", async () => {
    const c = await command(); const first = await service.execute(actor, c);
    await pool.query("UPDATE office_command_receipts SET execute_before=clock_timestamp()-interval '1 second',issued_at=clock_timestamp()-interval '10 minutes' WHERE request_id=$1", [c.requestId]);
    expect((await service.execute(actor, c)).revision).toBe(first.revision);
    await pool.query("UPDATE office_command_receipts SET issued_at=clock_timestamp()-interval '25 hours',execute_before=clock_timestamp()-interval '24 hours',confirm_before=clock_timestamp()-interval '1 second' WHERE request_id=$1", [c.requestId]);
    await expect(service.status(actor, c.requestId)).rejects.toMatchObject({ status: 410 });
    await expect(service.execute(actor, c)).rejects.toMatchObject({ status: 410 });
  });
  it("new durable/event records exclude ordinary before/after PII", async () => {
    const c = await command({ changes: { name: "합성 비밀 이름", phone: "010-0000-1111", memo: "합성 비밀 메모" } });
    await service.execute(actor, c);
    const rows = await pool.query("SELECT row_to_json(r) AS row FROM office_command_receipts r");
    const logs = await pool.query("SELECT payload FROM pool_event_logs");
    const serialized = JSON.stringify([rows.rows, logs.rows]);
    for (const value of ["합성 비밀 이름", "010-0000-1111", "합성 비밀 메모", '"before"', '"after"'])
      expect(serialized).not.toContain(value);
    expect(logs.rows[0].payload.fields.sort()).toEqual(["memo", "name", "phone"]);
  });
  it("compound update+move cannot be silently collapsed by a mocked model", async () => {
    const model = vi.fn(async () => ({ kind: "command", command: { action: "update", changes: { memo: "합성" } } }));
    expect(await interpretOffice(model, { text: "메모 수정하고 반 이동", memberId: "member_one" })).toMatchObject({ kind: "clarify" });
    expect(model).not.toHaveBeenCalled();
    expect((await pool.query("SELECT count(*) AS n FROM pool_event_logs")).rows[0].n).toBe("0");
  });
  it("actual model message byte ceiling includes system text, selected ID and escaped multibyte input", () => {
    const input = { text: "합성 회원 검색", memberId: "member_one" };
    const messages = officeModelMessages(input);
    expect(Buffer.byteLength(JSON.stringify(messages), "utf8") + 256).toBeLessThanOrEqual(OFFICE_MODEL_INPUT_LIMIT);
    expect(() => officeModelMessages({ text: "가".repeat(2000), memberId: "member_one" })).toThrow("모델 입력 한도");
    expect(() => officeModelMessages({ text: "\u0000".repeat(1000) })).toThrow("모델 입력 한도");
  });
});
const api = (path: string, body?: unknown, auth = "admin_fixture") => fetch(origin + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeAll(async () => {
  pool = new Pool({ host: "127.0.0.1", port: 55439, database: "office_stage3_fixture", user: "office_fixture", max: 8, connectionTimeoutMillis: 2000 });
  const check = (await pool.query("SELECT current_database() AS db,inet_server_addr()::text AS host")).rows[0];
  expect(check).toEqual({ db: "office_stage3_fixture", host: "127.0.0.1/32" });
  await pool.query(`DROP SCHEMA IF EXISTS office_fixture CASCADE; CREATE SCHEMA office_fixture`);
  await pool.end();
  pool = new Pool({ host: "127.0.0.1", port: 55439, database: "office_stage3_fixture", user: "office_fixture", max: 8,
    options: "-c search_path=office_fixture", connectionTimeoutMillis: 2000 });
  await pool.query(`
    CREATE TABLE students (id text PRIMARY KEY,swimming_pool_id text NOT NULL,name text NOT NULL,
      phone text,birth_date text,birth_year text,parent_name text,parent_phone text,parent_user_id text,
      memo text,status text NOT NULL DEFAULT 'active',class_group_id text,assigned_class_ids jsonb,
      schedule_labels text,weekly_count int DEFAULT 2,updated_at timestamptz DEFAULT now());
    CREATE TABLE class_groups (id text PRIMARY KEY,swimming_pool_id text,name text,schedule_days text,
      schedule_time text,capacity int,is_deleted boolean DEFAULT false,is_one_time boolean DEFAULT false);
    CREATE TABLE student_class_history(id text PRIMARY KEY,student_id text,class_group_id text,swimming_pool_id text,
      enrolled_at date,left_at date,created_at timestamptz DEFAULT now());
    CREATE TABLE pool_event_logs (id text PRIMARY KEY,pool_id text,event_type text,entity_type text,entity_id text,
      actor_id text,payload jsonb,source text,created_at timestamptz DEFAULT now());
  `);
  await pool.query(readFileSync(new URL("../../../../scripts/office-stage3/receipts.draft.sql", import.meta.url), "utf8"));
  fixture.pool = pool; service = new OfficeCommandService(pool);
  const router = (await import("../routes/office.js")).default;
  const app = express(); app.use(express.json()); app.use("/api/office", router);
  server = await new Promise<any>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}/api/office`;
});
beforeEach(async () => {
  vi.stubEnv("OFFICE_STAGE3_ENABLED", "true"); vi.stubEnv("OFFICE_STAGE3_AI_ENABLED", "false");
  fixture.events = 0; fixture.modelCalls = 0;
  await pool.query(`TRUNCATE students,class_groups,student_class_history,pool_event_logs,office_command_receipts;
    INSERT INTO class_groups(id,swimming_pool_id,name,schedule_days,schedule_time,capacity) VALUES
      ('class_a','pool_fixture','합성 A','월수금','16:00',10),
      ('class_b','pool_fixture','합성 B','화목','17:00',10),
      ('class_c','pool_fixture','합성 C','토','10:00',10),
      ('class_conflict','pool_fixture','합성 충돌','화','17:00',10),
      ('class_foreign','pool_other','다른 수영장','토','10:00',10);
    INSERT INTO students(id,swimming_pool_id,name,parent_phone,parent_user_id,class_group_id,assigned_class_ids) VALUES
      ('member_one','pool_fixture','합성 동명','010-0000-0000','parent_fixture','class_a','["class_a","class_b"]'),
      ('member_two','pool_fixture','합성 동명',null,null,'class_a','["class_a","class_b"]'),
      ('member_foreign','pool_other','합성 외부',null,null,'class_foreign','["class_foreign"]');
    INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at) VALUES
      ('h_one_a','member_one','class_a','pool_fixture','2026-01-01'),('h_one_b','member_one','class_b','pool_fixture','2026-01-01'),
      ('h_two_a','member_two','class_a','pool_fixture','2026-01-01'),('h_two_b','member_two','class_b','pool_fixture','2026-01-01');`);
});
afterAll(async () => { vi.unstubAllEnvs(); if (server) await new Promise<void>(r => server.close(() => r())); if (pool) await pool.end(); });
describe("OFFICE isolated canonical SQL / HTTP contract", () => {
  it("ordinary fields commit + receipt, with no guardian authentication or other-membership changes", async () => {
    const c = await command({ changes: { name: "합성 수정", phone: "010-0000-0001", birth_date: "2015-01-02", birth_year: "2015", parent_name: "합성 보호자", memo: "메모" } });
    const response = await api("/command", c); expect(response.status).toBe(200);
    const receipt = await response.json() as OfficeReceipt;
    expect(receipt.revision).toBe(await revision());
    expect((await pool.query("SELECT * FROM students WHERE id='member_one'")).rows[0]).toMatchObject({
      name: "합성 수정", parent_phone: "010-0000-0000", parent_user_id: "parent_fixture", assigned_class_ids: ["class_a", "class_b"], weekly_count: 2,
    });
    expect(fixture.events).toBe(1);
  });
  it("canonical server rejects unauthenticated, role and cross-pool calls", async () => {
    const c = await command();
    expect((await api("/command", c, "")).status).toBe(401);
    expect((await api("/command", c, "teacher")).status).toBe(403);
    expect((await api("/command", c, "foreign")).status).toBe(410);
    await expect(service.execute({ ...actor, role: "teacher" }, c)).rejects.toMatchObject({ status: 403 });
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("0");
  });
  it("denies forged actor/Pool/URL/SQL, auth fields, invalid date and ambiguous move", async () => {
    const c = await command();
    for (const body of [{ ...c, poolId: "pool_other" }, { ...c, sql: "DELETE" }, { ...c, url: "/api/anything" },
      { ...c, changes: { parent_phone: "010-1111-1111" } }, { ...c, changes: { birth_date: "2015-02-30" } },
      { ...c, changes: { status: "active" } }, { ...c, action: "move", changes: undefined, fromClassId: "", toClassId: "" }])
      expect((await api("/command", body)).status).toBe(400);
    expect(() => parseOfficeCommand({ ...c, role: "pool_admin" })).toThrow();
  });
  it("two concurrent ordinary saves using one revision: one commit, one conflict", async () => {
    const c = await command();
    const second = await issue({ ...c, changes: { memo: "다른 변경" } });
    const results = await Promise.allSettled([service.execute(actor, c), service.execute(actor, second)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("1");
  });
  it("same request simultaneous/replayed returns one durable result; changed payload denied", async () => {
    const c = await command(), [a, b] = await Promise.all([service.execute(actor, c), service.execute(actor, c)]);
    expect(a.revision).toEqual(b.revision);
    expect((await service.execute(actor, c)).revision).toEqual(a.revision);
    await expect(service.execute(actor, { ...c, changes: { memo: "재사용 공격" } })).rejects.toMatchObject({ code: "REQUEST_REUSED" });
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("1");
  });
  it("lost response resolved by scoped receipt lookup, without reapplying mutation", async () => {
    const c = await command(); await service.execute(actor, c);
    const response = await api("/commands/" + c.requestId);
    expect(response.status).toBe(200); expect((await response.json() as OfficeReceipt).revision).toBe(await revision());
    expect((await api("/commands/" + c.requestId, undefined, "foreign")).status).toBe(404);
    expect((await api("/commands/os1_00000000-0000-0000-0000-000000000001")).status).toBe(404);
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("1");
  });
  it("one selected membership moves atomically; other membership and weekly count retained", async () => {
    const { changes: _, ...base } = await command();
    const result = await service.execute(actor, await issue({ ...base, action: "move", fromClassId: "class_a", toClassId: "class_c" }));
    expect(result.assignedClassIds).toEqual(["class_c", "class_b"]);
    expect((await pool.query("SELECT assigned_class_ids,weekly_count FROM students WHERE id='member_one'")).rows[0])
      .toEqual({ assigned_class_ids: ["class_c", "class_b"], weekly_count: 2 });
    const history = (await pool.query("SELECT class_group_id,left_at FROM student_class_history WHERE student_id='member_one'")).rows;
    expect(history.find((h: any) => h.class_group_id === "class_b").left_at).toBeNull();
    expect(history.find((h: any) => h.class_group_id === "class_a").left_at).not.toBeNull();
    expect(history.find((h: any) => h.class_group_id === "class_c").left_at).toBeNull();
  });
  it("class, current state, capacity, schedule and history mismatch are server blockers", async () => {
    const { changes: _, ...c } = await command();
    const base = { ...c, action: "move", fromClassId: "class_a" };
    for (const [target, code] of [["class_foreign", "CLASS"], ["class_b", "STATE"], ["class_conflict", "SCHEDULE"]])
      await expect(service.execute(actor, await issue({ ...base, toClassId: target }))).rejects.toMatchObject({ code });
    await pool.query("UPDATE class_groups SET capacity=0 WHERE id='class_c'");
    await expect(service.execute(actor, await issue({ ...base, toClassId: "class_c" }))).rejects.toMatchObject({ code: "CAPACITY" });
    await pool.query("UPDATE class_groups SET capacity=10 WHERE id='class_c'; UPDATE student_class_history SET left_at='2026-02-01' WHERE id='h_one_a'");
    await expect(service.execute(actor, await issue({ ...base, toClassId: "class_c" }))).rejects.toMatchObject({ code: "HISTORY" });
  });
  it("two members competing for last class seat cannot both commit", async () => {
    await pool.query("UPDATE class_groups SET capacity=1 WHERE id='class_c'");
    const a = { action: "move", requestId: rid("move_one"), memberId: "member_one", expectedRevision: await revision(), fromClassId: "class_a", toClassId: "class_c" };
    const b = { ...a, requestId: rid("move_two"), memberId: "member_two", expectedRevision: await revision("member_two") };
    const issuedA = await issue(a), issuedB = await issue(b);
    const results = await Promise.allSettled([service.execute(actor, issuedA), service.execute(actor, issuedB)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "CAPACITY" } });
  });
  it("receipt failure rolls back business write and history as one transaction", async () => {
    const c = await command(), original = await revision();
    const injected = new OfficeCommandService({ connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: async (q: string, args?: unknown[]) => {
        if (q.startsWith("INSERT INTO pool_event_logs")) throw new Error("fixture receipt failure");
        return client.query(q, args);
      } } satisfies OfficeSql;
    } });
    await expect(injected.execute(actor, c)).rejects.toThrow("fixture receipt failure");
    expect(await revision()).toBe(original);
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("0");
  });
  it("default-off gates prevent operating writes and actual model even when routes exist", async () => {
    vi.stubEnv("OFFICE_STAGE3_ENABLED", "false");
    expect((await api("/command", await command())).status).toBe(503);
    vi.stubEnv("OFFICE_STAGE3_ENABLED", "true");
    expect((await api("/interpret", { text: "합성 요청" })).status).toBe(503);
    expect(fixture.modelCalls).toBe(0);
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("0");
  });
});
describe("mock model interpretation — never actual AI", () => {
  it("search or ambiguous target returns query/clarification, not an execution", async () => {
    const clarify = vi.fn(async () => ({ kind: "clarify", question: "동명 회원 중 어느 회원인가요?" }));
    expect(await interpretOffice(clarify, { text: "합성 동명 반을 옮겨줘" })).toMatchObject({ kind: "clarify" });
    expect(await interpretOffice(async () => ({ kind: "search", search: "합성 동명" }), { text: "합성 동명 검색" })).toEqual({ kind: "search", search: "합성 동명" });
    expect((await pool.query("SELECT count(*) FROM pool_event_logs")).rows[0].count).toBe("0");
  });
  it("passes only text + selected member, and requires app-confirmed proposal", async () => {
    const model = vi.fn(async () => ({ kind: "command", command: { action: "update", changes: { memo: "합성 메모" } } }));
    const result = await interpretOffice(model, { text: "메모 수정", memberId: "member_one" });
    expect(model).toHaveBeenCalledWith({ text: "메모 수정", memberId: "member_one" });
    expect(result).toMatchObject({ kind: "proposal", confirmation: "required", command: { memberId: "member_one" } });
  });
  it("rejects model chosen URL/SQL/actor/Pool/confirmation/revision and unselected IDs", async () => {
    for (const extra of [{ url: "/x" }, { sql: "select" }, { actor: actor.userId }, { poolId: actor.poolId },
      { confirmation: "none" }, { expectedRevision: "0".repeat(32) }, { memberId: "member_two" }])
      await expect(interpretOffice(async () => ({ kind: "command", command: { action: "update", changes: { memo: "X" }, ...extra } }),
        { text: "합성 요청", memberId: "member_one" })).rejects.toMatchObject({ code: "CLARIFICATION" });
    await expect(interpretOffice(async () => ({ kind: "command", command: { action: "move", fromClassId: "class_a", toClassId: "class_c" } }),
      { text: "대상 없음" })).rejects.toMatchObject({ code: "CLARIFICATION" });
  });
});
