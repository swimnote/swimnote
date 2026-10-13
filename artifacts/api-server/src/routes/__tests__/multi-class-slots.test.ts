import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";

// This suite has no production connection or production-auth bypass.
const fixture = await vi.hoisted(async () => {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@workspace/db/schema");
  const pool = new Pool({ host: "127.0.0.1", port: 55439, user: "fixture_admin", database: "postgres" });
  return { pool, db: drizzle(pool, { schema }), mode: "normal" };
});
vi.mock("@workspace/db", () => ({ db: fixture.db, superAdminDb: fixture.db, pool: fixture.pool, superAdminPool: fixture.pool }));
vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const userId = req.headers["x-fixture-user"] ?? "T1";
    req.user = { userId, role: userId === "ADMIN" ? "pool_admin" : "teacher" };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) =>
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: "role" }),
}));
vi.mock("../../utils/change-logger.js", () => ({ logChange: vi.fn() }));
vi.mock("../../lib/pool-event-logger.js", () => ({ logPoolEvent: vi.fn(async () => {}) }));
vi.mock("../../lib/pg-realtime.js", () => ({ notifyPoolEvent: vi.fn(async()=>{}) }));
vi.mock("../../lib/objectStorage.js", () => ({
  getPresignedUrl: vi.fn(async()=>({ok:true,url:"https://fixture.invalid/private-photo",error:null})),
}));
vi.mock("../../lib/push-service.js", () => ({
  sendPushToUser: vi.fn(async()=>{}), sendPushToClassParents: vi.fn(async()=>{}), sendPushToPoolParents: vi.fn(async()=>{}),
}));
vi.mock("../../lib/xmode.js", () => ({ resolvePoolMode: vi.fn(async()=>({mode:fixture.mode})) }));
vi.mock("../../lib/curriculum-evidence-resolver.js", () => ({ resolveManualDiaryEvidence: vi.fn(async()=>{}) }));
vi.mock("../../lib/curriculum-progress-mapper.js", () => ({
  upsertSessionObservation: vi.fn(async()=>{}), invalidateSessionObservation: vi.fn(async()=>{}),
}));
vi.mock("../../lib/curriculum-confirmation-engine.js", () => ({ computeConfirmedProgress: vi.fn(async()=>{}) }));
import classRouter from "../class-groups.js";
import attendanceRouter from "../attendance.js";
import studentRouter from "../students.js";
import teacherRouter from "../teachers.js";
import photoRouter from "../photos.js";
import diaryRouter from "../diary.js";
import absenceRouter from "../absences.js";
import { getCurrentStudentClassIds, teacherCanAccessStudent, teacherCanAccessClass } from "../../lib/class-membership.js";
import { writeCanonicalAttendance } from "../../lib/canonical-attendance.js";
import { completeMakeupAttendance } from "../../lib/makeup-attendance.js";

const app = express();
app.use(express.json());
app.use("/class-groups", classRouter);
app.use("/attendance", attendanceRouter);
app.use("/students", studentRouter);
app.use(teacherRouter, photoRouter, diaryRouter, absenceRouter);
app.use((e: any, _req: any, res: any, _next: any) => res.status(500).json({ error: e.message }));
const as = (id: string) => ({ "x-fixture-user": id });
const date = "2026-10-13";
const input = (classId = "TUE") => ({ student_id: "A", class_group_id: classId, date, status: "present" });

beforeAll(async () => {
  for (const table of [schema.usersTable, schema.studentsTable, schema.classGroupsTable,
    schema.attendanceTable, schema.makeupSessionsTable, schema.classChangeLogsTable,
    schema.parentAccountsTable, schema.parentStudentsTable]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      const raw = column.getSQLType();
      const type = /^(text|varchar|boolean|integer|smallint|bigint|numeric|real|double|jsonb|json|date|timestamp|time)/.test(raw) ? raw : "text";
      const def = type === "jsonb" ? " DEFAULT '[]'::jsonb" : type === "boolean" ? " DEFAULT false"
        : type.includes("timestamp") && ["created_at","updated_at"].includes(column.name) ? " DEFAULT now()" : "";
      return `"${column.name}" ${type}${def}${column.primary ? " PRIMARY KEY" : ""}`;
    });
    await fixture.pool.query(`CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(",")})`);
    for (const column of config.columns) {
      if (column.getSQLType().includes("timestamp") && !["created_at","updated_at"].includes(column.name)) {
        await fixture.pool.query(`ALTER TABLE "${config.name}" ALTER COLUMN "${column.name}" DROP DEFAULT`);
      }
    }
  }
  await fixture.pool.query(`CREATE TABLE IF NOT EXISTS student_class_history (
    id text PRIMARY KEY,student_id text,class_group_id text,swimming_pool_id text,
    enrolled_at date,left_at date,created_at timestamp DEFAULT now());
    CREATE TABLE IF NOT EXISTS photo_assets_meta(id text,student_id text,class_id text,pool_id text,
      album_type text,media_status text,lesson_date text,created_at timestamptz,sort_order integer,
      uploaded_by text,uploaded_by_name text,caption text,file_size integer,object_key text);
    CREATE TABLE IF NOT EXISTS class_diaries(id text PRIMARY KEY,class_group_id text,teacher_id text,
      teacher_name text,swimming_pool_id text,lesson_date text,common_content text,
      is_edited boolean DEFAULT false,edited_at timestamptz,edited_by text,
      is_deleted boolean DEFAULT false,deleted_at timestamptz,deleted_by text,
      ai_generated boolean DEFAULT false,ai_trace_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS class_diary_student_notes(id text PRIMARY KEY,diary_id text,student_id text,
      note_content text,is_edited boolean DEFAULT false,edited_at timestamptz,edited_by text,
      is_deleted boolean DEFAULT false,deleted_at timestamptz,deleted_by text,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS class_diary_audit_logs(id text PRIMARY KEY,diary_id text,student_note_id text,
      target_type text,action_type text,before_content text,after_content text,
      actor_id text,actor_name text,actor_role text,swimming_pool_id text,created_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS teacher_absences(id text PRIMARY KEY,pool_id text,teacher_user_id text,
      teacher_name text,class_group_id text,class_group_name text,absence_date text,absence_time text,
      created_by text,has_temp_transfer boolean DEFAULT false,created_at timestamptz DEFAULT now());
    ALTER TABLE makeup_sessions ADD COLUMN IF NOT EXISTS handed_to_teacher_id text;
    ALTER TABLE makeup_sessions ADD COLUMN IF NOT EXISTS handed_to_teacher_name text;
  `);
  await fixture.pool.query(readFileSync(new URL("../../../migrations/20261013_attendance_explicit_identity.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => {
  fixture.mode="normal";
  await fixture.pool.query(`TRUNCATE users,students,class_groups,attendance,student_class_history,makeup_sessions,class_change_logs,photo_assets_meta,class_diaries,class_diary_student_notes;
    INSERT INTO users(id,name,role,swimming_pool_id) VALUES
      ('ADMIN','fixture-admin','pool_admin','P1'),('T1','fixture-1','teacher','P1'),
      ('T2','fixture-2','teacher','P1'),('T3','fixture-3','teacher','P1'),
      ('T4','fixture-co','teacher','P1'),('TZ','fixture-outside','teacher','P2');
    INSERT INTO class_groups(id,name,swimming_pool_id,teacher_user_id,co_teacher_ids,schedule_days,schedule_time,is_deleted)
      VALUES ('TUE','Tuesday 16','P1','T1','["T4"]','화','16:00',false),
      ('THU','Thursday 16','P1','T2','[]','목','16:00',false),
      ('TUE2','Tuesday B','P1','T3','[]','화','16:00',false),
      ('THU2','Thursday B','P1','T3','[]','목','16:00',false),
      ('OUT','Outside','P2','TZ','[]','화','16:00',false);
    INSERT INTO students(id,name,status,swimming_pool_id,class_group_id,assigned_class_ids,weekly_count)
      VALUES ('A','fixture-A','active','P1','TUE','["TUE","THU"]',2),
      ('B','fixture-B','active','P1','TUE2','["TUE2","THU2"]',2),
      ('Z','fixture-Z','active','P2','OUT','["OUT"]',1),
      ('L','fixture-legacy','active','P1',NULL,'[]',1);
    INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at)
      VALUES ('H1','A','TUE','P1','2026-01-01'),('H2','A','THU','P1','2026-01-01'),
      ('H3','B','TUE2','P1','2026-01-01'),('H4','B','THU2','P1','2026-01-01'),
      ('H5','Z','OUT','P2','2026-01-01');
    INSERT INTO attendance(id,student_id,class_group_id,swimming_pool_id,date,status)
      VALUES ('legacy-dup-1','A','TUE','P1','2026-07-20','present'),
             ('legacy-dup-2','A','TUE','P1','2026-07-20','present');
    INSERT INTO attendance(id,student_id,swimming_pool_id,date,status)
      SELECT 'legacy-null-'||n,'L','P1','2026-06-'||lpad(n::text,2,'0'),'present' FROM generate_series(1,87)n;
  `);
});
afterAll(() => fixture.pool.end());

describe("multi-class slot contract on isolated PostgreSQL", () => {
  it.each([["A",["TUE","THU"]],["B",["TUE2","THU2"]]])("assignment preserves two histories for %s", async (id, ids) => {
    const r = await request(app).patch(`/students/${id}/assign`).set(as("ADMIN")).send({ assigned_class_ids: ids });
    expect(r.status).toBe(200);
    expect(await getCurrentStudentClassIds(id)).toEqual([...ids].sort());
    const h = await fixture.pool.query("SELECT count(*)::int n FROM student_class_history WHERE student_id=$1 AND left_at IS NULL",[id]);
    expect(h.rows[0].n).toBe(2);
  });
  it("only intentional removal ends one membership", async () => {
    expect((await request(app).patch("/students/A/assign").set(as("ADMIN")).send({ assigned_class_ids:["TUE"] })).status).toBe(200);
    expect(await getCurrentStudentClassIds("A")).toEqual(["TUE"]);
    const h = await fixture.pool.query("SELECT count(*)::int n FROM student_class_history WHERE student_id='A' AND left_at IS NULL");
    expect(h.rows[0].n).toBe(1);
  });
  it.each([["T1",["TUE"]],["T2",["THU"]],["T3",["TUE2","THU2"]],["T4",["TUE"]]])("%s sees only lead/co classes", async (actor, ids) => {
    const r = await request(app).get("/class-groups").set(as(actor));
    expect(r.status).toBe(200); expect(r.body.map((x:any)=>x.id).sort()).toEqual([...ids].sort());
  });
  it.each(["T1","T2","T4"])("%s sees A but not unassigned B", async actor => {
    const r = await request(app).get("/teacher/me/members").set(as(actor));
    expect(r.status).toBe(200); expect(r.body.map((x:any)=>x.id)).toEqual(["A"]);
  });
  it.each([["T1","THU"],["T2","TUE"],["TZ","TUE"]])("%s cannot get/patch %s", async (actor,id) => {
    expect((await request(app).get(`/class-groups/${id}`).set(as(actor))).status).toBe(403);
    expect((await request(app).patch(`/class-groups/${id}`).set(as(actor)).send({name:"denied"})).status).toBe(403);
  });
  it.each(["T1","T2","T4"])("%s has current private-photo access", async actor => {
    expect((await request(app).get("/photos/private/A").set(as(actor))).status).toBe(200);
  });
  it.each(["T3","TZ"])("%s cannot read A private photos", async actor => {
    expect((await request(app).get("/photos/private/A").set(as(actor))).status).toBe(403);
  });
  it("same student/date different class stays independent", async () => {
    for(const [actor,id] of [["T1","TUE"],["T2","THU"]]) expect((await request(app).post("/attendance").set(as(actor)).send(input(id))).status).toBe(201);
    const rows = await fixture.pool.query("SELECT class_group_id FROM attendance WHERE date=$1 ORDER BY class_group_id",[date]);
    expect(rows.rows.map(r=>r.class_group_id)).toEqual(["THU","TUE"]);
  });
  it("two concurrent requests create one canonical row", async () => {
    const results = await Promise.all([1,2].map(()=>request(app).post("/attendance").set(as("T1")).send(input())));
    expect(results.every(r=>[200,201].includes(r.status))).toBe(true);
    const n = await fixture.pool.query("SELECT count(*)::int n FROM attendance WHERE date=$1",[date]);
    expect(n.rows[0].n).toBe(1);
  });
  it("regular and makeup coexist for identical student/class/date", async () => {
    await writeCanonicalAttendance({poolId:"P1",studentId:"A",classId:"TUE",date,kind:"regular",status:"absent"});
    await writeCanonicalAttendance({poolId:"P1",studentId:"A",classId:"TUE",date,kind:"makeup",status:"present"});
    const r=await fixture.pool.query("SELECT session_type,status FROM attendance WHERE date=$1 ORDER BY session_type",[date]);
    expect(r.rows).toEqual([{session_type:"makeup",status:"present"},{session_type:"regular",status:"absent"}]);
  });
  it("legacy rows remain readable and cannot be silently upgraded", async () => {
    const before=(await fixture.pool.query("SELECT * FROM attendance ORDER BY id")).rows;
    const r=await request(app).get("/students/L/attendance").set(as("ADMIN"));
    expect(r.status).toBe(200);
    const denied=await request(app).post("/attendance").set(as("T1")).send({...input(),date:"2026-07-20"});
    expect(denied.status).toBe(409);
    expect((await fixture.pool.query("SELECT * FROM attendance ORDER BY id")).rows).toEqual(before);
    expect(before.filter(r=>r.class_group_id==null).length).toBe(87);
    expect(before.filter(r=>r.id.startsWith("legacy-dup")).length).toBe(2);
  });
  it("omitted class filter still cannot expose another teacher's attendance", async () => {
    for(const classId of ["TUE","THU"]) await writeCanonicalAttendance({poolId:"P1",studentId:"A",classId,date,kind:"regular",status:"present"});
    const r=await request(app).get("/attendance").set(as("T1"));
    expect(r.status).toBe(200); expect(r.body.every((row:any)=>row.class_group_id==="TUE")).toBe(true);
  });
  it("class-array order never decides student authorization", async () => {
    await fixture.pool.query(`UPDATE students SET assigned_class_ids='["THU","TUE"]',class_group_id='THU' WHERE id='A'`);
    expect(await teacherCanAccessStudent("T1","A")).toBe(true);
    expect(await teacherCanAccessStudent("T2","A")).toBe(true);
    expect(await teacherCanAccessStudent("T3","A")).toBe(false);
  });
  it("a teacher cannot remove the other teacher's membership", async () => {
    const r=await request(app).patch("/students/A/assign").set(as("T1")).send({assigned_class_ids:["TUE"]});
    expect(r.status).toBe(403); expect(await getCurrentStudentClassIds("A")).toEqual(["THU","TUE"]);
  });
  it("pool boundaries and forged session kinds are rejected", async () => {
    expect((await request(app).post("/attendance").set(as("TZ")).send(input())).status).toBe(403);
    expect((await request(app).post("/attendance").set(as("T1")).send({...input(),session_type:"makeup"})).status).toBe(400);
    expect((await request(app).patch("/students/A/assign").set(as("ADMIN")).send({assigned_class_ids:["OUT"]})).status).toBe(403);
    expect(await teacherCanAccessClass("TZ","TUE")).toBe(false);
  });
  it("pool admin retains all own-pool classes and members", async () => {
    const classes=await request(app).get("/class-groups").set(as("ADMIN"));
    expect(classes.body.map((r:any)=>r.id).sort()).toEqual(["THU","THU2","TUE","TUE2"]);
    const members=await request(app).get("/teacher/me/members").set(as("ADMIN"));
    expect(members.body.map((r:any)=>r.id).sort()).toEqual(["A","B","L"]);
  });
  it("scheduler preserve-existing mode cannot overwrite a manual absence", async () => {
    const key={poolId:"P1",studentId:"A",classId:"TUE",date,kind:"regular" as const};
    await writeCanonicalAttendance({...key,status:"absent"});
    await writeCanonicalAttendance({...key,status:"present",preserveExisting:true});
    expect((await fixture.pool.query("SELECT status FROM attendance WHERE date=$1",[date])).rows[0].status).toBe("absent");
  });
  it("makeup completion commits its canonical attendance reference", async () => {
    await fixture.pool.query(`INSERT INTO makeup_sessions(id,student_id,swimming_pool_id,status,original_class_group_id) VALUES('M','A','P1','waiting','TUE')`);
    const row=await completeMakeupAttendance({makeupId:"M",poolId:"P1",studentId:"A",classId:"TUE",date,actorId:"T1",actorName:"fixture"});
    const m=(await fixture.pool.query("SELECT status,completed_attendance_id FROM makeup_sessions WHERE id='M'")).rows[0];
    expect(m).toEqual({status:"completed",completed_attendance_id:row.id});
  });
  it("a legacy conflict rolls back makeup completion", async () => {
    await fixture.pool.query(`INSERT INTO makeup_sessions(id,student_id,swimming_pool_id,status,original_class_group_id) VALUES('M','A','P1','waiting','TUE')`);
    await expect(completeMakeupAttendance({makeupId:"M",poolId:"P1",studentId:"A",classId:"TUE",date:"2026-07-20",actorId:"T1",actorName:"fixture"})).rejects.toThrow();
    expect((await fixture.pool.query("SELECT status FROM makeup_sessions WHERE id='M'")).rows[0].status).toBe("waiting");
  });
  it.each([["T1","TUE",200],["T1","THU",403],["T2","THU",200],["T2","TUE",403],["T4","TUE",200],["TZ","TUE",403]])(
    "diary writer %s -> %s returns %s", async(actor,classId,status)=>{
      const r=await request(app).post("/diaries").set(as(actor)).send({
        class_group_id:classId,lesson_date:date,common_content:"fixture lesson",
        student_notes:[{student_id:"A",note_content:"fixture personal note"}],
      });
      expect(r.status,JSON.stringify(r.body)).toBe(status);
    });
  it("two teachers' notes accumulate under the same student and are readable as student history",async()=>{
    for(const [actor,classId] of [["T1","TUE"],["T2","THU"]]){
      const r=await request(app).post("/diaries").set(as(actor)).send({
        class_group_id:classId,lesson_date:date,common_content:"fixture lesson",
        student_notes:[{student_id:"A",note_content:"fixture student note"}]});
      expect(r.status,JSON.stringify(r.body)).toBe(200);
    }
    const notes=await fixture.pool.query("SELECT student_id,count(*)::int n FROM class_diary_student_notes GROUP BY student_id");
    expect(notes.rows).toEqual([{student_id:"A",n:2}]);
    const r=await request(app).get("/diaries/index?student_id=A").set(as("T1"));
    expect(r.status,JSON.stringify(r.body)).toBe(200);
    expect(JSON.stringify(r.body)).toContain("Thursday 16");
    expect(JSON.stringify(r.body)).toContain("Tuesday 16");
  });
  it("diary note cannot target another pool or another class's student", async()=>{
    for(const studentId of ["B","Z"]){
      expect((await request(app).post("/diaries").set(as("T1")).send({
        class_group_id:"TUE",lesson_date:date,common_content:"fixture",
        student_notes:[{student_id:studentId,note_content:"must reject"}]})).status).toBe(403);
    }
  });
  it("membership frequency does not impose a new two-class cap",async()=>{
    const r=await request(app).patch("/students/A/assign").set(as("ADMIN")).send({assigned_class_ids:["TUE","THU","TUE2"],weekly_count:2});
    expect(r.status).toBe(200); expect(await getCurrentStudentClassIds("A")).toHaveLength(3);
  });
  it("makeup ownership never follows student membership into the other teacher's class",async()=>{
    await fixture.pool.query(`INSERT INTO makeup_sessions(id,student_id,swimming_pool_id,status,original_class_group_id,cancelled_at,original_teacher_id)
      VALUES('M','A','P1','waiting','THU',NULL,'T2')`);
    expect((await request(app).patch("/teacher/makeups/M/complete").set(as("T1")).send({})).status).toBe(403);
    const r=await request(app).get("/teacher/makeups?status=waiting").set(as("T1"));
    expect(r.status,JSON.stringify(r.body)).toBe(200); expect(r.body).toEqual([]);
  });
  it("X uses the identical lead/co-teacher diary write boundary",async()=>{
    fixture.mode="x";
    const base={lesson_date:date,common_content:"fixture",student_notes:[{student_id:"A",note_content:"fixture"}]};
    expect((await request(app).post("/diaries").set(as("T1")).send({...base,class_group_id:"THU"})).status).toBe(403);
    expect((await request(app).post("/diaries").set(as("T2")).send({...base,class_group_id:"THU"})).status).toBe(200);
  });
  it("the same teacher independently writes both B classes",async()=>{
    for(const classId of ["TUE2","THU2"]){
      expect((await request(app).post("/attendance").set(as("T3")).send({...input(classId),student_id:"B"})).status).toBe(201);
      expect((await request(app).post("/diaries").set(as("T3")).send({
        class_group_id:classId,lesson_date:date,common_content:"fixture",student_notes:[{student_id:"B",note_content:"fixture"}]})).status).toBe(200);
    }
    expect((await fixture.pool.query("SELECT count(*)::int n FROM attendance WHERE student_id='B'")).rows[0].n).toBe(2);
  });
  it("teacher absence is class-scoped and a legacy conflict rolls back every write",async()=>{
    expect((await request(app).post("/absences").set(as("T1")).send({class_group_id:"THU",absence_date:date})).status).toBe(403);
    const before=(await fixture.pool.query("SELECT * FROM attendance ORDER BY id")).rows;
    expect((await request(app).post("/absences").set(as("T1")).send({class_group_id:"TUE",absence_date:"2026-07-20"})).status).toBe(409);
    expect((await fixture.pool.query("SELECT * FROM attendance ORDER BY id")).rows).toEqual(before);
    expect((await fixture.pool.query("SELECT count(*)::int n FROM teacher_absences")).rows[0].n).toBe(0);
  });
  it("normal makeup completion preserves domain flags and co-teacher permissions",async()=>{
    await fixture.pool.query(`INSERT INTO makeup_sessions(id,student_id,swimming_pool_id,status,original_class_group_id,
      original_teacher_id,assigned_class_group_id,assigned_teacher_id,assigned_date,is_substitute)
      VALUES('M','A','P1','assigned','TUE','T1','TUE','T1','2026-10-13',false)`);
    const r=await request(app).patch("/teacher/makeups/M/complete").set(as("T4")).send({});
    expect(r.status,JSON.stringify(r.body)).toBe(200);
    const m=(await fixture.pool.query("SELECT is_substitute,completed_attendance_id FROM makeup_sessions WHERE id='M'")).rows[0];
    expect(m.is_substitute).toBe(false); expect(m.completed_attendance_id).toBeTruthy();
  });
  it("assigned-class co-teacher can cancel only their assigned makeup",async()=>{
    await fixture.pool.query(`INSERT INTO makeup_sessions(id,student_id,swimming_pool_id,status,original_class_group_id,
      original_teacher_id,assigned_class_group_id,assigned_teacher_id,assigned_date)
      VALUES('M','A','P1','assigned','THU','T2','TUE','T1','2026-10-13')`);
    expect((await request(app).patch("/teacher/makeups/M/revert").set(as("T3")).send({})).status).toBe(403);
    const r=await request(app).patch("/teacher/makeups/M/revert").set(as("T4")).send({});
    expect(r.status,JSON.stringify(r.body)).toBe(200);
    expect((await fixture.pool.query("SELECT status FROM makeup_sessions WHERE id='M'")).rows[0].status).toBe("waiting");
  });
  it("a legitimate guest makeup still permits a student-owned diary note",async()=>{
    await fixture.pool.query(`UPDATE students SET assigned_class_ids='["TUE"]' WHERE id='A';
      UPDATE student_class_history SET left_at='2026-10-01' WHERE student_id='A' AND class_group_id='THU';
      INSERT INTO makeup_sessions(id,student_id,swimming_pool_id,status,original_class_group_id,
        original_teacher_id,assigned_class_group_id,assigned_teacher_id,assigned_date)
        VALUES('M','A','P1','assigned','TUE','T1','THU','T2','2026-10-13')`);
    const r=await request(app).post("/diaries").set(as("T2")).send({
      class_group_id:"THU",lesson_date:date,common_content:"fixture",
      student_notes:[{student_id:"A",note_content:"guest makeup fixture"}]});
    expect(r.status,JSON.stringify(r.body)).toBe(200);
  });
  it("the secondary teacher can open the same student's private photo file",async()=>{
    await fixture.pool.query(`INSERT INTO photo_assets_meta(id,student_id,class_id,pool_id,album_type,media_status,object_key)
      VALUES('PH','A','TUE','P1','private','attached','fixture-object')`);
    expect((await request(app).get("/photos/PH/file").set(as("T1"))).status).toBe(302);
    const secondary=await request(app).get("/photos/PH/file").set(as("T2"));
    expect(secondary.status).toBe(302);
    expect(secondary.headers.location).toBe("https://fixture.invalid/private-photo");
    expect((await request(app).get("/photos/PH/file").set(as("T3"))).status).toBe(403);
    expect((await request(app).get("/photos/PH/file").set(as("TZ"))).status).toBe(403);
  });
  it("weekly attendance keeps regular separate from makeup for a shared student",async()=>{
    for(const kind of ["regular","makeup"] as const) await writeCanonicalAttendance({
      poolId:"P1",studentId:"A",classId:"TUE",date,kind,status:kind==="regular"?"absent":"present"});
    const r=await request(app).get("/attendance/weekly?class_group_id=TUE&start_date=2026-10-12").set(as("T1"));
    expect(r.status,JSON.stringify(r.body)).toBe(200);
    const row=r.body.data.find((item:any)=>item.student_id==="A" && item.class_group_id==="TUE");
    expect(row?.days[date]).toBe("absent");
  });
});
