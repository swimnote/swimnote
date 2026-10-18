// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { DesktopRoutes } from "./DesktopApp";
import { OfficeNavigationProvider } from "./OfficeNavigation";
import { api } from "../lib/api-client";
import { queryClient } from "../lib/query-client";
import { useDesktopTokenStorage } from "../lib/token";

vi.mock("../lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ state: { status: "authenticated", user: { id: "fixture-user", role: "pool_admin", poolName: "Fixture Pool" } }, logout: vi.fn() }),
}));
let width: number;
let observers: (() => void)[];
function App({ scope = "user-a:pool-a" }: { scope?: string }) {
  return <Router><QueryClientProvider client={queryClient}>
    <OfficeNavigationProvider key={scope}><DesktopRoutes /></OfficeNavigationProvider>
  </QueryClientProvider></Router>;
}
beforeEach(() => {
  width = 1440; observers = [];
  useDesktopTokenStorage(); queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  window.history.replaceState({}, "", "/admin/members");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 720 }) as DOMRect);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: MouseEventInit & { pointerId?: number } = {}) {
      super(type, options); this.pointerId = options.pointerId ?? 1;
    }
  });
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === "/students") return [{
      id: "student_legacy_001", name: "PRIVATE_MEMBER_NAME", status: "active",
      class_group_id: "class-a", class_group_name: "기초반", phone: "PRIVATE_PHONE", parent_name: "PRIVATE_PARENT",
    }] as never;
    if (path === "/class-groups") return [{ id: "class-a", name: "기초반" }] as never;
    if (path.startsWith("/admin/growth-reports/students/")) return { success: true, reports: [] } as never;
    if (path === "/admin/dashboard-stats") return { total_members: 1, today_present: 0, pending_makeups: 0, pending_requests: 0 } as never;
    throw new Error("Unexpected fixture path: " + path);
  });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const business = () => document.getElementById("office-business-region")!;
async function selected() {
  await screen.findByText("PRIVATE_MEMBER_NAME");
  fireEvent.click(screen.getByText("PRIVATE_MEMBER_NAME"));
  const dialog = screen.getByRole("dialog", { name: "회원 상세" });
  await within(dialog).findByText("발행된 성장리포트가 없습니다.");
  return dialog;
}

it("integrated layout preserves one business mount, observers, filters, scroll and Drawer on sidebar collapse", async () => {
  const disk = vi.spyOn(Storage.prototype, "setItem");
  const view = render(<App />);
  const dialog = await selected();
  const input = screen.getByPlaceholderText("이름 또는 전화번호 검색") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "PRIVATE_MEMBER" } });
  const filters = screen.getAllByRole("combobox") as HTMLSelectElement[];
  fireEvent.change(filters[0], { target: { value: "" } });
  fireEvent.change(filters[1], { target: { value: "class-a" } });
  const scroll = view.container.querySelector<HTMLElement>("[data-office-business-scroll]")!;
  scroll.scrollTop = 520; fireEvent.scroll(scroll);
  const reads = vi.mocked(api.get).mock.calls.length;
  const observerCount = queryClient.getQueryCache().getAll().map(query => query.getObserversCount());
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole("button", { name: "메뉴 접기" }));
    expect(input.isConnected).toBe(true);
    expect(queryClient.getQueryCache().getAll().map(query => query.getObserversCount())).toEqual(observerCount);
    fireEvent.click(screen.getByRole("button", { name: "메뉴 펼치기" }));
    expect(business().hidden).toBe(false);
    expect(screen.getByPlaceholderText("이름 또는 전화번호 검색")).toBe(input);
    expect(input.value).toBe("PRIVATE_MEMBER");
    expect(filters[0].value).toBe("");
    expect(filters[1].value).toBe("class-a");
    expect(scroll.scrollTop).toBe(520);
    expect(screen.getByRole("dialog")).toBe(dialog);
  }
  expect(vi.mocked(api.get).mock.calls.length).toBe(reads);
  expect(disk).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});

it("integrated command draft is session-only, persists through navigation, and never submits", async () => {
  const disk = vi.spyOn(Storage.prototype, "setItem");
  render(<App />);
  await selected();
  const command = screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement;
  fireEvent.change(command, { target: { value: "아직 보내지 않는 업무 메모" } });
  expect(command.disabled).toBe(false);
  expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(command.closest("form")!);
  expect(command.value).toBe("아직 보내지 않는 업무 메모");
  expect(screen.getByRole("log").textContent).not.toMatch(/PRIVATE_MEMBER|PRIVATE_PHONE|PRIVATE_PARENT/);
  expect(screen.queryByRole("button", { name: "AI 중심", exact: true })).toBeNull();
  expect(document.querySelector(".office-workspace-divider")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "앱 내 뒤로" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "앱 내 앞으로" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "홈 현황", exact: true }));
  await screen.findByText("오늘 현황");
  expect(screen.getByRole("textbox", { name: "업무 입력" })).toBe(command);
  expect(command.value).toBe("아직 보내지 않는 업무 메모");
  expect(disk).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});

it("keeps the desired horizontal offset through width clamping and menu navigation", async () => {
  render(<App />);
  await screen.findByText("PRIVATE_MEMBER_NAME");
  const table = screen.getByRole("region", { name: "회원표 가로 스크롤" });
  let viewport = 216;
  Object.defineProperties(table, {
    clientWidth: { configurable: true, get: () => viewport },
    scrollWidth: { configurable: true, get: () => 848 },
  });
  table.scrollLeft = 500; fireEvent.scroll(table);
  const resize = async (next: number) => {
    viewport = next;
    await act(async () => { observers.forEach(callback => callback()); });
    fireEvent.scroll(table); // Browser-generated scroll after layout clamping must not erase the intent.
  };
  await resize(800);
  expect(table.scrollLeft).toBe(48);
  await resize(1000);
  expect(table.scrollLeft).toBe(0);
  await resize(216);
  expect(table.scrollLeft).toBe(500);
  await resize(0);
  await resize(216);
  expect(screen.getByRole("region", { name: "회원표 가로 스크롤" })).toBe(table);
  expect(table.scrollLeft).toBe(500);
  fireEvent.click(screen.getByRole("button", { name: "홈 현황", exact: true }));
  await screen.findByText("오늘 현황");
  fireEvent.click(screen.getByRole("button", { name: /회원목록 회원 검색/ }));
  await screen.findByText("PRIVATE_MEMBER_NAME");
  const returned = screen.getByRole("region", { name: "회원표 가로 스크롤" });
  Object.defineProperties(returned, {
    clientWidth: { configurable: true, get: () => 216 },
    scrollWidth: { configurable: true, get: () => 848 },
  });
  await act(async () => { observers.forEach(callback => callback()); });
  expect(returned.scrollLeft).toBe(500);
});

it("does not remount the command input on sidebar changes and retains pointer navigation focus/caret", async () => {
  render(<App />);
  await screen.findByText("PRIVATE_MEMBER_NAME");
  const command = screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement;
  fireEvent.change(command, { target: { value: "연결 전 업무 초안" } });
  act(() => { command.focus(); command.setSelectionRange(2, 5); });
  const toggle = screen.getByRole("button", { name: "메뉴 접기" });
  fireEvent.pointerDown(toggle);
  act(() => toggle.focus());
  fireEvent.click(toggle);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(document.activeElement).toBe(command);
  expect(command.selectionStart).toBe(2);
  expect(command.selectionEnd).toBe(5);
  expect(screen.getByRole("textbox", { name: "업무 입력" })).toBe(command);
  expect(business().hidden).toBe(false);
});

it.each(["user-b:pool-a", "user-a:pool-b"])("resets command draft, history and selection on verified scope change: %s", async scope => {
  const view = render(<App />);
  await selected();
  fireEvent.change(screen.getByRole("textbox", { name: "업무 입력" }), { target: { value: "PRIVATE_DRAFT" } });
  view.rerender(<App scope={scope} />);
  await screen.findByText("PRIVATE_MEMBER_NAME");
  expect(business().hidden).toBe(false);
  expect((screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByRole("log")).toHaveLength(1);
});
