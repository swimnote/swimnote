import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuperPoolDetailPage from "./SuperPoolDetailPage";

const { api, fixture } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn() },
  fixture: { pool: { id: "A", name: "Fixture", x_plan_key: null as string | null }, active: false },
}));
vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("wouter", () => ({ useRoute: () => [true, { id: "A" }], useLocation: () => ["/super/pools/A", vi.fn()] }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount(existingPlan: string | null = null) {
  fixture.pool.x_plan_key = existingPlan;
  fixture.active = false;
  api.get.mockImplementation(async (url: string) => url.startsWith("/pools/x-mode")
    ? { mode: fixture.active ? "x" : "normal", xmode_entitlement: fixture.active }
    : { pool: { ...fixture.pool } });
  api.patch.mockImplementation(async (_url: string, body: any) => {
    fixture.active = body.xmode_entitlement;
    fixture.pool.x_plan_key = fixture.active ? body.x_plan_key : null;
    return { x_manual_entitlement: fixture.active, action: fixture.active ? "granted" : "revoked" };
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SuperPoolDetailPage />
  </QueryClientProvider>);
}
describe("PC superadmin X grant UI", () => {
  it.each(["x300", "x500", "x1000"])("select %s → canonical ON payload → X visible → OFF payload → normal", async plan => {
    mount();
    await screen.findByText("Fixture");
    await waitFor(() => expect((screen.getByRole("button", { name: "X 부여" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "X 플랜 선택" }), { target: { value: plan } });
    await waitFor(() => expect((screen.getByRole("button", { name: "X 부여" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "X 부여" }));
    await screen.findByText("X 활성");
    expect(api.patch).toHaveBeenCalledWith("/super/operators/A/xmode", { xmode_entitlement: true, x_plan_key: plan });
    fireEvent.click(screen.getByRole("button", { name: "X 해제" }));
    await screen.findByText("일반", { selector: "strong" });
    expect(api.patch).toHaveBeenLastCalledWith("/super/operators/A/xmode", { xmode_entitlement: false });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("preselects the current pool's existing X plan", async () => {
    mount("x500");
    await waitFor(() => expect((screen.getByRole("combobox", { name: "X 플랜 선택" }) as HTMLSelectElement).value).toBe("x500"));
  });
  it("prerequisite rejection is specific and never displays X active", async () => {
    mount();
    await screen.findByText("Fixture");
    api.patch.mockRejectedValue({ status: 422, message: "LOCAL_CURRICULUM_NOT_ACTIVE" });
    fireEvent.change(screen.getByRole("combobox", { name: "X 플랜 선택" }), { target: { value: "x300" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "X 부여" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "X 부여" }));
    expect((await screen.findByRole("alert")).textContent).toBe("활성화된 수영장 커리큘럼이 필요합니다.");
    expect(screen.queryByText("X 활성")).toBeNull();
  });
});
