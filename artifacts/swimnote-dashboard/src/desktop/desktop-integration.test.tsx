// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopApp } from "./DesktopApp";
import { getToken, useDesktopTokenStorage } from "../lib/token";
import { queryClient } from "../lib/query-client";

vi.mock("../lib/api-client", () => ({
  publicPost: vi.fn(),
  api: {
    getBaseUrl: () => "https://api.fixture.invalid/api",
    get: vi.fn(async (route: string) => {
      if (route === "/auth/me") return {
        id: "fixture-user", name: "PRIVATE_NAME", email: "PRIVATE_EMAIL",
        role: "pool_admin", swimming_pool_id: "fixture-pool",
      };
      if (route === "/pools/my-pools") return [{ id: "fixture-pool", name: "검증 Pool" }];
      if (route === "/pools/x-mode") return { pool_id: "fixture-pool", mode: "x" };
      throw new Error("Unexpected fixture route");
    }),
  },
}));

const token = "fixture.final.token";
let stream: ReadableStreamDefaultController<Uint8Array>;
let clear: ReturnType<typeof vi.fn>;
beforeEach(() => {
  useDesktopTokenStorage();
  queryClient.clear();
  clear = vi.fn(async () => ({ ok: true }));
  Object.defineProperty(window, "officeDesktop", { configurable: true, value: {
    getBootstrapInfo: async () => ({ stage: "F03", platform: "win32", packaged: true, version: "fixture" }),
    restoreSession: async () => ({ token, remembered: true }),
    commitSession: async () => ({ ok: true }),
    clearSession: clear,
  } });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => ({
    status: 200, ok: true,
    body: new ReadableStream({
      start(controller) {
        stream = controller;
        init.signal.addEventListener("abort", () => {
          try { controller.error(new DOMException("aborted", "AbortError")); } catch { /* Already closed. */ }
        });
      },
    }),
  })));
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  delete (window as { officeDesktop?: unknown }).officeDesktop;
});

it("shows safe identity/revalidation/storage/SSE states; offline does not erase the session", async () => {
  const view = render(<DesktopApp />);
  await screen.findByText(/실시간 연결 확인됨/);
  expect(screen.getByText(/서버 사용자·Pool·권한 재검증 완료/)).toBeTruthy();
  expect(screen.getByText(/main 안전 저장 성공 응답 확인/)).toBeTruthy();
  expect(screen.getByText(/업무 조회 대상: 없음/)).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/PRIVATE_NAME|PRIVATE_EMAIL|fixture\.final\.token/);
  await act(async () => window.dispatchEvent(new Event("offline")));
  expect(screen.getByText(/네트워크 복구 후 자동 재연결/)).toBeTruthy();
  expect(clear).not.toHaveBeenCalled();
  expect(getToken()).toBe(token);
  await act(async () => window.dispatchEvent(new Event("online")));
  await screen.findByText(/실시간 연결 확인됨/);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(clear).not.toHaveBeenCalled();
});

it("clears main storage, in-memory token, private UI and query cache on authoritative SSE denial", async () => {
  const view = render(<DesktopApp />);
  await screen.findByText(/실시간 연결 확인됨/);
  queryClient.setQueryData(["students"], [{ phone: "PRIVATE_PHONE" }]);
  await act(async () => {
    stream.enqueue(new TextEncoder().encode('data: {"type":"session.invalid","reason":"revoked"}\n\n'));
  });
  await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  await screen.findByPlaceholderText("아이디를 입력하세요");
  expect(getToken()).toBeNull();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(view.queryByText(/검증 Pool/)).toBeNull();
  expect(view.container.textContent).not.toMatch(/PRIVATE_PHONE|PRIVATE_NAME|PRIVATE_EMAIL/);
});
