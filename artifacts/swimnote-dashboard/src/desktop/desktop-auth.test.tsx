// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { DesktopApp } from "./DesktopApp";
import { useDesktopTokenStorage } from "../lib/token";

const { publicPost, get } = vi.hoisted(() => ({ publicPost: vi.fn(), get: vi.fn() }));
vi.mock("../lib/api-client", () => ({ publicPost, api: { get } }));
vi.mock("../lib/query-client", () => ({ queryClient: { clear: vi.fn() } }));
// Keep this F03 credential-flow suite isolated; F04's real boundary has its own SSE fixture.
vi.mock("./DesktopRealtime", () => ({
  DesktopRealtime: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
let bridge: {
  getBootstrapInfo: ReturnType<typeof vi.fn>;
  restoreSession: ReturnType<typeof vi.fn>;
  commitSession: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.clearAllMocks();
  useDesktopTokenStorage();
  bridge = {
    getBootstrapInfo: vi.fn(async () => ({ stage: "F03", platform: "win32", packaged: false, version: "test" })),
    restoreSession: vi.fn(async () => ({ token: null, remembered: false })),
    commitSession: vi.fn(async () => ({ ok: true })),
    clearSession: vi.fn(async () => ({ ok: true })),
  };
  Object.defineProperty(window, "officeDesktop", { value: bridge, configurable: true });
  get.mockImplementation(async route => {
    if (route === "/auth/me") return { id: "fixture-user", name: "테스트 사용자", email: "fixture@example.invalid", role: "pool_admin", swimming_pool_id: "fixture-pool" };
    if (route === "/pools/my-pools") return [{ id: "fixture-pool", name: "테스트 수영장" }];
    if (route === "/pools/x-mode") return { pool_id: "fixture-pool", mode: "x" };
    throw new Error("Unexpected route");
  });
});
afterEach(() => { cleanup(); delete (window as { officeDesktop?: unknown }).officeDesktop; });
async function start() {
  const view = render(<Router><DesktopApp /></Router>);
  const input = await view.findByPlaceholderText("아이디를 입력하세요") as HTMLInputElement;
  expect(input.matches(":disabled")).toBe(false);
  fireEvent.change(input, { target: { value: "fixture-user" } });
  fireEvent.change(view.getByPlaceholderText("비밀번호"), { target: { value: "synthetic-password" } });
  return view;
}
describe("F03 UI through canonical login/PIN/TOTP (all server calls mocked)", () => {
  it("enables input and defaults remember OFF", async () => {
    publicPost.mockResolvedValue({ success: true, token: "synthetic-final-token" });
    const view = await start();
    expect((view.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.submit(view.container.querySelector("form")!);
    await view.findByRole("heading", { name: "인증 및 OFFICE 접근 권한 확인 완료" });
    expect(bridge.commitSession).toHaveBeenCalledWith({ token: "synthetic-final-token", remember: false });
  });
  it("preserves explicit ON through the PIN step, saves only the final token", async () => {
    publicPost.mockResolvedValueOnce({ success: true, web_pin_required: true, web_session: "synthetic-temporary-session" })
      .mockResolvedValueOnce({ success: true, token: "synthetic-final-token" });
    const view = await start();
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.submit(view.container.querySelector("form")!);
    await view.findByRole("button", { name: "PIN 확인", exact: true });
    expect(bridge.commitSession).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    for (const key of ["1", "2", "3", "4"]) fireEvent.click(view.getByRole("button", { name: key, exact: true }));
    await view.findByRole("heading", { name: "인증 및 OFFICE 접근 권한 확인 완료" });
    expect(publicPost).toHaveBeenNthCalledWith(1, "/auth/login", { email: "fixture-user", password: "synthetic-password", web_login: true });
    expect(publicPost).toHaveBeenNthCalledWith(2, "/auth/web-pin/verify", { web_session: "synthetic-temporary-session", web_pin: "1234" });
    expect(bridge.commitSession).toHaveBeenCalledExactlyOnceWith({ token: "synthetic-final-token", remember: true });
  });
  it("keeps TOTP temporary session in memory and follows verify-login before final storage", async () => {
    publicPost.mockResolvedValueOnce({ success: true, totp_required: true, totp_session: "synthetic-totp-session", token: "must-not-save" })
      .mockResolvedValueOnce({ success: true, token: "synthetic-final-token" });
    const view = await start();
    fireEvent.submit(view.container.querySelector("form")!);
    const otp = await view.findByPlaceholderText("인증 앱의 6자리 코드");
    expect(bridge.commitSession).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    fireEvent.change(otp, { target: { value: "123456" } });
    fireEvent.submit(view.container.querySelector("form")!);
    await view.findByRole("heading", { name: "인증 및 OFFICE 접근 권한 확인 완료" });
    expect(publicPost).toHaveBeenNthCalledWith(2, "/auth/totp/verify-login", { totp_session: "synthetic-totp-session", otp_code: "123456" });
    expect(bridge.commitSession).toHaveBeenCalledExactlyOnceWith({ token: "synthetic-final-token", remember: false });
  });
  it("wrong PIN is shown without automatic retries or final token storage", async () => {
    publicPost.mockResolvedValueOnce({ success: true, web_pin_required: true, web_session: "synthetic-temporary-session" })
      .mockRejectedValueOnce({ status: 401 });
    const view = await start();
    fireEvent.submit(view.container.querySelector("form")!);
    await view.findByRole("button", { name: "PIN 확인", exact: true });
    for (const key of ["1", "2", "3", "4"]) fireEvent.click(view.getByRole("button", { name: key, exact: true }));
    await view.findByText("PIN 번호가 올바르지 않습니다.");
    expect(publicPost).toHaveBeenCalledTimes(2);
    expect(bridge.commitSession).not.toHaveBeenCalled();
  });
  it("wrong TOTP stays at the additional-auth step without saving or automatic retries", async () => {
    publicPost.mockResolvedValueOnce({ success: true, totp_required: true, totp_session: "synthetic-totp-session" })
      .mockRejectedValueOnce({ status: 401 });
    const view = await start();
    fireEvent.submit(view.container.querySelector("form")!);
    const otp = await view.findByPlaceholderText("인증 앱의 6자리 코드");
    fireEvent.change(otp, { target: { value: "123456" } });
    fireEvent.submit(view.container.querySelector("form")!);
    await view.findByText("OTP 코드가 올바르지 않거나 인증 세션이 만료되었습니다.");
    expect((otp as HTMLInputElement).value).toBe("");
    expect(publicPost).toHaveBeenCalledTimes(2);
    expect(bridge.commitSession).not.toHaveBeenCalled();
  });
  it.each([401, 0, 500])("credential failure %s is shown without retries", async status => {
    publicPost.mockRejectedValue({ status });
    const view = await start();
    fireEvent.submit(view.container.querySelector("form")!);
    await view.findByText(status === 401 ? "아이디 또는 비밀번호가 올바르지 않습니다." :
      status === 0 ? "서버에 연결할 수 없습니다. 네트워크를 확인해주세요." : "로그인 중 오류가 발생했습니다.");
    expect(publicPost).toHaveBeenCalledTimes(1);
    expect(bridge.commitSession).not.toHaveBeenCalled();
  });
  it("logout clears the account and next login defaults OFF with no old identity", async () => {
    publicPost.mockResolvedValue({ success: true, token: "synthetic-final-token" });
    const view = await start();
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.submit(view.container.querySelector("form")!);
    fireEvent.click(await view.findByRole("button", { name: "로그아웃 / 다른 계정으로 로그인" }));
    const input = await view.findByPlaceholderText("아이디를 입력하세요") as HTMLInputElement;
    expect(input.value).toBe("");
    expect((view.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(view.queryByText(/테스트 수영장/)).toBeNull());
  });
});
