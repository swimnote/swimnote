// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MonthlyRecoveryBatchControls from "./MonthlyRecoveryBatchControls";

function ControlledBatch({ reason: initialReason, ...scope }: Omit<React.ComponentProps<typeof MonthlyRecoveryBatchControls>, "onReasonChange">) {
  const [reason, setReason] = React.useState(initialReason);
  return <MonthlyRecoveryBatchControls {...scope} reason={reason} onReasonChange={setReason} />;
}

const mocked = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocked }));

const preview = {
  report_month: "2026-07", pool_id: null, eligible_total: 1700,
  failed_total: 1600, unknown_total: 100, next_round: 2,
};
const batch = {
  id: "batch-1", report_month: "2026-07", pool_id: null, recovery_round: 2,
  state: "PAUSED", total: 1700, completed: 450, success: 300,
  insufficient_evidence: 50, failed: 40, unknown: 20, conflict: 5, remaining: 1250,
  pause_reason: null,
};

function getResponse(path: string) {
  if (path.includes("/preview?")) return Promise.resolve(preview);
  if (path.includes("/recovery-batches?")) return Promise.resolve({ batches: [] });
  return Promise.reject(new Error(`Unexpected GET ${path}`));
}

describe("monthly recovery batch controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockImplementation(getResponse);
    mocked.post.mockResolvedValue({ batch: { ...batch, state: "RUNNING" }, replayed: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("previews the server cohort, requires selection and confirmation, and reuses the exact request after timeout", async () => {
    let batchListReads = 0;
    mocked.get.mockImplementation(path => {
      if (path.includes("/preview?")) return Promise.resolve(preview);
      batchListReads += 1;
      return Promise.resolve({ batches: batchListReads === 1 ? [] : [{ ...batch, state: "RUNNING" }] });
    });
    let rejectFirst!: (error: Error) => void;
    mocked.post.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ batch: { ...batch, state: "RUNNING" }, replayed: true });
    render(<ControlledBatch reportMonth="2026-07" poolId="" reason="root cause fixed" />);

    expect(await screen.findByText("1,700건")).toBeTruthy();
    expect(mocked.get).toHaveBeenCalledWith("/super/growth-reports/recovery-batches/preview?report_month=2026-07");
    expect(mocked.get).toHaveBeenCalledWith("/super/growth-reports/recovery-batches?report_month=2026-07");
    expect(mocked.post).not.toHaveBeenCalled();
    const create = screen.getByRole("button", { name: "전체 재시도 승인" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "미완료 전체 선택" }));
    expect((screen.getByRole("button", { name: "전체 재시도 승인" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "전체 재시도 승인" }));
    fireEvent.click(screen.getByRole("button", { name: "승인 처리 중..." }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const [url, request] = mocked.post.mock.calls[0];
    expect(url).toBe("/super/growth-reports/recovery-batches");
    expect(request).toMatchObject({
      report_month: "2026-07", reason: "root cause fixed", confirmed: true,
      approval_id: expect.any(String),
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("eligible 대상 1700건"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("유료 분석"));

    rejectFirst(new Error("request timed out"));
    const retry = await screen.findByRole("button", { name: "동일 승인 재시도" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(2));
    expect(mocked.post.mock.calls[1]).toEqual([url, request]);
    expect(await screen.findByText("기존 승인 요청 결과를 재생했습니다.")).toBeTruthy();
    const runningStatus = await screen.findByText("RUNNING");
    const renderedBatch = runningStatus.closest("article");
    expect(renderedBatch?.textContent).toContain("회차 2");
    expect(renderedBatch?.textContent).toContain("전체 1700");
    expect(renderedBatch?.textContent).toContain("완료 450");
    expect(renderedBatch?.textContent).toContain("성공 300");
    expect(batchListReads).toBe(2);
  });

  it("loads persisted progress and resumes a paused batch with the required contract", async () => {
    mocked.get.mockImplementation(path => path.includes("/preview?")
      ? Promise.resolve(preview) : Promise.resolve({ batches: [{ ...batch, pause_reason: "RATE_LIMIT" }] }));
    mocked.post.mockResolvedValue({ batch: { ...batch, pause_reason: "RATE_LIMIT", state: "RUNNING" } });
    render(<ControlledBatch reportMonth="2026-07" poolId="" reason="rate limit cleared" />);
    expect(await screen.findByText("PAUSED")).toBeTruthy();
    for (const count of ["전체 1700", "완료 450", "성공 300", "근거부족 50", "실패 40", "UNKNOWN 20", "충돌 5", "잔여 1250"]) {
      expect(screen.getByText(count)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "이 batch 재개 승인" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(
      "/super/growth-reports/recovery-batches/batch-1/resume",
      { reason: "rate limit cleared", confirmed: true },
    ));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("RATE_LIMIT"));
  });

  it("allows all-month approval alongside another pool's active batch but blocks that pool's own active batch", async () => {
    const otherPoolBatch = { ...batch, id: "other-pool-active", pool_id: "pool-a", state: "RUNNING" };
    mocked.get.mockImplementation(path => path.includes("/preview?")
      ? Promise.resolve(preview) : Promise.resolve({ batches: [otherPoolBatch] }));
    const allPools = render(
      <ControlledBatch reportMonth="2026-07" poolId="" reason="cohort cause fixed" />,
    );
    await screen.findByText("1,700건");
    fireEvent.click(screen.getByRole("button", { name: "미완료 전체 선택" }));
    const allPoolApproval = screen.getByRole("button", { name: "전체 재시도 승인" }) as HTMLButtonElement;
    expect(allPoolApproval.disabled).toBe(false);
    fireEvent.click(allPoolApproval);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(
      "/super/growth-reports/recovery-batches",
      expect.objectContaining({
        report_month: "2026-07", reason: "cohort cause fixed", confirmed: true,
        approval_id: expect.any(String),
      }),
    ));
    allPools.unmount();

    mocked.post.mockClear();
    mocked.get.mockImplementation(path => path.includes("/preview?")
      ? Promise.resolve({ ...preview, pool_id: "pool-a" })
      : Promise.resolve({ batches: [otherPoolBatch] }));
    render(
      <ControlledBatch reportMonth="2026-07" poolId="pool-a" reason="pool cause fixed" />,
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(
      "/super/growth-reports/recovery-batches/preview?report_month=2026-07&pool_id=pool-a",
    ));
    fireEvent.click(screen.getByRole("button", { name: "미완료 전체 선택" }));
    expect((screen.getByRole("button", { name: "전체 재시도 승인" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("reports malformed envelopes instead of inventing preview counts", async () => {
    mocked.get.mockResolvedValue({ summary: { eligible_total: 99 } });
    render(<ControlledBatch reportMonth="2026-07" poolId="" reason="reason" />);
    expect(await screen.findByText(/응답 형식이 올바르지 않습니다/)).toBeTruthy();
    expect(screen.queryByText("99건")).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  describe("September 17-target approval regression", () => {
    const septemberPreview = {
      report_month: "2026-09", pool_id: null, eligible_total: 17,
      failed_total: 0, unknown_total: 17, next_round: 1,
    };
    const septemberBatch = {
      ...batch, report_month: "2026-09", recovery_round: 1, state: "RUNNING",
      total: 17, completed: 0, success: 0, insufficient_evidence: 0,
      failed: 0, unknown: 0, conflict: 0, remaining: 17,
    };
    const approvalButton = () => screen.getByRole("button", { name: "전체 재시도 승인" }) as HTMLButtonElement;
    const reasonInput = () => screen.getByLabelText("원인 수정 및 일괄 재시도 승인 사유");
    async function selectAll(reason = "") {
      render(<ControlledBatch reportMonth="2026-09" poolId="" reason={reason} />);
      await screen.findByText("17건");
      fireEvent.click(screen.getByRole("button", { name: "미완료 전체 선택" }));
    }
    beforeEach(() => {
      mocked.get.mockImplementation(path => path.includes("/preview?")
        ? Promise.resolve(septemberPreview) : Promise.resolve({ batches: [] }));
      mocked.post.mockResolvedValue({ batch: septemberBatch, replayed: false });
    });

    it.each(["", "   ", "\t \n"])("keeps a selected 17-target cohort disabled for blank reason %j with a visible explanation", async reason => {
      await selectAll();
      fireEvent.change(reasonInput(), { target: { value: reason } });
      expect(screen.getByText("서버 cohort 선택: 17건")).toBeTruthy();
      expect(approvalButton().disabled).toBe(true);
      expect(screen.getByText("승인 사유를 입력하면 전체 재시도를 실행할 수 있습니다.")).toBeTruthy();
      expect(mocked.post).not.toHaveBeenCalled();
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it("shows the editable reason inside the blue section and immediately enables approval after input", async () => {
      await selectAll();
      expect(reasonInput().closest("section")?.getAttribute("aria-label")).toBe("월간 전체 recovery batch");
      expect(approvalButton().disabled).toBe(true);
      fireEvent.change(reasonInput(), { target: { value: "원인 수정 확인" } });
      expect(approvalButton().disabled).toBe(false);
      expect(screen.queryByText("승인 사유를 입력하면 전체 재시도를 실행할 수 있습니다.")).toBeNull();
      expect(mocked.post).not.toHaveBeenCalled();
    });

    it("disables approval after deselecting all despite a nonempty reason", async () => {
      await selectAll("원인 수정 확인");
      expect(approvalButton().disabled).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "전체 선택 해제" }));
      expect(approvalButton().disabled).toBe(true);
      expect(screen.getByText("미완료 전체 대상을 선택해 주세요.")).toBeTruthy();
      expect(screen.getByText("서버 cohort 선택: 0건")).toBeTruthy();
      expect(mocked.post).not.toHaveBeenCalled();
    });

    it("disables approval for zero server-eligible targets and explains the blocker", async () => {
      mocked.get.mockImplementation(path => path.includes("/preview?")
        ? Promise.resolve({ ...septemberPreview, eligible_total: 0, unknown_total: 0 })
        : Promise.resolve({ batches: [] }));
      render(<ControlledBatch reportMonth="2026-09" poolId="" reason="원인 수정 확인" />);
      await screen.findByText("서버가 허용한 미완료 recovery 대상이 없습니다.");
      expect(approvalButton().disabled).toBe(true);
      expect((screen.getByRole("button", { name: "미완료 전체 선택" }) as HTMLButtonElement).disabled).toBe(true);
      expect(mocked.post).not.toHaveBeenCalled();
    });

    it("confirms month, 17 targets, round and reason before exactly one bulk POST, and blocks double clicks while submitting", async () => {
      let resolvePost!: (value: unknown) => void;
      mocked.post.mockImplementation(() => new Promise(resolve => { resolvePost = resolve; }));
      await selectAll("  원인 수정 확인  ");
      const approve = approvalButton();
      expect(approve.disabled).toBe(false);
      vi.mocked(window.confirm).mockImplementation(message => {
        expect(mocked.post).not.toHaveBeenCalled();
        expect(message).toContain("2026-09 미완료 17건을 Recovery Round 1로 일괄 재시도 승인하시겠습니까?");
        expect(message).toContain("승인 사유: 원인 수정 확인");
        return true;
      });
      fireEvent.click(approve);
      fireEvent.click(approve);
      expect(mocked.post).toHaveBeenCalledTimes(1);
      expect(mocked.post).toHaveBeenCalledWith("/super/growth-reports/recovery-batches", {
        report_month: "2026-09", reason: "원인 수정 확인", confirmed: true,
        approval_id: expect.any(String),
      });
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect((screen.getByRole("button", { name: "승인 처리 중..." }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText("Recovery batch 생성 중입니다.")).toBeTruthy();
      resolvePost({ batch: septemberBatch, replayed: false });
      await screen.findByText("RUNNING");
      expect(mocked.post).toHaveBeenCalledTimes(1);
    });

    it("never executes on entry, selection, reason input, or a cancelled confirmation", async () => {
      await selectAll();
      fireEvent.change(reasonInput(), { target: { value: "원인 수정 확인" } });
      expect(approvalButton().disabled).toBe(false);
      expect(mocked.post).not.toHaveBeenCalled();
      vi.mocked(window.confirm).mockReturnValue(false);
      fireEvent.click(approvalButton());
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(mocked.post).not.toHaveBeenCalled();
      expect(approvalButton().disabled).toBe(false);
      expect(screen.queryByRole("button", { name: "동일 승인 재시도" })).toBeNull();
    });

    it("displays the actual server read blocker rather than silently disabling the button", async () => {
      mocked.get.mockImplementation(path => path.includes("/preview?")
        ? Promise.reject(new Error("서버 eligibility HOLD: 원본 분석 payload 없음"))
        : Promise.resolve({ batches: [] }));
      render(<ControlledBatch reportMonth="2026-09" poolId="" reason="원인 수정 확인" />);
      await waitFor(() => expect(approvalButton().disabled).toBe(true));
      expect(await screen.findByText("서버 eligibility HOLD: 원본 분석 payload 없음")).toBeTruthy();
      expect(mocked.post).not.toHaveBeenCalled();
    });

    it("explains an active batch blocker, including the persisted server pause reason", async () => {
      mocked.get.mockImplementation(path => path.includes("/preview?")
        ? Promise.resolve(septemberPreview)
        : Promise.resolve({ batches: [{ ...septemberBatch, state: "PAUSED", pause_reason: "RATE_LIMIT" }] }));
      await selectAll("원인 수정 확인");
      expect(approvalButton().disabled).toBe(true);
      expect(screen.getByText("현재 범위에 진행 중인 Recovery batch가 있습니다 (PAUSED). 서버 사유: RATE_LIMIT")).toBeTruthy();
      expect(mocked.post).not.toHaveBeenCalled();
    });
  });
});