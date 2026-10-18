// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn(), post = vi.fn();
vi.mock("../lib/api-client", () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getBaseUrl: () => "https://x.test/api" } }));

import { buildCommand } from "./office-finance-api";
import { pendingSet, pendingGet, pendingClear, receiptSaved } from "./office-unknown";
import { signaturePath } from "./OfficeIntakePanel";
import { OfficeImportsFinance } from "./OfficeImportsFinance";

beforeEach(() => { get.mockReset(); post.mockReset(); pendingClear(); cleanup(); });

describe("finance command coercion", () => {
  const spec = { key: "receipt.record", label: "x", fields: [{ key: "amountKrw", label: "금액", type: "number" as const }, { key: "note", label: "메모", required: false }] };
  it("coerces integers and rejects decimals", () => {
    expect(buildCommand(spec, "2025-01-02", { amountKrw: "150000" }).command).toEqual({ action: "receipt.record", date: "2025-01-02", amountKrw: 150000 });
    expect(buildCommand(spec, "2025-01-02", { amountKrw: "1.5" }).error).toBeTruthy();
    expect(buildCommand(spec, "2025-01-02", {}).error).toBeTruthy();
  });
});
describe("unknown outcome", () => {
  it("404 receipt does not unlock", async () => {
    pendingSet("u:p|x", { requestId: "r1", body: {}, label: "x" });
    get.mockRejectedValue({ status: 404 });
    expect(await receiptSaved("r1")).toBe(false);
    get.mockResolvedValue({});
    expect(await receiptSaved("r1")).toBe(false);
    expect(pendingGet("u:p|x")).toBeTruthy();
    get.mockResolvedValue({ item: { id: 1 } });
    expect(await receiptSaved("r1")).toBe(true);
    get.mockResolvedValue({ event:{id:"fin_1"},version:1 });
    expect(await receiptSaved("r1")).toBe(true);
    get.mockResolvedValue({ results:[],revision:2,applied:0 });
    expect(await receiptSaved("r1")).toBe(true);
  });
  it("actor change clears other scopes, session-invalid clears all", () => {
    pendingSet("a:1|x", { requestId: "1", body: {}, label: "x" }); pendingSet("b:1|x", { requestId: "2", body: {}, label: "x" });
    pendingClear("b:1");
    expect(pendingGet("a:1|x")).toBeUndefined(); expect(pendingGet("b:1|x")).toBeTruthy();
    window.dispatchEvent(new Event("office:session-invalid"));
    expect(pendingGet("b:1|x")).toBeUndefined();
  });
});
describe("signature path", () => {
  it("starts a new subpath at p[2]===1", () => {
    const d = signaturePath([[0, 0, 1], [5, 5, 0], [20, 20, 1], [25, 25, 0]]).d;
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect((d.match(/L/g) ?? []).length).toBe(2);
  });
});
describe("import finance preview invalidation", () => {
  it("editing a rule discards preview and disables apply", async () => {
    post.mockResolvedValue({ previewHash: "h", ledgerVersion: 1, rows: [], totals: { amountKrw: 0, remainingCount: 0 }, referenceDate: "2025-01-01" });
    const cur = { id: "i1", revision: 3, data: { financeRules: { student_id: "A", kind: "B" } } } as any;
    render(<QueryClientProvider client={new QueryClient()}><OfficeImportsFinance cur={cur} headers={["A", "B", "C"]} scopeKey="u:p" onRevision={() => {}} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("fin-preview"));
    await waitFor(() => screen.getByTestId("fin-preview-result"));
    fireEvent.change(screen.getByTestId("fin-rule-amount_krw"), { target: { value: "C" } });
    expect(screen.queryByTestId("fin-preview-result")).toBeNull();
  });
});
