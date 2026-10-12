import { readFileSync } from "node:fs";
import ts from "typescript";
import { createPushTokenLifecycle, createPushTokenCleanupRequest, PUSH_DEVICE_TOKEN_KEY } from "../push-token-lifecycle";

function setup() {
  const values = new Map<string, string>(), owners = new Map<string, string>(), trace: string[] = [];
  const storage = {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
    multiRemove: vi.fn(async () => { trace.push("local-clear"); }),
  };
  const api = vi.fn(async (auth: string, _path: string, init: { method: string; body: string }) => {
    const token = JSON.parse(init.body).token;
    trace.push(init.method + ":" + auth + ":" + token);
    if (init.method === "POST") owners.set(token, auth);
    else if (owners.get(token) === auth) owners.delete(token);
    return { success: true };
  });
  return { life: createPushTokenLifecycle(), storage, values, owners, trace, api };
}
function extract(path: string, name: string) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!found) throw Error("SOURCE_FUNCTION_NOT_FOUND");
  return ts.transpileModule(found.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + `\nreturn ${name};`;
}
function logoutFunction(f: ReturnType<typeof setup>, auth: string) {
  const setters = ["setPendingRoute", "setToken", "setKind", "setAdminUser", "setParentAccount", "setPool",
    "setParentPoolName", "setAllAccounts", "setOwnedPools", "setParentJoinStatus", "setParentJoinRequestId"];
  return new Function("pushTokenLifecycle", "token", "createPushTokenCleanupRequest", "API_BASE", "AsyncStorage", ...setters,
    extract("../../context/auth/SessionContext.tsx", "logout"))(
      f.life, auth, () => f.api, "fixture-base", f.storage, ...setters.map(() => vi.fn()));
}
const flush = () => new Promise(r => setTimeout(r, 10));

describe("device push token lifecycle", () => {
  it("A → logout cleanup → B binds same device token; other device preserved", async () => {
    const f = setup();
    f.owners.set("other-device", "A");
    await f.life.register(f.life.beginSession("A")!, "T", f.api, f.storage);
    await logoutFunction(f, "A")();
    expect(f.owners.has("T")).toBe(false);
    expect(f.owners.get("other-device")).toBe("A");
    expect(f.trace.indexOf("DELETE:A:T")).toBeLessThan(f.trace.indexOf("local-clear"));
    await f.life.register(f.life.beginSession("B")!, "T", f.api, f.storage);
    expect(f.owners.get("T")).toBe("B");
  });
  it("session change without logout rebinds same token", async () => {
    const f = setup();
    await f.life.register(f.life.beginSession("A")!, "T", f.api, f.storage);
    await f.life.register(f.life.beginSession("B")!, "T", f.api, f.storage);
    expect(f.owners.get("T")).toBe("B"); expect(f.api).toHaveBeenCalledTimes(2);
  });
  it("token rotation T → T2 registers and logout deletes only current T2", async () => {
    const f = setup(), handle = f.life.beginSession("A")!;
    await f.life.register(handle, "T", f.api, f.storage);
    await f.life.register(handle, "T2", f.api, f.storage);
    expect(f.values.get(PUSH_DEVICE_TOKEN_KEY)).toBe("T2");
    await f.life.logout("A", f.api, f.storage);
    expect(f.api.mock.calls[2][2]).toEqual({ method: "DELETE", body: JSON.stringify({ token: "T2" }) });
  });
  it("same session/token repeated or concurrent registration is idempotent", async () => {
    const f = setup(), handle = f.life.beginSession("A")!;
    await Promise.all(Array.from({ length: 5 }, () => f.life.register(handle, "T", f.api, f.storage)));
    expect(f.api).toHaveBeenCalledTimes(1);
  });
  it("parent identity change rebinds and supplies new parent_account_id", async () => {
    const f = setup();
    await f.life.register(f.life.beginSession("A", "parent_1")!, "T", f.api, f.storage);
    await f.life.register(f.life.beginSession("A", "parent_2")!, "T", f.api, f.storage);
    expect(JSON.parse(f.api.mock.calls[1][2].body).parent_account_id).toBe("parent_2");
  });
  it("stale async A callback cannot overwrite B binding", async () => {
    const f = setup(), old = f.life.beginSession("A")!;
    const current = f.life.beginSession("B")!;
    expect(await f.life.register(old, "T", f.api, f.storage)).toBe(false);
    await f.life.register(current, "T", f.api, f.storage);
    expect(f.owners.get("T")).toBe("B"); expect(f.api).toHaveBeenCalledTimes(1);
  });
  it("logout drains an in-flight registration before deleting its resulting token", async () => {
    const f = setup(), actual = f.api.getMockImplementation()!;
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    f.api.mockImplementation(async (a, p, init) => {
      if (init.method === "POST") { entered(); await hold; }
      return actual(a, p, init);
    });
    const registration = f.life.register(f.life.beginSession("A")!, "T", f.api, f.storage);
    await started;
    const logout = logoutFunction(f, "A")();
    expect(f.life.beginSession("A")).toBeNull();
    release(); await Promise.all([registration, logout]);
    expect(f.owners.has("T")).toBe(false);
    expect(f.trace).toEqual(["POST:A:T", "DELETE:A:T", "local-clear"]);
  });
  it("app restart logout uses persisted current token", async () => {
    const f = setup();
    f.values.set(PUSH_DEVICE_TOKEN_KEY, "persisted-T"); f.owners.set("persisted-T", "A");
    await logoutFunction(f, "A")();
    expect(f.owners.size).toBe(0); expect(f.trace[0]).toBe("DELETE:A:persisted-T");
  });
  it("first OTA with no persisted key cleans the device token already registered by the prior app", async () => {
    const f = setup();
    f.owners.set("legacy-T", "A"); f.owners.set("other-device", "A");
    f.life.beginSession("A");
    const resolver = vi.fn(async () => "legacy-T");
    f.life.setDeviceTokenResolver(resolver);
    await logoutFunction(f, "A")();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(f.trace[0]).toBe("DELETE:A:legacy-T"); expect(f.owners.get("other-device")).toBe("A");
    expect(f.owners.has("legacy-T")).toBe(false);
  });
  it("B session arriving during async storage cleanup is not cleared by A logout", async () => {
    const f = setup();
    await f.life.register(f.life.beginSession("A")!, "T", f.api, f.storage);
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    f.storage.removeItem.mockImplementation(async () => { entered(); await hold; });
    const exiting = logoutFunction(f, "A")();
    const rejected = expect(exiting).rejects.toThrow("PUSH_LOGOUT_SESSION_CHANGED");
    await started;
    const current = f.life.beginSession("B")!, rebind = f.life.register(current, "T", f.api, f.storage);
    release(); await rejected; await rebind;
    expect(f.storage.multiRemove).not.toHaveBeenCalled(); expect(f.owners.get("T")).toBe("B");
  });
  it.each([false, true])("late A cleanup success/failure (%s) cannot clear B auth or invalidate B registration", async fail => {
    const f = setup(), actual = f.api.getMockImplementation()!;
    await f.life.register(f.life.beginSession("A")!, "T", f.api, f.storage);
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    f.api.mockImplementation(async (a, p, init) => {
      if (init.method === "DELETE") { entered(); await hold; if (fail) throw Error("FIXTURE_DELETE_FAILURE"); }
      return actual(a, p, init);
    });
    const exiting = logoutFunction(f, "A")();
    const rejected = expect(exiting).rejects.toThrow(fail ? "FIXTURE_DELETE_FAILURE" : "PUSH_LOGOUT_SESSION_CHANGED");
    await started;
    const current = f.life.beginSession("B")!;
    const rebinding = f.life.register(current, "T", f.api, f.storage);
    release(); await rejected; await rebinding;
    expect(f.storage.multiRemove).not.toHaveBeenCalled();
    expect(f.owners.get("T")).toBe("B");
    expect(f.life.beginSession("B")).toBe(current);
  });
  it("an already stale A logout cannot invalidate active B", async () => {
    const f = setup(), current = f.life.beginSession("B")!;
    await f.life.register(current, "T", f.api, f.storage);
    await expect(logoutFunction(f, "A")({ forceLocal: true })).rejects.toThrow("PUSH_LOGOUT_SESSION_CHANGED");
    expect(f.storage.multiRemove).not.toHaveBeenCalled(); expect(f.life.beginSession("B")).toBe(current);
  });
  it("cleanup API failure preserves local auth and allows retry", async () => {
    const f = setup(), handle = f.life.beginSession("A")!;
    await f.life.register(handle, "T", f.api, f.storage);
    f.api.mockRejectedValueOnce(Error("FIXTURE_DELETE_FAILURE"));
    await expect(logoutFunction(f, "A")()).rejects.toThrow("FIXTURE_DELETE_FAILURE");
    expect(f.storage.multiRemove).not.toHaveBeenCalled(); expect(f.owners.get("T")).toBe("A");
    await logoutFunction(f, "A")(); expect(f.owners.has("T")).toBe(false);
  });
  it("forced security logout still clears local auth if JWT cleanup is rejected", async () => {
    const f = setup();
    await f.life.register(f.life.beginSession("A")!, "T", f.api, f.storage);
    f.api.mockRejectedValueOnce(Error("FIXTURE_AUTH_REVOKED"));
    await logoutFunction(f, "A")({ forceLocal: true });
    expect(f.storage.multiRemove).toHaveBeenCalledTimes(1);
  });
  it("registration failure does not set stale registered flag, next attempt retries", async () => {
    const f = setup(), handle = f.life.beginSession("A")!;
    f.api.mockRejectedValueOnce(Error("FIXTURE_POST_FAILURE"));
    await expect(f.life.register(handle, "T", f.api, f.storage)).rejects.toThrow();
    await f.life.register(handle, "T", f.api, f.storage);
    expect(f.owners.get("T")).toBe("A");
  });
  it("logout without any device token makes no DELETE", async () => {
    const f = setup();
    await logoutFunction(f, "A")();
    expect(f.api).not.toHaveBeenCalled(); expect(f.storage.multiRemove).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup request adapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses current JWT and exact device token without auth callback recursion", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await createPushTokenCleanupRequest("https://fixture.invalid/api")("A", "/push-token",
      { method: "DELETE", body: JSON.stringify({ token: "T" }) });
    expect(fetchMock.mock.calls[0]).toEqual(["https://fixture.invalid/api/push-token", expect.objectContaining({
      method: "DELETE", headers: { "Content-Type": "application/json", Authorization: "Bearer A" },
      body: JSON.stringify({ token: "T" }),
    })]);
  });
  it("server cleanup rejection is explicit, not a silent success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(createPushTokenCleanupRequest("https://fixture.invalid/api")("A", "/push-token",
      { method: "DELETE", body: JSON.stringify({ token: "T" }) })).rejects.toThrow("PUSH");
  });
});

describe("actual root PushTokenSync wiring", () => {
  it("Expo/native token-change and foreground listeners re-fetch Expo token, session changes rebind", async () => {
    const f = setup();
    let auth = "A", expoToken = "T", tokenListener!: () => void, foregroundListener!: (state: string) => void;
    let effect!: () => (() => void) | undefined;
    const remove = vi.fn(), native = {
      getPermissionsAsync: async () => ({ status: "granted" }),
      requestPermissionsAsync: vi.fn(),
      getExpoPushTokenAsync: async () => ({ data: expoToken }),
      addPushTokenListener: (cb: () => void) => { tokenListener = cb; return { remove }; },
    };
    const component = new Function("useAuth", "useEffect", "pushTokenLifecycle", "Platform", "Notifications",
      "setupNotificationChannels", "Constants", "apiRequest", "AsyncStorage", "AppState", "console",
      extract("../../app/_layout.tsx", "PushTokenSync"))(
        () => ({ token: auth, kind: "admin", parentAccount: null }), (cb: any) => { effect = cb; },
        f.life, { OS: "ios" }, native, async () => {}, { expoConfig: { extra: { eas: { projectId: "fixture-project" } } } },
        f.api, f.storage, { addEventListener: (_name: string, cb: any) => { foregroundListener = cb; return { remove }; } }, console);
    component(); const cleanupA = effect()!; await flush();
    expect(f.owners.get("T")).toBe("A");
    expoToken = "T2"; tokenListener(); await flush();
    expect(f.owners.get("T2")).toBe("A");
    foregroundListener("active"); await flush(); expect(f.api).toHaveBeenCalledTimes(2);
    const staleListener = tokenListener;
    cleanupA(); auth = "B"; component(); const cleanupB = effect()!;
    staleListener(); await flush();
    expect(f.owners.get("T2")).toBe("B"); cleanupB();
    expect(remove).toHaveBeenCalledTimes(4);
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
  });
  it("denied permissions never obtain/register a device token", async () => {
    const f = setup();
    let effect!: () => (() => void) | undefined;
    const getToken = vi.fn(), native = {
      getPermissionsAsync: async () => ({ status: "denied" }), requestPermissionsAsync: async () => ({ status: "denied" }),
      getExpoPushTokenAsync: getToken, addPushTokenListener: () => ({ remove() {} }),
    };
    const component = new Function("useAuth", "useEffect", "pushTokenLifecycle", "Platform", "Notifications",
      "setupNotificationChannels", "Constants", "apiRequest", "AsyncStorage", "AppState", "console",
      extract("../../app/_layout.tsx", "PushTokenSync"))(
        () => ({ token: "A", kind: "admin" }), (cb: any) => { effect = cb; }, f.life, { OS: "android" }, native,
        async () => {}, {}, f.api, f.storage, { addEventListener: () => ({ remove() {} }) }, console);
    component(); const cleanup = effect()!; await flush();
    expect(getToken).not.toHaveBeenCalled(); expect(f.api).not.toHaveBeenCalled(); cleanup();
  });
});
