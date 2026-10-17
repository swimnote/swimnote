import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import { createOfficeRouter } from "./office-http.js";
import { OfficeCommandService } from "./office-command.js";
const fixture = vi.hoisted(() => ({ active: true, roles: ["pool_admin"], connects: 0 }));
// Actual requireAuth/requireRole; only JWT signing key and SQL adapter are synthetic.
vi.mock("./auth.js", async () => {
  const j = (await import("jsonwebtoken")).default;
  return { TOKEN_VERSION: 91, SUPER_ADMIN_PERMISSIONS: {},
    verifyToken: (token: string) => j.verify(token, "office-synthetic-session-test-only") };
});
vi.mock("./xmode.js", () => ({ resolvePoolMode: () => { throw new Error("Forbidden"); } }));
vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: async () => ({ rows: [{
    is_activated: fixture.active, withdrawal_requested_at: null, retain_mode: true, roles: fixture.roles,
  }] }) },
  get pool() { throw new Error("Operating connection forbidden"); },
  get db() { throw new Error("Operating connection forbidden"); },
}));
import { requireAuth, requireRole, clearWithdrawCache } from "../middlewares/auth.js";
const id = "os1_00000000-0000-0000-0000-000000000001";
const token = (extra = {}, options = {}) => jwt.sign({ userId: "session_fixture", role: "pool_admin",
  poolId: "synthetic_pool", tv: 91, ...extra }, "office-synthetic-session-test-only", { expiresIn: 120, ...options });
let server: any, base: string;
beforeEach(async () => {
  fixture.active = true; fixture.roles = ["pool_admin"]; fixture.connects = 0;
  clearWithdrawCache("session_fixture"); vi.stubEnv("OFFICE_STAGE3_ENABLED", "false");
  const service = new OfficeCommandService({ connect: async () => {
    fixture.connects++;
    return { release() {}, query: async (_sql: string, values?: unknown[]) => ({ rows:
      values?.[2] === "session_fixture" && values?.[1] === "synthetic_pool"
        ? [{ current: true, result: { requestId: id, memberId: "synthetic_member",
          revision: "0".repeat(32), action: "update", changes: [], assignedClassIds: [] } }] : [] }) };
  } });
  const app = express();
  app.use("/office", createOfficeRouter({ service, auth: [requireAuth as any, requireRole("pool_admin") as any],
    actor: async (req: any) => ({ userId: req.user.userId, role: req.user.role, poolId: req.user.poolId }),
    model: async () => { throw new Error("No model calls"); }, notify: async () => {} }));
  server = await new Promise<any>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/office/commands/${id}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); });
const lookup = (signed?: string) => fetch(base, { headers: signed ? { authorization: "Bearer " + signed } : {} });
describe("actual auth middleware around read-only receipts", () => {
  it("valid signed synthetic session reads with execution OFF", async () => {
    expect((await lookup(token())).status).toBe(200); expect(fixture.connects).toBe(1);
  });
  it("missing, forged and expired sessions never reach the receipt connection", async () => {
    for (const signed of [undefined, "forged", token({}, { expiresIn: -1 }), token({ tv: 90 })])
      expect((await lookup(signed)).status).toBe(401);
    expect(fixture.connects).toBe(0);
  });
  it("fresh role revocation blocks even a correctly signed old role claim", async () => {
    fixture.roles = [];
    expect((await lookup(token())).status).toBe(403); expect(fixture.connects).toBe(0);
  });
  it("inactive synthetic account cannot use a valid JWT for receipt reads", async () => {
    fixture.active = false;
    expect((await lookup(token())).status).toBe(401); expect(fixture.connects).toBe(0);
  });
  it("different signed actor or Pool never receives the other receipt", async () => {
    expect((await lookup(token({ userId: "different_actor" }))).status).toBe(404);
    expect((await lookup(token({ poolId: "different_pool" }))).status).toBe(404);
  });
});
