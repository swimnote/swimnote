import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import pg from "pg";
import ts from "typescript";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teacherListStatsQuery, loadTeacherListStats } from "../../lib/teacher-list-stats.js";

const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { execute: state.execute }, superAdminDb: { execute: state.execute },
}));
// Only signature verification is stubbed. Production auth/role guards run unchanged.
vi.mock("../../lib/auth.js", () => ({
  TOKEN_VERSION: 1, SUPER_ADMIN_PERMISSIONS: {},
  verifyToken: (token: string) => {
    const [role, poolId = "p", userId = "admin"] = token.split(":");
    if (!["pool_admin", "teacher", "super_admin"].includes(role)) throw Error("invalid");
    return { role, poolId, userId, tv: 1 };
  },
}));
import { requireAuth, requireRole } from "../../middlewares/auth.js";

const url = process.env.TEACHERS_TEST_DB_URL;
const parsed = url ? new URL(url) : null;
// Fail closed: this test must never connect to a real project database.
if (!parsed || parsed.hostname !== "127.0.0.1" || parsed.port !== "55442"
    || parsed.username !== "teacher_test") {
  throw Error("TEACHERS_TEST_DB_URL must reference the isolated local teacher_test PostgreSQL");
}
const client = new pg.Client({ connectionString: url });
const dialect = new PgDialect();
const execute = async (query: any) => {
  const q = dialect.sqlToQuery(query);
  return client.query(q.sql, q.params);
};
const ids = Array.from({ length: 8 }, (_, i) => `t${i + 1}`);
const today = new Date().toISOString().slice(0, 10);

// Execute the actual /teachers handler and actual pool-resolution function,
// not a test-only reimplementation of their behavior.
const routeSource = readFileSync(new URL("../admin.ts", import.meta.url), "utf8");
const route = routeSource.slice(routeSource.indexOf('router.get("/teachers",'),
  routeSource.indexOf("// GET /admin/parents"));
const resolver = routeSource.slice(routeSource.indexOf("async function getAdminPoolId("),
  routeSource.indexOf("async function writeActivityLog("));
const app = express();
const router = express.Router();
const compiled = ts.transpileModule(resolver + "\n" + route, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function("router", "requireAuth", "requireRole", "superAdminDb", "sql", "loadTeacherListStats", compiled)(
  router, requireAuth, requireRole, { execute }, sql, loadTeacherListStats,
);
app.use("/api/admin", router);

// Historical SQL is a regression oracle only, on small isolated fixtures.
const legacy = `
 SELECT ti.user_id,ti.id AS invite_id,ti.invite_status,ti.rejection_reason,ti.approved_at,ti.created_at AS joined_at,
 COUNT(DISTINCT cg.id)::int AS class_count,COUNT(DISTINCT s.id)::int AS student_count,
 COUNT(DISTINCT a.id) FILTER(WHERE a.date=$2)::int AS today_att,
 COUNT(DISTINCT cd.id) FILTER(WHERE cd.lesson_date=$2 AND cd.is_deleted=false)::int AS today_diary,
 COUNT(DISTINCT mk.id) FILTER(WHERE mk.status IN ('waiting','transferred'))::int AS makeup_waiting
 FROM teacher_invites ti
 LEFT JOIN class_groups cg ON cg.teacher_user_id=ti.user_id AND cg.swimming_pool_id=$1 AND cg.is_deleted=false
 LEFT JOIN students s ON s.class_group_id=cg.id AND s.status NOT IN ('withdrawn','deleted')
 LEFT JOIN attendance a ON a.class_group_id=cg.id
 LEFT JOIN class_diaries cd ON cd.class_group_id=cg.id AND cd.swimming_pool_id=$1
 LEFT JOIN makeup_sessions mk ON mk.swimming_pool_id=$1 AND
 (mk.original_teacher_id=ti.user_id OR mk.assigned_teacher_id=ti.user_id OR mk.transferred_to_teacher_id=ti.user_id)
 WHERE ti.swimming_pool_id=$1 AND ti.user_id=ANY($3::text[]) GROUP BY ti.user_id,ti.id ORDER BY ti.user_id,ti.id`;

beforeAll(async () => {
  await client.connect();
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE users(id text PRIMARY KEY,name text,email text,phone text,role text,
      swimming_pool_id text,is_activated boolean,roles text[],withdrawal_requested_at timestamptz);
    CREATE TABLE class_groups(id text PRIMARY KEY,teacher_user_id text,swimming_pool_id text,is_deleted boolean);
    CREATE TABLE teacher_invites(id text PRIMARY KEY,user_id text,swimming_pool_id text,invite_status text,
      rejection_reason text,approved_at timestamptz,created_at timestamptz);
    CREATE TABLE students(id text PRIMARY KEY,class_group_id text,status text);
    CREATE TABLE attendance(id text PRIMARY KEY,class_group_id text,date date);
    CREATE TABLE class_diaries(id text PRIMARY KEY,class_group_id text,swimming_pool_id text,lesson_date date,is_deleted boolean);
    CREATE TABLE makeup_sessions(id text PRIMARY KEY,swimming_pool_id text,original_teacher_id text,
      assigned_teacher_id text,transferred_to_teacher_id text,status text);
    INSERT INTO users SELECT 't'||i,'Teacher '||i,'fixture'||i,NULL,'teacher','p',i<=6,ARRAY['teacher'],NULL
      FROM generate_series(1,8) i;
    INSERT INTO users VALUES
      ('admin','Admin','fixture',NULL,'pool_admin','p',true,ARRAY['pool_admin'],NULL),
      ('other-admin','Other admin','fixture',NULL,'pool_admin','other',true,ARRAY['pool_admin'],NULL),
      ('revoked','Revoked','fixture',NULL,'pool_admin','p',true,ARRAY['teacher'],NULL),
      ('foreign','Foreign teacher','fixture',NULL,'teacher','other',true,ARRAY['teacher'],NULL);
    INSERT INTO teacher_invites SELECT 'ti'||i,'t'||i,'p','approved',NULL,'2026-01-01','2026-01-01'
      FROM generate_series(1,7) i;
    INSERT INTO teacher_invites VALUES('ti3z','t3','p','rejected','fixture',NULL,'2026-01-02'),
      ('foreign-invite','foreign','other','approved',NULL,NULL,'2026-01-01'),
      ('orphan','missing','p','approved',NULL,NULL,'2026-01-01');
    INSERT INTO class_groups SELECT 'c'||i||'_'||j,'t'||i,'p',false
      FROM generate_series(1,8) i CROSS JOIN generate_series(1,2) j;
    INSERT INTO class_groups VALUES ('deleted-class','t1','p',true),('foreign-class','t1','other',false);
    INSERT INTO students SELECT 's'||c.id||i,c.id,CASE i WHEN 4 THEN 'withdrawn' WHEN 5 THEN 'deleted' ELSE 'active' END
      FROM class_groups c CROSS JOIN generate_series(1,5) i;
    INSERT INTO attendance SELECT 'a'||c.id||i,c.id,CASE WHEN i=4 THEN '2026-01-01'::date ELSE CURRENT_DATE END
      FROM class_groups c CROSS JOIN generate_series(1,4) i;
    INSERT INTO class_diaries SELECT 'd'||c.id||i,c.id,c.swimming_pool_id,
      CASE WHEN i=4 THEN '2026-01-01'::date ELSE CURRENT_DATE END,i=3
      FROM class_groups c CROSS JOIN generate_series(1,4) i;
    INSERT INTO makeup_sessions VALUES
      ('self','p','t1','t1','t1','waiting'),
      ('shared','p','t1','t2','t3','transferred'),
      ('completed','p','t1',NULL,NULL,'completed'),
      ('foreign-makeup','other','t1','t1','t1','waiting'),
      ('no-invite','p','t8',NULL,NULL,'waiting');
  `);
  state.execute.mockImplementation(execute);
}, 20_000);
afterAll(async () => { await client.query("ROLLBACK"); await client.end(); });

describe("teacher list query and real HTTP handler", () => {
  it("preserves every historical statistic and invite field", async () => {
    const previous = (await client.query(legacy, ["p", today, ids])).rows;
    const current = await loadTeacherListStats({ execute }, "p", ids, today);
    expect(current).toEqual(previous);
    expect(current.find(r => r.user_id === "t1")).toMatchObject({
      class_count: 2, student_count: 6, today_att: 6, today_diary: 4, makeup_waiting: 2,
    });
  });
  it("returns exactly 8 unique teachers including 2 inactive and a teacher without an invite", async () => {
    const r = await request(app).get("/api/admin/teachers").set("Authorization", "Bearer pool_admin:p:admin");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(8);
    expect(new Set(r.body.map((t:any) => t.id)).size).toBe(8);
    expect(r.body.filter((t:any) => !t.is_activated)).toHaveLength(2);
    expect(r.body.find((t:any) => t.id === "t8")).toMatchObject({
      invite_id: null, invite_status: null, class_count: 0, student_count: 0, makeup_waiting: 0,
    });
  });
  it("does not accept a forged other-pool query parameter from a pool_admin", async () => {
    const r = await request(app).get("/api/admin/teachers?pool_id=other").set("Authorization", "Bearer pool_admin:p:admin");
    expect(r.status).toBe(200);
    expect(r.body.map((t:any) => t.id).sort()).toEqual(ids);
  });
  it("statistics exclude foreign identities even if supplied in the ID array", async () => {
    const rows = await loadTeacherListStats({ execute }, "p", [...ids, "foreign"], today);
    expect(rows.some(row => row.user_id === "foreign")).toBe(false);
  });
  it("another administrator sees only their own pool, not the target 8", async () => {
    const r = await request(app).get("/api/admin/teachers?pool_id=p").set("Authorization", "Bearer pool_admin:other:other-admin");
    expect(r.status).toBe(200);
    expect(r.body.map((t:any) => t.id)).toEqual(["foreign"]);
  });
  it("rejects missing authentication", async () => {
    expect((await request(app).get("/api/admin/teachers")).status).toBe(401);
  });
  it("rejects invalid authentication", async () => {
    expect((await request(app).get("/api/admin/teachers").set("Authorization", "Bearer invalid")).status).toBe(401);
  });
  it("rejects teacher role", async () => {
    expect((await request(app).get("/api/admin/teachers").set("Authorization", "Bearer teacher:p:t1")).status).toBe(403);
  });
  it("rejects revoked pool-admin DB permission", async () => {
    expect((await request(app).get("/api/admin/teachers").set("Authorization", "Bearer pool_admin:p:revoked")).status).toBe(403);
  });
  it("returns a successful empty array for an empty pool", async () => {
    const r = await request(app).get("/api/admin/teachers?pool_id=empty").set("Authorization", "Bearer super_admin");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
  it("keeps the response JSON contract", async () => {
    const r = await request(app).get("/api/admin/teachers").set("Authorization", "Bearer pool_admin:p:admin");
    expect(Object.keys(r.body[0]).sort()).toEqual([
      "id","name","email","phone","is_activated","roles","is_admin_granted","invite_id","invite_status",
      "rejection_reason","approved_at","joined_at","class_count","student_count","today_att","today_diary","makeup_waiting",
    ].sort());
  });
  it("handles large independent sources without an intermediate Cartesian product", async () => {
    await client.query("SAVEPOINT volume");
    try {
      await client.query(`
        INSERT INTO students SELECT 'large-s'||i,'c1_1','active' FROM generate_series(1,1000) i;
        INSERT INTO attendance SELECT 'large-a'||i,'c1_1',CURRENT_DATE FROM generate_series(1,1000) i;
        INSERT INTO class_diaries SELECT 'large-d'||i,'c1_1','p',CURRENT_DATE,false FROM generate_series(1,1000) i;
        INSERT INTO makeup_sessions SELECT 'large-m'||i,'p','t1','t1','t1','waiting' FROM generate_series(1,1000) i;
      `);
      const query = dialect.sqlToQuery(teacherListStatsQuery("p", ids, today));
      const plan = (await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, query.params)).rows[0]["QUERY PLAN"][0];
      const nodes = (node:any):any[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
      expect(Math.max(...nodes(plan.Plan).map((n:any) => n["Actual Rows"]))).toBeLessThan(5000);
      const rows = await loadTeacherListStats({ execute }, "p", ids, today);
      expect(rows.find(r => r.user_id === "t1")).toMatchObject({
        student_count: 1006, today_att: 1006, today_diary: 1004, makeup_waiting: 1002,
      });
      expect(new Set(rows.map(r => r.user_id)).size).toBe(7); // no-invite fallback is unchanged
    } finally { await client.query("ROLLBACK TO SAVEPOINT volume"); }
  });
});
