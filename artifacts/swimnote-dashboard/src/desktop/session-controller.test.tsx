// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopSessionController } from "./session-controller";
import { getToken, setToken, useDesktopTokenStorage } from "../lib/token";
import type { OfficeDesktopBridge } from "../../desktop/contracts";
import { readAuthSession } from "../lib/auth-session";

const { get, clearQueries } = vi.hoisted(() => ({ get: vi.fn(), clearQueries: vi.fn() }));
vi.mock("../lib/api-client", () => ({ api: { get } }));
vi.mock("../lib/query-client", () => ({ queryClient: { clear: clearQueries } }));
const identity = { id: "fixture-user", role: "pool_admin", swimming_pool_id: "fixture-pool", name: "테스트 사용자", email: "fixture@example.invalid" };
function allow(mode = "x") {
  get.mockImplementation(async (route: string) => {
    if (route === "/auth/me") return identity;
    if (route === "/pools/my-pools") return [{ id: "fixture-pool", name: "테스트 수영장" }];
    if (route === "/pools/x-mode") return { pool_id: "fixture-pool", mode };
    throw new Error("Unexpected route");
  });
}
function bridge() {
  return {
    getBootstrapInfo: vi.fn(),
    restoreSession: vi.fn(async () => ({ token: null, remembered: false })),
    commitSession: vi.fn(async () => ({ ok: true })),
    clearSession: vi.fn(async () => ({ ok: true })),
    readLoginPreferences: vi.fn(async () => ({ loginId: "", remember: false })),
    saveLoginPreferences: vi.fn(async () => ({ ok: true })),
  };
}
beforeEach(() => { vi.clearAllMocks(); useDesktopTokenStorage(); allow(); });

describe("Desktop token lifecycle with mocked canonical API and storage bridge", () => {
  it("default OFF, no token: shows login without querying production", async () => {
    const controller = new DesktopSessionController(bridge());
    await controller.restore();
    expect(controller.getSnapshot().status).toBe("login");
    expect(get).not.toHaveBeenCalled();
  });
  it.each([false, true])("validates identity/Pool/X before committing with remember=%s", async remember => {
    const desktop = bridge();
    const controller = new DesktopSessionController(desktop);
    desktop.commitSession.mockImplementation(async () => {
      expect(get).toHaveBeenCalledTimes(3);
      expect(controller.getSnapshot().status).toBe("checking");
      return { ok: true };
    });
    await controller.accept("synthetic-final-token", remember);
    expect(controller.getSnapshot()).toMatchObject({ status: "authenticated", remembered: remember });
    expect(desktop.commitSession).toHaveBeenCalledWith({ token: "synthetic-final-token", remember });
    expect(localStorage.getItem("x_token")).toBeNull();
  });
  it("restores ON only after revalidation, not immediately on decrypt", async () => {
    const desktop = bridge();
    desktop.restoreSession.mockResolvedValue({ token: "synthetic-final-token", remembered: true } as never);
    const controller = new DesktopSessionController(desktop);
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({ status: "authenticated", remembered: true });
    expect(get.mock.calls.map(call => call[0]).sort()).toEqual(["/auth/me", "/pools/my-pools", "/pools/x-mode"].sort());
  });
  it.each([401, 403, 404])("expiry/revocation %s removes remembered session and returns to login", async status => {
    const desktop = bridge();
    get.mockRejectedValue({ status });
    const controller = new DesktopSessionController(desktop);
    await controller.accept("synthetic-final-token", true);
    expect(controller.getSnapshot().status).toBe("login");
    expect(desktop.clearSession).toHaveBeenCalled();
    expect(desktop.commitSession).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });
  it.each(["normal", "x_pending", "subscription_required"])("authentication is not OFFICE permission for %s", async mode => {
    allow(mode);
    const desktop = bridge();
    const controller = new DesktopSessionController(desktop);
    await controller.accept("synthetic-final-token", true);
    expect(controller.getSnapshot()).toMatchObject({ status: "login", denied: true });
    expect(desktop.commitSession).not.toHaveBeenCalled();
    expect(desktop.clearSession).toHaveBeenCalled();
  });
  it("rejects changed role or mismatched Pool", async () => {
    for (const altered of [{ ...identity, role: "teacher" }, { ...identity, swimming_pool_id: "different-pool" }]) {
      allow();
      const implementation = get.getMockImplementation()!;
      get.mockImplementation(async route => route === "/auth/me" ? altered : implementation(route));
      const desktop = bridge();
      const controller = new DesktopSessionController(desktop);
      await controller.accept("synthetic-final-token", true);
      expect(controller.getSnapshot().status).toBe("login");
      expect(desktop.commitSession).not.toHaveBeenCalled();
    }
  });
  it.each([0, 500, 503])("network/CORS/server failure %s preserves stored auth but blocks entry", async status => {
    const desktop = bridge();
    get.mockRejectedValue({ status });
    const controller = new DesktopSessionController(desktop);
    await controller.accept("synthetic-final-token", true);
    expect(controller.getSnapshot().status).toBe("retry");
    expect(desktop.clearSession).not.toHaveBeenCalled();
    expect(desktop.commitSession).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
    allow();
    await controller.retry();
    expect(controller.getSnapshot().status).toBe("authenticated");
  });
  it("unknown X is not a successful access check", async () => {
    allow("unknown");
    const desktop = bridge();
    const controller = new DesktopSessionController(desktop);
    await controller.accept("synthetic-final-token", true);
    expect(controller.getSnapshot().status).toBe("retry");
    expect(desktop.commitSession).not.toHaveBeenCalled();
  });
  it("encryption/IPC failure clears state and returns to ordinary login", async () => {
    const desktop = bridge();
    desktop.commitSession.mockResolvedValue({ ok: false, error: "unavailable" } as never);
    const controller = new DesktopSessionController(desktop);
    await controller.accept("synthetic-final-token", true);
    expect(controller.getSnapshot()).toMatchObject({ status: "login" });
    expect(getToken()).toBeNull();
    expect(desktop.clearSession).toHaveBeenCalled();
  });
  it("decryption failure prompts normal login without any API call", async () => {
    const desktop = bridge();
    desktop.restoreSession.mockResolvedValue({ token: null, remembered: false, error: "decrypt-failed" } as never);
    const controller = new DesktopSessionController(desktop);
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({ status: "login" });
    expect(get).not.toHaveBeenCalled();
  });
  it("switch/login clears previous token and query context", async () => {
    setToken("previous-memory");
    const desktop = bridge();
    const controller = new DesktopSessionController(desktop);
    await controller.prepareLogin();
    expect(getToken()).toBeNull();
    expect(clearQueries).toHaveBeenCalled();
    expect(desktop.clearSession).toHaveBeenCalled();
  });
  it("logout cancels a stale access result and clears auth/cache", async () => {
    let resolveIdentity!: (value: typeof identity) => void;
    const pending = new Promise<typeof identity>(resolve => { resolveIdentity = resolve; });
    const implementation = get.getMockImplementation()!;
    get.mockImplementation(route => route === "/auth/me" ? pending : implementation(route));
    const desktop = bridge();
    const controller = new DesktopSessionController(desktop);
    const accepting = controller.accept("synthetic-final-token", true);
    await controller.logout();
    resolveIdentity(identity);
    await accepting;
    expect(controller.getSnapshot()).toEqual({ status: "login" });
    expect(getToken()).toBeNull();
    expect(desktop.commitSession).not.toHaveBeenCalled();
    expect(clearQueries).toHaveBeenCalled();
  });
  it("does not claim logout success when encrypted storage cleanup fails", async () => {
    const desktop = bridge();
    desktop.clearSession.mockResolvedValue({ ok: false });
    const controller = new DesktopSessionController(desktop);
    await controller.logout();
    expect(controller.getSnapshot().status).toBe("retry");
  });
  it("cannot authenticate without the trusted Desktop bridge", async () => {
    const controller = new DesktopSessionController(undefined);
    await controller.restore();
    expect(controller.getSnapshot().status).toBe("login");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("shared Web auth service preserves its existing policy", () => {
  it("Web keeps a normal-mode authenticated identity for its existing X gate", async () => {
    allow("normal");
    expect(await readAuthSession()).toMatchObject({ role: "pool_admin", xMode: "normal", hasX: false });
  });
  it("Web keeps unknown X on a partial lookup failure, unlike Desktop fail-closed entry", async () => {
    const implementation = get.getMockImplementation()!;
    get.mockImplementation(route => route === "/pools/x-mode" ? Promise.reject({ status: 503 }) : implementation(route));
    expect(await readAuthSession()).toMatchObject({ role: "pool_admin", xMode: "unknown", hasX: false });
  });
  it("super-admin keeps the existing no-Pool-context policy", async () => {
    get.mockResolvedValue({ ...identity, role: "super_admin", swimming_pool_id: null });
    expect(await readAuthSession(true)).toMatchObject({ role: "super_admin", xMode: "x", hasX: true });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
