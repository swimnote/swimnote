// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { AuthProvider } from "../contexts/AuthContext";
import { DashboardLayout } from "../layouts/DashboardLayout";
import HomePage from "../pages/HomePage";
import MembersPage from "../pages/members/MembersPage";
import { getToken, isDesktopTokenStorage } from "../lib/token";
import { queryClient } from "../lib/query-client";
import { api } from "../lib/api-client";

vi.mock("../lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
beforeEach(() => {
  queryClient.clear();
  localStorage.setItem("x_token", "fixture-web-token");
  window.history.replaceState({}, "", "/admin/members");
  vi.mocked(api.get).mockImplementation(async route => {
    if (route === "/auth/me") return { id: "fixture", name: "웹검증관리자", role: "pool_admin", swimming_pool_id: "pool" } as never;
    if (route === "/pools/my-pools") return [{ id: "pool", name: "웹검증수영장" }] as never;
    if (route === "/pools/x-mode") return { mode: "x" } as never;
    if (route === "/students?pool_all=true") return [{ id: "fixture-member", name: "웹검증회원", status: "active" }] as never;
    if (route === "/class-groups") return [] as never;
    if (route === "/admin/dashboard-stats") return { total_members: 0, today_present: 0, pending_makeups: 0, pending_requests: 0 } as never;
    if (route.startsWith("/admin/growth-reports/students/")) return { success: true, reports: [] } as never;
    throw new Error("Unexpected Web regression fixture");
  });
});
afterEach(() => { cleanup(); queryClient.clear(); localStorage.clear(); vi.clearAllMocks(); });
function mount(page: React.ReactNode) {
  return render(<Router><QueryClientProvider client={queryClient}>
    <AuthProvider><DashboardLayout>{page}</DashboardLayout></AuthProvider>
  </QueryClientProvider></Router>);
}
it("preserves Web authentication, all navigation and member editing affordances", async () => {
  expect(isDesktopTokenStorage()).toBe(false);
  mount(<MembersPage />);
  await screen.findByText("웹검증회원");
  expect(getToken()).toBe("fixture-web-token");
  expect((screen.getByRole("button", { name: "+ 회원 등록" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Excel" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "설정", exact: true })).toBeTruthy();
  fireEvent.click(screen.getByText("웹검증회원"));
  for (const label of ["수정", "일지 보기", "연기", "퇴원"]) {
    const button = screen.getByRole("button", { name: label, exact: true }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.style.opacity).toBe("1");
    expect(button.getAttribute("aria-describedby")).toBeNull();
  }
  expect(screen.queryByText(/Desktop 조회 전용: 수정·연기·퇴원/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "수정", exact: true }));
  await screen.findByText("회원 정보 수정");
  expect(api.patch).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("preserves Web dashboard quick actions and logout isolation", async () => {
  mount(<HomePage />);
  await screen.findByText("안녕하세요, 웹검증관리자님");
  expect(screen.getByRole("button", { name: /신규 회원 정보를 등록/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /커리큘럼 등록 수영장/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃", exact: true }));
  expect(getToken()).toBeNull();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it("N01 keeps Web menu routing on the existing router without Desktop history controls", async () => {
  mount(<HomePage />);
  await screen.findByText("안녕하세요, 웹검증관리자님");
  fireEvent.click(screen.getByRole("button", { name: "홈", exact: true }));
  await waitFor(() => expect(window.location.pathname).toBe("/admin"));
  fireEvent.click(screen.getByRole("button", { name: "전체 회원", exact: true }));
  await waitFor(() => expect(window.location.pathname).toBe("/admin/members"));
  expect(screen.queryByRole("navigation", { name: "현재 업무 위치" })).toBeNull();
  expect(isDesktopTokenStorage()).toBe(false);
});
