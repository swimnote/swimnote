import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveRendererPath, isInsideDirectory, validateDevelopmentURL,
  isTrustedRendererURL, isValidBootstrapPayload, clampWindowBounds,
  CONTENT_SECURITY_POLICY,
  isAllowedAuthRequest,
} from "./security.cts";

const root = path.resolve("/tmp/office-renderer-fixture");
describe("secure local protocol", () => {
  it.each(["/admin", "/admin/", "/admin/login", "/admin/members/123"])("SPA fallback %s", (route) => {
    expect(resolveRendererPath("app://office" + route, root)).toBe(path.join(root, "desktop.html"));
  });
  it("resolves /admin assets without changing the Web base", () => {
    expect(resolveRendererPath("app://office/admin/assets/login.js?v=1", root))
      .toBe(path.join(root, "assets/login.js"));
  });
  it.each([
    "file:///etc/passwd", "https://office/admin/login", "app://evil/admin/login",
    "app://user:password@office/admin/login", "app://office:123/admin/login",
    "app://office/other", "app://office/admin/../../secret",
    "app://office/admin/%2e%2e/secret", "app://office/admin/%252e%252e/secret",
    "app://office/admin/%2E./secret", "app://office/admin/a%5c..%5csecret",
    "app://office/admin/%00", "app://office/admin/%", "app://office/admin/C:/secret",
  ])("denies malformed or unsafe URL %s", (url) => {
    expect(resolveRendererPath(url, root)).toBeNull();
  });
  it("rejects realpath escape and directory-prefix confusion", () => {
    expect(isInsideDirectory(root, root + "-other/a")).toBe(false);
    expect(isInsideDirectory(root, path.join(root, "../secret"))).toBe(false);
    expect(isInsideDirectory(root, path.join(root, "assets/login.js"))).toBe(true);
  });
  it("allows only the canonical auth origin, not unsafe scripts, objects, forms, or frames", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src https://swimnote-api.onrender.com");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
  it("keeps the HTML CSP in sync with the protocol's auth-only origin", () => {
    const html = readFileSync(new URL("../desktop.html", import.meta.url), "utf8");
    expect(html).toContain("connect-src https://swimnote-api.onrender.com;");
    expect(html).not.toContain("connect-src *");
  });
  it.each([
    ["/api/auth/login", "POST"], ["/api/auth/web-pin/verify", "POST"],
    ["/api/auth/totp/verify-login", "POST"], ["/api/auth/me", "GET"],
    ["/api/pools/my-pools", "GET"], ["/api/pools/x-mode", "GET"],
    ["/api/auth/login", "OPTIONS"],
  ])("permits only canonical F03 request %s %s", (route, method) => {
    expect(isAllowedAuthRequest("https://swimnote-api.onrender.com" + route, method)).toBe(true);
  });
  it.each([
    ["http://swimnote-api.onrender.com/api/auth/login", "POST"],
    ["https://swimnote-api.onrender.com.evil/api/auth/login", "POST"],
    ["https://swimnote-api.onrender.com/api/students", "GET"],
    ["https://swimnote-api.onrender.com/api/auth/web-pin", "PATCH"],
    ["https://swimnote-api.onrender.com/api/auth/totp/enable", "POST"],
    ["https://swimnote-api.onrender.com/api/auth/me", "PATCH"],
    ["https://swimnote-api.onrender.com/api/auth/me?pool_id=other", "GET"],
    ["https://user:secret@swimnote-api.onrender.com/api/auth/me", "GET"],
    ["https://swimnote-api.onrender.com:444/api/auth/me", "GET"],
    ["https://remote.example/api/auth/login", "POST"],
  ])("denies broader network access %s %s", (url, method) => {
    expect(isAllowedAuthRequest(url, method)).toBe(false);
  });
});

describe("renderer trust and minimal IPC", () => {
  it("trusts the packaged main-frame URL but not external origins", () => {
    expect(isTrustedRendererURL("app://office/admin/login")).toBe(true);
    expect(isTrustedRendererURL("http://127.0.0.1:5173/admin/login")).toBe(false);
    expect(isTrustedRendererURL("https://swimnote.kr/admin")).toBe(false);
  });
  it("allows explicit loopback development only", () => {
    const dev = validateDevelopmentURL("http://127.0.0.1:5173/admin/login");
    expect(isTrustedRendererURL("http://127.0.0.1:5173/admin/login", dev)).toBe(true);
    expect(isTrustedRendererURL("http://127.0.0.1:5174/admin/login", dev)).toBe(false);
    expect(isTrustedRendererURL("http://localhost.evil:5173/admin/login", dev)).toBe(false);
  });
  it.each([
    "https://remote.example/admin/login", "http://remote.example:123/admin/login",
    "http://127.0.0.1/admin/login", "http://name:secret@127.0.0.1:123/admin/login",
    "file:///admin/login", "http://localhost:123/other",
  ])("denies invalid development URL %s", (url) => {
    expect(() => validateDevelopmentURL(url)).toThrow();
  });
  it.each([[], [{}], ["token"], [null, "extra"], [undefined]])("rejects unexpected payload %j", (...args) => {
    expect(isValidBootstrapPayload(args)).toBe(false);
  });
  it("accepts the sole no-data bootstrap request", () => {
    expect(isValidBootstrapPayload([null])).toBe(true);
  });
  it("preload exposes only bootstrap/session lifecycle, not IPC/Node/filesystem/network", () => {
    const source = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    expect(source).toContain("Object.freeze");
    expect(source).toContain('exposeInMainWorld("officeDesktop", bridge)');
    expect(source).toContain('ipcRenderer.invoke("office:bootstrap-info", null)');
    expect(source.match(/ipcRenderer\.invoke\(/g)).toHaveLength(4);
    expect(source).not.toMatch(/node:fs|nodeIntegration|sendSync|shell\.|process\.env|fetch\(|https?:/);
  });
  it("main checks exact sender and main frame and keeps all security settings", () => {
    const source = readFileSync(new URL("./main.cts", import.meta.url), "utf8");
    for (const setting of ["nodeIntegration: false", "contextIsolation: true", "sandbox: true", "webSecurity: true"]) {
      expect(source).toContain(setting);
    }
    expect(source).toContain("event.sender !== win.webContents");
    expect(source).toContain("event.senderFrame !== win.webContents.mainFrame");
    expect(source).toContain("isValidBootstrapPayload(args)");
    expect(source).toContain('action: "deny"');
    expect(source).toContain("!app.isPackaged && process.env.OFFICE_DEV_URL");
    expect(source).not.toMatch(/disable-web-security|no-sandbox|openExternal|setLoginItemSettings/);
  });
  it("a second launch only restores/focuses the existing window, never reloads its input", () => {
    const source = readFileSync(new URL("./main.cts", import.meta.url), "utf8");
    const secondInstance = source.split('app.on("second-instance",')[1].split('app.on("window-all-closed"')[0];
    expect(secondInstance).toContain("mainWindow.restore()");
    expect(secondInstance).toContain("mainWindow.focus()");
    expect(secondInstance).not.toMatch(/loadURL|reload|executeJavaScript|send\(/);
  });
});

describe("minimum window state", () => {
  const work = { x: 0, y: 0, width: 1280, height: 720 };
  it("clamps saved off-screen/oversized bounds", () => {
    expect(clampWindowBounds({ x: 9000, y: -9000, width: 8000, height: 8000 }, work)).toEqual(work);
  });
  it("handles small screens and corrupted geometry", () => {
    expect(clampWindowBounds({ x: NaN, width: Infinity }, { x: -800, y: 0, width: 800, height: 600 }))
      .toEqual({ x: -800, y: 0, width: 800, height: 600 });
  });
});
