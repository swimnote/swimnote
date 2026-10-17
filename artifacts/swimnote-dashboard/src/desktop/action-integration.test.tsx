// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopRoutes } from "./DesktopApp";
import { OfficeActionProvider } from "./OfficeActionProvider";
import { useOfficeActions } from "./OfficeActionContext";
import { OfficeNavigationProvider, useOfficeNavigation } from "./OfficeNavigation";
import { OfficeTaskCard } from "./OfficeTaskCard";
import type { OfficeTask } from "./OfficeTaskContract";
import type { ActionActor } from "./OfficeActionCore";
import { api } from "../lib/api-client";
import { useDesktopTokenStorage } from "../lib/token";

vi.mock("../lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let actor: ActionActor;
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ state: { status: "authenticated", user: { id: actor.userId, role: actor.role, name: "격리 합성 수영장",
    swimming_pool_id: actor.poolId, poolName: "격리 합성 수영장" } }, logout: vi.fn() }),
}));
let service: NonNullable<ReturnType<typeof useOfficeActions>>, nav: NonNullable<ReturnType<typeof useOfficeNavigation>>;
let publish: () => void, client: QueryClient;
const rows = [
  { id: "fixture_1", name: "가상회원A", status: "active", phone: "010-0000-0000", class_group_id: "class_a", class_group_name: "기초반" },
  { id: "fixture_2", name: "가상회원B", status: "suspended", class_group_id: "class_b", class_group_name: "상급반" },
];
function Probe() {
  service = useOfficeActions()!; nav = useOfficeNavigation()!;
  const [tasks, setTasks] = useState<OfficeTask[]>([]);
  publish = () => setTasks(service.core.getTasks());
  return <section aria-label="격리된 합성 작업 카드">{tasks.map(task => <OfficeTaskCard key={task.id} task={task}
    onOpenResult={async result => { await service.core.openTaskResult(task.id, result.id); publish(); }} />)}</section>;
}
function Fixture({ scope = actor }: { scope?: ActionActor }) {
  return <Router><QueryClientProvider client={client}>
    <OfficeNavigationProvider key={`${scope.userId}:${scope.poolId}:${scope.role}`}>
      <OfficeActionProvider actor={scope}><Probe /><DesktopRoutes /></OfficeActionProvider>
    </OfficeNavigationProvider>
  </QueryClientProvider></Router>;
}
beforeEach(() => {
  actor = { userId: "fixture_user", poolId: "pool_a", role: "pool_admin" };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
  useDesktopTokenStorage(); window.history.replaceState({}, "", "/admin");
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === "/admin/dashboard-stats") return { total_members: 2, today_present: 0, pending_makeups: 0, pending_requests: 0 } as never;
    if (path === "/students?pool_all=true") return rows as never;
    if (path === "/class-groups") return [{ id: "class_a", name: "기초반" }, { id: "class_b", name: "상급반" }] as never;
    if (path.startsWith("/admin/growth-reports/students/")) return { success: true, reports: [] } as never;
    throw new Error("Fixture denied route: " + path);
  });
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });
const request = (action: string, input = {}) => ({ action, input });
const search = () => screen.getByPlaceholderText("이름 또는 전화번호 검색");
const calls = () => vi.mocked(api.get).mock.calls.filter(([p]) => p === "/students?pool_all=true").length;
async function execute(action: string, input = {}) {
  let result; await act(async () => { result = await service.execute(request(action, input), "structured"); }); return result;
}
it("routes shortcut, menu, row/detail and search through the same core and canonical query", async () => {
  render(<Fixture />); await screen.findByText("안녕하세요, 격리 합성 수영장님");
  const spy = vi.spyOn(service.core, "execute");
  fireEvent.click(screen.getByText("회원목록", { exact: true }));
  await screen.findByPlaceholderText("이름 또는 전화번호 검색");
  expect(spy).toHaveBeenCalledWith(request("office.members.open"), "shortcut");
  fireEvent.click(await screen.findByText("가상회원A"));
  await screen.findByRole("dialog");
  expect(spy).toHaveBeenCalledWith(request("office.member.open", { memberId: "fixture_1" }), "menu");
  const readCount = calls();
  fireEvent.click(screen.getByText("홈 현황", { selector: "button", exact: true }));
  await screen.findByText("안녕하세요, 격리 합성 수영장님");
  const sidebar = within(document.querySelector("aside")!);
  // Text lookup avoids jsdom's CSS-variable shorthand clone bug after active-menu transitions.
  fireEvent.click(sidebar.getByText("회원", { exact: true }));
  fireEvent.click(sidebar.getByText("전체 회원", { exact: true }));
  await screen.findByRole("dialog"); // Existing menu resumes the selected member.
  expect(spy).toHaveBeenCalledWith(request("office.members.open"), "menu");
  fireEvent.change(search(), { target: { value: "가상회원A" } });
  await waitFor(() => expect(spy).toHaveBeenCalledWith(request("office.members.search", { search: "가상회원A", status: "active", classId: "" }), "menu"));
  await waitFor(() => expect(nav.destination).toEqual({ screen: "members" }));
  expect(calls()).toBe(readCount); // Cached list reused, not another data store/GET.
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
});
it("connects structured request -> real task card -> common result OPEN -> fresh successful read receipt", async () => {
  render(<Fixture />); await screen.findByText("안녕하세요, 격리 합성 수영장님");
  await act(async () => { await service.core.runStructured(request("office.member.open", { memberId: "fixture_1" })); publish(); });
  expect(screen.getByText("완료 · 미열람")).toBeTruthy();
  const before = calls();
  fireEvent.click(screen.getByRole("button", { name: "결과 보기: 업무 화면" }));
  await screen.findByText("완료 · 열람함");
  expect(calls()).toBe(before + 1);
  expect(service.core.getTasks()[0].changes).toEqual([]);
  expect(service.core.getTasks()[0].results[0].expectedRevision).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "앱 내 뒤로" }));
  await waitFor(() => expect(nav.destination).toEqual({ screen: "members" }));
  fireEvent.click(screen.getByRole("button", { name: "앱 내 앞으로" }));
  await screen.findByRole("dialog");
});
it("preserves draft/files and list context across Action OPEN and Navigation Back/Forward", async () => {
  render(<Fixture />); await execute("office.members.open"); await screen.findByPlaceholderText("이름 또는 전화번호 검색");
  const input = screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "미전송 초안" } });
  const file = document.querySelector('input[type="file"]')!;
  fireEvent.change(file, { target: { files: [new File(["fixture"], "fixture.txt", { type: "text/plain" })] } });
  fireEvent.change(search(), { target: { value: "가상회원A" } });
  await waitFor(() => expect(nav.view.search).toBe("가상회원A"));
  await execute("office.member.open", { memberId: "fixture_1" }); await screen.findByRole("dialog");
  act(() => nav.updateView({ scroll: 120, horizontalScroll: 280 }));
  const saved = { ...nav.view };
  await execute("office.home.open"); await execute("office.members.open");
  await screen.findByRole("dialog");
  expect(nav.view.search).toBe(saved.search); expect(nav.view.horizontalScroll).toBe(saved.horizontalScroll);
  expect(screen.getByRole("textbox", { name: "업무 입력" })).toBe(input); expect(input.value).toBe("미전송 초안");
  expect(screen.getByText("fixture.txt")).toBeTruthy();
  expect(document.querySelector(".office-dock-send")).toHaveProperty("disabled", true);
});
it("restores a query task's exact filters before acknowledging its fresh result, without treating scroll/page as Action input", async () => {
  render(<Fixture />); await screen.findByText("안녕하세요, 격리 합성 수영장님");
  act(() => nav.updateView({ scroll: 120, horizontalScroll: 240, page: 2 }));
  await act(async () => {
    await service.core.runStructured(request("office.members.search", { search: "가상회원A", status: "active", classId: "class_a" }));
    publish();
  });
  await execute("office.members.search", { search: "가상회원B", status: "", classId: "" });
  expect(nav.view.search).toBe("가상회원B");
  const before = calls();
  fireEvent.click(screen.getByRole("button", { name: "결과 보기: 회원 조회" }));
  await screen.findByText("완료 · 열람함");
  expect(nav.view).toMatchObject({ search: "가상회원A", status: "active", classId: "class_a" });
  expect(calls()).toBe(before + 1);
  expect(service.core.getTasks()[0].changes).toEqual([]);
});
it("shows input/scope errors, leaves missing/failed detail unopened and keeps failed result unread", async () => {
  render(<Fixture />); await screen.findByText("안녕하세요, 격리 합성 수영장님");
  expect(await execute("office.member.open", { memberId: "not_found" })).toMatchObject({ status: "failed", code: "missing" });
  expect(nav.destination).toEqual({ screen: "home" });
  expect(await execute("office.members.search", { poolId: "foreign" })).toMatchObject({ status: "failed", code: "input" });
  await act(async () => { await service.core.runStructured(request("office.member.open", { memberId: "fixture_1" })); publish(); });
  vi.mocked(api.get).mockRejectedValue({ status: 503, message: "합성 오류" });
  fireEvent.click(screen.getByRole("button", { name: "결과 보기: 업무 화면" }));
  await waitFor(() => expect(service.core.getTasks()[0].results[0].viewedAt).toBeUndefined());
  expect(screen.getByText("완료 · 미열람")).toBeTruthy();
});
it.each(["user", "pool", "role"])("isolates tasks and late network results on %s replacement", async change => {
  const view = render(<Fixture />); await screen.findByText("안녕하세요, 격리 합성 수영장님");
  const old = service.core;
  let finish!: (data: unknown) => void;
  vi.mocked(api.get).mockImplementation(path => path === "/students?pool_all=true" ? new Promise(r => { finish = r; }) as never : Promise.resolve({ total_members: 0 }) as never);
  let pending!: ReturnType<typeof old.runStructured>;
  act(() => { pending = old.runStructured(request("office.member.open", { memberId: "fixture_1" })); });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  actor = { ...actor, ...(change === "user" ? { userId: "other_user" } : change === "pool" ? { poolId: "pool_b" } : { role: "teacher" }) };
  await act(async () => { client.clear(); view.rerender(<Fixture scope={actor} />); });
  await act(async () => { finish(rows); await pending; });
  expect(old.getTasks()).toEqual([]); expect(service.core.getTasks()).toEqual([]);
  expect(nav.destination).toEqual({ screen: "home" });
  expect(client.getQueryData(["students"])).toBeUndefined();
});
it("keeps the core usable under StrictMode and coalesces duplicate detail OPEN", async () => {
  render(<StrictMode><Fixture /></StrictMode>); await screen.findByText("안녕하세요, 격리 합성 수영장님");
  await act(async () => {
    const input = request("office.member.open", { memberId: "fixture_1" });
    await Promise.all([service.execute(input, "menu"), service.execute(input, "structured")]);
  });
  await screen.findByRole("dialog"); expect(calls()).toBe(1);
  act(() => nav.back());
  await waitFor(() => expect(nav.canBack).toBe(true)); // Only Home -> list -> detail, not duplicate detail entries.
  expect(nav.destination).toEqual({ screen: "members" });
});
