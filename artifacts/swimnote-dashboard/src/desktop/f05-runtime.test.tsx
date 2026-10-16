// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { DesktopApp } from "./DesktopApp";
import { getToken, useDesktopTokenStorage } from "../lib/token";
import { queryClient } from "../lib/query-client";
import { api } from "../lib/api-client";

vi.mock("../lib/api-client", () => ({ publicPost: vi.fn(), api: { get: vi.fn(), getBaseUrl: () => "https://fixture.invalid/api" } }));
const id = "11111111-1111-4111-8111-111111111111";
let version: number;
let pool: string;
let listError: boolean;
let statsError: boolean;
let classError: boolean;
let studentsEmpty: boolean;
let historyError: unknown;
let historyResult: unknown;
let delayList: Promise<unknown> | undefined;
let delayStats: Promise<unknown> | undefined;
let streams: ReadableStreamDefaultController<Uint8Array>[];
let clear: ReturnType<typeof vi.fn>;
const students = () => [
  { id, name: `검증회원A-${version}`, status: "active", parent_name: "검증보호자", phone: "00000000001", class_group_id: "class-a", class_group_name: "기초반" },
  { id: "22222222-2222-4222-8222-222222222222", name: "검증회원B", status: "suspended", class_group_id: "class-b", class_group_name: "상급반" },
];
function open() { return render(<Router><DesktopApp /></Router>); }
function emit(type: string) {
  streams.at(-1)!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type })}\n\n`));
}
const calls = (route: string) => vi.mocked(api.get).mock.calls.filter(call => call[0] === route).length;

beforeEach(() => {
  useDesktopTokenStorage();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.clearAllMocks();
  version = 1; pool = "pool-a"; listError = statsError = classError = studentsEmpty = false;
  historyError = undefined; historyResult = { success: true, reports: [] };
  delayList = delayStats = undefined; streams = [];
  window.history.replaceState({}, "", "/admin/login");
  clear = vi.fn(async () => ({ ok: true }));
  Object.defineProperty(window, "officeDesktop", { configurable: true, value: {
    getBootstrapInfo: async () => ({ stage: "F03", platform: "win32", packaged: false, version: "fixture" }),
    restoreSession: async () => ({ token: `fixture-${pool}`, remembered: true }),
    commitSession: async () => ({ ok: true }), clearSession: clear,
    readLoginPreferences: async () => ({ loginId: "fixture-login", remember: true }),
    saveLoginPreferences: async () => ({ ok: true }),
  } });
  vi.mocked(api.get).mockImplementation(async route => {
    if (route === "/auth/me") return { id: `user-${pool}`, role: "pool_admin", swimming_pool_id: pool, name: `사용자-${pool}` } as never;
    if (route === "/pools/my-pools") return [{ id: pool, name: `검증수영장-${pool}` }] as never;
    if (route === "/pools/x-mode") return { pool_id: pool, mode: "x" } as never;
    if (route === "/admin/dashboard-stats") {
      if (delayStats) return await delayStats as never;
      if (statsError) throw new Error("fixture stats failure");
      return { total_members: studentsEmpty ? 0 : version, today_present: 0, pending_makeups: 0, pending_requests: 0 } as never;
    }
    if (route === "/students?pool_all=true") {
      if (delayList) return await delayList as never;
      if (listError) throw new Error("fixture list failure");
      return (studentsEmpty ? [] : students()) as never;
    }
    if (route === "/class-groups") {
      if (classError) throw new Error("fixture class failure");
      return [{ id: "class-a", name: "기초반" }, { id: "class-b", name: "상급반" }] as never;
    }
    if (route === `/admin/growth-reports/students/${id}`) {
      if (historyError) throw historyError;
      return historyResult as never;
    }
    throw new Error("Unapproved fixture route: " + route);
  });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => ({
    status: 200, ok: true, body: new ReadableStream({
      start(controller) {
        streams.push(controller);
        init.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    }),
  })));
});
afterEach(() => {
  cleanup(); queryClient.clear(); vi.unstubAllGlobals();
  delete (window as { officeDesktop?: unknown }).officeDesktop;
});

it("hands one verified session to the existing dashboard, routes, Pool and sidebar; no duplicate authentication", async () => {
  open();
  await screen.findByText("안녕하세요, 사용자-pool-a님");
  expect(screen.getAllByText(/검증수영장-pool-a/).length).toBeGreaterThan(0);
  expect(calls("/auth/me")).toBe(1);
  expect(calls("/pools/x-mode")).toBe(1);
  expect(calls("/admin/dashboard-stats")).toBe(1);
  expect(screen.queryByRole("button", { name: "설정", exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /회원목록 회원 검색/ }));
  await screen.findByText("검증회원A-1");
  expect(calls("/students?pool_all=true")).toBe(1);
  expect((screen.getByRole("button", { name: "+ 회원 등록" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /Excel/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("검증회원A-1"));
  const drawer = await screen.findByRole("dialog", { name: "회원 상세" });
  await within(drawer).findByText("발행된 성장리포트가 없습니다.");
  for (const label of ["수정", "연기", "퇴원", "일지 보기"]) {
    const button = within(drawer).getByRole("button", { name: label }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.style.opacity).toBe("0.45");
    expect(button.getAttribute("aria-describedby")).toBe("member-drawer-readonly");
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "회원 상세" })).toBe(drawer);
    expect(screen.queryByText("회원 정보 수정")).toBeNull();
    expect(window.location.pathname).toBe("/admin/members");
  }
  expect(within(drawer).getByText(/Desktop 조회 전용: 수정·연기·퇴원/)).toBeTruthy();
  expect(calls(`/admin/growth-reports/students/${id}`)).toBe(1);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("retains search/filter/selection while event refresh updates the open drawer and history", async () => {
  window.history.replaceState({}, "", "/admin/members");
  open();
  await screen.findByText("검증회원A-1");
  const search = screen.getByPlaceholderText("이름 또는 전화번호 검색");
  fireEvent.change(search, { target: { value: "검증회원A" } });
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "class-a" } });
  fireEvent.click(screen.getByText("검증회원A-1"));
  await screen.findByText("발행된 성장리포트가 없습니다.");
  version = 2;
  await act(async () => emit("member.changed"));
  expect((await within(screen.getByRole("dialog")).findAllByText("검증회원A-2")).length).toBe(2);
  expect((search as HTMLInputElement).value).toBe("검증회원A");
  expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("class-a");
  expect(calls(`/admin/growth-reports/students/${id}`)).toBe(2);
  await act(async () => emit("growth_report.changed"));
  await waitFor(() => expect(calls(`/admin/growth-reports/students/${id}`)).toBe(3));
  fireEvent.keyDown(document, { key: "Escape" });
  expect((search as HTMLInputElement).value).toBe("검증회원A");
  expect(screen.queryByText("검증회원B")).toBeNull();
  fireEvent.change(search, { target: { value: "없는검증회원" } });
  await screen.findByText("검색 결과가 없습니다.");
});

it.each([
  [new TypeError("fixture network rejection"), "세부 원인은 미확인"],
  [{ status: 500, message: "PRIVATE_FIXTURE_MESSAGE" }, "HTTP 500"],
  [new SyntaxError("fixture invalid JSON"), "응답 형식"],
])("distinguishes history failures and retries without masking them as empty: %s", async (error, message) => {
  window.history.replaceState({}, "", "/admin/members");
  historyError = error;
  open();
  await screen.findByText("검증회원A-1");
  fireEvent.click(screen.getByText("검증회원A-1"));
  const drawer = screen.getByRole("dialog", { name: "회원 상세" });
  await within(drawer).findByText(new RegExp(message as string));
  expect(within(drawer).queryByText("발행된 성장리포트가 없습니다.")).toBeNull();
  expect(drawer.textContent).not.toContain("PRIVATE_FIXTURE");
  historyError = undefined;
  fireEvent.click(within(drawer).getByRole("button", { name: "다시 조회" }));
  await within(drawer).findByText("발행된 성장리포트가 없습니다.");
});

it("does not silently treat a malformed history response as no published reports", async () => {
  window.history.replaceState({}, "", "/admin/members");
  historyResult = { success: true };
  open();
  await screen.findByText("검증회원A-1");
  fireEvent.click(screen.getByText("검증회원A-1"));
  const drawer = screen.getByRole("dialog", { name: "회원 상세" });
  await within(drawer).findByText(/응답 형식/);
  expect(within(drawer).queryByText("발행된 성장리포트가 없습니다.")).toBeNull();
});

it("does not claim resync success before the reconnected active query finishes", async () => {
  window.history.replaceState({}, "", "/admin/members");
  open();
  await screen.findByText("검증회원A-1");
  let resolve!: (value: unknown) => void;
  delayList = new Promise(value => { resolve = value; });
  await act(async () => window.dispatchEvent(new Event("offline")));
  expect(clear).not.toHaveBeenCalled();
  expect(getToken()).toBe("fixture-pool-a");
  await act(async () => window.dispatchEvent(new Event("online")));
  await screen.findByText(/SSE 재동기화 신호: 재조회 처리 중/);
  expect(screen.queryByText(/SSE 재동기화 신호: 관련 업무 재조회 완료/)).toBeNull();
  version = 3;
  await act(async () => resolve(students()));
  await screen.findByText("검증회원A-3");
  await screen.findByText(/SSE 재동기화 신호: 관련 업무 재조회 완료/);
});

it("exposes resync failure/retry without erasing filters or reporting current", async () => {
  window.history.replaceState({}, "", "/admin/members");
  open();
  await screen.findByText("검증회원A-1");
  const search = screen.getByPlaceholderText("이름 또는 전화번호 검색");
  fireEvent.change(search, { target: { value: "검증회원A" } });
  listError = true;
  await act(async () => emit("resync.required"));
  await screen.findByText(/SSE 재동기화 신호: 재조회 실패/);
  listError = false; version = 4;
  fireEvent.click(screen.getByRole("button", { name: "다시 조회", exact: true }));
  await screen.findByText("검증회원A-4");
  expect((search as HTMLInputElement).value).toBe("검증회원A");
});

it("reports dashboard/list/classes failure and empty results with working retry", async () => {
  statsError = true;
  open();
  await screen.findByText(/현황 정보를 불러오지 못했습니다/);
  statsError = false; studentsEmpty = true;
  fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  await waitFor(() => expect(screen.queryByText(/현황 정보를 불러오지 못했습니다/)).toBeNull());
  listError = classError = true;
  fireEvent.click(screen.getByRole("button", { name: /회원목록 회원 검색/ }));
  await screen.findByText("회원 목록을 불러오지 못했습니다.");
  await screen.findByText(/반 정보를 불러오지 못했습니다/);
  listError = classError = false;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  await screen.findByText("등록된 회원이 없습니다.");
});

it("unmounts private state and cancels late reads on logout and next Pool mount", async () => {
  window.history.replaceState({}, "", "/admin/members");
  const view = open();
  await screen.findByText("검증회원A-1");
  fireEvent.change(screen.getByPlaceholderText("이름 또는 전화번호 검색"), { target: { value: "검증회원A" } });
  let resolve!: (value: unknown) => void;
  delayList = new Promise(value => { resolve = value; });
  await act(async () => emit("member.changed"));
  await waitFor(() => expect(calls("/students?pool_all=true")).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "로그아웃", exact: true }));
  await screen.findByPlaceholderText("아이디를 입력하세요");
  expect(getToken()).toBeNull();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  await act(async () => resolve([{ id, name: "LATE_PRIVATE_MEMBER", status: "active" }]));
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(view.container.textContent).not.toMatch(/LATE_PRIVATE_MEMBER|검증회원A/);
  view.unmount();
  pool = "pool-b"; studentsEmpty = true; delayList = undefined;
  window.history.replaceState({}, "", "/admin/members");
  open();
  await screen.findByText("등록된 회원이 없습니다.");
  expect(screen.queryByText(/검증수영장-pool-a/)).toBeNull();
  expect((screen.getByPlaceholderText("이름 또는 전화번호 검색") as HTMLInputElement).value).toBe("");
});

it("shows loading until the actual dashboard response and blocks unsupported direct routes", async () => {
  let resolve!: (value: unknown) => void;
  delayStats = new Promise(value => { resolve = value; });
  const view = open();
  await screen.findByText("오늘 현황");
  expect(screen.queryByText("불러오지 못했습니다")).toBeNull();
  await act(async () => resolve({ total_members: 0, today_present: 0, pending_makeups: 0, pending_requests: 0 }));
  await waitFor(() => expect(screen.getAllByText("0").length).toBe(4));
  view.unmount();
  window.history.replaceState({}, "", "/admin/members/new");
  open();
  await screen.findByText("현재 단계에서 지원하지 않는 메뉴입니다.");
  expect(calls("/students?pool_all=true")).toBe(0);
});
