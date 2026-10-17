// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { OfficeActionCore, OFFICE_ACTIONS, type ActionDependencies } from "./OfficeActionCore";
import type { OfficeDestination } from "./OfficeNavigation";
vi.mock("../lib/api-client", () => ({ api: { get: vi.fn() } }));

function fixture(overrides: Partial<ActionDependencies> = {}) {
  let destination: OfficeDestination = { screen: "home" }, time = 100;
  const deps: ActionDependencies = {
    actor: { userId: "fixture-user", poolId: "fixture-pool", role: "pool_admin" }, scope: "fixture-session",
    isCurrent: () => true, destination: () => destination, filters: () => ({ search: "", status: "active", classId: "" }),
    updateFilters: vi.fn(), open: vi.fn(target => { destination = target; return true; }),
    members: vi.fn<ActionDependencies["members"]>(async () => ({ data: [{ id: "member_1", name: "가상회원", status: "active", phone: "010-0000-0000", class_group_id: "class_1" }],
      source: "network", queryStartedAt: ++time, receivedAt: ++time })),
    readHome: vi.fn<ActionDependencies["readHome"]>(async () => ({ source: "network", queryStartedAt: ++time, receivedAt: ++time })), now: () => ++time,
    ...overrides,
  };
  return { core: new OfficeActionCore(deps), deps };
}
const request = (action: string, input: unknown = {}) => ({ action, input });
it("registers four read/open actions and two default-gated explicit writes, never URL/SQL executors", () => {
  expect(Object.keys(OFFICE_ACTIONS)).toHaveLength(6);
  expect(Object.values(OFFICE_ACTIONS).filter(a => a.kind !== "mutation").every(a => a.confirmation === "none" && !a.invalidates.length && a.permission === "pool_admin")).toBe(true);
  expect(OFFICE_ACTIONS["office.member.update"].confirmation).toBe("explicit-save");
  expect(OFFICE_ACTIONS["office.member.move"].confirmation).toBe("preview-confirm");
});
it.each([
  [null, "unsupported"],
  [request("billing.pay"), "unsupported"],
  [request("__proto__"), "unsupported"],
  [{ action: "office.home.open", input: {}, poolId: "foreign" }, "unsupported"],
  [request("office.home.open", { url: "https://invalid.test" }), "input"],
  [request("office.members.open", { view: "arbitrary" }), "input"],
  [request("office.member.open", { memberId: "../other" }), "input"],
  [request("office.member.open", { memberId: "member_1", userId: "other" }), "input"],
  [request("office.member.open", { memberId: "member_1", view: "edit" }), "input"],
  [request("office.member.open", { memberId: "member_1", tab: "notes" }), "input"],
  [request("office.member.open", { memberId: "member_1", view: "full", tab: "payments" }), "input"],
  [request("office.members.search", { poolId: "other" }), "input"],
  [request("office.members.search", { search: "a".repeat(201) }), "input"],
  [request("office.members.search", { status: "arbitrary" }), "input"],
  [request("office.members.search", { classId: "class/foreign" }), "input"],
])("rejects invalid or unsupported request %j before navigation/query", async (input, code) => {
  const { core, deps } = fixture();
  expect(await core.execute(input)).toMatchObject({ status: "failed", code });
  expect(deps.open).not.toHaveBeenCalled(); expect(deps.members).not.toHaveBeenCalled();
});
it.each(["teacher", "parent_account", "super_admin", ""])("does not replace server auth or allow unapproved role %s", async role => {
  const { core, deps } = fixture({ actor: { userId: "u", poolId: "p", role } });
  expect(await core.execute(request("office.home.open"))).toMatchObject({ status: "failed", code: "forbidden" });
  expect(deps.open).not.toHaveBeenCalled();
});
it("requires a current authenticated user and Pool", async () => {
  const { core } = fixture({ actor: { userId: "u", poolId: "", role: "pool_admin" } });
  expect(await core.execute(request("office.members.open"))).toMatchObject({ status: "failed", code: "forbidden" });
});
it("distinguishes navigation success, filtered query count and missing target", async () => {
  const { core, deps } = fixture();
  expect(await core.execute(request("office.home.open"), "menu")).toMatchObject({ status: "success", kind: "open" });
  expect(deps.members).not.toHaveBeenCalled();
  expect(await core.execute(request("office.members.search", { search: "0100000", classId: "class_1" }))).toMatchObject({ status: "success", kind: "query", count: 1 });
  expect(await core.execute(request("office.members.search", { search: "없는이름" }))).toMatchObject({ status: "success", kind: "query", count: 0 });
  expect(await core.execute(request("office.members.search", { status: "unassigned" }))).toMatchObject({ status: "success", kind: "query", count: 0 });
  expect(await core.execute(request("office.member.open", { memberId: "missing" }))).toMatchObject({ status: "failed", code: "missing" });
});
it.each([401, 403, 404, 500])("keeps HTTP %s as a failed lookup, not a successful OPEN", async status => {
  const { core, deps } = fixture({ members: vi.fn().mockRejectedValue({ status }) });
  expect(await core.execute(request("office.member.open", { memberId: "member_1" }))).toMatchObject({ status: "failed" });
  expect(deps.open).not.toHaveBeenCalled();
});
it("distinguishes unknown transport result and cancellation", async () => {
  const { core } = fixture({ members: vi.fn().mockRejectedValue(new TypeError("offline")) });
  expect(await core.execute(request("office.members.search"))).toMatchObject({ status: "unknown" });
  const aborted = fixture({ members: vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")) });
  expect(await aborted.core.execute(request("office.members.search"))).toMatchObject({ status: "cancelled" });
});
it("coalesces simultaneous menu/structured calls without another lookup or navigation", async () => {
  const { core, deps } = fixture(), input = request("office.member.open", { memberId: "member_1" });
  const a = core.execute(input, "menu"), b = core.execute(input, "structured");
  expect(a).toBe(b); await a;
  expect(deps.members).toHaveBeenCalledTimes(1); expect(deps.open).toHaveBeenCalledTimes(1);
});
it("does not apply an older search after a newer search finishes", async () => {
  const resolve: ((value: Awaited<ReturnType<ActionDependencies["members"]>>) => void)[] = [];
  const { core, deps } = fixture({ members: vi.fn<ActionDependencies["members"]>(() => new Promise(r => resolve.push(r))) });
  const a = core.execute(request("office.members.search", { search: "old" })); await Promise.resolve();
  const b = core.execute(request("office.members.search", { search: "new" })); await Promise.resolve();
  const read = { data: [], source: "network" as const, queryStartedAt: 1, receivedAt: 2 };
  resolve[1](read); await b; resolve[0](read);
  expect(await a).toMatchObject({ status: "cancelled" });
  expect(deps.updateFilters).toHaveBeenCalledTimes(1);
  expect(deps.updateFilters).toHaveBeenCalledWith(expect.objectContaining({ search: "new" }));
});
it("does not overwrite a newer Home OPEN or explicit history navigation with a late detail result", async () => {
  for (const historyChange of [false, true]) {
    let finish!: (value: Awaited<ReturnType<ActionDependencies["members"]>>) => void;
    let version = 0;
    const { core, deps } = fixture({ navigationVersion: () => version, members: vi.fn<ActionDependencies["members"]>(() => new Promise(r => { finish = r; })) });
    const pending = core.execute(request("office.member.open", { memberId: "member_1" })); await Promise.resolve();
    if (historyChange) version++;
    else await core.execute(request("office.home.open"));
    finish({ data: [{ id: "member_1", name: "가상회원", status: "active" }], source: "network", queryStartedAt: 1, receivedAt: 2 });
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(deps.open).toHaveBeenCalledTimes(historyChange ? 0 : 1);
  }
});
it("disposes requests/tasks and suppresses late results after session replacement", async () => {
  let finish!: (value: Awaited<ReturnType<ActionDependencies["members"]>>) => void;
  const { core, deps } = fixture({ members: vi.fn<ActionDependencies["members"]>(() => new Promise(r => { finish = r; })) });
  const task = core.runStructured(request("office.member.open", { memberId: "member_1" })); await Promise.resolve();
  core.dispose(); finish({ data: [], source: "network", queryStartedAt: 1, receivedAt: 2 });
  expect(await task).toBeNull(); expect(core.getTasks()).toEqual([]); expect(deps.open).not.toHaveBeenCalled();
  expect(await core.execute(request("office.home.open"))).toMatchObject({ status: "cancelled" });
});
it("creates a real controlled task result but OPEN alone does not acknowledge a read", async () => {
  const { core } = fixture();
  const input = request("office.member.open", { memberId: "member_1" });
  const a = core.runStructured(input), b = core.runStructured(input); expect(a).toBe(b);
  const task = (await a)!;
  expect(task).toMatchObject({ status: "completed", scope: "fixture-session", changes: [] });
  expect(task.summary).toContain("화면 열기 성공"); expect(task.results[0].viewedAt).toBeUndefined();
  expect(task.results[0].expectedRevision).toBeUndefined();
  const x = core.openTaskResult(task.id, task.results[0].id), y = core.openTaskResult(task.id, task.results[0].id);
  expect(x).toBe(y); await x;
  expect(core.getTasks()[0].results[0].viewedAt).toBeGreaterThanOrEqual(task.completedAt!);
});
it("preserves full member view and exact tab in Action results, repeated OPEN and read evidence", async () => {
  const { core, deps } = fixture();
  const input = request("office.member.open", { memberId: "member_1", view: "full", tab: "notes" });
  const task = (await core.runStructured(input))!;
  expect(task.results[0].target).toEqual({ screen: "members", memberId: "member_1", view: "full", tab: "notes" });
  await core.openTaskResult(task.id, task.results[0].id);
  expect(deps.open).toHaveBeenLastCalledWith(task.results[0].target, false);
  expect(core.getTasks()[0].results[0].viewedAt).toBeDefined();
});
it.each(["cache", "old-network", "failed", "missing"])("keeps a result unread for %s evidence", async mode => {
  const f = fixture();
  const task = (await f.core.runStructured(request("office.member.open", { memberId: "member_1" })))!;
  if (mode === "failed") vi.mocked(f.deps.members).mockRejectedValue({ status: 500 });
  else vi.mocked(f.deps.members).mockImplementation(async (_signal, fresh) => ({
    data: fresh && mode === "missing" ? [] : [{ id: "member_1", name: "가상회원", status: "active" }],
    source: mode === "cache" ? "cache" : "network", queryStartedAt: mode === "old-network" ? 1 : 1000, receivedAt: 1001,
  }));
  await f.core.openTaskResult(task.id, task.results[0].id);
  expect(f.core.getTasks()[0].results[0].viewedAt).toBeUndefined();
});
it("reopens the original query filters, not a later unrelated search", async () => {
  const { core, deps } = fixture();
  const task = (await core.runStructured(request("office.members.search", { search: "가상회원", status: "active", classId: "class_1" })))!;
  await core.execute(request("office.members.search", { search: "다른검색", status: "" }));
  await core.openTaskResult(task.id, task.results[0].id);
  expect(deps.updateFilters).toHaveBeenLastCalledWith({ search: "가상회원", status: "active", classId: "class_1" });
  expect(core.getTasks()[0].results[0].viewedAt).toBeDefined();
});
it("does not acknowledge a result after navigation changes during its fresh read", async () => {
  let version = 0;
  const f = fixture({ navigationVersion: () => version });
  const task = (await f.core.runStructured(request("office.home.open")))!;
  vi.mocked(f.deps.readHome).mockImplementation(async () => {
    version++;
    return { source: "network", queryStartedAt: 1000, receivedAt: 1001 };
  });
  await f.core.openTaskResult(task.id, task.results[0].id);
  expect(f.core.getTasks()[0].results[0].viewedAt).toBeUndefined();
});
