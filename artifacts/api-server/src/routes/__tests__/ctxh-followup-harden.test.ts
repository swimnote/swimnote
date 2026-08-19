/**
 * ctxh-followup-harden.test.ts — P0-CS09 REAL Follow-up Context Harden
 *
 * CTXH-01  deterministic resolution → resolution_context sub-key in JSONB merge
 * CTXH-02  CS26: NO_MATCH → AI_RESPONDED deterministically (no LLM/evidence path)
 * CTXH-03  CS26: NO_MATCH → no resolution_context UPDATE (not a resolved entity)
 * CTXH-04  no_evidence path → no resolution_context UPDATE
 * CTXH-05  CS26: NO_MATCH path always AI_RESPONDED, no provider error path reachable
 * CTXH-06  previousContext read from resolution_context sub-key (not top-level)
 * CTXH-07  creator Knowledge absent → NO_MATCH → AI_RESPONDED (CS26, no hallucination)
 * CTXH-08  creator Knowledge active → RESOLVED deterministically
 * CTXH-09  session metadata (user_role, app_version) preserved by JSONB merge
 * CTXH-10  different user → 403 (case boundary)
 * CTXH-11  different pool → 403 (pool boundary)
 * CTXH-12  role/mode preserved in augmented chain
 * CTXH-13  evidence=0 → OpenAI.create never invoked
 * CTXH-14  evidence=0 → response llm_used=false, model=null
 * CTXH-15  PreviousResolutionContext interface contains no raw query/answer
 * CTXH-16  §8 referential requirement: "스윔노트 만든사람 누구야" NOT a follow-up signal
 *
 * ─── CS26 CONTRACT ────────────────────────────────────────────────────────────
 * General support/respond no longer automatically calls LLM or transitions to
 * HUMAN_REQUIRED on NO_MATCH. Every NO_MATCH produces an AI_RESPONDED result
 * with a deterministic fallback message. LLM escalation requires the explicit
 * 3-streak CTA → gpt-escalation → unresolved confirmation route.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * + unit tests for deriveEvidenceContext (§6 selection logic)
 * + unit tests for FOLLOWUP_SIGNALS refinement (§8)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ─────────────────────────────────────────────────────────────────

const mockRunResolutionChain   = vi.hoisted(() => vi.fn());
const mockGatherEvidence       = vi.hoisted(() => vi.fn());
const mockDeriveEvidenceContext = vi.hoisted(() => vi.fn());
const mockCreate               = vi.hoisted(() => vi.fn());
const traceCalls               = vi.hoisted(() => [] as any[]);
const flushCalls               = vi.hoisted(() => [] as any[]);

// ── In-memory stores ──────────────────────────────────────────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];
let updateCalls:  string[] = [];          // captured UPDATE support_cases SQL texts

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "Unauthorized" });
    req.user = JSON.parse(req.headers["x-test-user"] as string);
    next();
  },
}));

vi.mock("drizzle-orm", () => {
  function sql(strings: TemplateStringsArray, ...values: any[]) {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
      ""
    );
    return { __raw: false, __text: text, __values: values };
  }
  sql.raw = (t: string, p?: any[]) => ({ __raw: true, __text: t, __values: p ?? [] });
  return { sql };
});

vi.mock("@workspace/db", () => {
  const executeQuery = (q: any): any => {
    const text: string = (q.__text ?? q ?? "").replace(/\s+/g, " ");
    const params: any[] = q.__values ?? [];

    if (text.includes("INSERT INTO event_logs")) return { rows: [] };

    if (text.includes("FROM support_cases")) {
      const id = params[0];
      const found = caseStore.find((c: any) => c.id === id);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("turn_count")) {
      return { rows: [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("state")) {
      return { rows: [] };
    }
    if (text.includes("UPDATE support_cases") && (text.includes("resolution_context") || text.includes("context_json"))) {
      updateCalls.push(text + " | params: " + JSON.stringify(params));
      return { rows: [] };
    }
    if (text.includes("INSERT INTO support_ticket_replies")) {
      const reply: any = {
        id: params[0], ticket_id: params[1], case_id: params[2],
        author_user_id: params[3], author_name: params[4],
        author_role: params[5], message_type: params[6], content: params[7],
      };
      repliesStore.push(reply);
      return { rows: [{ id: reply.id }] };
    }
    return { rows: [] };
  };

  const db = { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) };
  const superAdminDb = { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) };
  return { db, superAdminDb };
});

vi.mock("../../lib/support-case-service.js", () => ({
  transitionSupportCase: vi.fn().mockResolvedValue({ ok: true }),
  logSupportEvent:       vi.fn().mockResolvedValue(undefined),
  ensureCs01rSchema:     vi.fn().mockResolvedValue(undefined),
  SUPPORT_EVENT_TYPE: {
    AI_RESPONDED:    "AI_RESPONDED",
    HUMAN_REQUESTED: "HUMAN_REQUESTED",
    CASE_OPENED:     "CASE_OPENED",
  },
}));

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain:    mockRunResolutionChain,
  gatherEvidence:        mockGatherEvidence,
  deriveEvidenceContext: mockDeriveEvidenceContext,
  tokenize:              vi.fn((s: string) => s.split(/\s+/)),
  normalizeQuery:        vi.fn((s: string) => s.toLowerCase().trim()),
}));

vi.mock("../../lib/ai-trace-service.js", () => ({
  saveAiTrace: vi.fn().mockImplementation(async (t: any) => { traceCalls.push(t); }),
}));

vi.mock("../../lib/ai-feature-enum.js", () => ({
  AI_FEATURE:         { SUPPORT_AI: "SUPPORT_AI" },
  SUPPORT_EVENT_TYPE: {
    AI_RESPONDED:    "AI_RESPONDED",
    HUMAN_REQUESTED: "HUMAN_REQUESTED",
    CASE_OPENED:     "CASE_OPENED",
  },
}));

vi.mock("../ai.js", () => ({
  getOpenAI: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}));

vi.mock("../../lib/support-trace.js", async (importOriginal) => {
  const real = await importOriginal() as any;
  return {
    ...real,
    flushSupportTrace:    vi.fn().mockImplementation(async (ctx: any, params: any) => {
      flushCalls.push({ ctx: JSON.parse(JSON.stringify(ctx)), params });
    }),
    flushInsertFailStage: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const ADMIN_USER  = { userId: "user_admin_01", role: "pool_admin", poolId: "pool_alpha", name: "Admin" };
const OTHER_USER  = { userId: "user_other_99", role: "pool_admin", poolId: "pool_alpha", name: "Other" };
const OTHER_POOL_USER = { userId: "user_admin_01", role: "pool_admin", poolId: "pool_DIFFERENT", name: "Admin" };

function authHeader(user: any) {
  return { "x-test-user": JSON.stringify(user) };
}

function defCase(overrides: Partial<any> = {}) {
  return {
    id:        "sc_ctxh_001",
    state:     "NEW",
    pool_id:   "pool_alpha",
    actor_id:  "user_admin_01",
    ticket_id: null,
    escalation_reason: null,
    context_json: null,
    ...overrides,
  };
}

// resolution results
const DET_RESULT = {
  resolution_status: "RESOLVED" as const,
  source_type:       "FAQ" as const,
  source_id:         "ki_swimnote_intro",
  confidence:        90,
  title:             "스윔노트 소개",
  answer:            "스윔노트는 수영장 운영 플랫폼입니다.",
  llm_required:      false,
  requires_human:    false,
  feature:           "swimnote_intro",
  category:          "product",
  entity_key:        "ki_swimnote_intro",
};

const NO_MATCH_RESULT = {
  resolution_status: "NO_MATCH" as const,
  source_type:       "NONE" as const,
  source_id:         null,
  confidence:        0,
  title:             null,
  answer:            null,
  llm_required:      true,
  requires_human:    true,
};

// ── App setup ─────────────────────────────────────────────────────────────────

let app: express.Express;
beforeEach(async () => {
  caseStore    = [];
  repliesStore = [];
  updateCalls  = [];
  traceCalls.length = 0;
  flushCalls.length = 0;

  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset();
  mockDeriveEvidenceContext.mockReset();
  mockCreate.mockReset();

  const { default: router } = await import("../support-respond.js");
  app = express();
  app.use(express.json());
  app.use("/api", router);
});

const BASE_BODY = { case_id: "sc_ctxh_001", message: "스윔노트 알려줘", mode: "normal" };

// ─────────────────────────────────────────────────────────────────────────────
// CTXH-01: deterministic → JSONB merge with resolution_context sub-key
// ─────────────────────────────────────────────────────────────────────────────

describe("WP-CS09 Harden — Follow-up Context P0", () => {

  it("CTXH-01 deterministic resolution → UPDATE uses JSONB merge (jsonb_build_object + resolution_context)", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(DET_RESULT);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    // At least one UPDATE must reference 'resolution_context' AND jsonb_build_object (JSONB merge pattern)
    const contextUpdate = updateCalls.find(
      (s) => s.includes("resolution_context") && s.includes("jsonb_build_object")
    );
    expect(contextUpdate, "JSONB merge UPDATE for resolution_context should be fired").toBeTruthy();

    // Must NOT be a plain SET context_json = $1 (full overwrite)
    const fullOverwrite = updateCalls.find(
      (s) => s.includes("SET context_json =") && !s.includes("COALESCE") && !s.includes("||")
    );
    expect(fullOverwrite, "Full overwrite of context_json is forbidden").toBeFalsy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-02: CS26 — NO_MATCH → AI_RESPONDED deterministically (no LLM)
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-02 CS26: NO_MATCH → AI_RESPONDED deterministically, no LLM/evidence called", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);

    const res = await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    // CS26: NO_MATCH returns AI_RESPONDED, not HUMAN_REQUIRED
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.requires_human).toBe(false);
    // LLM and evidence gathering are NOT invoked
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGatherEvidence).not.toHaveBeenCalled();
    expect(mockDeriveEvidenceContext).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-03: CS26 — NO_MATCH → no resolution_context UPDATE
  // (not a resolved entity match, no context to persist)
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-03 CS26: NO_MATCH → no resolution_context UPDATE (no entity resolved)", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    // No resolution_context UPDATE should fire for NO_MATCH (no entity resolved)
    const contextUpdate = updateCalls.find((s) => s.includes("resolution_context"));
    expect(contextUpdate, "No context UPDATE when NO_MATCH (CS26)").toBeUndefined();
    // deriveEvidenceContext must NOT be called (CS26 returns before evidence gathering)
    expect(mockDeriveEvidenceContext).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-04: no_evidence → no context stored
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-04 no_evidence path → no resolution_context UPDATE", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    mockGatherEvidence.mockResolvedValue([]);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    const contextUpdate = updateCalls.find((s) => s.includes("resolution_context"));
    expect(contextUpdate, "No context UPDATE on no_evidence path").toBeUndefined();
    // deriveEvidenceContext must NOT be called (CS26 returns before evidence gathering)
    expect(mockDeriveEvidenceContext).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-05: CS26 — NO_MATCH path is always AI_RESPONDED
  // Provider errors via OpenAI are not reachable from the general support/respond
  // endpoint. The LLM path is only accessible via the explicit gpt-escalation route.
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-05 CS26: NO_MATCH always AI_RESPONDED (no provider error path reachable)", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    // Even if gatherEvidence were called (it won't be), a provider rejection should not affect the response
    mockGatherEvidence.mockRejectedValue(new Error("Provider connection refused"));

    const res = await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    // CS26: NO_MATCH is always AI_RESPONDED, never HUMAN_REQUIRED
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.llm_used).toBe(false);
    // No context UPDATE for NO_MATCH
    const contextUpdate = updateCalls.find((s) => s.includes("resolution_context"));
    expect(contextUpdate, "No context UPDATE on CS26 NO_MATCH path").toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-06: previousContext read from resolution_context sub-key only
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-06 previousContext from resolution_context sub-key (not top-level collision)", async () => {
    // Case has BOTH session metadata AND resolution_context
    const richContextJson = {
      user_role:    "pool_admin",
      app_version:  "1.6.3",
      service_mode: "x",
      // WP-CS09 sub-key
      resolution_context: {
        source_type: "FAQ",
        source_id:   "ki_swimnote_intro",
        entity_key:  "ki_swimnote_intro",
        feature:     "swimnote_intro",
        category:    "product",
        resolved_at: "2026-08-18T06:14:36Z",
      },
    };
    caseStore.push(defCase({ context_json: richContextJson }));
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    mockGatherEvidence.mockResolvedValue([]);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send({ ...BASE_BODY, message: "이거 만든사람 누구야" });

    // runResolutionChain must have been called with previousContext = resolution_context sub-key
    const callArg = mockRunResolutionChain.mock.calls[0]?.[0];
    expect(callArg?.previousContext?.entity_key).toBe("ki_swimnote_intro");
    expect(callArg?.previousContext?.source_id).toBe("ki_swimnote_intro");

    // session metadata (user_role) must NOT bleed into previousContext
    expect((callArg?.previousContext as any)?.user_role).toBeUndefined();
    expect((callArg?.previousContext as any)?.app_version).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-07: creator Knowledge absent → NO_MATCH → AI_RESPONDED (CS26)
  // CS26 CONTRACT: NO_MATCH no longer transitions to HUMAN_REQUIRED automatically.
  // There is no hallucinated creator name; the case gets AI_RESPONDED with a
  // deterministic fallback message.
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-07 creator Knowledge absent → NO_MATCH → AI_RESPONDED (CS26, no hallucination, no HUMAN_REQUIRED)", async () => {
    caseStore.push(defCase());
    // runResolutionChain returns NO_MATCH (no creator knowledge found)
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);

    const res = await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send({ ...BASE_BODY, message: "이거 만든사람 누구야" })
      .expect(200);

    // CS26: case_state = AI_RESPONDED (no auto HUMAN_REQUIRED escalation)
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    // No hallucinated creator name; a deterministic fallback answer is present
    expect(res.body.answer).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-08: creator Knowledge active → RESOLVED via deterministic path
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-08 creator Knowledge active → deterministic RESOLVED, no LLM", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue({
      resolution_status: "RESOLVED",
      source_type:       "KNOWLEDGE",
      source_id:         "ki_swimnote_creator",
      confidence:        65,
      title:             "스윔노트 개발팀",
      answer:            "스윔노트는 국내 스타트업 팀이 개발했습니다.",
      llm_required:      false,
      requires_human:    false,
      feature:           null,
      entity_key:        "ki_swimnote_creator",
    });

    const res = await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send({ ...BASE_BODY, message: "이거 만든사람 누구야" })
      .expect(200);

    expect(res.body.source).toBe("KNOWLEDGE");
    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-09: session metadata preserved (JSONB merge, not full overwrite)
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-09 JSONB merge preserves existing session metadata (COALESCE + || operator)", async () => {
    caseStore.push(defCase({
      context_json: { user_role: "pool_admin", app_version: "1.6.3" },
    }));
    mockRunResolutionChain.mockResolvedValue(DET_RESULT);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    // The UPDATE must use COALESCE + || to merge, not a flat SET
    const contextUpdate = updateCalls.find((s) => s.includes("resolution_context"));
    expect(contextUpdate).toBeTruthy();
    expect(contextUpdate).toContain("COALESCE");
    expect(contextUpdate).toContain("||");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-10: different user → 403
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-10 different user → 403 (actor_id mismatch)", async () => {
    caseStore.push(defCase({ actor_id: "user_different" }));
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))  // user_admin_01 ≠ user_different
      .send(BASE_BODY)
      .expect(403);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-11: different pool → 403
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-11 different pool → 403 (pool_id mismatch)", async () => {
    caseStore.push(defCase({ pool_id: "pool_alpha" }));
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);

    await request(app).post("/api/support/respond")
      .set(authHeader(OTHER_POOL_USER))  // pool_DIFFERENT ≠ pool_alpha
      .send(BASE_BODY)
      .expect(403);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-12: role/mode preserved in RouterContext passed to runResolutionChain
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-12 role and mode preserved in RouterContext", async () => {
    const xUser = { ...ADMIN_USER, role: "teacher" };
    caseStore.push(defCase({ actor_id: xUser.userId, pool_id: xUser.poolId }));
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    mockGatherEvidence.mockResolvedValue([]);

    await request(app).post("/api/support/respond")
      .set(authHeader(xUser))
      .send({ ...BASE_BODY, mode: "x" });

    const callArg = mockRunResolutionChain.mock.calls[0]?.[0];
    expect(callArg?.role).toBe("teacher");
    expect(callArg?.mode).toBe("x");
    expect(callArg?.poolId).toBe("pool_alpha");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-13: evidence=0 → OpenAI.create never invoked (CS26 NO_EVIDENCE contract)
  // CS26: gatherEvidence is not even called for NO_MATCH; the route returns early.
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-13 evidence=0 / NO_MATCH → OpenAI invocation = 0 (CS26 early return)", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    mockGatherEvidence.mockResolvedValue([]);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-14: evidence=0 → response llm_used=false, model=null
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-14 evidence=0 → llm_used=false, llm_called=false in response", async () => {
    caseStore.push(defCase());
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    mockGatherEvidence.mockResolvedValue([]);

    const res = await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY)
      .expect(200);

    expect(res.body.llm_used).toBe(false);
    expect(res.body.llm_called).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-15: PreviousResolutionContext has no raw query/answer fields
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-15 PreviousResolutionContext interface: no raw query / answer fields", async () => {
    // Structural test: previousContext passed to runResolutionChain must not contain
    // raw text fields (query, answer, message, prompt, content).
    const resolutionCtx = {
      source_type: "FAQ",
      source_id:   "ki_swimnote_intro",
      entity_key:  "ki_swimnote_intro",
      feature:     "swimnote_intro",
      category:    "product",
      screen_id:   null,
      resolved_at: "2026-08-18T06:14:36Z",
    };
    caseStore.push(defCase({ context_json: { resolution_context: resolutionCtx } }));
    mockRunResolutionChain.mockResolvedValue(NO_MATCH_RESULT);
    mockGatherEvidence.mockResolvedValue([]);

    await request(app).post("/api/support/respond")
      .set(authHeader(ADMIN_USER))
      .send(BASE_BODY);

    const prevCtx = mockRunResolutionChain.mock.calls[0]?.[0]?.previousContext;
    expect(prevCtx).toBeTruthy();

    // Forbidden fields: raw text
    for (const forbidden of ["query", "answer", "message", "content", "prompt", "raw_message"]) {
      expect(Object.prototype.hasOwnProperty.call(prevCtx, forbidden)).toBe(false);
    }

    // Required fields: structured metadata only
    expect(typeof prevCtx.source_type).toBe("string");
    expect(Object.prototype.hasOwnProperty.call(prevCtx, "entity_key")).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CTXH-16: §8 referential requirement
  // "스윔노트 만든사람 누구야" → NOT a follow-up signal (no referential pronoun)
  // "이거 만든사람 누구야" → IS a follow-up signal ("이거" is referential)
  // ─────────────────────────────────────────────────────────────────────────

  it("CTXH-16 §8: standalone creator query has no referential pronoun (not follow-up signal)", async () => {
    // Import the real hasFollowupSignal directly from the resolver
    const { hasFollowupSignal, FOLLOWUP_SIGNALS } = await vi.importActual(
      "../../lib/support-resolver.js"
    ) as any;

    // "스윔노트 만든사람 누구야" — entity is explicit in the query, no pronoun needed
    expect(hasFollowupSignal("스윔노트 만든사람 누구야")).toBe(false);
    // "만든사람" alone → false (removed from FOLLOWUP_SIGNALS per §8)
    expect(hasFollowupSignal("만든사람 누구야")).toBe(false);
    // "누가 만들었어" alone → false
    expect(hasFollowupSignal("누가 만들었어")).toBe(false);

    // "이거 만든사람 누구야" → true ("이거" is referential)
    expect(hasFollowupSignal("이거 만든사람 누구야")).toBe(true);
    // "그거 만든 사람 누구야" → true ("그거" is referential)
    expect(hasFollowupSignal("그거 만든 사람 누구야")).toBe(true);

    // Verify removed items are NOT in FOLLOWUP_SIGNALS
    expect(FOLLOWUP_SIGNALS).not.toContain("만든사람");
    expect(FOLLOWUP_SIGNALS).not.toContain("만든 사람");
    expect(FOLLOWUP_SIGNALS).not.toContain("만들었어");
    expect(FOLLOWUP_SIGNALS).not.toContain("누가 만들었어");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// deriveEvidenceContext unit tests (§6 selection logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveEvidenceContext — §6 selection logic (unit)", () => {
  let deriveEvidenceContext: any;
  let HIGH_CONFIDENCE: number;

  beforeEach(async () => {
    const mod = await vi.importActual("../../lib/support-resolver.js") as any;
    deriveEvidenceContext = mod.deriveEvidenceContext;
    HIGH_CONFIDENCE = mod.HIGH_CONFIDENCE;
  });

  it("§6A: single qualifying KI evidence → entity from KI", () => {
    const result = deriveEvidenceContext([
      { id: "ki_swimnote_intro", item_type: "FAQ", title: "T", answer: "A", score: 90, feature: "swimnote_intro", category: "product" },
    ]);
    expect(result).not.toBeNull();
    expect(result.entity_key).toBe("swimnote_intro");
    expect(result.source_id).toBe("ki_swimnote_intro");
    expect(result.source_type).toBe("FAQ");
  });

  it("§6A: KI entity_key falls back to id when feature=null", () => {
    const result = deriveEvidenceContext([
      { id: "ki_some_item", item_type: "KNOWLEDGE", title: "T", answer: "A", score: 65, feature: null, category: null },
    ]);
    expect(result?.entity_key).toBe("ki_some_item");
  });

  it("§6B: multiple qualifying KI with same feature → common entity", () => {
    const result = deriveEvidenceContext([
      { id: "ki_a", item_type: "FAQ", title: "A", answer: "...", score: 80, feature: "x_mode", category: null },
      { id: "ki_b", item_type: "FAQ", title: "B", answer: "...", score: 70, feature: "x_mode", category: null },
    ]);
    expect(result).not.toBeNull();
    expect(result.entity_key).toBe("x_mode");
    expect(result.feature).toBe("x_mode");
  });

  it("§6C: multiple qualifying KI with different features → null (no forced entity)", () => {
    const result = deriveEvidenceContext([
      { id: "ki_a", item_type: "FAQ", title: "A", answer: "...", score: 80, feature: "swimnote_intro", category: null },
      { id: "ki_b", item_type: "FAQ", title: "B", answer: "...", score: 70, feature: "x_mode", category: null },
    ]);
    expect(result).toBeNull();
  });

  it("FM fallback: no qualifying KI → FM entity from screen_id", () => {
    const result = deriveEvidenceContext([
      { id: "fm_X_MODE_HUB", item_type: "FRONTEND_MAP", title: "X Hub", answer: "...", score: 75, feature: null, category: null },
    ]);
    expect(result).not.toBeNull();
    expect(result.source_type).toBe("FRONTEND_MAP");
    expect(result.entity_key).toBe("X_MODE_HUB");
    expect(result.feature).toBeNull();
  });

  it("empty evidence → null", () => {
    expect(deriveEvidenceContext([])).toBeNull();
  });

  it("below HIGH_CONFIDENCE KI → treated as non-qualifying (FM fallback or null)", () => {
    const result = deriveEvidenceContext([
      { id: "ki_low", item_type: "FAQ", title: "T", answer: "A", score: 55, feature: "something", category: null },
    ]);
    // score=55 < HIGH_CONFIDENCE=60 → not qualifying KI → no FM either → null
    expect(result).toBeNull();
  });

  it("§6: evidence context contains no raw query/answer text (metadata only)", () => {
    const result = deriveEvidenceContext([
      { id: "ki_x", item_type: "FAQ", title: "T", answer: "Raw answer text here", score: 65, feature: "f", category: null },
    ]);
    // answer/title/content NOT in the returned context
    if (result) {
      expect(Object.prototype.hasOwnProperty.call(result, "answer")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, "title")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, "content")).toBe(false);
    }
  });
});
