import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute only the relevant existing functions with isolated dependencies.
// No app/server bootstrap, network, real credentials, or database connection.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const screenPath = "artifacts/swim-app/app/(admin)/web-pin-settings.tsx";
const source = read(screenPath);
const serverSource = read("artifacts/api-server/src/routes/auth.ts");

function compile(text: string, bindings: Record<string, unknown>) {
  const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}

function screenFunction(file: string, name: string, bindings: Record<string, unknown>) {
  const text = read(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      expression = node.getText(ast);
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name &&
        node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!expression) throw new Error(`Missing screen function: ${name}`);
  return compile(`return (${expression});`, bindings) as () => Promise<void>;
}

function fixtureServer() {
  const ast = ts.createSourceFile("auth.ts", serverSource, ts.ScriptTarget.Latest, true);
  const routes: Record<string, (req: any, res: any) => Promise<unknown>> = {};
  const registrations = ast.statements.filter(node =>
    ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.expression.getText(ast) === "router" &&
    ["/web-pin", "/web-pin/status"].includes(
      ts.isStringLiteral(node.expression.arguments[0])
        ? node.expression.arguments[0].text : "",
    ),
  );
  expect(registrations).toHaveLength(2);
  let saved: string | null = null;
  const hashPassword = vi.fn(async () => "isolated-fixture-hash");
  const comparePassword = vi.fn(async (value: string) => value === "fixture-password");
  const execute = vi.fn(async (query: { parts: TemplateStringsArray; values: unknown[] }) => {
    if (query.parts.join("").includes("UPDATE users SET web_pin_hash")) {
      saved = query.parts.join("").includes("= NULL") ? null : query.values[0] as string;
    }
    return { rows: [{ web_pin_set: saved !== null }] };
  });
  compile(registrations.map(n => n.getText(ast)).join("\n"), {
    router: {
      patch: (p: string, _auth: unknown, handler: any) => { routes[`PATCH ${p}`] = handler; },
      get: (p: string, _auth: unknown, handler: any) => { routes[`GET ${p}`] = handler; },
    },
    requireAuth: () => {},
    superAdminDb: {
      select: () => ({ from: () => ({ where: () => ({
        limit: async () => [{ id: "fixture-user", password_hash: "fixture-password-hash" }],
      }) }) }),
      execute,
    },
    usersTable: { id: "id" },
    eq: () => ({}),
    sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values }),
    hashPassword, comparePassword,
    err: (res: any, status: number, message: string) =>
      res.status(status).json({ success: false, error: message, message }),
  });
  const request = vi.fn(async (_token: string | null, url: string, opts: RequestInit = {}) => {
    const handler = routes[`${opts.method ?? "GET"} ${url.replace(/^\/auth/, "")}`];
    if (!url.startsWith("/auth/") || !handler) {
      return new Response("<!DOCTYPE html><title>Not Found</title>", { status: 404 });
    }
    let status = 200;
    let data: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { data = value; return res; },
    };
    // The real auth middleware is intentionally not imported; identity is a fixture.
    await handler({
      user: _token ? { userId: "fixture-user" } : undefined,
      body: opts.body ? JSON.parse(String(opts.body)) : {},
    }, res);
    return new Response(JSON.stringify(data), { status });
  });
  return { request, execute, hashPassword, saved: () => saved };
}

function bindings(apiRequest: unknown, overrides: Record<string, unknown> = {}) {
  return {
    token: "fixture-session", newPin: "fixture-pin", confirmPin: "fixture-pin",
    currentPw: "", apiRequest,
    setSaving: vi.fn(), setMsg: vi.fn(), setWebPinSet: vi.fn(),
    setCurrentPw: vi.fn(), setNewPin: vi.fn(), setConfirmPin: vi.fn(),
    ...overrides,
  };
}

describe("mobile web PIN canonical server contract", () => {
  it("saves through the real extracted setter into an isolated store", async () => {
    const server = fixtureServer();
    const b = bindings(server.request);
    await screenFunction(screenPath, "handleSave", b)();
    expect(server.request.mock.calls[0]?.[1]).toBe("/auth/web-pin");
    expect(server.request.mock.calls[0]?.[2]?.method).toBe("PATCH");
    expect(server.hashPassword).toHaveBeenCalledTimes(1);
    expect(server.saved()).toBe("isolated-fixture-hash");
    expect(b.setWebPinSet).toHaveBeenCalledWith(true);
    expect(b.setNewPin).toHaveBeenCalledWith("");
  });

  it("surfaces a wrong current password without changing fixture storage", async () => {
    const server = fixtureServer();
    const b = bindings(server.request, { currentPw: "wrong-fixture-password" });
    await screenFunction(screenPath, "handleSave", b)();
    expect(server.saved()).toBeNull();
    expect(b.setMsg).toHaveBeenLastCalledWith({
      text: "현재 비밀번호가 올바르지 않습니다.", ok: false,
    });
    expect(b.setNewPin).not.toHaveBeenCalled();
  });

  it("shows a non-JSON 404 as a failed HTTP response, not a generic parse exception", async () => {
    const b = bindings(vi.fn(async () => new Response("<html>not found</html>", { status: 404 })));
    await screenFunction(screenPath, "handleSave", b)();
    expect(b.setMsg).toHaveBeenLastCalledWith(expect.objectContaining({
      ok: false, text: expect.stringContaining("404"),
    }));
    expect(b.setWebPinSet).not.toHaveBeenCalled();
  });

  it("keeps server permission-denial messages and leaves input untouched", async () => {
    const b = bindings(vi.fn(async () => Response.json(
      { success: false, message: "권한이 없습니다." }, { status: 403 },
    )));
    await screenFunction(screenPath, "handleSave", b)();
    expect(b.setMsg).toHaveBeenLastCalledWith({ text: "권한이 없습니다.", ok: false });
    expect(b.setNewPin).not.toHaveBeenCalled();
  });

  it("does not report malformed 200 responses as successful writes", async () => {
    const b = bindings(vi.fn(async () => new Response("<html>fallback</html>", { status: 200 })));
    await screenFunction(screenPath, "handleSave", b)();
    expect(b.setWebPinSet).not.toHaveBeenCalled();
    expect(b.setMsg).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
  });

  it("does not clear input or claim success after a network timeout", async () => {
    const b = bindings(vi.fn(async () => { throw new Error("fixture timeout"); }));
    await screenFunction(screenPath, "handleSave", b)();
    expect(b.setMsg).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
    expect(b.setNewPin).not.toHaveBeenCalled();
    expect(b.setSaving).toHaveBeenLastCalledWith(false);
  });

  it("does not request without a token or with mismatched/short confirmation", async () => {
    for (const override of [{ token: null }, { newPin: "123" }, { confirmPin: "different" }]) {
      const request = vi.fn();
      await screenFunction(screenPath, "handleSave", bindings(request, override))();
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("enforces the setter's identity guard and validation without a real DB", async () => {
    const server = fixtureServer();
    const denied = await server.request(null, "/auth/web-pin", {
      method: "PATCH", body: JSON.stringify({ web_pin: "fixture-pin" }),
    });
    const invalid = await server.request("fixture-session", "/auth/web-pin", {
      method: "PATCH", body: JSON.stringify({ web_pin: "123" }),
    });
    expect(denied.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(server.execute).not.toHaveBeenCalled();
  });

  it("reads the canonical status and response key from both mobile entry screens", async () => {
    const server = fixtureServer();
    await server.request("fixture-session", "/auth/web-pin", {
      method: "PATCH", body: JSON.stringify({ web_pin: "fixture-pin" }),
    });
    for (const file of [screenPath, "artifacts/swim-app/app/(admin)/x-pc-dashboard.tsx"]) {
      const set = vi.fn();
      await screenFunction(file, file === screenPath ? "loadStatus" : "loadPinStatus", {
        token: "fixture-session", apiRequest: server.request,
        setLoading: vi.fn(), setLoadingPin: vi.fn(),
        setWebPinSet: set, setPinSet: set, setMsg: vi.fn(),
      })();
      expect(server.request.mock.calls.at(-1)?.[1]).toBe("/auth/web-pin/status");
      expect(set).toHaveBeenCalledWith(true);
    }
  });

  it("uses the same authenticated PATCH contract for PIN removal", async () => {
    const server = fixtureServer();
    await server.request("fixture-session", "/auth/web-pin", {
      method: "PATCH", body: JSON.stringify({ web_pin: "fixture-pin" }),
    });
    let confirm: (() => Promise<void>) | undefined;
    const b = bindings(server.request, {
      Alert: { alert: (_title: string, _message: string, buttons: any[]) => {
        confirm = buttons.find(b => b.style === "destructive").onPress;
      } },
    });
    await screenFunction(screenPath, "handleDelete", b)();
    expect(server.saved()).not.toBeNull();
    await confirm!();
    expect(server.saved()).toBeNull();
    expect(b.setWebPinSet).toHaveBeenCalledWith(false);
  });

  it("keeps the existing PIN state after a denied removal", async () => {
    let confirm: (() => Promise<void>) | undefined;
    const b = bindings(vi.fn(async () => Response.json(
      { error: "권한이 없습니다." }, { status: 403 },
    )), {
      Alert: { alert: (_title: string, _message: string, buttons: any[]) => {
        confirm = buttons.find(b => b.style === "destructive").onPress;
      } },
    });
    await screenFunction(screenPath, "handleDelete", b)();
    await confirm!();
    expect(b.setWebPinSet).not.toHaveBeenCalled();
    expect(b.setMsg).toHaveBeenLastCalledWith({ text: "권한이 없습니다.", ok: false });
  });

  it("documents the previously invalid pool paths without invoking production", async () => {
    const server = fixtureServer();
    const response = await server.request("fixture-session", "/pools/web-pin", {
      method: "PUT", body: JSON.stringify({ currentPassword: "", newPin: "fixture-pin" }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
    expect(source.includes('apiRequest(token, "/pools/web-pin"')).toBe(false);
  });
});
