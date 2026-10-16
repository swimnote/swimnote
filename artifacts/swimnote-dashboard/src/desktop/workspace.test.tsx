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
    if (path === "/students?pool_all=true") return [{
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
const ai = () => document.getElementById("office-ai-region")!;
const switchAI = () => fireEvent.click(screen.getByRole("button", { name: "AI 중심", exact: true }));
const switchBusiness = () => fireEvent.click(screen.getByRole("button", { name: "업무집중", exact: true }));
async function selected() {
  await screen.findByText("PRIVATE_MEMBER_NAME");
  fireEvent.click(screen.getByText("PRIVATE_MEMBER_NAME"));
  const dialog = screen.getByRole("dialog", { name: "회원 상세" });
  await within(dialog).findByText("발행된 성장리포트가 없습니다.");
  return dialog;
}

it("N02 preserves one business mount, query observers, filters, scroll and selection through mode/collapse changes", async () => {
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
    switchAI();
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(screen.getByRole("button", { name: "Side Workspace 접기" }));
    expect(business().hidden).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(ai().textContent).toContain("student_legacy_001");
    expect(input.isConnected).toBe(true);
    expect(queryClient.getQueryCache().getAll().map(query => query.getObserversCount())).toEqual(observerCount);
    fireEvent.click(screen.getByRole("button", { name: "Side Workspace 열기" }));
    expect(business().hidden).toBe(false);
    expect(screen.getByPlaceholderText("이름 또는 전화번호 검색")).toBe(input);
    expect(input.value).toBe("PRIVATE_MEMBER");
    expect(filters[0].value).toBe("");
    expect(filters[1].value).toBe("class-a");
    expect(scroll.scrollTop).toBe(520);
    expect(screen.getByRole("dialog")).toBe(dialog);
    switchBusiness();
  }
  expect(vi.mocked(api.get).mock.calls.length).toBe(reads);
  expect(disk).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});

it("N02 exposes only minimal live Context, with no fake chat, and reuses OPEN/history", async () => {
  render(<App />);
  await selected();
  switchAI();
  expect(ai().textContent).toContain("student_legacy_001");
  expect(ai().textContent).not.toMatch(/PRIVATE_MEMBER|PRIVATE_PHONE|PRIVATE_PARENT/);
  expect(within(ai()).queryByRole("textbox")).toBeNull();
  expect(within(ai()).queryByRole("button", { name: /전송/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "현재 업무로 돌아가기" }));
  expect(document.activeElement).toBe(business());
  fireEvent.click(screen.getByRole("button", { name: "앱 내 뒤로" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(ai().textContent).toContain("선택 없음");
  fireEvent.click(screen.getByRole("button", { name: "앱 내 앞으로" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(ai().textContent).toContain("student_legacy_001");
});

it("N02 supports pointer/keyboard sizing and restores mode-specific width after collapse", async () => {
  render(<App />);
  await screen.findByText("PRIVATE_MEMBER_NAME");
  switchAI();
  let separator = screen.getByRole("separator", { name: "Side Workspace 크기 조절" });
  expect(separator.getAttribute("aria-orientation")).toBe("vertical");
  expect(separator.getAttribute("aria-valuenow")).toBe("480");
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  expect(separator.getAttribute("aria-valuenow")).toBe("504");
  fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 900 });
  fireEvent.pointerMove(separator, { pointerId: 1, clientX: 840 });
  fireEvent.pointerUp(separator, { pointerId: 1 });
  expect(separator.getAttribute("aria-valuenow")).toBe("564");
  fireEvent.click(screen.getByRole("button", { name: "Side Workspace 접기" }));
  expect(screen.queryByRole("separator")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Side Workspace 열기" }));
  separator = screen.getByRole("separator");
  expect(separator.getAttribute("aria-valuenow")).toBe("564");
  fireEvent.keyDown(separator, { key: "Home" });
  expect(separator.getAttribute("aria-valuenow")).toBe("280");
  fireEvent.keyDown(separator, { key: "End" });
  expect(separator.getAttribute("aria-valuenow")).toBe("952");
  switchBusiness();
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("360");
  switchAI();
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("952");
  act(() => screen.getByRole("separator").focus());
  await act(async () => { width = 600; observers.forEach(callback => callback()); });
  expect(screen.queryByRole("separator")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "업무집중", exact: true }));
  await act(async () => { width = 1440; observers.forEach(callback => callback()); });
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("952");
});

it("N02 keeps restore controls reachable in narrow fallback and recovers focus/width without remount", async () => {
  render(<App />);
  const dialog = await selected();
  switchAI();
  act(() => business().focus());
  expect(document.activeElement).toBe(business());
  await act(async () => { width = 600; observers.forEach(callback => callback()); });
  expect(screen.queryByRole("separator")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "업무집중", exact: true }));
  expect(business().hidden).toBe(true);
  expect(ai().hidden).toBe(false);
  expect(document.querySelector(".mobile-guard-overlay")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "현재 업무 보기" }));
  expect(business().hidden).toBe(false);
  expect(ai().hidden).toBe(true);
  expect(screen.getByRole("dialog")).toBe(dialog);
  fireEvent.click(screen.getByRole("button", { name: "AI 영역 보기" }));
  expect(business().hidden).toBe(true);
  await act(async () => { width = 1440; observers.forEach(callback => callback()); });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("480");
});

it.each(["user-b:pool-a", "user-a:pool-b"])("N02 resets layout and minimal Context on verified scope change: %s", async scope => {
  const view = render(<App />);
  await selected(); switchAI();
  fireEvent.click(screen.getByRole("button", { name: "Side Workspace 접기" }));
  view.rerender(<App scope={scope} />);
  await screen.findByText("PRIVATE_MEMBER_NAME");
  expect(business().hidden).toBe(false);
  expect(ai().hidden).toBe(true);
  expect(ai().textContent).not.toContain("student_legacy_001");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "업무집중", exact: true }).getAttribute("aria-pressed")).toBe("true");
});
