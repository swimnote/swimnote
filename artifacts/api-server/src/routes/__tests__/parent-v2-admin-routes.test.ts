import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  role: "pool_admin" as string,
  userId: "admin_test",
  poolId: "pool_test",
  dbExecute: vi.fn(),
  getPendingByPool: vi.fn(),
  approvePending: vi.fn(),
  rejectPending: vi.fn(),
  approvalInfo: vi.fn(),
  confirmPending: vi.fn(),
  requestAdminHelp: vi.fn(),
  sendPushToUser: vi.fn(),
  sendPushToUserWithResult: vi.fn(),
  sendPushToAdmin: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: (...args: any[]) => mocks.dbExecute(...args) },
  superAdminDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ swimming_pool_id: mocks.poolId }],
        }),
      }),
    }),
  },
}));

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = { userId: mocks.userId, role: mocks.role };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: () => void) => {
    if (!roles.includes(req.user?.role)) {
      res.status(403).json({ success: false, message: "권한이 없습니다." });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/auto-link-v2.js", () => ({
  getParentV2PendingByPool: (...args: any[]) => mocks.getPendingByPool(...args),
  approveParentV2Pending: (...args: any[]) => mocks.approvePending(...args),
  rejectParentV2Pending: (...args: any[]) => mocks.rejectPending(...args),
}));

vi.mock("../../lib/parent-v2-admin-service.js", () => ({
  getParentV2ApprovalInfo: (...args: any[]) => mocks.approvalInfo(...args),
  confirmParentV2Pending: (...args: any[]) => mocks.confirmPending(...args),
  requestParentV2AdminHelp: (...args: any[]) => mocks.requestAdminHelp(...args),
}));

vi.mock("../../lib/push-service.js", () => ({
  sendPushToUser: (...args: any[]) => mocks.sendPushToUser(...args),
  sendPushToUserWithResult: (...args: any[]) => mocks.sendPushToUserWithResult(...args),
}));

import parentRequestsRouter from "../parent-requests.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(parentRequestsRouter);
  return app;
}

beforeEach(() => {
  mocks.role = "pool_admin";
  mocks.userId = "admin_test";
  mocks.poolId = "pool_test";
  mocks.dbExecute.mockReset().mockResolvedValue({ rows: [] });
  mocks.getPendingByPool.mockReset().mockResolvedValue([]);
  mocks.approvePending.mockReset().mockResolvedValue({ success: true, message: "승인 완료", linkedCount: 1 });
  mocks.rejectPending.mockReset().mockResolvedValue({ success: true, message: "거절 완료" });
  mocks.approvalInfo.mockReset().mockResolvedValue({
    pending_id: "pending_test",
    child_name_raw: "박하윤",
    parent_name: "김보호",
    parent_phone: "010-1111-2222",
    phone_verified: true,
    candidates: [{
      id: "student_saved",
      name: "박하윤",
      parent_name: "김보호",
      parent_phone: "010-1111-2222",
      parent_phone2: null,
      parent_phone3: null,
      parent_phone4: null,
    }],
    reason: "phone_mismatch",
  });
  mocks.confirmPending.mockReset().mockResolvedValue({
    success: true,
    message: "승인 완료",
    linkedCount: 1,
    newRelationCount: 1,
    relationCreated: true,
    students: [{ id: "student_saved", name: "박하윤" }],
  });
  mocks.requestAdminHelp.mockReset();
  mocks.sendPushToUser.mockReset();
  mocks.sendPushToUserWithResult.mockReset().mockResolvedValue(true);
  mocks.sendPushToAdmin.mockReset();
});

describe("parent V2 approval routes", () => {
  it("returns the exact approval-info data contract scoped to the requesting admin pool", async () => {
    const response = await request(makeApp())
      .get("/admin/parent-v2-pending/pending_test/approval-info")
      .expect(200);

    expect(response.body.data).toEqual({
      pending_id: "pending_test",
      child_name_raw: "박하윤",
      parent_name: "김보호",
      parent_phone: "010-1111-2222",
      phone_verified: true,
      candidates: [{
        id: "student_saved",
        name: "박하윤",
        parent_name: "김보호",
        parent_phone: "010-1111-2222",
        parent_phone2: null,
        parent_phone3: null,
        parent_phone4: null,
      }],
      reason: "phone_mismatch",
    });
    expect(mocks.approvalInfo).toHaveBeenCalledWith("pending_test", "pool_test");
  });

  it("also returns read-only approval-info for a rejected request", async () => {
    mocks.approvalInfo.mockResolvedValueOnce({
      pending_id: "pending_test",
      child_name_raw: "원본 이름",
      parent_name: "김보호",
      parent_phone: "010-1111-2222",
      phone_verified: false,
      candidates: [{ id: "student_saved", name: "박하윤" }],
      reason: "name_mismatch",
    });
    const response = await request(makeApp())
      .get("/admin/parent-v2-pending/pending_test/approval-info")
      .expect(200);
    expect(response.body.data.child_name_raw).toBe("원본 이름");
    expect(response.body.data.candidates).toEqual([{ id: "student_saved", name: "박하윤" }]);
    expect(mocks.approvalInfo).toHaveBeenCalledWith("pending_test", "pool_test");
  });

  it("maps the requested approved tab to the persisted matched status", async () => {
    await request(makeApp())
      .get("/admin/parent-v2-pending?status=approved")
      .expect(200);

    expect(mocks.getPendingByPool).toHaveBeenCalledWith("pool_test", "matched");
  });

  it("routes rejected-row {action:'approve',student_id} through the baseline PATCH helper", async () => {
    mocks.dbExecute.mockResolvedValueOnce({ rows: [{ parent_id: "parent_test", child_name_raw: "박하윤" }] });
    const approved = await request(makeApp())
      .patch("/admin/parent-v2-pending/pending_test")
      .send({ action: "approve", student_id: "student_saved" })
      .expect(200);

    expect(mocks.approvePending).toHaveBeenCalledWith(
      "pending_test",
      "pool_test",
      "student_saved",
    );
    expect(approved.body).toMatchObject({ success: true, linked_count: 1 });
    expect(mocks.confirmPending).not.toHaveBeenCalled();
    expect(mocks.rejectPending).not.toHaveBeenCalled();
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "parent_test",
      true,
      "parent_link_approved",
      "자녀 연결 완료!",
      "박하윤과(와) 연결되었습니다.",
      { screen: "home" },
      "link_approved_pending_test",
    );
  });

  it("requires an authorized administrator and accepts only {student_id} on the new POST", async () => {
    mocks.role = "teacher";
    await request(makeApp())
      .post("/admin/parent-v2-pending/pending_test/confirm")
      .send({ student_id: "student_saved", parent_phone: "010-1111-2222" })
      .expect(403);
    expect(mocks.confirmPending).not.toHaveBeenCalled();

    mocks.role = "pool_admin";
    await request(makeApp())
      .post("/admin/parent-v2-pending/pending_test/confirm")
      .send({ student_id: "student_saved", parent_phone: "010-1111-2222" })
      .expect(400);
    expect(mocks.confirmPending).not.toHaveBeenCalled();

    mocks.dbExecute.mockResolvedValueOnce({ rows: [{ parent_id: "parent_test", child_name_raw: "오타 이름" }] });
    const response = await request(makeApp())
      .post("/admin/parent-v2-pending/pending_test/confirm")
      .send({ student_id: "student_saved" })
      .expect(200);

    expect(mocks.confirmPending).toHaveBeenCalledWith(
      "pending_test",
      "pool_test",
      "admin_test",
      "student_saved",
    );
    expect(response.body).toEqual({
      data: {
        success: true,
        linked_count: 1,
        students: [{ id: "student_saved", name: "박하윤" }],
        pending_status: "matched",
      },
    });
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "parent_test",
      true,
      "parent_link_approved",
      "자녀 연결 완료!",
      "오타 이름과(와) 연결되었습니다.",
      { screen: "home" },
      "link_approved_pending_test",
    );
  });

  it("binds administrator-request notification and deep link to the parent JWT and pool admins", async () => {
    mocks.role = "parent_account";
    mocks.userId = "parent_from_jwt";
    mocks.requestAdminHelp.mockImplementation(async (pendingId: string | undefined, parentId: string, send: any) => {
      const resolvedPendingId = pendingId ?? "pending_resolved";
      await send("pool_admin_from_pending_pool", "pool_test", resolvedPendingId);
      return {
        success: true,
        message: "수영장에 승인 요청을 보냈습니다.",
        cooldown_seconds: 600,
        push_delivery_status: "delivered",
      };
    });

    const response = await request(makeApp())
      .post("/parent/v2/pending/request-admin")
      .send({ parent_id: "forged_parent", pool_id: "forged_pool" })
      .expect(200);

    expect(mocks.requestAdminHelp).toHaveBeenCalledWith(
      undefined,
      "parent_from_jwt",
      expect.any(Function),
    );
    expect(mocks.sendPushToUserWithResult).toHaveBeenCalledWith(
      "pool_admin_from_pending_pool",
      false,
      "parent_link_admin_request",
      "학부모 연결 승인 요청",
      "학부모 연결 승인을 기다리는 요청이 있습니다.",
      { screen: "approvals", tab: "parent", pendingId: "pending_resolved" },
      "parent_v2_admin_request_pool_test_pending_resolved",
    );
    expect(response.body).toEqual({
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: 600,
      push_delivery_status: "delivered",
    });
  });

  it("reports durable request success separately from a failed push", async () => {
    mocks.role = "parent_account";
    mocks.sendPushToUserWithResult.mockResolvedValue(false);
    mocks.requestAdminHelp.mockImplementation(async (_pendingId: string | undefined, _parentId: string, send: any) => {
      const delivered = await send("pool_admin", "pool_test", "pending_test");
      expect(delivered).toBe(false);
      return {
        success: true,
        message: "수영장에 승인 요청을 보냈습니다.",
        cooldown_seconds: 600,
        push_delivery_status: "failed",
      };
    });

    const response = await request(makeApp())
      .post("/parent/v2/pending/request-admin")
      .send({ pending_id: "pending_test" })
      .expect(200);
    expect(response.body).toEqual({
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: 600,
      push_delivery_status: "failed",
    });
  });

  it("exposes an already-linked suppression result without sending another push", async () => {
    mocks.role = "parent_account";
    mocks.requestAdminHelp.mockResolvedValueOnce({
      success: true,
      message: "이미 승인된 학생 연결이 확인되어 관리자에게 새 요청을 보내지 않았습니다.",
      already_linked: true,
      push_delivery_status: "suppressed_already_linked",
    });
    const response = await request(makeApp())
      .post("/parent/v2/pending/request-admin")
      .send({ pending_id: "pending_test" })
      .expect(200);
    expect(response.body).toEqual({
      message: "이미 승인된 학생 연결이 확인되어 관리자에게 새 요청을 보내지 않았습니다.",
      already_linked: true,
      push_delivery_status: "suppressed_already_linked",
    });
    expect(mocks.sendPushToUserWithResult).not.toHaveBeenCalled();
  });
});