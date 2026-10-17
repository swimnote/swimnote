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

it("opens list -> quick Drawer -> wide member information and preserves tab history, list scroll and draft", async () => {
  const view = render(<Fixture />);
  await execute("office.members.open"); await screen.findByText("가상회원A");
  const draft = screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "전송하지 않은 초안" } });
  fireEvent.change(search(), { target: { value: "가상회원A" } });
  await waitFor(() => expect(nav.destination).toEqual({ screen: "members" }));
  const scroller = view.container.querySelector<HTMLElement>("[data-office-business-scroll]")!;
  scroller.scrollTop = 180; fireEvent.scroll(scroller);
  act(() => nav.updateView({ horizontalScroll: 240 }));
  fireEvent.click(screen.getByText("가상회원A"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByText("전체 회원정보", { selector: "button", exact: true }));
  await screen.findByRole("tab", { name: "기본정보" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(nav.destination).toMatchObject({ memberId: "fixture_1", view: "full", tab: "basic" });
  scroller.scrollTop = 90; fireEvent.scroll(scroller);
  fireEvent.click(screen.getByRole("tab", { name: "메모" }));
  await waitFor(() => expect(nav.destination).toMatchObject({ tab: "notes" }));
  act(() => nav.back());
  await waitFor(() => expect(nav.destination).toMatchObject({ tab: "basic" }));
  expect(scroller.scrollTop).toBe(90);
  act(() => nav.back()); await screen.findByRole("dialog");
  act(() => nav.forward()); await screen.findByRole("tab", { name: "기본정보" });
  expect(screen.getByRole("textbox", { name: "업무 입력" })).toBe(draft);
  expect(draft.value).toBe("전송하지 않은 초안");
  fireEvent.click(screen.getByText("회원 목록으로", { exact: true }));
  await screen.findByPlaceholderText("이름 또는 전화번호 검색");
  expect(nav.view).toMatchObject({ search: "가상회원A", scroll: 180, horizontalScroll: 240 });
  expect(scroller.scrollTop).toBe(180);
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
});

it("renders multiple actual classes, literal guardian names, extra phones and independent long memo without fake fees", async () => {
  const original = vi.mocked(api.get).getMockImplementation()!;
  const longName = "긴이름".repeat(18), memo = "수업 참고 메모\n".repeat(120);
  vi.mocked(api.get).mockImplementation((p, options) => p === "/students?pool_all=true"
    ? Promise.resolve([{ ...rows[0], name: longName, parent_name: "합성 보호자 A / 합성 보호자 B",
      parent_phone: "000-0000-0001", parent_phone2: "000-0000-0002",
      weekly_count: 2, schedule_labels: "월4·목7", memo, notes: "별도 기존 notes",
      assigned_class_ids: ["class_a", "class_b"],
      assignedClasses: [{ id: "class_a", name: "기초반", schedule_days: "월", schedule_time: "16:00", instructor: "합성 강사 A" },
        { id: "class_b", name: "심화반", schedule_days: "목", schedule_time: "19:00", instructor: "합성 강사 B" }] }]) as never
    : original(p, options));
  render(<Fixture />);
  await execute("office.member.open", { memberId: "fixture_1", view: "full", tab: "contacts" });
  await screen.findByRole("tab", { name: "연락처·보호자" });
  expect(screen.getByText("합성 보호자 A / 합성 보호자 B")).toBeTruthy();
  expect(screen.getByText("000-0000-0002")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "수강반" }));
  await screen.findByText("심화반");
  expect(screen.getByText("기초반")).toBeTruthy(); expect(screen.getByText(/월4·목7/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "메모" }));
  await waitFor(() => expect(nav.destination).toMatchObject({ tab: "notes" }));
  expect(document.querySelector(".office-member-detail-memo")?.textContent).toContain("수업 참고 메모");
  expect(screen.getByText("별도 기존 notes")).toBeTruthy();
  expect(document.querySelector(".office-member-detail")?.textContent).not.toMatch(/0원|미납 없음|동의 완료/);
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(5);
});

it("does not append duplicate history for the same full target and rejects unsupported tab/foreign scope", async () => {
  render(<Fixture />);
  const input = { memberId: "fixture_1", view: "full", tab: "growth" };
  await execute("office.member.open", input); await screen.findByText("발행된 성장리포트가 없습니다.");
  const version = nav.getRevision();
  await execute("office.member.open", input);
  act(() => nav.back());
  await waitFor(() => expect(nav.destination).toEqual({ screen: "members" }));
  expect(nav.canForward).toBe(true);
  expect(nav.getRevision()).toBeGreaterThan(version);
  expect(await execute("office.member.open", { ...input, tab: "payments" })).toMatchObject({ status: "failed", code: "input" });
  expect(await execute("office.member.open", { ...input, poolId: "foreign" })).toMatchObject({ status: "failed" });
});

it("isolates an old member's late growth response from the next member full view", async () => {
  const original = vi.mocked(api.get).getMockImplementation()!;
  let finish!: (data: unknown) => void;
  vi.mocked(api.get).mockImplementation((p, o) => p.endsWith("/fixture_1") && p.startsWith("/admin/growth-reports/students/")
    ? new Promise(r => { finish = r; }) as never : p.endsWith("/fixture_2")
      ? Promise.resolve({ success: true, reports: [{ report_id: "current", report_period: "2027-10", published_at: null }] }) as never : original(p, o));
  render(<Fixture />);
  await execute("office.member.open", { memberId: "fixture_1", view: "full", tab: "growth" });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await execute("office.member.open", { memberId: "fixture_2", view: "full", tab: "growth" });
  await screen.findByText("2027년 11월 성장리포트");
  await act(async () => finish({ success: true, reports: [{ report_id: "old", report_period: "2050-11", published_at: null }] }));
  expect(screen.queryByText("2050년 12월 성장리포트")).toBeNull();
  expect(nav.destination).toMatchObject({ memberId: "fixture_2" });
});
