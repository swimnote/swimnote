import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ready: vi.fn(),
  reissue: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: mocks.execute },
  db: { execute: mocks.execute },
}));
vi.mock("../../lib/auth.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/auth.js")>();
  return {
    ...actual,
    verifyToken: (token: string) => {
      const role = token.startsWith("verified-") ? token.slice("verified-".length) : null;
      if (!role) throw new Error("invalid fixture token");
      return { userId: `isolated-operator-${role}`, role, tv: actual.TOKEN_VERSION };
    },
  };
});
vi.mock("../../lib/growth-report-unknown-reissue.js", () => ({
  isUnknownReissueSchemaReady: mocks.ready,
  reissueUnknownGrowthReports: mocks.reissue,
  operatorBearerFromRequest: (req: express.Request) => req.header("authorization") ?? null,
}));
vi.mock("../../lib/growth-report-monthly-run.js", () => ({
  getMonthlyAutomationSummary: vi.fn(async () => null),
  listMonthlyAutomationExceptions: vi.fn(async () => ({ rows: [], total: 0 })),
}));

import router from "../super.js";

const app = express();
app.use(express.json());
app.use(router);
const path = "/super/growth-reports/unknown-reissue";
const approval = {
  report_ids: ["gr_isolated_fixture"],
  confirmed: true,
  reason: "Explicit isolated operator approval",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({
    rows: [{ is_activated: true, withdrawal_requested_at: null, retain_mode: false }],
  });
  mocks.ready.mockResolvedValue(true);
  mocks.reissue.mockResolvedValue([{ report_id: "gr_isolated_fixture", state: "PROCESSING" }]);
});

describe("UNKNOWN reissue super operator route", () => {
  it.each(["super_admin", "platform_admin"])("lets %s read the exception list without approving anything", async role => {
    const result = await request(app).get("/super/growth-reports/monthly-automation?report_period=2026-09")
      .set("Authorization", `Bearer verified-${role}`);
    expect(result.status).toBe(200);
    expect(mocks.reissue).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).sql;
    expect(query.trim()).toMatch(/^SELECT\b/i);
  });

  it.each(["super_admin", "platform_admin"])("admits verified %s and forwards only the incoming operator JWT", async role => {
    const result = await request(app).post(path)
      .set("Authorization", `Bearer verified-${role}`).send(approval);
    expect(result.status).toBe(200);
    expect(result.body.results).toEqual([{ report_id: "gr_isolated_fixture", state: "PROCESSING" }]);
    expect(mocks.reissue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: `isolated-operator-${role}`,
      actorRole: role,
      operatorAuthorization: `Bearer verified-${role}`,
      reportIds: ["gr_isolated_fixture"],
      reason: approval.reason,
    }));
    expect(result.body).not.toHaveProperty("operatorAuthorization");
  });

  it.each(["pool_admin", "admin", "teacher", "parent", "parent_account"])("rejects %s before approval persistence/ENGINE", async role => {
    const result = await request(app).post(path)
      .set("Authorization", `Bearer verified-${role}`).send(approval);
    expect(result.status).toBe(403);
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.reissue).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before persistence/ENGINE", async () => {
    const result = await request(app).post(path).send(approval);
    expect(result.status).toBe(401);
    expect(mocks.reissue).not.toHaveBeenCalled();
  });

  it.each([
    { ...approval, confirmed: false },
    { ...approval, reason: " " },
    { ...approval, report_ids: [] },
    { ...approval, report_ids: [42] },
    { ...approval, report_ids: Array(51).fill("gr_isolated_fixture") },
  ])("requires bounded explicit operator approval: %j", async body => {
    const result = await request(app).post(path)
      .set("Authorization", "Bearer verified-super_admin").send(body);
    expect(result.status).toBe(400);
    expect(mocks.reissue).not.toHaveBeenCalled();
  });

  it("holds when the additive operation schema is missing without dispatch", async () => {
    mocks.ready.mockResolvedValue(false);
    const result = await request(app).post(path)
      .set("Authorization", "Bearer verified-super_admin").send(approval);
    expect(result.status).toBe(200);
    expect(result.body.results[0]).toMatchObject({
      state: "HOLD", error_code: "UNKNOWN_REISSUE_SCHEMA_NOT_READY",
    });
    expect(mocks.reissue).not.toHaveBeenCalled();
  });
});