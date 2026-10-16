// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([200, 401])("a late Desktop response %s cannot populate or clear a replacement session", async status => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", "https://fixture.invalid/api");
  const storage = await import("../lib/token");
  storage.useDesktopTokenStorage();
  storage.setToken("old-fixture");
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const { api } = await import("../lib/api-client");
  const pending = api.get("/students?pool_all=true");
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  storage.clearToken(); storage.setToken("new-fixture");
  resolve(new Response('{"private":"old"}', { status }));
  await assertion;
  expect(storage.getToken()).toBe("new-fixture");
});

it("blocks Desktop business writes before fetch, while leaving Web writes unchanged", async () => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", "https://fixture.invalid/api");
  const storage = await import("../lib/token");
  const fetcher = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetcher);
  const { api } = await import("../lib/api-client");
  await api.patch("/admin/students/fixture/info", {});
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockClear();
  storage.useDesktopTokenStorage();
  await expect(api.patch("/admin/students/fixture/info", {})).rejects.toMatchObject({ status: 403 });
  await expect(api.post("/students", {})).rejects.toMatchObject({ status: 403 });
  await expect(api.delete("/students/fixture")).rejects.toMatchObject({ status: 403 });
  await expect(api.postForm("/students", new FormData())).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
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
