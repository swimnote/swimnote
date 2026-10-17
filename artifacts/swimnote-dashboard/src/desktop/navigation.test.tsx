// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { OfficeNavigationProvider, useOfficeNavigation, validOfficeDestination, type OfficeDestination } from "./OfficeNavigation";
import { DesktopRoutes } from "./DesktopApp";
import { queryClient } from "../lib/query-client";
import { useDesktopTokenStorage } from "../lib/token";
import { api } from "../lib/api-client";

vi.mock("../lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ state: { status: "authenticated", user: { id: "fixture-user", role: "pool_admin", poolName: "Fixture Pool" } }, logout: vi.fn() }),
}));
let control: NonNullable<ReturnType<typeof useOfficeNavigation>>;
let version: number;
let removed: boolean;
const textId = "student_legacy_001";
const students = () => removed ? [] : Array.from({ length: 75 }, (_, i) => ({
  id: i === 0 ? textId : `student_${i}`, name: `조회회원${String(i + 1).padStart(3, "0")}-v${version}`,
  status: "active", class_group_id: "class-a", class_group_name: "기초반",
}));
function Capture() {
  control = useOfficeNavigation()!;
  return null;
}
function App({ scope = "user-a:pool-a" }: { scope?: string }) {
  return <Router><QueryClientProvider client={queryClient}>
    <OfficeNavigationProvider key={scope}><Capture /><DesktopRoutes /></OfficeNavigationProvider>
  </QueryClientProvider></Router>;
}
beforeEach(() => {
  version = 1; removed = false;
  useDesktopTokenStorage(); queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  window.history.replaceState({}, "", "/admin");
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === "/admin/dashboard-stats") return { total_members: 75, today_present: 0, pending_makeups: 0, pending_requests: 0 } as never;
    if (path === "/students?pool_all=true") return students() as never;
    if (path === "/class-groups") return [{ id: "class-a", name: "기초반" }] as never;
    if (path.startsWith("/admin/growth-reports/students/")) return { success: true, reports: [] } as never;
    throw new Error("Unapproved fixture route: " + path);
  });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.clearAllMocks(); });
const members = () => screen.getByPlaceholderText("이름 또는 전화번호 검색") as HTMLInputElement;
const back = () => fireEvent.click(screen.getByRole("button", { name: "앱 내 뒤로" }));
const forward = () => fireEvent.click(screen.getByRole("button", { name: "앱 내 앞으로" }));
async function openMembers() {
  fireEvent.click(screen.getByRole("button", { name: /회원목록 회원 검색/ }));
  await screen.findByText("조회회원001-v1");
}

it("N01 restores filter, scroll and ID-based Drawer across real menu/dashboard/history navigation", async () => {
  const view = render(<App />);
  await screen.findByText("오늘 현황");
  await openMembers();
  fireEvent.change(members(), { target: { value: "조회회원" } });
  const filters = screen.getAllByRole("combobox") as HTMLSelectElement[];
  fireEvent.change(filters[0], { target: { value: "" } });
  fireEvent.change(filters[1], { target: { value: "class-a" } });
  const main = view.container.querySelector<HTMLElement>("[data-office-business-scroll]")!;
  main.scrollTop = 460; fireEvent.scroll(main);
  fireEvent.click(screen.getByText("조회회원001-v1"));
  await screen.findByRole("dialog", { name: "회원 상세" });
  expect(within(screen.getByRole("navigation", { name: "현재 업무 위치" })).getByText("회원 상세")).toBeTruthy();
  back();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(members().value).toBe("조회회원");
  expect(main.scrollTop).toBe(460);
  forward();
  expect(screen.getByRole("dialog")).toBeTruthy();
  version = 2;
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["students"] }); });
  expect((await within(screen.getByRole("dialog")).findAllByText("조회회원001-v2")).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "홈", exact: true }));
  await screen.findByText("오늘 현황");
  await act(async () => control.open({ screen: "members" }));
  await screen.findByRole("dialog");
  expect(members().value).toBe("조회회원");
  expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("");
  expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("class-a");
  expect(main.scrollTop).toBe(460);
  fireEvent.click(screen.getByRole("button", { name: "회원", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "회원", exact: true }));
  if (screen.getByRole("button", { name: "회원", exact: true }).getAttribute("aria-expanded") !== "true")
    fireEvent.click(screen.getByRole("button", { name: "회원", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "전체 회원", exact: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  back(); // A resumed detail returns to its valid list first; no duplicate menu entry.
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(members().value).toBe("조회회원");
  back();
  expect(screen.getByText("오늘 현황")).toBeTruthy();
  forward();
  expect(screen.queryByRole("dialog")).toBeNull();
  forward();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});

it("N01 restores pagination after remount and truncates Forward after a new destination", async () => {
  render(<App />);
  await openMembers();
  await act(async () => control.updateView({ page: 2 }));
  expect(control.view.page).toBe(2);
  await act(async () => control.open({ screen: "home" }));
  back();
  await screen.findByPlaceholderText("이름 또는 전화번호 검색");
  expect(control.view.page).toBe(2);
  back();
  expect(control.destination.screen).toBe("home");
  await act(async () => control.open({ screen: "members", memberId: textId }));
  expect(control.canForward).toBe(false);
  expect(control.destination).toEqual({ screen: "members", memberId: textId });
});

it("N01 rejects unsupported/URL/write destinations and accepts UUID and server text IDs", async () => {
  render(<App />);
  await screen.findByText("오늘 현황");
  for (const target of [{ screen: "refund" }, { screen: "home", url: "https://fixture.invalid" },
    { screen: "members", memberId: "../private" }, { screen: "members", api: "/students" }]) {
    await act(async () => expect(control.open(target as OfficeDestination)).toBe(false));
    expect(control.destination).toEqual({ screen: "home" });
  }
  expect(screen.getByText("현재 지원하지 않는 이동 대상입니다.")).toBeTruthy();
  expect(validOfficeDestination({ screen: "members", memberId: "11111111-1111-4111-8111-111111111111" })).toBe(true);
  expect(validOfficeDestination({ screen: "members", memberId: textId })).toBe(true);
});

it("N01 recovers blocked direct routes using the same supported navigation entry", async () => {
  window.history.replaceState({}, "", "/admin/not-connected");
  render(<App />);
  await screen.findByText("현재 단계에서 지원하지 않는 메뉴입니다.");
  fireEvent.click(screen.getByRole("button", { name: "홈 현황으로 이동" }));
  await screen.findByText("오늘 현황");
  expect(control.destination).toEqual({ screen: "home" });
  expect(control.canBack).toBe(false);
});

it("N01 returns missing targets to a valid list and clears the stale ID from Forward", async () => {
  render(<App />);
  await openMembers();
  await act(async () => control.open({ screen: "members", memberId: "missing_text_id" }));
  await screen.findByText(/선택한 회원이 현재 목록에 없거나/);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(control.destination).toEqual({ screen: "members" });
  await act(async () => control.open({ screen: "members", memberId: textId }));
  await screen.findByRole("dialog");
  removed = true;
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["students"] }); });
  await screen.findByText(/선택한 회원이 현재 목록에 없거나/);
  back(); forward();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(control.destination).toEqual({ screen: "members" });
});

it("N01 closes outside/ESC without blocking menu or another member and handles forbidden refresh", async () => {
  render(<App />);
  await openMembers();
  fireEvent.click(screen.getByText("조회회원001-v1"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByText("조회회원002-v1"));
  expect(control.destination).toEqual({ screen: "members", memberId: "student_1" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(members());
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("조회회원001-v1"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => control.open({ screen: "members", memberId: textId }));
  const previous = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path, ...args) => {
    if (path === "/students?pool_all=true") return Promise.reject({ status: 403 });
    return previous(path, ...args);
  });
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ["students"] }); });
  await screen.findByText(/선택한 회원이 현재 목록에 없거나/);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(control.destination).toEqual({ screen: "members" });
});

it.each(["user-b:pool-a", "user-a:pool-b"])("N01 scopes history/filter/selection to %s without disk writes", async scope => {
  const disk = vi.spyOn(Storage.prototype, "setItem");
  const view = render(<App />);
  await openMembers();
  fireEvent.change(members(), { target: { value: "조회회원001" } });
  await act(async () => control.open({ screen: "members", memberId: textId }));
  expect(control.canBack).toBe(true);
  view.rerender(<App scope={scope} />);
  await waitFor(() => expect(control.view.search).toBe(""));
  expect(control.destination).toEqual({ screen: "members" });
  expect(control.canBack).toBe(false);
  expect(control.canForward).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(disk).not.toHaveBeenCalled();
  disk.mockRestore();
});
