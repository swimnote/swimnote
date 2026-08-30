/**
 * terminology-engine-client.test.ts — Mock Gate Unit Tests (CASE A-H)
 *
 * Tests the real isMockAllowed / searchTerminology / getTermDetail logic
 * directly without going through the Express route layer.
 *
 * TERM-MOCK-A  test + TERMINOLOGY_USE_MOCK=true → mock data used (no ENGINE call)
 * TERM-MOCK-B  production + ENGINE URL set → isMockAllowed=false
 * TERM-MOCK-C  production + no ENGINE URL → ENGINE_URL_NOT_CONFIGURED
 * TERM-MOCK-D  any env + TERMINOLOGY_USE_MOCK=false + no URL → ENGINE_URL_NOT_CONFIGURED
 * TERM-MOCK-E  production + TERMINOLOGY_USE_MOCK=true → mock BLOCKED (false)
 * TERM-MOCK-F  test + TERMINOLOGY_USE_MOCK=true → getTermDetail returns fixture
 * TERM-MOCK-G  unknown termId in mock mode → returns null (not crash)
 * TERM-MOCK-H  test + no flag + no URL → ENGINE_URL_NOT_CONFIGURED (no auto-mock)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// No vi.mock here — we test the real module functions.
// global.fetch is stubbed for network paths.

describe("terminology-engine-client — mock gate (CASE A-H)", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // snapshot the 3 env vars we'll touch
    originalEnv = {
      NODE_ENV:                       process.env["NODE_ENV"],
      TERMINOLOGY_USE_MOCK:           process.env["TERMINOLOGY_USE_MOCK"],
      PROFESSIONAL_ENGINE_BASE_URL:   process.env["PROFESSIONAL_ENGINE_BASE_URL"],
    };
  });

  afterEach(() => {
    // restore env vars
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  function setEnv(vars: {
    nodeEnv?: string;
    useMock?: string;
    engineUrl?: string;
  }) {
    if (vars.nodeEnv !== undefined) process.env["NODE_ENV"] = vars.nodeEnv;
    if (vars.useMock !== undefined) process.env["TERMINOLOGY_USE_MOCK"] = vars.useMock;
    if (vars.engineUrl !== undefined) process.env["PROFESSIONAL_ENGINE_BASE_URL"] = vars.engineUrl;
  }

  // ── CASE A: test + explicit flag → mock used ────────────────────────────────

  it("TERM-MOCK-A: test + TERMINOLOGY_USE_MOCK=true → mock data returned", async () => {
    setEnv({ nodeEnv: "test", useMock: "true", engineUrl: "" });

    const { isTerminologyMockMode, searchTerminology } =
      await import("./terminology-engine-client.js");

    expect(isTerminologyMockMode()).toBe(true);

    const result = await searchTerminology("스트림라인");
    // fixture contains 스트림라인
    expect(result.terminology_version).toBe("mock-v1");
    expect(result.results.some((r) => r.canonical_name_ko.includes("스트림라인"))).toBe(true);
  });

  // ── CASE B: production + ENGINE URL → isMockAllowed=false ───────────────────

  it("TERM-MOCK-B: production + ENGINE URL set → isTerminologyMockMode=false", async () => {
    setEnv({ nodeEnv: "production", useMock: "false", engineUrl: "https://engine.example.com" });

    const { isTerminologyMockMode } = await import("./terminology-engine-client.js");
    expect(isTerminologyMockMode()).toBe(false);
  });

  // ── CASE C: production + no URL → ENGINE_URL_NOT_CONFIGURED ─────────────────

  it("TERM-MOCK-C: production + no ENGINE URL → ENGINE_URL_NOT_CONFIGURED", async () => {
    setEnv({ nodeEnv: "production", useMock: "false", engineUrl: "" });

    const { searchTerminology } = await import("./terminology-engine-client.js");

    await expect(searchTerminology("테스트")).rejects.toMatchObject({
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
      statusCode: 503,
    });
  });

  // ── CASE D: any env + no flag + no URL → ENGINE_URL_NOT_CONFIGURED ──────────

  it("TERM-MOCK-D: development + flag off + no URL → ENGINE_URL_NOT_CONFIGURED", async () => {
    setEnv({ nodeEnv: "development", useMock: "false", engineUrl: "" });

    const { searchTerminology } = await import("./terminology-engine-client.js");

    await expect(searchTerminology("테스트")).rejects.toMatchObject({
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
    });
  });

  // ── CASE E: production + TERMINOLOGY_USE_MOCK=true → mock BLOCKED ───────────

  it("TERM-MOCK-E: production + TERMINOLOGY_USE_MOCK=true → mock BLOCKED", async () => {
    setEnv({ nodeEnv: "production", useMock: "true", engineUrl: "" });

    const { isTerminologyMockMode, searchTerminology } =
      await import("./terminology-engine-client.js");

    // Flag is set but production → blocked
    expect(isTerminologyMockMode()).toBe(false);

    // Falls through to LIVE PATH — URL missing → ENGINE_URL_NOT_CONFIGURED
    await expect(searchTerminology("테스트")).rejects.toMatchObject({
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
    });
  });

  // ── CASE F: mock mode + getTermDetail returns fixture ───────────────────────

  it("TERM-MOCK-F: test + mock flag → getTermDetail returns fixture", async () => {
    setEnv({ nodeEnv: "test", useMock: "true", engineUrl: "" });

    const { getTermDetail } = await import("./terminology-engine-client.js");

    const detail = await getTermDetail("TERM-000001");
    expect(detail).not.toBeNull();
    expect(detail?.term_id).toBe("TERM-000001");
    expect(detail?.canonical_name_ko).toBe("스트림라인");
    // Sections must have segments (no offset)
    expect(Array.isArray(detail?.sections[0].segments)).toBe(true);
    for (const seg of detail!.sections[0].segments) {
      expect(seg).not.toHaveProperty("start");
      expect(seg).not.toHaveProperty("end");
    }
  });

  // ── CASE G: mock mode + unknown termId → null (no crash) ────────────────────

  it("TERM-MOCK-G: mock mode + unknown termId → null", async () => {
    setEnv({ nodeEnv: "test", useMock: "true", engineUrl: "" });

    const { getTermDetail } = await import("./terminology-engine-client.js");

    const detail = await getTermDetail("TERM-DOES-NOT-EXIST");
    expect(detail).toBeNull();
  });

  // ── CASE H: test + no flag + no URL → ENGINE_URL_NOT_CONFIGURED (no auto-mock) ──

  it("TERM-MOCK-H: test + flag off + no URL → ENGINE_URL_NOT_CONFIGURED (no auto-mock)", async () => {
    setEnv({ nodeEnv: "test", useMock: "false", engineUrl: "" });

    const { searchTerminology, isTerminologyMockMode } =
      await import("./terminology-engine-client.js");

    // Mock NOT enabled even in test env without explicit flag
    expect(isTerminologyMockMode()).toBe(false);

    await expect(searchTerminology("테스트")).rejects.toMatchObject({
      errorCode: "ENGINE_URL_NOT_CONFIGURED",
    });
  });

});
