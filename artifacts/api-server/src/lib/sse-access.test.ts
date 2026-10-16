import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  payload: { userId: "fixture-user", role: "pool_admin", tv: 1, exp: 0 },
  execute: vi.fn(),
}));
vi.mock("./auth.js", () => ({ TOKEN_VERSION: 1, verifyToken: () => fixture.payload }));
vi.mock("@workspace/db", () => ({
  superAdminDb: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: fixture.execute }) },
}));
import { checkStreamAccess, streamPrincipal } from "./sse-access";
const principal = { userId: "fixture-user", role: "pool_admin" as const,
  poolId: "fixture-pool", expiresAt: Date.now() + 60_000 };
const active = { is_activated: true, withdrawal_requested_at: null, roles: ["pool_admin"],
  role: "pool_admin", swimming_pool_id: "fixture-pool", pool_id: "fixture-pool", deactivated_at: null };
beforeEach(() => {
  fixture.payload = { userId: "fixture-user", role: "pool_admin", tv: 1, exp: Date.now() / 1000 + 60 };
  fixture.execute.mockReset().mockResolvedValue({ rows: [active] });
});
it("reuses signed token version, role and expiration validation", () => {
  expect(streamPrincipal("fixture-only", "fixture-pool").userId).toBe("fixture-user");
  fixture.payload.tv = 0;
  expect(() => streamPrincipal("fixture-only", "fixture-pool")).toThrow();
  fixture.payload.tv = 1; fixture.payload.exp = 0;
  expect(() => streamPrincipal("fixture-only", "fixture-pool")).toThrow();
});
it("checks current authority in a statement-time-bounded read transaction", async () => {
  expect(await checkStreamAccess(principal)).toBe(true);
  expect(fixture.execute).toHaveBeenCalledTimes(2);
});
it.each([
  { is_activated: false }, { withdrawal_requested_at: new Date() }, { roles: [] },
  { swimming_pool_id: "other-pool" }, { pool_id: null }, { deactivated_at: new Date() },
])("denies account/role/Pool revocation: %j", async patch => {
  fixture.execute.mockResolvedValue({ rows: [{ ...active, ...patch }] });
  expect(await checkStreamAccess(principal)).toBe(false);
});
it("does not fail open on DB failure", async () => {
  fixture.execute.mockRejectedValue(new Error("fixture outage"));
  await expect(checkStreamAccess(principal)).rejects.toThrow();
});
it("preserves valid super-admin pool selection, but checks its current role", async () => {
  const admin = { ...principal, role: "super_admin" as const };
  fixture.execute.mockResolvedValue({ rows: [{ ...active, role: "super_admin", roles: null, swimming_pool_id: null }] });
  expect(await checkStreamAccess(admin)).toBe(true);
  fixture.execute.mockResolvedValue({ rows: [{ ...active, role: "teacher", roles: ["teacher"] }] });
  expect(await checkStreamAccess(admin)).toBe(false);
});
