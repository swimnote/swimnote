import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isAllowedAuthRequest } from "./security.cts";
import { isLoginPreferences, LoginPreferencesStore, registerLoginPreferencesIPC } from "./session-ipc.cts";

const root = "https://swimnote-api.onrender.com/api";
const id = "11111111-1111-4111-8111-111111111111";
describe("F05 exact read allowlist", () => {
  it.each(["student_1790000000000_abc123xyz", "student_1790000000000_a"])(
    "supports existing server-generated text IDs without allowing writes: %s", studentId => {
      const url = `${root}/admin/growth-reports/students/${studentId}`;
      for (const method of ["GET", "OPTIONS"]) expect(isAllowedAuthRequest(url, method)).toBe(true);
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) expect(isAllowedAuthRequest(url, method)).toBe(false);
      for (const suffix of ["?pool_id=other", "?token=fixture", "/download", "/send", "#fragment"]) {
        expect(isAllowedAuthRequest(url + suffix, "GET")).toBe(false);
      }
    },
  );
  it.each(["student_other", "student_1790000000000_", "student_1790000000000_abcdefghij",
    "student_1790000000000_a%2Fsend", "student_1790000000000_a/../send"])(
    "rejects non-contract text IDs: %s", studentId => {
      expect(isAllowedAuthRequest(`${root}/admin/growth-reports/students/${studentId}`, "GET")).toBe(false);
    },
  );
  it.each(["/admin/dashboard-stats", "/students?pool_all=true", "/class-groups", `/admin/growth-reports/students/${id}`])(
    "allows only GET/preflight for %s", route => {
      expect(isAllowedAuthRequest(root + route, "GET")).toBe(true);
      expect(isAllowedAuthRequest(root + route, "OPTIONS")).toBe(true);
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
        expect(isAllowedAuthRequest(root + route, method)).toBe(false);
      }
    },
  );
  it.each([
    "/students", "/students?pool_all=false", "/students?pool_all=true&pool_id=other",
    "/students?pool_all=true&pool_all=true", "/class-groups?pool_id=other",
    "/admin/dashboard-stats?anything=true", "/students?token=fixture",
    `/admin/growth-reports/students/${id}/download`, "/admin/growth-reports/students/other",
    `/admin/growth-reports/students/${id}?pool_id=other`, "/admin/students/export",
    "/admin/students/fixture/withdraw", "/admin/teachers",
  ])("rejects unapproved path/query %s", route => {
    expect(isAllowedAuthRequest(root + route, "GET")).toBe(false);
  });
  it("rejects other hosts, credentials and fragments on read URLs", () => {
    for (const url of [root.replace("https:", "http:") + "/class-groups",
      root.replace("onrender.com", "onrender.com.evil") + "/class-groups",
      root.replace("https://", "https://user:pass@") + "/class-groups",
      root + "/class-groups#fragment"]) expect(isAllowedAuthRequest(url, "GET")).toBe(false);
  });
});

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
describe("minimal login preferences, independent of session credentials", () => {
  it("defaults OFF, serializes latest preferences, and stores only the two allowed fields", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "office-f05-"));
    const store = new LoginPreferencesStore(directory);
    expect(await store.read()).toEqual({ loginId: "", remember: false });
    await Promise.all([
      store.save({ loginId: "fixture-login", remember: false }),
      store.save({ loginId: "fixture-login", remember: true }),
    ]);
    expect(await new LoginPreferencesStore(directory).read()).toEqual({ loginId: "fixture-login", remember: true });
    expect(JSON.parse(await readFile(path.join(directory, "office-login-preferences.json"), "utf8")))
      .toEqual({ loginId: "fixture-login", remember: true });
    expect(await store.save({ loginId: "fixture", remember: true, token: "forbidden" } as never)).toEqual({ ok: false });
  });
  it("rejects credential keys, wrong types, excessive values, and malformed persisted data", async () => {
    for (const value of [null, [], { loginId: "", remember: "true" }, { loginId: "x", remember: true, password: "x" },
      { loginId: "x", remember: true, pin: "1234" }, { loginId: "x", remember: true, totp_session: "x" },
      { loginId: "a".repeat(255), remember: false }, { loginId: "x\n", remember: false }]) {
      expect(isLoginPreferences(value)).toBe(false);
    }
    directory = await mkdtemp(path.join(tmpdir(), "office-f05-"));
    await writeFile(path.join(directory, "office-login-preferences.json"), '{"token":"forbidden"}');
    await expect(new LoginPreferencesStore(directory).read()).rejects.toThrow();
  });
  it("checks exact IPC sender/frame/origin and payload without adding a generic store", () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipc = { handle: vi.fn((name, fn) => handlers.set(name, fn)), removeHandler: vi.fn() };
    const frame = { url: "app://office/admin/login" };
    const contents = { mainFrame: frame };
    const store = { read: vi.fn(), save: vi.fn() };
    const remove = registerLoginPreferencesIPC(ipc as never, contents as never, store as never);
    const read = handlers.get("office:login-preferences-read")!;
    const save = handlers.get("office:login-preferences-save")!;
    const event = { sender: contents, senderFrame: frame };
    read(event, null);
    save(event, { loginId: "fixture", remember: true });
    expect(store.read).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledExactlyOnceWith({ loginId: "fixture", remember: true });
    expect(() => read({ ...event, sender: {} }, null)).toThrow();
    expect(() => read({ ...event, senderFrame: { url: frame.url } }, null)).toThrow();
    frame.url = "https://evil.invalid/admin/login";
    expect(() => read(event, null)).toThrow();
    frame.url = "app://office/admin/login";
    expect(() => save(event, { loginId: "fixture", remember: true, token: "no" })).toThrow();
    expect(() => read(event, null, "extra")).toThrow();
    remove();
    expect(ipc.removeHandler).toHaveBeenCalledTimes(2);
  });
});
