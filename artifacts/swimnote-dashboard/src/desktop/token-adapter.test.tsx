// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Web adapter compatibility and Desktop memory-only boundary", () => {
  it("Web continues to use its existing x_token storage key", async () => {
    vi.resetModules();
    const storage = await import("../lib/token");
    storage.setToken("synthetic-web-token");
    expect(localStorage.getItem("x_token")).toBe("synthetic-web-token");
    expect(storage.getToken()).toBe("synthetic-web-token");
    storage.clearToken();
    expect(localStorage.getItem("x_token")).toBeNull();
  });
  it("Desktop never falls back to localStorage, including a missing bridge", async () => {
    vi.resetModules();
    const storage = await import("../lib/token");
    localStorage.setItem("x_token", "untrusted-old-web-value");
    storage.useDesktopTokenStorage();
    expect(storage.getToken()).toBeNull();
    storage.setToken("synthetic-desktop-token");
    expect(storage.getToken()).toBe("synthetic-desktop-token");
    expect(localStorage.getItem("x_token")).toBe("untrusted-old-web-value");
    storage.clearToken();
    expect(storage.getToken()).toBeNull();
  });
  it("Desktop API 401 clears memory without reloading a root-relative Web route", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE", "https://swimnote-api.onrender.com/api");
    const storage = await import("../lib/token");
    storage.useDesktopTokenStorage();
    storage.setToken("synthetic-desktop-token");
    const previousURL = window.location.href;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { api } = await import("../lib/api-client");
    await expect(api.get("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(storage.getToken()).toBeNull();
    expect(window.location.href).toBe(previousURL);
  });
});
