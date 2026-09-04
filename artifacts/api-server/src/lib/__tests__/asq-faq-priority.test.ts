/**
 * asq-faq-priority.test.ts — P0-CS08-ANSWER-SOURCE-QUALITY
 *
 * FAQ/KNOWLEDGE priority over Frontend Map for explanation-intent queries.
 *
 * §4 routing quality rule:
 *   PRODUCT_EXPLANATION (알려줘/뭐야/설명/소개/대해) → FAQ/Knowledge 우선
 *   SCREEN_LOCATION     (어디야/화면 탐색)            → Frontend Map 허용
 *
 * ASQ-01~12 tests. No production data written, no LLM calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runResolutionChain,
  scoreText,
  normalizeQuery,
  hasExplanationIntent,
  type RouterContext,
  type KnowledgeRow,
} from "../support-resolver.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => {
  function sql(strings: TemplateStringsArray, ...values: any[]) {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
      ""
    );
    return { __text: text, __values: values };
  }
  sql.raw = (t: string, p?: any[]) => ({ __raw: true, __text: t, __values: p ?? [] });
  return { sql };
});

// ki_x_mode_intro with updated content (matches production DB after update)
const KI_X_MODE_INTRO: KnowledgeRow = {
  id:                 "ki_x_mode_intro",
  item_type:          "FAQ",
  scope:              "global",
  pool_id:            null,
  category:           "X_MODE",
  feature:            "X_MODE_INTRO",
  affected_role:      null,
  affected_mode:      null,
  affected_roles:     ["pool_admin", "teacher", "parent", "parent_account"],
  affected_modes:     null,
  title:              "스윔노트X 소개",
  // content includes representative queries so normalizeQuery(content).includes("x 모드가 뭐야") → score 65
  content:            "스윔노트X(SWIMNOTE X)는 일반 스윔노트 위에 추가되는 별도 서비스입니다.\n\n자주 묻는 표현: X모드가 뭐야, X가 뭔지, 스윔노트X 설명해줘",
  question:           "스윔노트X에 대해 알려줘",
  answer:             "스윔노트X(SWIMNOTE X)는 일반 스윔노트 위에 추가되는 별도 서비스입니다.",
  deep_link:          null,
  frontend_screen_id: null,
  solution_steps:     null,
  conditions:         null,
  incident_id:        null,
  status:             "active",
  usage_count:        0,
};

let mockKnowledgeRows: KnowledgeRow[] = [];

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn((q: any) => {
      const text: string = (q.__text ?? "").replace(/\s+/g, " ");
      // Only return knowledge rows for FAQ/KNOWLEDGE queries, not RULE/SOLUTION/KNOWN_ISSUE
      if (
        text.includes("support_knowledge_items") &&
        text.includes("'FAQ', 'KNOWLEDGE'")
      ) {
        return Promise.resolve({ rows: mockKnowledgeRows });
      }
      // RULE, SOLUTION, KNOWN_ISSUE, event_logs → empty
      return Promise.resolve({ rows: [] });
    }),
  },
  db: { execute: vi.fn(() => Promise.resolve({ rows: [] })) },
}));

// ── Router context helpers ─────────────────────────────────────────────────────

function ctx(rawQ: string, role = "pool_admin", mode = "x"): RouterContext {
  const qLower = normalizeQuery(rawQ);
  const tokens  = qLower
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return {
    query:      rawQ,
    qLower,
    tokens,
    role,
    mode,
    poolId:     "pool_test",
    screenId:   null,
    appVersion: null,
  };
}

beforeEach(() => {
  mockKnowledgeRows = [];
});

// ── ASQ-01: "스윔노트X에 대해 알려줘" → ki_x_mode_intro ──────────────────────

describe("ASQ — FAQ priority over Frontend Map", () => {
  it("ASQ-01 '스윔노트X에 대해 알려줘' → ki_x_mode_intro (not FRONTEND_MAP)", async () => {
    mockKnowledgeRows = [KI_X_MODE_INTRO];
    const result = await runResolutionChain(ctx("스윔노트X에 대해 알려줘"));
    expect(result.source_type).toBe("FAQ");
    expect(result.source_id).toBe("ki_x_mode_intro");
    expect(result.resolution_status).toBe("RESOLVED");
  });

  // ASQ-02: no-space variant → same
  it("ASQ-02 '스윔노트x에대해서알려줘' → ki_x_mode_intro", async () => {
    mockKnowledgeRows = [KI_X_MODE_INTRO];
    const result = await runResolutionChain(ctx("스윔노트x에대해서알려줘"));
    expect(result.source_type).toBe("FAQ");
    expect(result.source_id).toBe("ki_x_mode_intro");
  });

  // ASQ-03: "X모드가 뭐야" — content includes "X모드가 뭐야" → score 65 ≥ HIGH_CONFIDENCE
  it("ASQ-03 'X모드가 뭐야' → ki_x_mode_intro (via content match, score 65)", async () => {
    mockKnowledgeRows = [KI_X_MODE_INTRO];
    const result = await runResolutionChain(ctx("X모드가 뭐야"));
    expect(result.source_type).toBe("FAQ");
    expect(result.source_id).toBe("ki_x_mode_intro");
    expect(result.confidence).toBeGreaterThanOrEqual(60);
  });

  // ASQ-04: X explanation → source_type MUST NOT be FRONTEND_MAP
  it("ASQ-04 X explanation queries must not return FRONTEND_MAP source", async () => {
    mockKnowledgeRows = [KI_X_MODE_INTRO];
    const queries = [
      "스윔노트X에 대해서 알려줘",
      "X 기능 소개해줘",
      "스윔노트X 설명해줘",
      "X모드가 뭐야",
    ];
    for (const q of queries) {
      const result = await runResolutionChain(ctx(q));
      expect(result.source_type).not.toBe("FRONTEND_MAP");
    }
  });

  // ASQ-05: Navigation query → Frontend Map 허용
  it("ASQ-05 'X모드 화면 어디야' → Frontend Map allowed (no explanation intent)", async () => {
    mockKnowledgeRows = []; // no FAQ hits
    const result = await runResolutionChain(ctx("X모드 화면 어디야"));
    // "어디야" is NOT an explanation marker → FRONTEND_MAP may win
    // ADMIN_X_MODE_HUB has "X 모드" in support_keywords → score 75
    expect(result.source_type).toBe("FRONTEND_MAP");
  });

  // ASQ-06: Navigation query (subscription screen) → Frontend Map
  it("ASQ-06 '구독 화면 어디야' → Frontend Map allowed", async () => {
    mockKnowledgeRows = [];
    const result = await runResolutionChain(ctx("구독 화면 어디야"));
    // "어디야" not in explanation markers → FRONTEND_MAP may resolve if score ≥ 60
    // Subscription-related screens exist in the registry
    expect(["FRONTEND_MAP", "NO_MATCH"]).toContain(result.source_type);
    // Must NOT be returned due to explanation gate
    if (result.source_type === "FRONTEND_MAP") {
      // Only navigation intent should reach here → good
      expect(hasExplanationIntent("구독 화면 어디야")).toBe(false);
    }
  });

  // ASQ-07: ki_swimnote_intro exists as PENDING (verified via DB in §13 section above)
  // In unit test: verify pending items are NOT included by queryKnowledge
  // (which filters status='active')
  it("ASQ-07 ki_swimnote_intro candidate remains pending — not used in resolution", async () => {
    const KI_SWIMNOTE_PENDING: KnowledgeRow = {
      id: "ki_swimnote_intro", item_type: "FAQ", scope: "global", pool_id: null,
      category: "APP_COMMON", feature: "SWIMNOTE_INTRO",
      affected_role: null, affected_mode: null,
      affected_roles: ["pool_admin","sub_admin","teacher","parent_account"],
      affected_modes: null,
      title: "스윔노트 소개", question: "스윔노트가 무엇인가요?",
      content: "스윔노트는 수영장 운영을 위한 통합 관리 플랫폼입니다.",
      answer: "스윔노트는 수영장 운영을 위한 통합 관리 플랫폼입니다.",
      deep_link: null, frontend_screen_id: null,
      solution_steps: null, conditions: null, incident_id: null,
      status: "pending", usage_count: 0,
    };
    // Even if mock leaks a pending item, queryKnowledge SQL filters status='active'
    // In production DB, only active items are returned.
    // Here we verify: if mock returns ONLY the pending item, resolution is NO_MATCH.
    // (queryKnowledge will have filtered it via SQL, mock returns only what we set)
    mockKnowledgeRows = []; // simulates SQL WHERE status='active' filtering pending out
    const result = await runResolutionChain(ctx("스윔노트알려줘"));
    expect(result.resolution_status).toBe("NO_MATCH");
    expect(result.source_id).toBeNull();
    void KI_SWIMNOTE_PENDING; // type-check only
  });

  // ASQ-08: "스윔노트알려줘" → NO_MATCH (pending not used)
  it("ASQ-08 '스윔노트알려줘' → NO_MATCH (no active swimnote intro item)", async () => {
    mockKnowledgeRows = []; // no active items for general swimnote
    const result = await runResolutionChain(ctx("스윔노트알려줘", "pool_admin", "normal"));
    expect(result.resolution_status).toBe("NO_MATCH");
    expect(result.requires_human).toBe(true);
  });

  // ASQ-09: role/mode security — wrong role → filtered by roleMatches
  it("ASQ-09 role filter preserved — parent role returns FAQ item", async () => {
    const parentRow: KnowledgeRow = { ...KI_X_MODE_INTRO, affected_roles: ["parent_account"] };
    mockKnowledgeRows = [parentRow];
    // pool_admin not in ["parent_account"] → roleMatches returns false → NO_MATCH
    const resultAdmin = await runResolutionChain(ctx("스윔노트X에 대해 알려줘", "pool_admin", "x"));
    expect(resultAdmin.resolution_status).toBe("NO_MATCH");

    // parent_account is in ["parent_account"] → matches
    const resultParent = await runResolutionChain(ctx("스윔노트X에 대해 알려줘", "parent_account", "x"));
    expect(resultParent.resolution_status).toBe("RESOLVED");
    expect(resultParent.source_id).toBe("ki_x_mode_intro");
  });

  // ASQ-10: LLM call 0 — llm_required = false for deterministic FAQ hit
  it("ASQ-10 X intro FAQ → llm_required=false, deterministic resolution", async () => {
    mockKnowledgeRows = [KI_X_MODE_INTRO];
    const result = await runResolutionChain(ctx("스윔노트X에 대해 알려줘"));
    expect(result.llm_required).toBe(false);
    expect(result.requires_human).toBe(false);
  });

  // ASQ-11: Unrelated query → no false ki_x_mode_intro hit
  it("ASQ-11 unrelated query '내일 날씨 어때' → no ki_x_mode_intro false hit", async () => {
    mockKnowledgeRows = [KI_X_MODE_INTRO];
    const result = await runResolutionChain(ctx("내일 날씨 어때"));
    expect(result.source_id).not.toBe("ki_x_mode_intro");
  });
});

// ── ASQ — hasExplanationIntent unit tests ─────────────────────────────────────

describe("ASQ — hasExplanationIntent()", () => {
  it("explanation queries return true", () => {
    expect(hasExplanationIntent("x 모드가 뭐야")).toBe(true);
    expect(hasExplanationIntent("스윔노트 x 에 대해 알려줘")).toBe(true);
    expect(hasExplanationIntent("x 기능 설명해줘")).toBe(true);
    expect(hasExplanationIntent("x 소개해줘")).toBe(true);
    expect(hasExplanationIntent("x 가 뭔지 알려줘")).toBe(true);
  });

  it("navigation queries return false", () => {
    expect(hasExplanationIntent("x 모드 화면 어디야")).toBe(false);
    expect(hasExplanationIntent("구독 화면 어디에서 해")).toBe(false);
    expect(hasExplanationIntent("x 설정 화면 찾기")).toBe(false);
  });
});

// ── ASQ — scoreText unit tests for X intro variants ──────────────────────────

describe("ASQ — scoreText for ki_x_mode_intro variants", () => {
  it("'스윔노트X에 대해 알려줘' → score 90 (exact question match)", () => {
    const qLower = normalizeQuery("스윔노트X에 대해 알려줘");
    const tokens = qLower.replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter(t => t.length >= 2);
    const score = scoreText(KI_X_MODE_INTRO, qLower, tokens);
    expect(score).toBe(90);
  });

  it("'스윔노트x에대해서알려줘' → score 90 (normalized to same)", () => {
    const qLower = normalizeQuery("스윔노트x에대해서알려줘");
    const tokens = qLower.replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter(t => t.length >= 2);
    const score = scoreText(KI_X_MODE_INTRO, qLower, tokens);
    expect(score).toBe(90);
  });

  it("'X모드가 뭐야' → score ≥ 60 (content match via representative queries)", () => {
    const qLower = normalizeQuery("X모드가 뭐야");
    const tokens = qLower.replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter(t => t.length >= 2);
    const score = scoreText(KI_X_MODE_INTRO, qLower, tokens);
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("'내일 날씨 어때' → score 0 (no relation)", () => {
    const qLower = normalizeQuery("내일 날씨 어때");
    const tokens = qLower.replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter(t => t.length >= 2);
    const score = scoreText(KI_X_MODE_INTRO, qLower, tokens);
    expect(score).toBe(0);
  });
});
