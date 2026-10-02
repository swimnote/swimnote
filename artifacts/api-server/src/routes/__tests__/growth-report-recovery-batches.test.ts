import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getStatus: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  resume: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: vi.fn() },
}));

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer test-")) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.user = {
      userId: `operator-${authorization.slice("Bearer test-".length)}`,
      role: authorization.slice("Bearer test-".length),
    };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/growth-report-recovery-batch.js", () => ({
  createRecoveryBatch: mocks.create,
  getRecoveryBatchStatus: mocks.getStatus,
  listRecoveryBatches: mocks.list,
  previewRecoveryBatch: mocks.preview,
  resumeRecoveryBatch: mocks.resume,
}));

import router from "../growth-report-recovery-batches.js";

const app = express();
app.use(express.json());
app.use(router);
const path = "/super/growth-reports/recovery-batches";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    batch: { id: "grrb_isolated_fixture" },
    replayed: false,
  });
  mocks.getStatus.mockResolvedValue({ id: "grrb_isolated_fixture", state: "PENDING" });
  mocks.list.mockResolvedValue({ batches: [] });
  mocks.preview.mockResolvedValue({ eligible_total: 0 });
  mocks.resume.mockResolvedValue({ batch: { id: "grrb_isolated_fixture", state: "PENDING" } });
});

describe("growth report recovery batch operator routes", () => {
  it.each(["super_admin", "platform_admin"])("admits verified %s for explicit approval", async role => {
    const approval = {
      report_month: "2026-08",
      pool_id: "isolated-pool",
      approval_id: "2acb5b71-3bea-4e33-b0e9-c22cf22ff752",
      reason: "Reviewed isolated recovery cohort",
      confirmed: true,
    };
    const response = await request(app)
      .post(path)
      .set("Authorization", `Bearer test-${role}`)
      .send(approval);

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reportMonth: "2026-08",
      poolId: "isolated-pool",
      approvalId: approval.approval_id,
      actorId: `operator-${role}`,
      actorRole: role,
      reason: approval.reason,
    }));
  });

  it.each(["admin", "pool_admin", "teacher", "parent"])(
    "rejects ordinary %s before approval persistence",
    async role => {
      const response = await request(app)
        .post(path)
        .set("Authorization", `Bearer test-${role}`)
        .send({
          report_month: "2026-08",
          approval_id: "2acb5b71-3bea-4e33-b0e9-c22cf22ff752",
          reason: "Not an authorized recovery approval",
          confirmed: true,
        });
      expect(response.status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthenticated requests before approval persistence", async () => {
    const response = await request(app).post(path).send({
      report_month: "2026-08",
      approval_id: "2acb5b71-3bea-4e33-b0e9-c22cf22ff752",
      reason: "Missing operator",
      confirmed: true,
    });
    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a non-string pool ID instead of broadening approval to all pools", async () => {
    const response = await request(app)
      .post(path)
      .set("Authorization", "Bearer test-super_admin")
      .send({
        report_month: "2026-08",
        pool_id: 42,
        approval_id: "2acb5b71-3bea-4e33-b0e9-c22cf22ff752",
        reason: "Valid approval fields with invalid pool scope",
        confirmed: true,
      });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_RECOVERY_SCOPE" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});