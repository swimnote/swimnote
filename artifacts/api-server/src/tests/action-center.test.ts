import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
  req.user = { userId: "admin-1", role: "pool_admin" };
  next();
}));
const mockRequireRole = vi.hoisted(() => vi.fn((...roles: any[]) => (req: any, res: any, next: any) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "FORBIDDEN" })));

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  superAdminDb: { select: mockSelect },
}));

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: mockRequireAuth,
  requireRole: mockRequireRole,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireXMode: (_req: any, _res: any, next: any) => next(),
}));

import express from "express";
import request from "supertest";
import adminRouter from "../routes/admin.js";

function makeApp(role: "pool_admin" | "teacher" = "pool_admin") {
  mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { userId: "admin-1", role };
    next();
  });
  mockSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [{ swimming_pool_id: "pool-1" }],
      }),
    }),
  });
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  return app;
}

describe("admin action center commercialization routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/action-center returns each action section", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "student-1", days_left: 7 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ class_group_id: "class-1", empty_seats: 2 }] });

    const res = await request(makeApp()).get("/admin/action-center");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      renewal_due: expect.any(Array),
      long_absence: expect.any(Array),
      empty_seats: expect.any(Array),
    });
  });

  it("PATCH /admin/students/:id/payment-status validates and updates", async () => {
    const invalid = await request(makeApp())
      .patch("/admin/students/student-1/payment-status")
      .send({ payment_status: "PENDING" });
    expect(invalid.status).toBe(400);

    mockExecute.mockResolvedValueOnce({ rows: [] });
    const valid = await request(makeApp())
      .patch("/admin/students/student-1/payment-status")
      .send({ payment_status: "PAID" });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ success: true, payment_status: "PAID" });
  });

  it("GET /admin/students/:id/basic-progress returns progress shape", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "student-1", name: "민수", class_group_id: "class-1" }] })
      .mockResolvedValueOnce({ rows: [{ name: "초급반" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: "diary-1", title: "수업일지" }] })
      .mockResolvedValueOnce({ rows: [{ total: 4, present: 3, absent: 1 }] })
      .mockResolvedValueOnce({ rows: [{ last_date: "2026-01-01" }] });

    const res = await request(makeApp()).get("/admin/students/student-1/basic-progress");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      student: expect.any(Object),
      class_name: "초급반",
      diary_count: 3,
      last_diary: expect.any(Object),
      attendance: { total: 4, present: 3, absent: 1 },
      last_attended_date: "2026-01-01",
    });
  });
});