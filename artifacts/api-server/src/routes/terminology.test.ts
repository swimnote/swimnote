/**
 * terminology.test.ts — Terminology Gateway Route Tests
 *
 * TERM-GW-01  GET /terminology/search — auth 없음 → 401
 * TERM-GW-02  GET /terminology/search?q=스트림라인 → 200 results array
 * TERM-GW-03  GET /terminology/search (empty q) → 200 empty results
 * TERM-GW-04  GET /terminology/terms/:termId → 200 detail
 * TERM-GW-05  GET /terminology/terms/TERM-INVALID → 404 TERM_NOT_FOUND
 * TERM-GW-06  GET /terminology/status → 200 ok + mock_mode
 * TERM-GW-07  GET /terminology/search — engine unavailable → 503
 * TERM-GW-08  GET /terminology/terms/:termId — engine unavailable → 503
 * TERM-GW-09  GET /terminology/terms/:termId — engine timeout → 503
 * TERM-GW-10  search results contain required fields
 * TERM-GW-11  detail response contains segments (no offset)
 * TERM-GW-12  limit param clamps to 100
 * TERM-GW-13  APP does not reorder results (ENGINE order preserved)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const mockSearch   = vi.hoisted(() => vi.fn());
const mockDetail   = vi.hoisted(() => vi.fn());
const mockIsMock   = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());

vi.mock("../lib/terminology-engine-client.js", () => ({
  searchTerminology:     mockSearch,
  getTermDetail:         mockDetail,
  isTerminologyMockMode: mockIsMock,
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

// ── import after mocks ─────────────────────────────────────────────────────────

import express from "express";
import request from "supertest";
import terminologyRouter from "./terminology.js";

// ── helpers ────────────────────────────────────────────────────────────────────

const SAMPLE_SEARCH_RESULT = {
  term_id:            "TERM-000001",
  canonical_name_ko:  "스트림라인",
  canonical_name_en:  "Streamline",
  aliases:            ["유선형 자세"],
  summary:            "물속에서 저항을 최소화하는 자세.",
};

const SAMPLE_DETAIL = {
  term_id:            "TERM-000001",
  canonical_name_ko:  "스트림라인",
  canonical_name_en:  "Streamline",
  aliases:            ["유선형 자세"],
  summary:            "물속에서 저항을 최소화하는 자세.",
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
  related_terms: [
    { term_id: "TERM-000002", canonical_name_ko: "글라이드" },
  ],
  terminology_version: "mock-v1",
};

function makeApp(authed = true) {
  const app = express();
  app.use(express.json());

  // requireAuth middleware stub
  mockRequireAuth.mockImplementation(
    authed
      ? (req: any, _res: any, next: any) => {
          req.user = { userId: "u1", role: "parent_account", poolId: "pool1" };
          next();
        }
      : (_req: any, res: any) => {
          res.status(401).json({ error: "UNAUTHORIZED" });
        },
  );

  app.use("/", terminologyRouter);
  return app;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("Terminology Gateway", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMock.mockReturnValue(true);
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("TERM-GW-01: no auth → 401", async () => {
    const app = makeApp(false);
    const res = await request(app).get("/terminology/search?q=스트림라인");
    expect(res.status).toBe(401);
  });

  // ── Search ────────────────────────────────────────────────────────────────

  it("TERM-GW-02: search → 200 with results", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [SAMPLE_SEARCH_RESULT],
      terminology_version: "mock-v1",
      total: 1,
    });
    const app = makeApp();
    const res = await request(app).get("/terminology/search?q=스트림라인");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].term_id).toBe("TERM-000001");
    expect(mockSearch).toHaveBeenCalledWith("스트림라인", 30);
  });

  it("TERM-GW-03: empty q → 200 empty results (no engine call)", async () => {
    const app = makeApp();
    const res = await request(app).get("/terminology/search?q=");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("TERM-GW-10: search result fields — required fields present", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [SAMPLE_SEARCH_RESULT],
      terminology_version: "mock-v1",
      total: 1,
    });
    const app = makeApp();
    const res = await request(app).get("/terminology/search?q=스트림라인");
    const item = res.body.results[0];
    expect(item).toHaveProperty("term_id");
    expect(item).toHaveProperty("canonical_name_ko");
    expect(item).toHaveProperty("canonical_name_en");
    expect(item).toHaveProperty("aliases");
    expect(item).toHaveProperty("summary");
  });

  it("TERM-GW-12: limit param clamps to 100", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], terminology_version: "mock-v1", total: 0 });
    const app = makeApp();
    await request(app).get("/terminology/search?q=test&limit=9999");
    // The route passes min(limitRaw, 100) to searchTerminology
    const callArgs = mockSearch.mock.calls[0];
    expect(callArgs[1]).toBe(100);
  });

  it("TERM-GW-13: APP does not reorder ENGINE results", async () => {
    const r1 = { ...SAMPLE_SEARCH_RESULT, term_id: "TERM-000001" };
    const r2 = { ...SAMPLE_SEARCH_RESULT, term_id: "TERM-000002", canonical_name_ko: "글라이드" };
    mockSearch.mockResolvedValueOnce({ results: [r1, r2], terminology_version: "mock-v1", total: 2 });
    const app = makeApp();
    const res = await request(app).get("/terminology/search?q=글");
    expect(res.body.results[0].term_id).toBe("TERM-000001");
    expect(res.body.results[1].term_id).toBe("TERM-000002");
  });

  // ── Detail ────────────────────────────────────────────────────────────────

  it("TERM-GW-04: detail → 200", async () => {
    mockDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    const app = makeApp();
    const res = await request(app).get("/terminology/terms/TERM-000001");
    expect(res.status).toBe(200);
    expect(res.body.term_id).toBe("TERM-000001");
    expect(mockDetail).toHaveBeenCalledWith("TERM-000001");
  });

  it("TERM-GW-05: unknown termId → 404", async () => {
    mockDetail.mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await request(app).get("/terminology/terms/TERM-INVALID");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("TERM_NOT_FOUND");
  });

  it("TERM-GW-11: detail segments — no offset, only text+link objects", async () => {
    mockDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    const app = makeApp();
    const res = await request(app).get("/terminology/terms/TERM-000001");
    const section = res.body.sections[0];
    expect(section.segments).toBeDefined();
    for (const seg of section.segments) {
      expect(typeof seg.text).toBe("string");
      // No start/end offset fields
      expect(seg).not.toHaveProperty("start");
      expect(seg).not.toHaveProperty("end");
    }
  });

  // ── Status ────────────────────────────────────────────────────────────────

  it("TERM-GW-06: status → 200 with mock_mode", async () => {
    const app = makeApp();
    const res = await request(app).get("/terminology/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.mock_mode).toBe("boolean");
  });

  // ── Engine errors ─────────────────────────────────────────────────────────

  it("TERM-GW-07: search engine unavailable → 503", async () => {
    const { TerminologyEngineError } = await import("../lib/terminology-engine-client.js");
    mockSearch.mockRejectedValueOnce(
      new (TerminologyEngineError as any)("ENGINE_UNAVAILABLE", 503, "down"),
    );
    const app = makeApp();
    const res = await request(app).get("/terminology/search?q=테스트");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ENGINE_UNAVAILABLE");
  });

  it("TERM-GW-08: detail engine unavailable → 503", async () => {
    const { TerminologyEngineError } = await import("../lib/terminology-engine-client.js");
    mockDetail.mockRejectedValueOnce(
      new (TerminologyEngineError as any)("ENGINE_UNAVAILABLE", 503, "down"),
    );
    const app = makeApp();
    const res = await request(app).get("/terminology/terms/TERM-000001");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ENGINE_UNAVAILABLE");
  });

  it("TERM-GW-09: engine timeout → 503", async () => {
    const { TerminologyEngineError } = await import("../lib/terminology-engine-client.js");
    mockDetail.mockRejectedValueOnce(
      new (TerminologyEngineError as any)("ENGINE_TIMEOUT", 504, "timeout"),
    );
    const app = makeApp();
    const res = await request(app).get("/terminology/terms/TERM-000001");
    expect(res.status).toBe(503);
  });

});
