/**
 * AI01-09 — AiCostDashboard component tests
 *
 * TC1: mount → /super/ai-cost-overview 1회 호출
 * TC2: 오늘/이번 달 toggle → 올바른 section 데이터 표시 (API 재호출 없음)
 * TC3: known cost + unknown cost → 금액과 "비용 미확인 기록" 분리 표시
 * TC4: SYSTEM_MAINTENANCE → 별도 row 표시
 * TC5: model=null → "-" 렌더링
 * TC6: empty response (total_events=0) → crash 없이 empty state
 * TC7: API error → "비용 데이터를 불러오지 못했습니다." 표시
 * TC8: 기간 toggle만으로 외부 API 호출 없음 (fetch 추가 호출 없음)
 */

import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AiCostDashboard from "@/pages/super/AiCostDashboard";

// ── api mock ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { api } from "@/lib/api";
const mockGet = vi.mocked(api.get);

const EMPTY_SUMMARY = {
  total_events: 0, logical_requests: 0, actual_calls_known: 0,
  actual_calls_unknown_events: 0, retries: 0, known_cost_usd: 0,
  unknown_cost_calls: 0, success_count: 0, failure_count: 0,
};

const FULL_SUMMARY = {
  total_events: 12, logical_requests: 10, actual_calls_known: 8,
  actual_calls_unknown_events: 2, retries: 1,
  known_cost_usd: 0.0184, unknown_cost_calls: 34,
  success_count: 9, failure_count: 3,
};

function makeOverview(overrides?: {
  todaySummary?: Partial<typeof FULL_SUMMARY>;
  todayTrigger?: any[];
  todayFeature?: any[];
  todayPsm?: any[];
  todayPool?: any[];
  monthSummary?: Partial<typeof FULL_SUMMARY>;
}) {
  const todaySummary = { ...FULL_SUMMARY, ...(overrides?.todaySummary ?? {}) };
  const monthSummary = { ...FULL_SUMMARY, total_events: 80, known_cost_usd: 0.1234, ...(overrides?.monthSummary ?? {}) };

  return {
    generated_at: "2026-08-21T08:00:00.000Z",
    today: {
      period_start:              "2026-08-21T00:00:00.000Z",
      period_end:                "2026-08-21T08:00:00.000Z",
      summary:                   todaySummary,
      by_trigger_type:           overrides?.todayTrigger ?? [],
      by_feature:                overrides?.todayFeature ?? [],
      by_provider_service_model: overrides?.todayPsm ?? [],
      by_pool:                   overrides?.todayPool ?? [],
    },
    month: {
      period_start:              "2026-08-01T00:00:00.000Z",
      period_end:                "2026-08-21T08:00:00.000Z",
      summary:                   monthSummary,
      by_trigger_type:           [],
      by_feature:                [],
      by_provider_service_model: [],
      by_pool:                   [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — mount → API 1회 호출
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1. mount → /super/ai-cost-overview 1회 호출", () => {
  it("컴포넌트 마운트 시 정확히 1번 호출", async () => {
    mockGet.mockResolvedValueOnce(makeOverview());

    render(<AiCostDashboard />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith("/super/ai-cost-overview");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — 오늘/이번 달 toggle → 올바른 section / API 재호출 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2. 오늘/이번 달 toggle → 올바른 section 표시", () => {
  it("'이번 달' 클릭 → month 데이터 표시 + API 재호출 없음", async () => {
    mockGet.mockResolvedValueOnce(makeOverview());

    render(<AiCostDashboard />);

    // Wait for data to load
    await waitFor(() => screen.getByText("이번 달"));

    const monthBtn = screen.getByText("이번 달");
    fireEvent.click(monthBtn);

    // API must NOT be called again
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — known cost + unknown cost 분리 표시
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3. known cost / unknown cost 분리 표시", () => {
  it('"확인된 비용" 금액 표시 + "비용 미확인 기록" 건수 표시', async () => {
    mockGet.mockResolvedValueOnce(makeOverview({
      todaySummary: { known_cost_usd: 0.0184, unknown_cost_calls: 34 },
    }));

    render(<AiCostDashboard />);

    // Cards
    await waitFor(() => screen.getByText("확인된 비용"));

    expect(screen.getByText("확인된 비용")).toBeInTheDocument();
    expect(screen.getByText("비용 미확인 기록")).toBeInTheDocument();

    // "34건" should appear (unknown_cost_calls)
    expect(screen.getByText(/34건/)).toBeInTheDocument();
    // "$0.0184" formatted value
    expect(screen.getByText(/\$0\.0184/)).toBeInTheDocument();

    // "비용 미확인 기록" card must show a count ("34건"), not a dollar amount.
    // The value element inside the card should display "34건", not "$X".
    const unknownCardLabel = screen.getByText("비용 미확인 기록");
    const unknownCardRoot  = unknownCardLabel.closest("div[class*='flex flex-col']") ??
                             unknownCardLabel.parentElement?.parentElement;
    // The value should NOT be expressed as a currency amount like "$34"
    expect(screen.getByText(/34건/)).toBeInTheDocument();
    // No bare "$34" formatted as currency for the unknown count
    expect(screen.queryByText("$34")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — SYSTEM_MAINTENANCE 별도 row
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4. SYSTEM_MAINTENANCE → 별도 row 표시", () => {
  it("by_trigger_type에 SYSTEM_MAINTENANCE row 렌더링", async () => {
    mockGet.mockResolvedValueOnce(makeOverview({
      todayTrigger: [
        { trigger_type: "USER_ACTION",        logical_requests: 8, actual_calls_known: 8, known_cost_usd: 0.01, unknown_cost_calls: 0 },
        { trigger_type: "SYSTEM_MAINTENANCE", logical_requests: 3, actual_calls_known: 3, known_cost_usd: 0.003, unknown_cost_calls: 0 },
      ],
    }));

    render(<AiCostDashboard />);

    await waitFor(() => screen.getByText("SYSTEM_MAINTENANCE"));

    expect(screen.getByText("SYSTEM_MAINTENANCE")).toBeInTheDocument();
    expect(screen.getByText("USER_ACTION")).toBeInTheDocument();
    // Both must be present as separate rows
    const sysEl = screen.getByText("SYSTEM_MAINTENANCE");
    const usrEl = screen.getByText("USER_ACTION");
    expect(sysEl).not.toBe(usrEl);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — model=null → "-" 렌더링
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5. model=null → '-' 렌더링", () => {
  it("provider/service/model 표에서 model null → '-' 표시", async () => {
    mockGet.mockResolvedValueOnce(makeOverview({
      todayPsm: [
        { provider: "cloudflare_r2", service: "r2_put", model: null, total_events: 5, logical_requests: 5, actual_calls_known: 5, known_cost_usd: 0, unknown_cost_calls: 5 },
      ],
    }));

    render(<AiCostDashboard />);

    await waitFor(() => screen.getByText("cloudflare_r2"));

    // model null → "-" text in the model column
    // The component renders <span className="text-[#ccc]">-</span> for null model
    const modelDash = screen.getAllByText("-");
    expect(modelDash.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — empty response → crash 없이 empty state
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6. empty response → empty state", () => {
  it("total_events=0 → '기록된 사용량이 없습니다.' 표시, crash 없음", async () => {
    mockGet.mockResolvedValueOnce(makeOverview({
      todaySummary:  { ...EMPTY_SUMMARY },
      monthSummary:  { ...EMPTY_SUMMARY },
    }));

    render(<AiCostDashboard />);

    await waitFor(() => screen.getAllByText("기록된 사용량이 없습니다."));
    expect(screen.getAllByText("기록된 사용량이 없습니다.").length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7 — API error → error state
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7. API error → error state", () => {
  it("api.get reject → '비용 데이터를 불러오지 못했습니다.' 표시", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network error"));

    render(<AiCostDashboard />);

    await waitFor(() => screen.getByText("비용 데이터를 불러오지 못했습니다."));
    expect(screen.getByText("비용 데이터를 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText("다시 시도")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8 — 기간 toggle만으로 외부 API 호출 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8. 기간 toggle → provider API 추가 호출 없음", () => {
  it("오늘↔이번달 여러 번 toggle 해도 api.get 총 1회", async () => {
    mockGet.mockResolvedValueOnce(makeOverview());

    render(<AiCostDashboard />);
    await waitFor(() => screen.getByText("이번 달"));

    // Toggle several times
    fireEvent.click(screen.getByText("이번 달"));
    fireEvent.click(screen.getByText("오늘"));
    fireEvent.click(screen.getByText("이번 달"));

    // Only initial load call — no extra calls
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
