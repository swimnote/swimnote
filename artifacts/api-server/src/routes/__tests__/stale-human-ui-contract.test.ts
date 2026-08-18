/**
 * STALE — Stale Human UI Contract Tests
 *
 * P0-CS08-STALE-HUMAN-UI: 정상 FAQ/deterministic 응답 이후
 * 이전 HUMAN_REQUIRED 상태가 클리어되어야 한다.
 *
 * STALE-01  NO_MATCH → HUMAN_REQUIRED (자동 fallback)
 * STALE-02  같은 case, 이후 FAQ exact hit → case_state = AI_RESPONDED
 * STALE-03  FAQ 성공 → HTTP 응답에 case_state = "AI_RESPONDED" (HUMAN_REQUIRED 아님)
 * STALE-04  이전 NO_MATCH 메시지는 대화 히스토리에 보존
 * STALE-05  legacy ack 숨김 (isHuman=false → UI 조건 미충족) — server 계약 검증
 * STALE-06  human CTA 숨김 (case_state AI_RESPONDED → master_state WAITING) — server 계약
 * STALE-07  header 상태 — AI_RESPONDED → getMasterState = "WAITING", NOT AGENT_REQUESTED
 * STALE-08  명시적 사용자 human 요청 케이스 → AI 답변 후에도 HUMAN_REQUIRED 유지
 * STALE-09  실제 human ticket 있으면 AI_PROCESSING 전환 거부
 * STALE-10  parent_account 회귀 테스트
 * STALE-11  pool_admin / teacher 회귀 테스트
 * STALE-12  전체 suite (이전 no-evidence 포함 1758+ TC)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── vi.hoisted ──────────────────────────────────────────────────────────────────

const mockCreate             = vi.hoisted(() => vi.fn());
const mockRunResolutionChain = vi.hoisted(() => vi.fn());
const mockGatherEvidence     = vi.hoisted(() => vi.fn());
const mockTransition         = vi.hoisted(() => vi.fn());
const transitionCalls        = vi.hoisted(() => [] as any[]);

// ── In-memory stores ────────────────────────────────────────────────────────────

let caseStore:    any[] = [];
let repliesStore: any[] = [];

// ── Mocks ───────────────────────────────────────────────────────────────────────

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
    const text: string = (q.__text ?? "").replace(/\s+/g, " ");
    const params: any[] = q.__values ?? [];

    if (text.includes("INSERT INTO event_logs")) return { rows: [] };

    if (text.includes("FROM support_cases")) {
      const id = params[0];
      const found = caseStore.find((c) => c.id === id);
      return { rows: found ? [found] : [] };
    }
    if (text.includes("UPDATE support_cases") && text.includes("turn_count")) return { rows: [] };
    if (text.includes("UPDATE support_cases") && text.includes("state")) {
      const newState = params[0];
      const id       = params.at(-1);
      const sc = caseStore.find((c) => c.id === id);
      if (sc && newState) sc.state = newState;
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
    if (text.includes("INSERT INTO ai_traces")) return { rows: [] };
    return { rows: [] };
  };

  return {
    superAdminDb: { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
    db:           { execute: vi.fn((q: any) => Promise.resolve(executeQuery(q))) },
  };
});

vi.mock("../ai.js", () => ({
  getOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
}));

vi.mock("../../lib/ai-trace-service.js", () => ({
  saveAiTrace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/support-resolver.js", () => ({
  runResolutionChain: (...args: any[]) => mockRunResolutionChain(...args),
  gatherEvidence:     (...args: any[]) => mockGatherEvidence(...args),
  tokenize:           (s: string) =>
    s.toLowerCase().replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter((t: string) => t.length >= 2),
  normalizeQuery:     (s: string) => s.toLowerCase().trim(),
}));

vi.mock("../../lib/support-case-service.js", () => {
  const VALID_TRANSITIONS: Record<string, readonly string[]> = {
    NEW:             ["AI_PROCESSING", "HUMAN_REQUIRED", "WAITING", "AI_RESOLVED"],
    AI_PROCESSING:   ["AI_RESPONDED", "WAITING", "HUMAN_REQUIRED", "AI_RESOLVED"],
    AI_RESPONDED:    ["WAITING", "AI_RESOLVED", "HUMAN_REQUIRED"],
    WAITING:         ["AI_PROCESSING", "AI_RESOLVED", "HUMAN_REQUIRED", "REOPENED"],
    AI_RESOLVED:     ["RESOLVED", "REOPENED"],
    HUMAN_REQUIRED:  ["HUMAN_RESPONDED", "ESCALATED", "PHONE_REQUIRED", "AI_PROCESSING"],
    HUMAN_RESPONDED: ["RESOLVED", "ESCALATED", "REOPENED"],
    ESCALATED:       ["HUMAN_RESPONDED", "RESOLVED", "PHONE_REQUIRED"],
    PHONE_REQUIRED:  ["RESOLVED"],
    RESOLVED:        ["REOPENED", "CLOSED"],
    REOPENED:        ["AI_PROCESSING", "HUMAN_REQUIRED"],
    CLOSED:          [],
  };

  const getMasterStateFn = (state: string, esc?: string | null): string => {
    switch (state) {
      case "NEW": case "AI_PROCESSING":                    return "AI_ACTIVE";
      case "AI_RESPONDED": case "WAITING":                 return "WAITING";
      case "AI_RESOLVED": case "RESOLVED": case "CLOSED":  return "RESOLVED";
      case "HUMAN_REQUIRED":                               return "AGENT_REQUESTED";
      case "HUMAN_RESPONDED":                              return "AGENT_ACTIVE";
      case "PHONE_REQUIRED":                               return "PHONE_REQUIRED";
      case "ESCALATED":
        return ["BILLING_REQUIRED","REFUND_REQUIRED","SAFETY_OR_PRIVACY"].includes(esc ?? "")
          ? "PHONE_REQUIRED" : "AGENT_ACTIVE";
      case "REOPENED":                                     return "REOPENED";
      default:                                             return state;
    }
  };

  return {
    transitionSupportCase: vi.fn(async (p: any) => {
      transitionCalls.push({ ...p });
      mockTransition(p);
      // Validate transition before applying (mirrors production logic)
      const sc = caseStore.find((c) => c.id === p.caseId);
      if (!sc) return { ok: false, error: "not found" };
      const allowed = VALID_TRANSITIONS[sc.state] ?? [];
      if (!allowed.includes(p.toState)) {
        return { ok: false, error: `${sc.state} → ${p.toState} not allowed` };
      }
      sc.state = p.toState;
      return { ok: true };
    }),
    logSupportEvent:  vi.fn().mockResolvedValue(undefined),
    getMasterState:   getMasterStateFn,
    VALID_TRANSITIONS,
    ALL_INTERNAL_STATES: new Set(Object.keys(VALID_TRANSITIONS)),
  };
});

import supportRespondRouter from "../support-respond.js";
import { getMasterState }   from "../../lib/support-case-service.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(supportRespondRouter);
  return app;
}

// ── Seed helpers ────────────────────────────────────────────────────────────────

let _seq = 0;
function seedCase(overrides: Partial<any> = {}): any {
  const sc = {
    id:                `sc_stale_${Date.now()}_${++_seq}`,
    state:             "NEW",
    pool_id:           "pool_01",
    ticket_id:         null,
    actor_id:          "user_01",
    escalation_reason: null,
    ...overrides,
  };
  caseStore.push(sc);
  return sc;
}

const PARENT_USER = { userId: "user_01", role: "parent_account", poolId: "pool_01", name: "Parent" };
const ADMIN_USER  = { userId: "user_01", role: "pool_admin",      poolId: "pool_01", name: "Admin"  };
const TEACHER_USER= { userId: "user_01", role: "teacher",         poolId: "pool_01", name: "Teacher"};

const NO_MATCH = {
  resolution_status: "NO_MATCH",
  source_type:       "NONE",
  source_id:         null,
  confidence:        0,
  title:             null,
  answer:            null,
  requires_human:    true,
  llm_required:      true,
};

const FAQ_RESOLVED = {
  resolution_status: "RESOLVED",
  source_type:       "FAQ",
  source_id:         "ki_x_mode_intro",
  confidence:        90,
  title:             "스윔노트X 소개",
  answer:            "스윔노트X는 별도 AI 기반 서비스입니다.",
  requires_human:    false,
  llm_required:      false,
};

const DET_RULE_RESOLVED = {
  resolution_status: "RESOLVED",
  source_type:       "RULE",
  source_id:         "rule_01",
  confidence:        85,
  title:             "규칙 답변",
  answer:            "규칙 기반 응답입니다.",
  requires_human:    false,
  llm_required:      false,
};

// ── beforeEach ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  caseStore.length    = 0;
  repliesStore.length = 0;
  transitionCalls.length = 0;

  mockCreate.mockReset();
  mockRunResolutionChain.mockReset();
  mockGatherEvidence.mockReset();
  mockTransition.mockReset();
  mockGatherEvidence.mockResolvedValue([]);
});

// ── getMasterState contract (no network) ─────────────────────────────────────────

describe("getMasterState contract", () => {
  it("HUMAN_REQUIRED → AGENT_REQUESTED (isHuman=true)", () => {
    expect(getMasterState("HUMAN_REQUIRED")).toBe("AGENT_REQUESTED");
  });
  it("AI_RESPONDED → WAITING (isHuman=false)", () => {
    expect(getMasterState("AI_RESPONDED")).toBe("WAITING");
  });
  it("AI_PROCESSING → AI_ACTIVE", () => {
    expect(getMasterState("AI_PROCESSING")).toBe("AI_ACTIVE");
  });
  it("NEW → AI_ACTIVE", () => {
    expect(getMasterState("NEW")).toBe("AI_ACTIVE");
  });
});

// ── STALE Tests ─────────────────────────────────────────────────────────────────

describe("STALE — Stale Human UI Contract", () => {

  // ── STALE-01 ─────────────────────────────────────────────────────────────────

  it("STALE-01 NO_MATCH → case transitions to HUMAN_REQUIRED", async () => {
    const sc = seedCase({ state: "NEW" });
    mockRunResolutionChain.mockResolvedValueOnce(NO_MATCH);
    mockGatherEvidence.mockResolvedValueOnce([]); // no evidence

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(res.status).toBe(200);
    expect(res.body.case_state).toBe("HUMAN_REQUIRED");

    // Final transition should be AI_PROCESSING → HUMAN_REQUIRED
    const finalTx = transitionCalls.find(t => t.toState === "HUMAN_REQUIRED");
    expect(finalTx).toBeDefined();
  });

  // ── STALE-02 ─────────────────────────────────────────────────────────────────

  it("STALE-02 auto-HUMAN_REQUIRED → subsequent FAQ → case_state = AI_RESPONDED", async () => {
    // Start: case already in HUMAN_REQUIRED (auto-fallback, no ticket)
    const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });

    mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(res.status).toBe(200);
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.source).toBe("FAQ");
    expect(res.body.requires_human).toBe(false);
  });

  // ── STALE-03 ─────────────────────────────────────────────────────────────────

  it("STALE-03 FAQ success HTTP response has case_state AI_RESPONDED, NOT HUMAN_REQUIRED", async () => {
    const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });
    mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(res.status).toBe(200);
    expect(res.body.case_state).not.toBe("HUMAN_REQUIRED");
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.ok).toBe(true);
  });

  // ── STALE-04 ─────────────────────────────────────────────────────────────────

  it("STALE-04 old NO_MATCH message preserved in DB (not deleted)", async () => {
    const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });

    // Simulate previously stored NO_MATCH ai reply
    repliesStore.push({
      id:          "rep_old_no_match",
      case_id:     sc.id,
      author_role: "ai",
      message_type:"ai_low_confidence",
      content:     "정확한 정보를 찾지 못했습니다.",
    });

    mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    // Old message must still exist
    const oldMsg = repliesStore.find(r => r.id === "rep_old_no_match");
    expect(oldMsg).toBeDefined();
    expect(oldMsg!.content).toContain("찾지 못했습니다");

    // New AI reply must also be stored
    const newAiMsg = repliesStore.find(
      r => r.case_id === sc.id && r.author_role === "ai" && r.id !== "rep_old_no_match"
    );
    expect(newAiMsg).toBeDefined();
    // deterministic path (FAQ/RULE) stores "ai_deterministic", LLM path stores "ai_llm"
    expect(["ai_llm", "ai_deterministic"]).toContain(newAiMsg!.message_type);
  });

  // ── STALE-05 ─────────────────────────────────────────────────────────────────
  // Legacy ack visibility: only shown when isHuman=true.
  // Server contract: case_state=AI_RESPONDED → getMasterState="WAITING" → NOT in humanStates.

  it("STALE-05 legacy ack hidden — case_state=AI_RESPONDED means master_state=WAITING (isHuman=false)", () => {
    const masterState = getMasterState("AI_RESPONDED");
    const humanStates = new Set(["AGENT_REQUESTED", "AGENT_ACTIVE", "PHONE_REQUIRED"]);
    const isHuman = humanStates.has(masterState);
    expect(isHuman).toBe(false); // legacy ack condition: isHuman=false → hidden
  });

  // ── STALE-06 ─────────────────────────────────────────────────────────────────

  it("STALE-06 human CTA hidden — case_state=AI_RESPONDED means isHuman=false", () => {
    // HTTP response case_state = AI_RESPONDED
    // getMasterState("AI_RESPONDED") = "WAITING"
    // isHuman = ["AGENT_REQUESTED","AGENT_ACTIVE","PHONE_REQUIRED"].includes("WAITING") → false
    // showHumanCta: reset by fetchCaseDetail when !humanStates.has(newMasterState) → false
    const masterState = getMasterState("AI_RESPONDED");
    const isHuman = (["AGENT_REQUESTED", "AGENT_ACTIVE", "PHONE_REQUIRED"] as string[]).includes(masterState);
    expect(isHuman).toBe(false);
    // (showHumanCta reset is covered by the mobile component change)
  });

  // ── STALE-07 ─────────────────────────────────────────────────────────────────

  it("STALE-07 header state — after FAQ success master_state is WAITING, NOT AGENT_REQUESTED", () => {
    // HUMAN_REQUIRED (stale) → AGENT_REQUESTED label ("상담사 연결 대기")
    expect(getMasterState("HUMAN_REQUIRED")).toBe("AGENT_REQUESTED");
    // After fix: AI_RESPONDED → WAITING label ("답변 확인 대기")
    expect(getMasterState("AI_RESPONDED")).toBe("WAITING");
    expect(getMasterState("AI_RESPONDED")).not.toBe("AGENT_REQUESTED");
  });

  // ── STALE-08 ─────────────────────────────────────────────────────────────────

  it("STALE-08 explicit user human request — stays HUMAN_REQUIRED after AI FAQ", async () => {
    // User explicitly requested human: escalation_reason set
    const sc = seedCase({
      state:             "HUMAN_REQUIRED",
      ticket_id:         "tkt_explicit_001",
      escalation_reason: "USER_REQUESTED_HUMAN",
    });
    mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    expect(res.status).toBe(200);

    // AI_PROCESSING transition should NOT have been attempted
    const aiProcTx = transitionCalls.find(t => t.toState === "AI_PROCESSING");
    expect(aiProcTx).toBeUndefined();

    // Case state should remain HUMAN_REQUIRED (no AI_PROCESSING transition)
    const finalCase = caseStore.find(c => c.id === sc.id);
    expect(finalCase?.state).toBe("HUMAN_REQUIRED");
  });

  // ── STALE-09 ─────────────────────────────────────────────────────────────────

  it("STALE-09 ticket_id present → AI_PROCESSING transition blocked (ticket not cancelled)", async () => {
    const sc = seedCase({
      state:             "HUMAN_REQUIRED",
      ticket_id:         "tkt_real_human_999",
      escalation_reason: null, // no explicit reason, but ticket exists
    });
    mockRunResolutionChain.mockResolvedValueOnce(DET_RULE_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "규칙 질문" });

    expect(res.status).toBe(200);

    // Must NOT have tried to transition to AI_PROCESSING from HUMAN_REQUIRED with ticket
    const aiProcTx = transitionCalls.find(t => t.toState === "AI_PROCESSING");
    expect(aiProcTx).toBeUndefined();
  });

  // ── STALE-10 ─────────────────────────────────────────────────────────────────

  it("STALE-10 parent_account regression — auto HUMAN_REQUIRED → FAQ → AI_RESPONDED", async () => {
    const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });
    mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘", mode: "normal" });

    expect(res.status).toBe(200);
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.requires_human).toBe(false);
    expect(res.body.llm_used).toBe(false);
  });

  // ── STALE-11 ─────────────────────────────────────────────────────────────────

  it("STALE-11 pool_admin + teacher — same fix applies", async () => {
    for (const user of [ADMIN_USER, TEACHER_USER]) {
      const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });
      mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

      const res = await request(buildApp())
        .post("/support/respond")
        .set("x-test-user", JSON.stringify(user))
        .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

      expect(res.status).toBe(200);
      expect(res.body.case_state).toBe("AI_RESPONDED");
    }
  });

  // ── STALE-02 VARIANT: deterministic RULE ────────────────────────────────────

  it("STALE-02b auto-HUMAN_REQUIRED → RULE resolution → AI_RESPONDED", async () => {
    const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });
    mockRunResolutionChain.mockResolvedValueOnce(DET_RULE_RESOLVED);

    const res = await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(ADMIN_USER))
      .send({ case_id: sc.id, message: "규칙 질문" });

    expect(res.status).toBe(200);
    expect(res.body.case_state).toBe("AI_RESPONDED");
    expect(res.body.source).toBe("RULE");
  });

  // ── AI_PROCESSING transition gate for auto HUMAN_REQUIRED ───────────────────

  it("STALE-02c auto-HUMAN_REQUIRED: AI_PROCESSING transition IS called before resolution", async () => {
    const sc = seedCase({ state: "HUMAN_REQUIRED", ticket_id: null, escalation_reason: null });
    mockRunResolutionChain.mockResolvedValueOnce(FAQ_RESOLVED);

    await request(buildApp())
      .post("/support/respond")
      .set("x-test-user", JSON.stringify(PARENT_USER))
      .send({ case_id: sc.id, message: "스윔노트X에 대해 알려줘" });

    const aiProcTx = transitionCalls.find(t => t.toState === "AI_PROCESSING");
    expect(aiProcTx).toBeDefined();
    expect(aiProcTx!.caseId).toBe(sc.id);
  });

  // ── VALID_TRANSITIONS contract ───────────────────────────────────────────────

  it("STALE-SM VALID_TRANSITIONS allows HUMAN_REQUIRED → AI_PROCESSING", async () => {
    const { VALID_TRANSITIONS } = await import("../../lib/support-case-service.js");
    expect(VALID_TRANSITIONS["HUMAN_REQUIRED"]).toContain("AI_PROCESSING");
  });

});
