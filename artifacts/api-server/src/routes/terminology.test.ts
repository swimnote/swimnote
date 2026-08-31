/**
 * terminology.test.ts — Terminology Gateway Route Tests (route layer)
 *
 * TERM-GW-01  auth 없음 → 401
 * TERM-GW-02  search → 200 results
 * TERM-GW-03  empty q → 200 empty (no engine call)
 * TERM-GW-04  detail → 200
 * TERM-GW-05  unknown termId → 404 TERM_NOT_FOUND
 * TERM-GW-06  status → 200 ok + mock_mode
 * TERM-GW-07  search engine unavailable → 503
 * TERM-GW-08  detail engine unavailable → 503
 * TERM-GW-09  engine timeout → 503
 * TERM-GW-10  search result required fields present
 * TERM-GW-11  detail segments — no start/end offset fields
 * TERM-GW-12  limit param clamps to 100
 * TERM-GW-13  APP does not reorder ENGINE results
 * TERM-GW-F   ENGINE returns 0 results → 200 empty (not error)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const mockSearch      = vi.hoisted(() => vi.fn());
const mockDetail      = vi.hoisted(() => vi.fn());
const mockIsMockMode  = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());

const mockPingEngine = vi.hoisted(() => vi.fn());

vi.mock("../lib/terminology-engine-client.js", () => ({
  searchTerminology:     mockSearch,
  getTermDetail:         mockDetail,
  isTerminologyMockMode: mockIsMockMode,
  pingEngine:            mockPingEngine,
  TerminologyEngineError: class TerminologyEngineError extends Error {
    constructor(
      public errorCode: string,
      public statusCode: number,
      message: string,
    ) {
      super(message);
      this.name = "TerminologyEngineError";
    }
  },
}));

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: mockRequireAuth,
}));

import express from "express";
import request from "supertest";
import terminologyRouter from "./terminology.js";

// ── helpers ────────────────────────────────────────────────────────────────────

const SAMPLE_RESULT = {
  term_id:           "TERM-000001",
  canonical_name_ko: "스트림라인",
  canonical_name_en: "Streamline",
  aliases:           ["유선형 자세"],
  summary:           "물속에서 저항을 최소화하는 자세.",
};

const SAMPLE_DETAIL = {
  term_id:           "TERM-000001",
  canonical_name_ko: "스트림라인",
  canonical_name_en: "Streamline",
  aliases:           ["유선형 자세"],
  summary:           "물속에서 저항을 최소화하는 자세.",
  sections: [
    {
      type: "detail",
      label: "자세히 알아보기",
      segments: [
        { text: "벽을 차고 " },
        { text: "글라이드", link: { term_id: "TERM-000002" } },
        { text: "와 연결됩니다." },
      ],
    },
  ],
  related_terms: [{ term_id: "TERM-000002", canonical_name_ko: "글라이드" }],
  terminology_version: "mock-v1",
};

function makeApp(authed = true) {
  const app = express();
  app.use(express.json());
  mockRequireAuth.mockImplementation(
    authed
      ? (req: any, _res: any, next: any) => {
          req.user = { userId: "u1", role: "parent_account" };
          next();
        }
      : (_req: any, res: any) => res.status(401).json({ error: "UNAUTHORIZED" }),
  );
  app.use("/", terminologyRouter);
  return app;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("Terminology Gateway — routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMockMode.mockReturnValue(false);
    mockPingEngine.mockResolvedValue({ status: 401 });
  });

  it("TERM-GW-01: no auth → 401", async () => {
    const res = await request(makeApp(false)).get("/terminology/search?q=스트림라인");
    expect(res.status).toBe(401);
  });

  it("TERM-GW-02: search → 200 results", async () => {
    mockSearch.mockResolvedValueOnce({ results: [SAMPLE_RESULT], terminology_version: "v1", total: 1 });
    const res = await request(makeApp()).get("/terminology/search?q=스트림라인");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].term_id).toBe("TERM-000001");
    expect(mockSearch).toHaveBeenCalledWith("스트림라인", 30);
  });

  it("TERM-GW-03: empty q → 200 empty (no engine call)", async () => {
    const res = await request(makeApp()).get("/terminology/search?q=");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("TERM-GW-04: detail → 200", async () => {
    mockDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    const res = await request(makeApp()).get("/terminology/terms/TERM-000001");
    expect(res.status).toBe(200);
    expect(res.body.term_id).toBe("TERM-000001");
  });

  it("TERM-GW-05: unknown termId → 404 TERM_NOT_FOUND", async () => {
    mockDetail.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get("/terminology/terms/TERM-INVALID");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("TERM_NOT_FOUND");
  });

  it("TERM-GW-06: status → 200 with mock_mode boolean", async () => {
    const res = await request(makeApp()).get("/terminology/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.mock_mode).toBe("boolean");
  });

  it("TERM-GW-07: search engine unavailable → 503", async () => {
    const { TerminologyEngineError } = await import("../lib/terminology-engine-client.js");
    mockSearch.mockRejectedValueOnce(
      new (TerminologyEngineError as any)("ENGINE_UNAVAILABLE", 503, "down"),
    );
    const res = await request(makeApp()).get("/terminology/search?q=테스트");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ENGINE_UNAVAILABLE");
  });

  it("TERM-GW-08: detail engine unavailable → 503", async () => {
    const { TerminologyEngineError } = await import("../lib/terminology-engine-client.js");
    mockDetail.mockRejectedValueOnce(
      new (TerminologyEngineError as any)("ENGINE_UNAVAILABLE", 503, "down"),
    );
    const res = await request(makeApp()).get("/terminology/terms/TERM-000001");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ENGINE_UNAVAILABLE");
  });

  it("TERM-GW-09: engine timeout → 503", async () => {
    const { TerminologyEngineError } = await import("../lib/terminology-engine-client.js");
    mockDetail.mockRejectedValueOnce(
      new (TerminologyEngineError as any)("ENGINE_TIMEOUT", 504, "timeout"),
    );
    const res = await request(makeApp()).get("/terminology/terms/TERM-000001");
    expect(res.status).toBe(503);
  });

  it("TERM-GW-10: search result — required fields present", async () => {
    mockSearch.mockResolvedValueOnce({ results: [SAMPLE_RESULT], terminology_version: "v1", total: 1 });
    const res = await request(makeApp()).get("/terminology/search?q=스트림라인");
    const item = res.body.results[0];
    expect(item).toHaveProperty("term_id");
    expect(item).toHaveProperty("canonical_name_ko");
    expect(item).toHaveProperty("canonical_name_en");
    expect(item).toHaveProperty("aliases");
    expect(item).toHaveProperty("summary");
  });

  it("TERM-GW-11: detail segments — no start/end offset fields", async () => {
    mockDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    const res = await request(makeApp()).get("/terminology/terms/TERM-000001");
    const seg = res.body.sections[0].segments[0];
    expect(typeof seg.text).toBe("string");
    expect(seg).not.toHaveProperty("start");
    expect(seg).not.toHaveProperty("end");
  });

  it("TERM-GW-12: limit param clamps to 100", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], terminology_version: "v1", total: 0 });
    await request(makeApp()).get("/terminology/search?q=test&limit=9999");
    expect(mockSearch.mock.calls[0][1]).toBe(100);
  });

  it("TERM-GW-13: APP does not reorder ENGINE results", async () => {
    const r1 = { ...SAMPLE_RESULT, term_id: "TERM-000001" };
    const r2 = { ...SAMPLE_RESULT, term_id: "TERM-000002", canonical_name_ko: "글라이드" };
    mockSearch.mockResolvedValueOnce({ results: [r1, r2], terminology_version: "v1", total: 2 });
    const res = await request(makeApp()).get("/terminology/search?q=글");
    expect(res.body.results[0].term_id).toBe("TERM-000001");
    expect(res.body.results[1].term_id).toBe("TERM-000002");
  });

  it("TERM-GW-F: ENGINE returns 0 results → 200 empty array (not error)", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], terminology_version: "v1", total: 0 });
    const res = await request(makeApp()).get("/terminology/search?q=없는용어xyz");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.error).toBeUndefined();
  });
});
