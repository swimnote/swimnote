// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SuperAI from "./SuperAI";
import SuperGuard from "@/components/super/SuperGuard";

const mocked = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), navigate: vi.fn(),
  user: { role: "super_admin" },
}));
vi.mock("@/lib/api", () => ({ api: mocked }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mocked.user, loading: false }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/super/ai", mocked.navigate],
}));
vi.mock("@/pages/super/GlobalTemplateSets", () => ({ default: () => null }));
vi.mock("@/pages/super/GrowthReviewStats", () => ({ default: () => null }));
vi.mock("@/pages/super/AiCostDashboard", () => ({ default: () => null }));

describe("monthly growth-report operator controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.user = { role: "super_admin" };
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
          recovery_allowed: false, unknown_reissue_allowed: true },
      ] },
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens the notified month and requires approval before failed-only recovery", async () => {
    render(<SuperAI />);
    const button = await screen.findByRole("button", { name: "허용된 실패 recovery" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "허용된 실패 recovery" })).toHaveLength(1);
    expect(screen.queryByText("HOLD / 재분석 불가")).toBeNull();
    expect(screen.getByRole("button", { name: "재분석 승인 대상 선택" })).toBeTruthy();
    expect(screen.getByText(/Provider 실제 비용: UNKNOWN/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "공통 장애 수정 확인" } });
    fireEvent.click(button);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/super/growth-reports/batch-recovery", {
      pool_id: "local-test-pool", report_month: "2026-07", reason: "공통 장애 수정 확인",
    }));
    expect(mocked.get.mock.calls[0][0]).toContain("report_period=2026-07");
    expect(screen.getByText(/학부모 발송은 기존 관리자 절차/)).toBeTruthy();
  });

  it("does not auto-select UNKNOWN rows and requires explicit approval confirmation", async () => {
    render(<SuperAI />);
    const checkbox = await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    const approve = screen.getByRole("button", { name: "재분석 승인" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(mocked.post).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(screen.getByText("선택 1건")).toBeTruthy();
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "원인 수정 완료" } });
    fireEvent.click(approve);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("2026-07 월 UNKNOWN 1건"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("유료 신규 시도"));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("posts only selected IDs through the authenticated API wrapper and displays each returned result", async () => {
    mocked.post.mockResolvedValue({
      results: [
        { report_id: "unknown-test", recovery_operation_id: "operation-existing", new_request_id: "request-existing",
          recovery_generation: 2, state: "COMPLETE" },
        { report_id: "unknown-second", recovery_operation_id: "operation-second", new_request_id: "request-second",
          state: "INSUFFICIENT_EVIDENCE", error_code: "DATA_ACCUMULATING", detail: "not enough evidence" },
      ],
    });
    mocked.get.mockResolvedValue({
      summary: null, run: null,
      exceptions: { total: 2, rows: [
        { swimming_pool_id: "local-test-pool", report_id: "unknown-test",
          first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
        { swimming_pool_id: "local-test-pool", report_id: "unknown-second",
          first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
      ] },
    });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "UNKNOWN unknown-second 선택" }));
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "복구 가능한 입력 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "재분석 승인" }));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/super/growth-reports/unknown-reissue", {
      report_ids: ["unknown-test", "unknown-second"], confirmed: true, reason: "복구 가능한 입력 확인",
    }));
    expect(await screen.findByText(/unknown-test: COMPLETE/)).toBeTruthy();
    expect(screen.getByText(/unknown-second: INSUFFICIENT_EVIDENCE/)).toBeTruthy();
    expect(screen.getByText(/Operation operation-existing/)).toBeTruthy();
    expect(screen.getByText(/Request request-existing/)).toBeTruthy();
    expect(screen.getAllByText(/DATA_ACCUMULATING/)).toHaveLength(2);
    expect(screen.getAllByText(/not enough evidence/)).toHaveLength(2);
  });

  it("excludes generated, insufficient-evidence, excluded, and held rows from selection", async () => {
    mocked.get.mockResolvedValue({
      summary: null, run: null,
      exceptions: { total: 5, rows: [
        { swimming_pool_id: "pool", report_id: "legacy-null-first-pass", analysis_uncertain_at: "2026-07-01T00:00:00Z",
          unknown_reissue_allowed: true },
        { swimming_pool_id: "pool", report_id: "generated", product_status: "GENERATED",
          first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
        { swimming_pool_id: "pool", report_id: "insufficient", product_status: "INSUFFICIENT_EVIDENCE",
          first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
        { swimming_pool_id: "pool", report_id: "excluded", product_status: "EXCLUDED",
          first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
        { swimming_pool_id: "pool", report_id: "held", first_pass_error_category: "UNKNOWN",
          unknown_reissue_allowed: false, unknown_reissue_hold_reason: "original payload unavailable" },
      ] },
    });
    render(<SuperAI />);
    expect(await screen.findByRole("checkbox", { name: "UNKNOWN legacy-null-first-pass 선택" })).toBeTruthy();
    for (const id of ["generated", "insufficient", "excluded", "held"]) {
      expect((screen.getByRole("checkbox", { name: `UNKNOWN ${id} 선택` }) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByRole("checkbox", { name: "UNKNOWN legacy-null-first-pass 선택" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/original payload unavailable/)).toBeTruthy();
  });

  it("guards double clicks and timeout retry reuses the identical report IDs", async () => {
    let rejectFirst!: (error: Error) => void;
    mocked.post.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ results: [{ report_id: "unknown-test", state: "COMPLETE" }] });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }));
    expect(screen.getByText("선택 1건")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "재시도 사유" } });
    const approve = screen.getByRole("button", { name: "재분석 승인" });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(mocked.post).toHaveBeenCalledTimes(1);
    rejectFirst(new Error("request timed out"));
    const retry = await screen.findByRole("button", { name: "동일 승인 상태 확인 / 재시도" });
    expect((screen.getByRole("button", { name: "추가 재분석 승인" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(2));
    expect(mocked.post.mock.calls[0]).toEqual(mocked.post.mock.calls[1]);
    expect(mocked.post.mock.calls[1]).toEqual(["/super/growth-reports/unknown-reissue", {
      report_ids: ["unknown-test"], confirmed: true, reason: "재시도 사유",
    }]);
  });

  it("requires a separately confirmed next-generation approval with current operation IDs", async () => {
    mocked.get.mockResolvedValue({
      summary: null, run: null,
      exceptions: { total: 3, rows: [
        { swimming_pool_id: "pool", report_id: "unknown-next", first_pass_error_category: "UNKNOWN",
          unknown_reissue_allowed: false, unknown_reissue_next_approval_allowed: true,
          unknown_reissue_operation: { report_id: "unknown-next", recovery_operation_id: "latest-operation",
            new_request_id: "latest-request", state: "UNKNOWN" } },
        { swimming_pool_id: "pool", report_id: "unknown-processing", first_pass_error_category: "UNKNOWN",
          unknown_reissue_allowed: true, unknown_reissue_next_approval_allowed: false,
          unknown_reissue_operation: { report_id: "unknown-processing", recovery_operation_id: "processing-operation",
            state: "PROCESSING" } },
        { swimming_pool_id: "pool", report_id: "ordinary-failure", product_status: "FAILED",
          first_pass_error_category: "ENGINE", unknown_reissue_allowed: false },
      ] },
    });
    mocked.post.mockResolvedValue({ results: [{ report_id: "unknown-next", state: "PROCESSING" }] });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-next 선택" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "UNKNOWN unknown-processing 선택" }));
    expect((screen.getByRole("button", { name: "추가 재분석 승인" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "UNKNOWN unknown-processing 선택" }));
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "새 시도 별도 승인 사유" } });
    expect((screen.getByRole("button", { name: "추가 재분석 승인" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "추가 재분석 승인" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("추가 재분석"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("새로운 유료 분석 시도"));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/super/growth-reports/unknown-reissue", {
      report_ids: ["unknown-next"], confirmed: true, reason: "새 시도 별도 승인 사유",
      next_generation: true, expected_operation_ids: { "unknown-next": "latest-operation" },
    }));
  });

  it("clears UNKNOWN selection and results when the reporting filters change", async () => {
    mocked.post.mockResolvedValue({
      results: [{ report_id: "unknown-test", state: "PROCESSING", recovery_operation_id: "op-to-clear" }],
    });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }));
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "확인 사유" } });
    fireEvent.click(screen.getByRole("button", { name: "재분석 승인" }));
    expect(await screen.findByText(/unknown-test: PROCESSING/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("오류 분류"), { target: { value: "UNKNOWN" } });
    await waitFor(() => expect(screen.queryByText(/unknown-test: PROCESSING/)).toBeNull());
    expect(screen.getByText("선택 0건")).toBeTruthy();
    expect(mocked.get).toHaveBeenCalledWith(expect.stringContaining("category=UNKNOWN"));
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

  it("labels persisted operation metadata with its enclosing report without auto-approval", async () => {
    mocked.get.mockResolvedValue({
      summary: null, run: null,
      exceptions: { total: 1, rows: [{
        swimming_pool_id: "pool", report_id: "persisted-report",
        analysis_uncertain_at: "2026-07-01T00:00:00Z", unknown_reissue_allowed: true,
        unknown_reissue_operation: {
          recovery_operation_id: "persisted-operation", new_request_id: "persisted-request",
          recovery_generation: 1, state: "PROCESSING",
        },
      }] },
    });
    render(<SuperAI />);
    expect(await screen.findByText(/persisted-report: PROCESSING/)).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("renders monthly UNKNOWN approval on the actual default AI route without a hidden tab or auto-execution", async () => {
    window.history.replaceState({}, "", "/super/ai");
    render(<SuperGuard allowPlatformAdmin><SuperAI /></SuperGuard>);
    expect(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "재분석 승인" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "월간 성장리포트 / UNKNOWN 재분석" })
      .getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("선택 0건")).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("makes a single pilot selectable from its row and submits once after the confirmation dialog", async () => {
    mocked.post.mockResolvedValue({ results: [{ report_id: "unknown-test", state: "COMPLETE" }] });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("button", { name: "재분석 승인 대상 선택" }));
    expect(screen.getByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }))
      .toHaveProperty("checked", true);
    expect(screen.getByText("선택 1건")).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "파일럿 승인" } });
    fireEvent.click(screen.getByRole("button", { name: "재분석 승인" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("대상 report: unknown-test"));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post).toHaveBeenCalledWith("/super/growth-reports/unknown-reissue", {
      report_ids: ["unknown-test"], confirmed: true, reason: "파일럿 승인",
    });
    expect(await screen.findByText(/unknown-test: COMPLETE/)).toBeTruthy();
  });

  it("displays an executing state until the requested terminal result arrives", async () => {
    let complete!: (result: unknown) => void;
    mocked.post.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }));
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "진행 상태 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "재분석 승인" }));
    expect(screen.getByRole("button", { name: "재분석 승인 처리 중..." })).toHaveProperty("disabled", true);
    complete({ results: [{ report_id: "unknown-test", state: "UNKNOWN" }] });
    expect(await screen.findByText(/unknown-test: UNKNOWN/)).toBeTruthy();
  });

  it.each(["UNKNOWN", "CONFLICT", "FAILED"])("displays %s results instead of reporting success", async state => {
    mocked.post.mockResolvedValue({ results: [{ report_id: "unknown-test", state, error_code: "TEST_ERROR" }] });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }));
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "상태 표시 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "재분석 승인" }));
    expect(await screen.findByText(new RegExp(`unknown-test: ${state}`))).toBeTruthy();
    expect(screen.queryByText(/unknown-test: COMPLETE/)).toBeNull();
  });

  it("blocks completed and PUBLISHED rows even if historical UNKNOWN metadata remains", async () => {
    mocked.get.mockResolvedValue({ summary: null, run: null, exceptions: { total: 2, rows: [
      { swimming_pool_id: "pool", report_id: "published", product_status: "PUBLISHED",
        first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
      { swimming_pool_id: "pool", report_id: "complete", product_status: "REVIEW_REQUIRED", analysis_status: "COMPLETE",
        first_pass_error_category: "UNKNOWN", unknown_reissue_allowed: true },
    ] } });
    render(<SuperAI />);
    for (const id of ["published", "complete"]) {
      expect(await screen.findByRole("checkbox", { name: `UNKNOWN ${id} 선택` })).toHaveProperty("disabled", true);
    }
    expect(screen.queryByRole("button", { name: "재분석 승인 대상 선택" })).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("replays a persisted operation without creating client UUIDs or requesting a new generation", async () => {
    mocked.get.mockResolvedValue({ summary: null, run: null, exceptions: { total: 1, rows: [
      { swimming_pool_id: "pool", report_id: "unknown-test", analysis_uncertain_at: "2026-09-01T00:00:00Z",
        unknown_reissue_allowed: true, unknown_reissue_operation: {
          recovery_operation_id: "stable-op", new_request_id: "stable-request", state: "PROCESSING",
        } },
    ] } });
    mocked.post.mockResolvedValue({ results: [{
      report_id: "unknown-test", recovery_operation_id: "stable-op", new_request_id: "stable-request", state: "PROCESSING",
    }] });
    render(<SuperAI />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" }));
    fireEvent.change(screen.getByLabelText("원인 수정 및 승인 사유"), { target: { value: "기존 승인 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "동일 승인 상태 확인 / 재시도" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0]).toEqual(["/super/growth-reports/unknown-reissue", {
      report_ids: ["unknown-test"], confirmed: true, reason: "기존 승인 확인",
    }]);
    expect(screen.getByText(/Operation stable-op/)).toBeTruthy();
  });

  it.each(["pool_admin", "teacher", "parent", "admin"])("denies %s before fetching or rendering operator controls", role => {
    mocked.user = { role };
    render(<SuperGuard allowPlatformAdmin><SuperAI /></SuperGuard>);
    expect(screen.queryByRole("button", { name: "재분석 승인" })).toBeNull();
    expect(mocked.get).not.toHaveBeenCalled();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("allows an already authenticated platform_admin only with the explicit AI route opt-in", async () => {
    mocked.user = { role: "platform_admin" };
    const page = render(<SuperGuard allowPlatformAdmin><SuperAI /></SuperGuard>);
    expect(await screen.findByRole("checkbox", { name: "UNKNOWN unknown-test 선택" })).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
    page.unmount();
    mocked.get.mockClear();
    render(<SuperGuard><SuperAI /></SuperGuard>);
    expect(mocked.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "재분석 승인" })).toBeNull();
  });

  it("keeps other AI tabs reachable and preserves explicit tab URLs", async () => {
    window.history.replaceState({}, "", "/super/ai?tab=templates");
    render(<SuperAI />);
    expect(screen.queryByRole("button", { name: "재분석 승인" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "월간 성장리포트 / UNKNOWN 재분석" }));
    expect(await screen.findByRole("button", { name: "재분석 승인" })).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("monthly");
    expect(mocked.post).not.toHaveBeenCalled();
  });
});