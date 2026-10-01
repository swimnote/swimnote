import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  dbSelect: vi.fn(),
  superAdminSelect: vi.fn(),
  dbUpdate: vi.fn(),
  withdrawStudent: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: any[]) => mocks.dbSelect(...args),
    update: (...args: any[]) => mocks.dbUpdate(...args),
    execute: vi.fn(),
  },
  superAdminDb: {
    select: (...args: any[]) => mocks.superAdminSelect(...args),
    execute: vi.fn(),
  },
}));

vi.mock("@workspace/db/schema", () => {
  const table = (name: string) => new Proxy({ __tableName: name }, {
    get(target, property) {
      if (property === "__tableName") return target.__tableName;
      return { table: name, column: String(property) };
    },
  });
  return {
    studentsTable: table("studentsTable"),
    classGroupsTable: table("classGroupsTable"),
    parentStudentsTable: table("parentStudentsTable"),
    parentAccountsTable: table("parentAccountsTable"),
    usersTable: table("usersTable"),
    attendanceTable: table("attendanceTable"),
    classChangeLogsTable: table("classChangeLogsTable"),
  };
});

vi.mock("drizzle-orm", () => {
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
    { raw: (value: string) => ({ raw: value }) },
  );
  return {
    eq: (...args: any[]) => ({ op: "eq", args }),
    and: (...args: any[]) => ({ op: "and", args }),
    sql,
  };
});

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { ...mocks.state.actor };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/pool-event-logger.js", () => ({ logPoolEvent: vi.fn() }));
vi.mock("../../lib/auto-link-v2.js", () => ({ triggerAutoLinkOnStudentV2: vi.fn() }));
vi.mock("../../lib/parent-approval-hooks.js", () => ({ onParentApproved: vi.fn() }));
vi.mock("../../lib/member-limit.js", () => ({
  assertMemberLimitInTx: vi.fn(),
  MemberLimitError: class MemberLimitError extends Error {},
  sendMemberLimitResponse: vi.fn(),
}));
vi.mock("../../utils/messenger-system.js", () => ({ createSystemMessage: vi.fn() }));
vi.mock("../../utils/change-logger.js", () => ({ logChange: vi.fn() }));
vi.mock("../../lib/pg-realtime.js", () => ({ notifyPoolEvent: vi.fn() }));
vi.mock("../../utils/historyUtils.js", () => ({
  kstTodayStr: vi.fn(),
  validateEffectiveDate: vi.fn(),
  closeAllActiveClassHistory: vi.fn(),
  closeClassHistory: vi.fn(),
}));
vi.mock("../../lib/withdraw-student-service.js", () => ({
  withdrawStudent: (...args: any[]) => mocks.withdrawStudent(...args),
}));

const { default: studentsRouter } = await import("../students.js");
const app = express();
app.use(express.json());
app.use("/students", studentsRouter);

function makeQuery(tableName: string | undefined) {
  const query: any = {
    from(table: any) {
      query.tableName = table?.__tableName;
      return query;
    },
    where() {
      return query;
    },
    limit() {
      return Promise.resolve(rowsFor(query.tableName).slice(0, 1));
    },
    then(resolve: any, reject: any) {
      return Promise.resolve(rowsFor(query.tableName)).then(resolve, reject);
    },
  };
  query.tableName = tableName;
  return query;
}

function rowsFor(tableName: string | undefined): any[] {
  if (tableName === "usersTable") {
    return mocks.state.poolId ? [{ swimming_pool_id: mocks.state.poolId }] : [];
  }
  if (tableName === "studentsTable") {
    return mocks.state.student ? [mocks.state.student] : [];
  }
  if (tableName === "classGroupsTable") return mocks.state.teacherClasses;
  return [];
}

function resetScenario() {
  mocks.state = {
    actor: { userId: "user-admin", role: "pool_admin" },
    poolId: "pool-1",
    student: {
      id: "student-1",
      swimming_pool_id: "pool-1",
      status: "active",
      class_group_id: null,
      assigned_class_ids: [],
      pending_status_change: null,
    },
    teacherClasses: [],
    updateValues: null,
  };
  mocks.dbSelect.mockClear().mockImplementation(() => makeQuery(undefined));
  mocks.superAdminSelect.mockClear().mockImplementation(() => makeQuery(undefined));
  mocks.dbUpdate.mockImplementation(() => {
    const update: any = {
      set(values: Record<string, any>) {
        mocks.state.updateValues = values;
        return update;
      },
      where() {
        mocks.state.student = { ...mocks.state.student, ...mocks.state.updateValues };
        return Promise.resolve([]);
      },
    };
    return update;
  });
  mocks.withdrawStudent.mockReset().mockImplementation(async () => {
    mocks.state.student = { ...mocks.state.student, status: "withdrawn" };
    return { success: true, studentId: "student-1", r2DeletedCount: 0, r2FailedCount: 0, deletedTables: [] };
  });
}

beforeEach(resetScenario);

describe("POST /students/:id/change-status withdrawal access", () => {
  it("lets a pool admin withdraw a student in their pool through the canonical service", async () => {
    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });

    expect(response.status).toBe(200);
    expect(response.body.new_status).toBe("withdrawn");
    expect(mocks.withdrawStudent).toHaveBeenCalledOnce();
    expect(mocks.withdrawStudent.mock.calls[0][1]).toBe("student-1");
    expect(mocks.withdrawStudent.mock.calls[0][2]).toBe("pool-1");
  });

  it("lets a teacher withdraw a student assigned to one of their pool classes", async () => {
    mocks.state.actor = { userId: "teacher-1", role: "teacher" };
    mocks.state.teacherClasses = [{ id: "class-1" }];
    mocks.state.student.assigned_class_ids = ["class-1"];

    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });

    expect(response.status).toBe(200);
    expect(mocks.withdrawStudent).toHaveBeenCalledOnce();
  });

  it("denies a same-pool teacher who is not assigned to the student", async () => {
    mocks.state.actor = { userId: "teacher-1", role: "teacher" };
    mocks.state.teacherClasses = [{ id: "teacher-class" }];
    mocks.state.student.class_group_id = "other-class";
    mocks.state.student.assigned_class_ids = ["other-class"];

    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });

    expect(response.status).toBe(403);
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });

  it("accepts a teacher's primary assigned class and rejects cross-pool or poolless teachers", async () => {
    mocks.state.actor = { userId: "teacher-1", role: "teacher" };
    mocks.state.teacherClasses = [{ id: "class-1" }];
    mocks.state.student.class_group_id = "class-1";
    const allowed = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });
    expect(allowed.status).toBe(200);

    resetScenario();
    mocks.state.actor = { userId: "teacher-1", role: "teacher" };
    mocks.state.teacherClasses = [{ id: "class-1" }];
    mocks.state.student.class_group_id = "class-1";
    mocks.state.student.swimming_pool_id = "pool-2";
    const crossPool = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });
    expect(crossPool.status).toBe(403);
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();

    mocks.state.poolId = null;
    const noPool = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });
    expect(noPool.status).toBe(403);
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });

  it("denies pool admins without a pool and prevents cross-pool access", async () => {
    mocks.state.poolId = null;
    const missingPool = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });
    expect(missingPool.status).toBe(403);

    resetScenario();
    mocks.state.student.swimming_pool_id = "pool-2";
    const crossPool = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });
    expect(crossPool.status).toBe(403);
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });

  it("keeps the existing poolless super-admin exception", async () => {
    mocks.state.actor = { userId: "root-1", role: "super_admin" };
    mocks.state.poolId = null;

    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });

    expect(response.status).toBe(200);
    expect(mocks.withdrawStudent).toHaveBeenCalledOnce();
    expect(mocks.withdrawStudent.mock.calls[0][2]).toBe("pool-1");
  });

  it("keeps the existing cross-pool restriction for a super-admin with a pool", async () => {
    mocks.state.actor = { userId: "root-1", role: "super_admin" };
    mocks.state.student.swimming_pool_id = "pool-2";
    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn" });
    expect(response.status).toBe(403);
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });

  it("rejects next-month withdrawal before querying or executing anything", async () => {
    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "withdrawn", effective_mode: "next_month" });

    expect(response.status).toBe(400);
    expect(mocks.superAdminSelect).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });

  it("continues to schedule suspension next month without changing current status", async () => {
    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "suspended", effective_mode: "next_month" });

    expect(response.status).toBe(200);
    expect(response.body.pending_status_change).toBe("suspended");
    expect(response.body.student.status).toBe("active");
    expect(mocks.state.updateValues.pending_status_change).toBe("suspended");
    expect(mocks.state.updateValues.pending_effective_mode).toBe("next_month");
    expect(mocks.state.updateValues.pending_effective_month).toMatch(/^\d{4}-\d{2}$/);
    expect(mocks.state.updateValues).not.toHaveProperty("status");
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });

  it("does not change the existing teacher next-month suspension path", async () => {
    mocks.state.actor = { userId: "teacher-1", role: "teacher" };
    mocks.state.teacherClasses = [];
    const response = await request(app).post("/students/student-1/change-status")
      .send({ new_status: "suspended", effective_mode: "next_month" });
    expect(response.status).toBe(200);
    expect(response.body.pending_status_change).toBe("suspended");
    expect(response.body.student.status).toBe("active");
    expect(mocks.withdrawStudent).not.toHaveBeenCalled();
  });
});