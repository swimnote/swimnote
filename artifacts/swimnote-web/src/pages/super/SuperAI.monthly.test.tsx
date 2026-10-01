// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SuperAI from "./SuperAI";

const mocked = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocked }));
vi.mock("@/pages/super/GlobalTemplateSets", () => ({ default: () => null }));
vi.mock("@/pages/super/GrowthReviewStats", () => ({ default: () => null }));
vi.mock("@/pages/super/AiCostDashboard", () => ({ default: () => null }));

describe("monthly growth-report operator controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/super/ai?tab=monthly&report_period=2026-07");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocked.post.mockResolvedValue({ ok: true });
    mocked.get.mockResolvedValue({
      summary: { eligible_total: 2, generated_total: 0, insufficient_evidence_total: 0,
        pool_total: 1, unresolved_pool_total: 1, unresolved_member_total: 2 },
      run: { paused_at: null, circuit_status: "CLOSED", pause_reason: null },
      exceptions: { total: 2, rows: [
        { swimming_pool_id: "local-test-pool", report_id: "failed-test",
          product_status: "FAILED", first_pass_error_category: "ENGINE",
          recovery_allowed: true, first_pass_engine_requests: 1, recovery_engine_requests: 0 },
        { swimming_pool_id: "local-test-pool", report_id: "unknown-test",
          product_status: "PREANALYZING", first_pass_error_category: "UNKNOWN",
          recovery_allowed: false },
      ] },
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens the notified month and requires approval before failed-only recovery", async () => {
    render(<SuperAI />);
    const button = await screen.findByRole("button", { name: "허용된 실패 recovery" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "허용된 실패 recovery" })).toHaveLength(1);
    expect(screen.getByText("HOLD / 재분석 불가")).toBeTruthy();
    expect(screen.getByText(/Provider 실제 비용: UNKNOWN/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "공통 장애 수정 확인" } });
    fireEvent.click(button);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/super/growth-reports/batch-recovery", {
      pool_id: "local-test-pool", report_month: "2026-07", reason: "공통 장애 수정 확인",
    }));
    expect(mocked.get.mock.calls[0][0]).toContain("report_period=2026-07");
    expect(screen.getByText(/학부모 발송은 기존 관리자 절차/)).toBeTruthy();
  });

  it("shows unavailable state instead of pretending a failed read succeeded", async () => {
    mocked.get.mockRejectedValue(new Error("unavailable"));
    render(<SuperAI />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "월간 실행 정보를 불러오지 못했습니다.");
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("does not offer recovery or fabricate a run for old unregistered cycles", async () => {
    mocked.get.mockResolvedValue({ summary: null, run: null, exceptions: { rows: [], total: 0 } });
    render(<SuperAI />);
    expect(await screen.findByText(/등록된 월간 자동화 run이 없습니다/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "허용된 실패 recovery" })).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});