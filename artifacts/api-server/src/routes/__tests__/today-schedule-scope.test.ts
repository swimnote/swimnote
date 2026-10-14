import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const state = vi.hoisted(() => ({
  user: { userId: "dual", poolId: "p1", role: "teacher" },
  execute: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { execute: state.execute } }));
vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { ...state.user }; next(); },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) =>
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: "role" }),
}));

// Explicit opt-in: fixtures may only reach this isolated localhost database.
const port = Number(process.env.SCHEDULE_SCOPE_TEST_PORT);
describe.skipIf(!port)("today-schedule effective role — real PostgreSQL + actual route", () => {
  let client: pg.Client;
  let server: Server;
  let origin: string;
  const dialect = new PgDialect();
  beforeAll(async () => {
    if (!Number.isInteger(port) || port < 1024) throw new Error("INVALID_FIXTURE_PORT");
    client = new pg.Client({ host: "127.0.0.1", port, database: "schedule_scope_fixture", user: "runner" });
    await client.connect();
    await client.query(`
      CREATE TABLE users (id text PRIMARY KEY, swimming_pool_id text, role text, roles text[]);
      CREATE TABLE class_groups (
        id text PRIMARY KEY, swimming_pool_id text, teacher_user_id text,
        co_teacher_ids jsonb DEFAULT '[]', is_deleted boolean DEFAULT false,
        schedule_days text DEFAULT '목', schedule_time text DEFAULT '16:00');
      CREATE TABLE pool_holidays (id text, pool_id text, holiday_date text);
      CREATE TABLE student_class_history (
        class_group_id text, student_id text, swimming_pool_id text, enrolled_at text, left_at text);
      CREATE TABLE students (
        id text, name text, birth_year int, assigned_class_ids jsonb, weekly_count int,
        schedule_labels jsonb, status text, parent_user_id text, updated_at timestamp, deleted_at timestamp);
      CREATE TABLE attendance (class_group_id text, date text, status text, session_type text);
      CREATE TABLE class_diaries (class_group_id text, swimming_pool_id text, lesson_date text, is_deleted boolean);
      CREATE TABLE teacher_schedule_notes (
        class_group_id text, teacher_id text, swimming_pool_id text, schedule_date text,
        note_text text, audio_file_url text);
      CREATE TABLE makeup_sessions (
        id text, student_id text, assigned_class_group_id text, swimming_pool_id text,
        assigned_date text, status text, cancelled_at timestamp);
      INSERT INTO users VALUES
        ('dual','p1','pool_admin',ARRAY['pool_admin','teacher']),
        ('normal','p1','teacher',ARRAY['teacher']),
        ('other','p1','teacher',ARRAY['teacher']),
        ('super','p1','super_admin',ARRAY['super_admin']);
      INSERT INTO class_groups (id,swimming_pool_id,teacher_user_id)
        SELECT 'c'||n, 'p1', CASE WHEN n=1 THEN 'dual' WHEN n=2 THEN 'normal' ELSE 'other' END
        FROM generate_series(1,12) n;
      INSERT INTO class_groups (id,swimming_pool_id,teacher_user_id,co_teacher_ids)
        VALUES ('foreign','p2','dual','["dual"]');
      INSERT INTO class_groups (id,swimming_pool_id,teacher_user_id,is_deleted)
        VALUES ('deleted','p1','dual',true);
    `);
    state.execute.mockImplementation(async query => {
      const compiled = dialect.sqlToQuery(query);
      return client.query(compiled.sql, compiled.params);
    });
    const { default: router } = await import("../today-schedule.js");
    const app = express();
    app.use(router);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  beforeEach(async () => {
    state.user = { userId: "dual", poolId: "p1", role: "teacher" };
    await client.query("BEGIN");
  });
  afterEach(async () => { await client.query("ROLLBACK"); });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (client) await client.end();
  });
  async function getToday() {
    const response = await fetch(`${origin}/today-schedule?date=2026-10-15`);
    expect(response.status).toBe(200);
    return response.json() as Promise<any[]>;
  }
  it("A. normal teacher returns only assigned classes", async () => {
    state.user.userId = "normal";
    expect((await getToday()).map(x => x.id)).toEqual(["c2"]);
  });
  it("B/F. dual DB administrator + teacher JWT: 12 becomes 1, other=0", async () => {
    const { classAccessPredicate } = await import("../../lib/class-membership.js");
    const legacy = dialect.sqlToQuery(sql`SELECT id FROM class_groups
      WHERE ${classAccessPredicate("dual", sql`class_groups.id`)} AND schedule_days LIKE '%목%'`);
    expect((await client.query(legacy.sql, legacy.params)).rows).toHaveLength(12);
    expect((await getToday()).map(x => x.id)).toEqual(["c1"]);
  });
  it("C/F. same dual account + pool_admin JWT keeps all 12 pool classes", async () => {
    state.user.role = "pool_admin";
    expect(await getToday()).toHaveLength(12);
  });
  it("D. co-teacher class included without exposing other classes", async () => {
    await client.query(`UPDATE class_groups SET co_teacher_ids='["dual"]' WHERE id='c3'`);
    expect(new Set((await getToday()).map(x => x.id))).toEqual(new Set(["c1", "c3"]));
  });
  it.each(["teacher", "pool_admin", "super_admin"])("E. %s never gets another pool, even if named lead/co-teacher there", async role => {
    state.user.role = role;
    const rows = await getToday();
    expect(rows.every(x => x.swimming_pool_id === "p1")).toBe(true);
    expect(rows.some(x => x.id === "foreign")).toBe(false);
    expect(rows.some(x => x.id === "deleted")).toBe(false);
  });
  it("super_admin retains same-pool administrator contract", async () => {
    state.user = { userId: "super", poolId: "p1", role: "super_admin" };
    expect(await getToday()).toHaveLength(12);
  });
  it("mismatched JWT pool cannot broaden the persisted pool boundary", async () => {
    state.user.poolId = "p2";
    state.user.role = "pool_admin";
    expect(await getToday()).toEqual([]);
  });
  it("effective auth SQL has no DB role decision", async () => {
    const { classAccessPredicate } = await import("../../lib/class-membership.js");
    const query = dialect.sqlToQuery(classAccessPredicate({
      userId: "dual", poolId: "p1", effectiveRole: "teacher",
    }, sql`class_groups.id`));
    expect(query.sql).not.toContain("access_u.role");
    expect(query.params).toContain(false);
  });
  it("weekday filtering and true empty results remain intact", async () => {
    const response = await fetch(`${origin}/today-schedule?date=2026-10-16`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
