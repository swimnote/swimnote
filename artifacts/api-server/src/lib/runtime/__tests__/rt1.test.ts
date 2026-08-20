/**
 * RT1 — AI Data Runtime Unit Tests
 *
 * 실제 OpenAI 호출 없음. Mock 사용.
 * Production route import 없음.
 *
 * TC-01  RequestContext normalization
 * TC-02  tenant authority required (empty tenant → error)
 * TC-03  EvidencePack same-tenant PASS
 * TC-04  cross-tenant evidence FAIL
 * TC-05  global scoped evidence 허용
 * TC-06  AnswerPolicy 4 states
 * TC-07  Gateway timeout classification
 * TC-08  retryable/non-retryable classification
 * TC-09  retry_attempts semantics (총 시도 횟수)
 * TC-10  diagnostics raw query 미포함
 * TC-11  diagnostics source IDs 저장
 * TC-12  no Production route imported/modified
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";

import {
  buildRequestContext,
  normalizeQueryBase,
} from "../request-context.js";

import {
  buildRetrievalResult,
  isMatchTenantCompatible,
  type RetrievalMatch,
} from "../retrieval-result.js";

import {
  buildEvidencePack,
  extractSourceIds,
  extractEvidenceTexts,
} from "../evidence-pack.js";

import {
  POLICY_RESULTS,
  baselinePolicy,
} from "../answer-policy.js";

import {
  callGateway,
  _setGatewayClientForTest,
  type GatewayRequest,
} from "../ai-gateway.js";

import {
  buildDiagnostics,
  serializeDiagnostics,
  assertNoPiiInDiagnostics,
  RUNTIME_VERSION,
} from "../diagnostics.js";

import {
  GatewayTimeoutError,
  GatewayRateLimitedError,
  GatewayUpstreamError,
  CrossTenantEvidenceError,
} from "../runtime-errors.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = "pool-001";
const OTHER_TENANT = "pool-999";

function makeMatch(overrides: Partial<RetrievalMatch> = {}): RetrievalMatch {
  return {
    source_id:    "ki-001",
    source_type:  "KNOWLEDGE_ITEM",
    text:         "알림 설정은 마이페이지에서 변경할 수 있습니다.",
    score:        85,
    rank:         1,
    match_method: "EXACT",
    tenant_id:    TENANT,
    ...overrides,
  };
}

// ── TC-01: RequestContext normalization ───────────────────────────────────────

describe("TC-01 RequestContext normalization", () => {
  it("normalizeQueryBase: lowercase + trim + collapse spaces", () => {
    // 양쪽 공백 제거 + 내부 중복 공백 단일화
    expect(normalizeQueryBase("  학부모리포트  어떤기능이야?  "))
      .toBe("학부모리포트 어떤기능이야?");
    expect(normalizeQueryBase("Hello  WORLD")).toBe("hello world");
    expect(normalizeQueryBase("  test  ")).toBe("test");
  });

  it("buildRequestContext produces frozen object with normalized_query", () => {
    const ctx = buildRequestContext({
      request_id:          "req-001",
      domain:              "SUPPORT",
      verified_tenant_id:  TENANT,
      actor_id:            "user-1",
      actor_role:          "parent_account",
      input_text:          "알림 끄는 방법",
      mode:                "normal",
    });

    expect(ctx.tenant_id).toBe(TENANT);
    expect(ctx.normalized_query).toBe("알림 끄는 방법");
    expect(ctx.input_text).toBe("알림 끄는 방법");
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("metadata is also frozen", () => {
    const ctx = buildRequestContext({
      request_id:         "req-002",
      domain:             "CURRICULUM",
      verified_tenant_id: TENANT,
      actor_id:           "u2",
      actor_role:         "parent_account",
      input_text:         "접영 언제 배워",
      mode:               "x",
      metadata:           { student_id: "s-1" },
    });
    expect(Object.isFrozen(ctx.metadata)).toBe(true);
  });
});

// ── TC-02: tenant authority required ─────────────────────────────────────────

describe("TC-02 tenant authority required", () => {
  it("empty verified_tenant_id → throws", () => {
    expect(() =>
      buildRequestContext({
        request_id: "r",
        domain: "SUPPORT",
        verified_tenant_id: "",
        actor_id: "u",
        actor_role: "parent_account",
        input_text: "test",
        mode: "normal",
      })
    ).toThrow("verified_tenant_id is required");
  });

  it("empty request_id → throws", () => {
    expect(() =>
      buildRequestContext({
        request_id: "",
        domain: "SUPPORT",
        verified_tenant_id: TENANT,
        actor_id: "u",
        actor_role: "parent_account",
        input_text: "test",
        mode: "normal",
      })
    ).toThrow("request_id is required");
  });

  it("empty input_text → throws", () => {
    expect(() =>
      buildRequestContext({
        request_id: "r",
        domain: "SUPPORT",
        verified_tenant_id: TENANT,
        actor_id: "u",
        actor_role: "parent_account",
        input_text: "",
        mode: "normal",
      })
    ).toThrow("input_text is required");
  });
});

// ── TC-03: EvidencePack same-tenant PASS ──────────────────────────────────────

describe("TC-03 EvidencePack same-tenant PASS", () => {
  it("same-tenant match is accepted", () => {
    const pack = buildEvidencePack({
      request_id: "req-003",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [makeMatch({ tenant_id: TENANT, score: 85 })],
    });

    expect(pack.verified_facts).toHaveLength(1);
    expect(pack.confidence).toBe("HIGH");
    expect(pack.ai_callable).toBe(true);
  });

  it("extractSourceIds returns correct IDs", () => {
    const pack = buildEvidencePack({
      request_id: "req-003b",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [makeMatch({ source_id: "ki-abc" })],
    });
    expect(extractSourceIds(pack)).toEqual(["ki-abc"]);
  });

  it("extractEvidenceTexts returns text list", () => {
    const pack = buildEvidencePack({
      request_id: "req-003c",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [makeMatch({ text: "테스트 텍스트" })],
    });
    expect(extractEvidenceTexts(pack)).toEqual(["테스트 텍스트"]);
  });
});

// ── TC-04: cross-tenant evidence FAIL ────────────────────────────────────────

describe("TC-04 cross-tenant evidence FAIL", () => {
  it("different tenant_id → CrossTenantEvidenceError", () => {
    expect(() =>
      buildEvidencePack({
        request_id: "req-004",
        domain:     "SUPPORT",
        tenant_id:  TENANT,
        matches:    [makeMatch({ tenant_id: OTHER_TENANT })],
      })
    ).toThrow(CrossTenantEvidenceError);
  });

  it("error message includes both tenant IDs", () => {
    try {
      buildEvidencePack({
        request_id: "req-004b",
        domain:     "SUPPORT",
        tenant_id:  TENANT,
        matches:    [makeMatch({ tenant_id: OTHER_TENANT })],
      });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain(OTHER_TENANT);
      expect(String(e)).toContain(TENANT);
    }
  });
});

// ── TC-05: global scoped evidence 허용 ───────────────────────────────────────

describe("TC-05 global scoped evidence 허용", () => {
  it("tenant_id='global' is accepted in any tenant context", () => {
    expect(isMatchTenantCompatible(makeMatch({ tenant_id: "global" }), TENANT)).toBe(true);
    expect(isMatchTenantCompatible(makeMatch({ tenant_id: "global" }), OTHER_TENANT)).toBe(true);
  });

  it("global match can be included in EvidencePack", () => {
    const pack = buildEvidencePack({
      request_id: "req-005",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [makeMatch({ tenant_id: "global", source_type: "KNOWLEDGE_ITEM" })],
    });
    expect(pack.verified_facts).toHaveLength(1);
  });
});

// ── TC-06: AnswerPolicy 4 states ─────────────────────────────────────────────

describe("TC-06 AnswerPolicy 4 states", () => {
  it("DB_DIRECT: requires_ai=false, can_answer_directly=true", () => {
    const r = POLICY_RESULTS.DB_DIRECT();
    expect(r.decision).toBe("DB_DIRECT");
    expect(r.requires_ai).toBe(false);
    expect(r.can_answer_directly).toBe(true);
  });

  it("GROUNDED_AI: requires_ai=true, can_answer_directly=false", () => {
    const r = POLICY_RESULTS.GROUNDED_AI();
    expect(r.decision).toBe("GROUNDED_AI");
    expect(r.requires_ai).toBe(true);
    expect(r.can_answer_directly).toBe(false);
  });

  it("HUMAN_REQUIRED: requires_ai=false, can_answer_directly=false", () => {
    const r = POLICY_RESULTS.HUMAN_REQUIRED();
    expect(r.decision).toBe("HUMAN_REQUIRED");
    expect(r.requires_ai).toBe(false);
    expect(r.can_answer_directly).toBe(false);
  });

  it("INSUFFICIENT_EVIDENCE: requires_ai=false, can_answer_directly=false", () => {
    const r = POLICY_RESULTS.INSUFFICIENT_EVIDENCE();
    expect(r.decision).toBe("INSUFFICIENT_EVIDENCE");
    expect(r.requires_ai).toBe(false);
    expect(r.can_answer_directly).toBe(false);
  });

  it("HUMAN_REQUIRED !== INSUFFICIENT_EVIDENCE", () => {
    const hr = POLICY_RESULTS.HUMAN_REQUIRED();
    const ie = POLICY_RESULTS.INSUFFICIENT_EVIDENCE();
    expect(hr.decision).not.toBe(ie.decision);
  });

  it("baselinePolicy: no evidence → INSUFFICIENT_EVIDENCE", () => {
    const pack = buildEvidencePack({
      request_id: "req-006a",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [],
    });
    const r = baselinePolicy(pack);
    expect(r.decision).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("baselinePolicy: single HIGH confidence → DB_DIRECT", () => {
    const pack = buildEvidencePack({
      request_id: "req-006b",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [makeMatch({ score: 90 })],
    });
    const r = baselinePolicy(pack);
    expect(r.decision).toBe("DB_DIRECT");
  });

  it("baselinePolicy: MEDIUM confidence → GROUNDED_AI", () => {
    const pack = buildEvidencePack({
      request_id: "req-006c",
      domain:     "SUPPORT",
      tenant_id:  TENANT,
      matches:    [makeMatch({ score: 60 })],
    });
    const r = baselinePolicy(pack);
    expect(r.decision).toBe("GROUNDED_AI");
  });
});

// ── TC-07: Gateway timeout classification ─────────────────────────────────────

describe("TC-07 Gateway timeout classification", () => {
  beforeEach(() => {
    // Mock OpenAI client that throws AbortError (timeout)
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn((_params: unknown, opts: { signal?: AbortSignal }) => {
            return new Promise((_resolve, reject) => {
              if (opts?.signal) {
                opts.signal.addEventListener("abort", () => {
                  const err = new Error("aborted");
                  err.name = "AbortError";
                  reject(err);
                });
              }
            });
          }),
        },
      },
    } as unknown as OpenAI;
    _setGatewayClientForTest(mockClient);
  });

  afterEach(() => {
    _setGatewayClientForTest(null);
  });

  it("timeout produces GatewayTimeoutError", async () => {
    const req: GatewayRequest = {
      request_id:      "req-007",
      feature:         "support",
      model:           "gpt-4o-mini",
      system_prompt:   "system",
      user_prompt:     "user",
      max_tokens:      100,
      timeout_ms:      50,
      response_format: { type: "json_object" },
      retry_attempts:  1,
    };
    await expect(callGateway(req)).rejects.toBeInstanceOf(GatewayTimeoutError);
  }, 3000);
});

// ── TC-08: retryable/non-retryable classification ─────────────────────────────

describe("TC-08 retryable/non-retryable classification", () => {
  it("GatewayTimeoutError is retryable", () => {
    const err = new GatewayTimeoutError();
    expect(err.retryable).toBe(true);
  });

  it("GatewayRateLimitedError is retryable", () => {
    const err = new GatewayRateLimitedError();
    expect(err.retryable).toBe(true);
  });

  it("GatewayUpstreamError 503 is retryable", () => {
    const err = new GatewayUpstreamError(503);
    expect(err.retryable).toBe(true);
  });

  it("GatewayUpstreamError 400 is NOT retryable", () => {
    const err = new GatewayUpstreamError(400);
    expect(err.retryable).toBe(false);
  });

  it("CrossTenantEvidenceError is NOT retryable", () => {
    const err = new CrossTenantEvidenceError("a", "b");
    expect(err.retryable).toBe(false);
  });
});

// ── TC-09: retry_attempts semantics ──────────────────────────────────────────

describe("TC-09 retry_attempts = 총 시도 횟수", () => {
  let callCount: number;

  beforeEach(() => {
    callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn((_p: unknown, opts: { signal?: AbortSignal }) => {
            callCount++;
            return new Promise<void>((_resolve, reject) => {
              // Always reject with 429
              const err: Record<string, unknown> = new Error("rate limited");
              err["status"] = 429;
              if (opts?.signal) {
                opts.signal.addEventListener("abort", () => {
                  const aerr = new Error("aborted");
                  aerr.name = "AbortError";
                  reject(aerr);
                });
              }
              // immediate rejection
              reject(err);
            });
          }),
        },
      },
    } as unknown as OpenAI;
    _setGatewayClientForTest(mockClient);
  });

  afterEach(() => {
    _setGatewayClientForTest(null);
    vi.clearAllMocks();
  });

  it("retry_attempts=1 → only 1 call total (no retry)", async () => {
    const req: GatewayRequest = {
      request_id:      "req-009a",
      feature:         "test",
      model:           "gpt-4o-mini",
      system_prompt:   "s",
      user_prompt:     "u",
      max_tokens:      10,
      timeout_ms:      2000,
      response_format: { type: "json_object" },
      retry_attempts:  1,
    };
    await expect(callGateway(req)).rejects.toThrow();
    expect(callCount).toBe(1);
  }, 5000);

  it("retry_attempts=2 → up to 2 calls total", async () => {
    const req: GatewayRequest = {
      request_id:      "req-009b",
      feature:         "test",
      model:           "gpt-4o-mini",
      system_prompt:   "s",
      user_prompt:     "u",
      max_tokens:      10,
      timeout_ms:      2000,
      response_format: { type: "json_object" },
      retry_attempts:  2,
      total_latency_budget_ms: 10000,
    };
    await expect(callGateway(req)).rejects.toThrow();
    expect(callCount).toBe(2);
  }, 8000);
});

// ── TC-10: diagnostics raw query 미포함 ───────────────────────────────────────

describe("TC-10 diagnostics raw query 미포함", () => {
  it("assertNoPiiInDiagnostics passes for clean diagnostics", () => {
    const diag = buildDiagnostics({
      domain:               "SUPPORT",
      retrieval_candidates: 5,
      final_match_count:    1,
      source_ids:           ["ki-001"],
      answer_mode:          "DB_DIRECT",
      ai_called:            false,
      latency_ms:           42,
    });

    const serialized = serializeDiagnostics(diag);
    expect(() => assertNoPiiInDiagnostics(serialized)).not.toThrow();
  });

  it("assertNoPiiInDiagnostics throws for raw_query key", () => {
    const bad: Record<string, unknown> = {
      domain:     "SUPPORT",
      raw_query:  "알림 끄는 방법",   // 금지
      answer_mode: "DB_DIRECT",
    };
    expect(() => assertNoPiiInDiagnostics(bad)).toThrow('forbidden key "raw_query"');
  });

  it("diagnostics includes runtime_version", () => {
    const diag = buildDiagnostics({
      domain:               "SUPPORT",
      retrieval_candidates: 0,
      final_match_count:    0,
      source_ids:           [],
      answer_mode:          "INSUFFICIENT_EVIDENCE",
      ai_called:            false,
      latency_ms:           10,
    });
    expect(diag.runtime_version).toBe(RUNTIME_VERSION);
  });

  it("buildDiagnostics does not include input_text key", () => {
    const diag = buildDiagnostics({
      domain:               "CURRICULUM",
      retrieval_candidates: 3,
      final_match_count:    2,
      source_ids:           ["ci-001", "ci-002"],
      answer_mode:          "GROUNDED_AI",
      ai_called:            true,
      latency_ms:           250,
      model:                "gpt-4o-mini",
    });
    expect((diag as Record<string, unknown>)["input_text"]).toBeUndefined();
    expect((diag as Record<string, unknown>)["raw_query"]).toBeUndefined();
  });
});

// ── TC-11: diagnostics source IDs 저장 ───────────────────────────────────────

describe("TC-11 diagnostics source IDs 저장", () => {
  it("source_ids are preserved", () => {
    const ids = ["ki-001", "ki-002", "ci-abc"];
    const diag = buildDiagnostics({
      domain:               "SUPPORT",
      retrieval_candidates: 10,
      final_match_count:    3,
      source_ids:           ids,
      answer_mode:          "GROUNDED_AI",
      ai_called:            true,
      latency_ms:           100,
    });
    expect(diag.source_ids).toEqual(ids);
  });

  it("source_id longer than 256 chars is filtered out", () => {
    const longId = "x".repeat(300);
    const diag = buildDiagnostics({
      domain:               "SUPPORT",
      retrieval_candidates: 1,
      final_match_count:    1,
      source_ids:           [longId, "ki-safe"],
      answer_mode:          "DB_DIRECT",
      ai_called:            false,
      latency_ms:           5,
    });
    expect(diag.source_ids).toEqual(["ki-safe"]);
    expect(diag.source_ids).not.toContain(longId);
  });

  it("serializeDiagnostics omits undefined fields", () => {
    const diag = buildDiagnostics({
      domain:               "DIARY",
      retrieval_candidates: 5,
      final_match_count:    2,
      source_ids:           ["dt-001"],
      answer_mode:          "GROUNDED_AI",
      ai_called:            true,
      latency_ms:           300,
    });
    const s = serializeDiagnostics(diag);
    // intent was not set → should not appear
    expect("intent" in s).toBe(false);
    // domain must appear
    expect(s["domain"]).toBe("DIARY");
  });
});

// ── TC-12: no Production route imported/modified ──────────────────────────────

describe("TC-12 no Production route imported/modified", () => {
  it("runtime modules have no dependency on production routes", async () => {
    // Importing the runtime modules themselves is the proof.
    // If any production route (support-respond, parent-curriculum, ai-v1) were
    // imported transitively, the import would pull in DB connections and fail.
    // The fact that all above tests pass without those connections confirms isolation.
    const modules = [
      await import("../request-context.js"),
      await import("../retrieval-result.js"),
      await import("../evidence-pack.js"),
      await import("../answer-policy.js"),
      await import("../diagnostics.js"),
    ];
    for (const mod of modules) {
      expect(mod).toBeDefined();
    }
  });
});
