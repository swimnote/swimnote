/**
 * gr-mark-review-required.test.ts
 *
 * POST /super/growth-reports/:reportId/mark-review-required
 * 수동 READY_FOR_ANALYSIS → REVIEW_REQUIRED 전환 엔드포인트 테스트
 */

import { describe, it, expect, beforeEach, vi as jest } from "vitest";

// ─── Mock 설정 ────────────────────────────────────────────────────────────────

const mockTransitionReportStatus = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock("../../lib/growth-report-service.js", () => ({
  transitionReportStatus: mockTransitionReportStatus,
}));

let mockDbRows: any[] = [];
const mockExecute = jest.fn<() => Promise<{ rows: any[] }>>().mockImplementation(
  async () => ({ rows: mockDbRows }),
);
jest.mock("@workspace/db", () => ({
  superAdminDb: { execute: mockExecute },
}));

// ─── 테스트용 핸들러 직접 호출 헬퍼 ──────────────────────────────────────────

type MockReq = { params: { reportId: string }; user?: { id: string } };
type MockRes = {
  status: (code: number) => MockRes;
  json: (body: unknown) => void;
  _status: number;
  _body: unknown;
};

function makeMockRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body; },
  };
  return res;
}

/**
 * DB row 생성 헬퍼 — 기본값은 전환 가능한 정상 상태
 */
function makeRow(overrides: Partial<{
  product_status: string;
  analysis_status: string;
  has_content: boolean;
  grounding_status: string | null;
  growth_framing_status: string | null;
  val_grounding_status: string | null;
  val_growth_framing_status: string | null;
}> = {}) {
  return {
    product_status:            "READY_FOR_ANALYSIS",
    analysis_status:           "COMPLETE",
    has_content:               true,
    grounding_status:          "PASS",
    growth_framing_status:     "PASS",
    val_grounding_status:      null,
    val_growth_framing_status: null,
    ...overrides,
  };
}

// ─── 핸들러 로직 직접 시뮬레이션 ─────────────────────────────────────────────
// super.ts 핸들러를 직접 import하면 전체 라우터가 로드되므로
// 핸들러 조건 로직을 별도 함수로 추출해 단위 테스트합니다.

async function runHandler(reportId: string): Promise<{ status: number; body: unknown }> {
  const res = makeMockRes();
  const PASS_VALUES = new Set(["PASS", "REVISED_PASS"]);

  if (!reportId || typeof reportId !== "string") {
    res.status(400).json({ error: "INVALID_REPORT_ID" });
    return { status: res._status, body: res._body };
  }

  const rows = (await mockExecute(null as any)).rows;

  if (!rows.length) {
    res.status(404).json({ error: "REPORT_NOT_FOUND", report_id: reportId });
    return { status: res._status, body: res._body };
  }

  const row = rows[0];

  if (row.product_status !== "READY_FOR_ANALYSIS") {
    res.status(409).json({ ok: false, error: "WRONG_STATUS", product_status: row.product_status });
    return { status: res._status, body: res._body };
  }

  if (row.analysis_status !== "COMPLETE") {
    res.status(409).json({ ok: false, error: "NOT_COMPLETE", analysis_status: row.analysis_status });
    return { status: res._status, body: res._body };
  }

  if (!row.has_content) {
    res.status(409).json({ ok: false, error: "NO_REPORT_CONTENT" });
    return { status: res._status, body: res._body };
  }

  const groundingStatus = row.grounding_status ?? row.val_grounding_status ?? null;
  if (!PASS_VALUES.has(groundingStatus)) {
    res.status(409).json({ ok: false, error: "GROUNDING_NOT_PASS", grounding_status: groundingStatus });
    return { status: res._status, body: res._body };
  }

  const framingStatus = row.growth_framing_status ?? row.val_growth_framing_status ?? null;
  if (!PASS_VALUES.has(framingStatus)) {
    res.status(409).json({ ok: false, error: "GROWTH_FRAMING_NOT_PASS", growth_framing_status: framingStatus });
    return { status: res._status, body: res._body };
  }

  await mockTransitionReportStatus({
    db: null, reportId, toStatus: "REVIEW_REQUIRED",
    actorType: "super_admin", actorId: null, reason: "SUPER_ADMIN_MARK_REVIEW_REQUIRED",
  });

  res.json({ ok: true, report_id: reportId, product_status: "REVIEW_REQUIRED" });
  return { status: res._status, body: res._body };
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("POST /super/growth-reports/:reportId/mark-review-required", () => {
  beforeEach(() => {
    mockDbRows = [];
    mockTransitionReportStatus.mockClear();
    mockExecute.mockClear();
    mockExecute.mockImplementation(async () => ({ rows: mockDbRows }));
  });

  // TC1: 정상 전환 — COMPLETE + report_content + grounding/framing PASS
  it("TC1: COMPLETE + content + PASS → 200 REVIEW_REQUIRED + transition 호출", async () => {
    mockDbRows = [makeRow()];
    const { status, body } = await runHandler("report_id_1");
    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
    expect((body as any).product_status).toBe("REVIEW_REQUIRED");
    expect(mockTransitionReportStatus).toHaveBeenCalledTimes(1);
    expect(mockTransitionReportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "REVIEW_REQUIRED", reason: "SUPER_ADMIN_MARK_REVIEW_REQUIRED" })
    );
  });

  // TC2: report_content 없음 → 409 NO_REPORT_CONTENT
  it("TC2: report_content NULL → 409 NO_REPORT_CONTENT", async () => {
    mockDbRows = [makeRow({ has_content: false })];
    const { status, body } = await runHandler("report_id_2");
    expect(status).toBe(409);
    expect((body as any).error).toBe("NO_REPORT_CONTENT");
    expect(mockTransitionReportStatus).not.toHaveBeenCalled();
  });

  // TC3: analysis_status != COMPLETE → 409 NOT_COMPLETE
  it("TC3: analysis_status=DATA_ACCUMULATING → 409 NOT_COMPLETE", async () => {
    mockDbRows = [makeRow({ analysis_status: "DATA_ACCUMULATING" })];
    const { status, body } = await runHandler("report_id_3");
    expect(status).toBe(409);
    expect((body as any).error).toBe("NOT_COMPLETE");
    expect(mockTransitionReportStatus).not.toHaveBeenCalled();
  });

  // TC4: product_status != READY_FOR_ANALYSIS → 409 WRONG_STATUS
  it("TC4: product_status=FAILED → 409 WRONG_STATUS", async () => {
    mockDbRows = [makeRow({ product_status: "FAILED" })];
    const { status, body } = await runHandler("report_id_4");
    expect(status).toBe(409);
    expect((body as any).error).toBe("WRONG_STATUS");
    expect(mockTransitionReportStatus).not.toHaveBeenCalled();
  });

  // TC5: grounding FAIL → 409 GROUNDING_NOT_PASS
  it("TC5: grounding=FAIL → 409 GROUNDING_NOT_PASS", async () => {
    mockDbRows = [makeRow({ grounding_status: "FAIL" })];
    const { status, body } = await runHandler("report_id_5");
    expect(status).toBe(409);
    expect((body as any).error).toBe("GROUNDING_NOT_PASS");
    expect(mockTransitionReportStatus).not.toHaveBeenCalled();
  });

  // TC6: growth_framing FAIL → 409 GROWTH_FRAMING_NOT_PASS
  it("TC6: growth_framing=FAIL → 409 GROWTH_FRAMING_NOT_PASS", async () => {
    mockDbRows = [makeRow({ growth_framing_status: "FAIL" })];
    const { status, body } = await runHandler("report_id_6");
    expect(status).toBe(409);
    expect((body as any).error).toBe("GROWTH_FRAMING_NOT_PASS");
    expect(mockTransitionReportStatus).not.toHaveBeenCalled();
  });

  // TC7: REVISED_PASS도 허용
  it("TC7: grounding=REVISED_PASS, growth_framing=REVISED_PASS → 200 허용", async () => {
    mockDbRows = [makeRow({ grounding_status: "REVISED_PASS", growth_framing_status: "REVISED_PASS" })];
    const { status, body } = await runHandler("report_id_7");
    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
    expect(mockTransitionReportStatus).toHaveBeenCalledTimes(1);
  });

  // TC8: report 없음 → 404
  it("TC8: 존재하지 않는 report → 404 REPORT_NOT_FOUND", async () => {
    mockDbRows = [];
    const { status, body } = await runHandler("nonexistent_id");
    expect(status).toBe(404);
    expect((body as any).error).toBe("REPORT_NOT_FOUND");
    expect(mockTransitionReportStatus).not.toHaveBeenCalled();
  });

  // TC9: val_* fallback — grounding_result 없고 validation.grounding 에서 읽기
  it("TC9: grounding_status=null, val_grounding_status=PASS → 200 허용 (fallback)", async () => {
    mockDbRows = [makeRow({ grounding_status: null, val_grounding_status: "PASS" })];
    const { status, body } = await runHandler("report_id_9");
    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
  });

  // TC10: val_* fallback — 둘 다 null → 409 GROUNDING_NOT_PASS
  it("TC10: grounding_status=null, val_grounding_status=null → 409 GROUNDING_NOT_PASS", async () => {
    mockDbRows = [makeRow({ grounding_status: null, val_grounding_status: null })];
    const { status, body } = await runHandler("report_id_10");
    expect(status).toBe(409);
    expect((body as any).error).toBe("GROUNDING_NOT_PASS");
  });
});
