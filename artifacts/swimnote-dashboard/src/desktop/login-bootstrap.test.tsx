// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import LoginPage, { LoginForm } from "../pages/LoginPage";

const { publicPost, login } = vi.hoisted(() => ({
  publicPost: vi.fn(), login: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api-client", () => ({ publicPost }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ login }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("existing login reused without enabling F03", () => {
  it("Desktop shows the login form, disables credential entry and blocks submit", () => {
    const view = render(<Router><LoginForm login={login} bootstrapOnly /></Router>);
    const input = view.getByPlaceholderText("아이디를 입력하세요") as HTMLInputElement;
    expect(input.closest("fieldset")?.disabled).toBe(true);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(publicPost).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
  it("Web default entry keeps enabled credentials and original validation", () => {
    const view = render(<Router><LoginPage /></Router>);
    const input = view.getByPlaceholderText("아이디를 입력하세요") as HTMLInputElement;
    expect(input.closest("fieldset")?.disabled).toBe(false);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(view.getByText("아이디는 6자 이상 입력해주세요.")).toBeTruthy();
    expect(publicPost).not.toHaveBeenCalled();
  });
  it("Web successful login still invokes the existing auth callback", async () => {
    publicPost.mockResolvedValueOnce({ success: true, token: "synthetic-web-final-token" });
    const view = render(<Router><LoginPage /></Router>);
    fireEvent.change(view.getByPlaceholderText("아이디를 입력하세요"), { target: { value: "fixture-user" } });
    fireEvent.change(view.getByPlaceholderText("비밀번호"), { target: { value: "synthetic-password" } });
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(login).toHaveBeenCalledExactlyOnceWith("synthetic-web-final-token"));
    expect(publicPost).toHaveBeenCalledWith("/auth/login", { email: "fixture-user", password: "synthetic-password", web_login: true });
    expect(view.queryByRole("checkbox")).toBeNull();
  });
});
