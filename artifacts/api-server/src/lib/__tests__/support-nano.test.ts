/**
 * support-nano.test.ts — WP-SUPPORT-NANO-01
 *
 * TC1: 정확한 질문 → 관련 KI 선택 → grounded answer
 * TC2: 표현 변형/동의어 → candidate 중 올바른 KI 선택
 * TC3: follow-up 질문 → 최근 context를 사용해 올바른 KI 유지
 * TC4: candidate 여러 개 → irrelevant KI 제거
 * TC5: candidate에 근거 없음 → insufficient/fallback
 * TC6: AI가 candidate 밖 KI ID 반환 → validator reject + ID 제거
 * TC7: Support 요청 1회 → 실제 AI call 1회
 * TC8: usage trace → feature/provider/model/actual_call_count 정상
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  nanoResolve,
  validateNanoOutput,
  buildRecentContext,
  type NanoOutput,
  type NanoParams,
  type RecentMessage,
} from "../support-nano-resolver.js";

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ sql: strings.join("?"), values }),
    { raw: (s: string) => ({ sql: s, values: [] }) }
  ),
}));

// ── OpenAI mock factory ───────────────────────────────────────────────────────

function makeOpenAI(output: Partial<NanoOutput> = {}, callCount = { n: 0 }) {
  const defaultOutput: NanoOutput = {
    selected_knowledge_ids: ["ki_001"],
    answer:                 "X모드는 특별 기능입니다.",
    confidence:             "HIGH",
    insufficient_knowledge: false,
    ...output,
  };
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          callCount.n++;
          return {
            choices: [{ message: { content: JSON.stringify(defaultOutput) } }],
            usage:   { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          };
        }),
      },
    },
  } as any;
}

const BASE_CANDIDATES = [
  { id: "ki_001", item_type: "FAQ",      title: "X모드란",          answer: "X모드는 고급 기능입니다.", score: 80, feature: "x_mode",  category: null, status: "active", revision: 1, updated_at: null, source_type: null },
  { id: "ki_002", item_type: "SOLUTION", title: "X모드 활성화 방법", answer: "설정에서 X모드를 켜세요.",  score: 70, feature: "x_mode",  category: null, status: "active", revision: 1, updated_at: null, source_type: null },
  { id: "ki_003", item_type: "RULE",     title: "환불 정책",         answer: "환불은 30일 이내 가능.",   score: 40, feature: "billing", category: null, status: "active", revision: 1, updated_at: null, source_type: null },
];

const BASE_PARAMS: Omit<NanoParams, "openai"> = {
  query:      "X모드 알려줘",
  role:       "teacher",
  mode:       "normal",
  candidates: BASE_CANDIDATES,
  recentMsgs: [],
  model:      "gpt-4o-mini",
  timeoutMs:  28_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — 정확한 질문 → 관련 KI 선택 → grounded answer
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1. 정확한 질문 → 관련 KI 선택 → grounded answer", () => {
  it("selected_knowledge_ids에 ki_001 포함, confidence=HIGH, insufficient=false", async () => {
    const openai = makeOpenAI({
      selected_knowledge_ids: ["ki_001"],
      answer:                 "X모드는 고급 기능입니다.",
      confidence:             "HIGH",
      insufficient_knowledge: false,
    });

    const result = await nanoResolve({ ...BASE_PARAMS, openai });

    expect(result.error).toBeNull();
    expect(result.output.selected_knowledge_ids).toContain("ki_001");
    expect(result.output.confidence).toBe("HIGH");
    expect(result.output.insufficient_knowledge).toBe(false);
    expect(result.output.answer).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — 표현 변형/동의어 → candidate 중 올바른 KI 선택
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2. 표현 변형/동의어 → candidate 중 올바른 KI 선택", () => {
  it("'x 기능 뭐야' 쿼리에도 ki_001 반환 (Nano가 의미 해석)", async () => {
    const openai = makeOpenAI({
      selected_knowledge_ids: ["ki_001"],
      answer:                 "X모드에 대해 설명합니다.",
      confidence:             "HIGH",
      insufficient_knowledge: false,
    });

    const result = await nanoResolve({
      ...BASE_PARAMS,
      openai,
      query: "x 기능 뭐야",
    });

    expect(result.error).toBeNull();
    expect(result.output.selected_knowledge_ids).toContain("ki_001");
    expect(result.output.confidence).not.toBe("LOW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — follow-up 질문 → 최근 context를 사용해 올바른 KI 유지
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3. follow-up 질문 → 최근 context 사용 → 올바른 KI 유지", () => {
  it("recentMsgs에 X모드 대화가 있으면 ki_001 유지", async () => {
    const recentMsgs: RecentMessage[] = [
      { role: "user", content: "X모드 알려줘" },
      { role: "ai",   content: "X모드는 고급 기능입니다." },
    ];

    const openai = makeOpenAI({
      selected_knowledge_ids: ["ki_001"],
      answer:                 "X모드 설정은 여기서 가능합니다.",
      confidence:             "HIGH",
      insufficient_knowledge: false,
    });

    const result = await nanoResolve({
      ...BASE_PARAMS,
      openai,
      query:      "그럼 어디서 해?",
      recentMsgs,
    });

    expect(result.error).toBeNull();
    expect(result.output.selected_knowledge_ids).toContain("ki_001");
    // Prompt should have been built with context
    const createCall = openai.chat.completions.create.mock.calls[0][0];
    const userContent = createCall.messages.find((m: any) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("이전 대화");
    expect(userContent).toContain("그럼 어디서 해?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — candidate 여러 개 → irrelevant KI 제거
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4. candidate 여러 개 → irrelevant KI 제거", () => {
  it("ki_001/ki_002만 선택 (ki_003 환불 KI는 X모드 질문에 무관 → 제외)", async () => {
    const openai = makeOpenAI({
      selected_knowledge_ids: ["ki_001", "ki_002"],
      answer:                 "X모드 설명 및 활성화 방법입니다.",
      confidence:             "HIGH",
      insufficient_knowledge: false,
    });

    const result = await nanoResolve({ ...BASE_PARAMS, openai });

    expect(result.output.selected_knowledge_ids).toContain("ki_001");
    expect(result.output.selected_knowledge_ids).toContain("ki_002");
    expect(result.output.selected_knowledge_ids).not.toContain("ki_003");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — candidate에 근거 없음 → insufficient/fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5. candidate에 근거 없음 → insufficient/fallback", () => {
  it("insufficient_knowledge=true, selected_knowledge_ids=[], confidence=LOW 반환", async () => {
    const openai = makeOpenAI({
      selected_knowledge_ids: [],
      answer:                 "해당 정보를 찾을 수 없습니다.",
      confidence:             "LOW",
      insufficient_knowledge: true,
    });

    const result = await nanoResolve({
      ...BASE_PARAMS,
      openai,
      query: "스윔노트 창업자 누구야",
    });

    expect(result.output.insufficient_knowledge).toBe(true);
    expect(result.output.selected_knowledge_ids).toHaveLength(0);
    expect(result.output.confidence).toBe("LOW");
    // answer is still present (no empty string)
    expect(result.output.answer.trim()).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — AI가 candidate 밖 KI ID 반환 → validator reject + ID 제거
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6. AI가 candidate 밖 KI ID 반환 → validator reject + ID 제거", () => {
  it("validateNanoOutput: 존재하지 않는 ID는 제거되고 ok=false", () => {
    const output: NanoOutput = {
      selected_knowledge_ids: ["ki_001", "ki_FABRICATED_999"],
      answer:                 "답변입니다.",
      confidence:             "HIGH",
      insufficient_knowledge: false,
    };
    const candidateIds = new Set(["ki_001", "ki_002", "ki_003"]);
    const result = validateNanoOutput(output, candidateIds);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("INVALID_KI_IDS");
    // Fabricated ID should be stripped from output
    expect(output.selected_knowledge_ids).not.toContain("ki_FABRICATED_999");
    expect(output.selected_knowledge_ids).toContain("ki_001");
  });

  it("validateNanoOutput: 전부 invalid ID → insufficient_knowledge=true", () => {
    const output: NanoOutput = {
      selected_knowledge_ids: ["ki_FAKE_A", "ki_FAKE_B"],
      answer:                 "답변입니다.",
      confidence:             "HIGH",
      insufficient_knowledge: false,
    };
    const candidateIds = new Set(["ki_001", "ki_002"]);
    validateNanoOutput(output, candidateIds);

    expect(output.selected_knowledge_ids).toHaveLength(0);
    expect(output.insufficient_knowledge).toBe(true);
  });

  it("validateNanoOutput: insufficient=true + selected_ids 모순 → IDs 비워짐", () => {
    const output: NanoOutput = {
      selected_knowledge_ids: ["ki_001"],
      answer:                 "답변",
      confidence:             "LOW",
      insufficient_knowledge: true,
    };
    const candidateIds = new Set(["ki_001"]);
    const result = validateNanoOutput(output, candidateIds);

    // Contradiction resolved
    expect(output.selected_knowledge_ids).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7 — Support 요청 1회 → 실제 AI call 1회
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7. Support 요청 1회 → 실제 AI call 1회", () => {
  it("nanoResolve 호출 1회 → openai.chat.completions.create 정확히 1회 호출", async () => {
    const callCount = { n: 0 };
    const openai = makeOpenAI({}, callCount);

    await nanoResolve({ ...BASE_PARAMS, openai });

    expect(callCount.n).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8 — usage trace → feature/provider/model/actual_call_count 정상
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8. usage trace → token count 정상 반환", () => {
  it("nanoResult.inputTokens/outputTokens/totalTokens가 OpenAI usage와 일치", async () => {
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({
              selected_knowledge_ids: ["ki_001"],
              answer: "답변",
              confidence: "HIGH",
              insufficient_knowledge: false,
            }) } }],
            usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
          }),
        },
      },
    } as any;

    const result = await nanoResolve({ ...BASE_PARAMS, openai });

    expect(result.error).toBeNull();
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(60);
    expect(result.totalTokens).toBe(180);
  });

  it("LLM error → error='LLM_ERROR', tokens=null", async () => {
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("Network failure")),
        },
      },
    } as any;

    const result = await nanoResolve({ ...BASE_PARAMS, openai });

    expect(result.error).toBe("LLM_ERROR");
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.totalTokens).toBeNull();
    // Fallback output must be present (no crash)
    expect(result.output.answer.trim()).toBeTruthy();
    expect(result.output.insufficient_knowledge).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildRecentContext — DB result parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("buildRecentContext — DB result parsing", () => {
  it("DB rows → RecentMessage[] (reverse chronological → chronological)", async () => {
    const { superAdminDb } = await import("@workspace/db");
    // DB returns rows in DESC order (ORDER BY created_at DESC LIMIT 6)
    // buildRecentContext reverses them → chronological (oldest → newest)
    (superAdminDb.execute as any).mockResolvedValueOnce({
      rows: [
        { author_role: "user", content: "그럼 가격은?" }, // newest
        { author_role: "ai",   content: "X모드 설명"  },
        { author_role: "user", content: "X모드 뭐야"  }, // oldest
      ],
    });

    const msgs = await buildRecentContext("case_001", 3);

    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("X모드 뭐야"); // oldest first after reverse
    expect(msgs[2].role).toBe("user");
  });

  it("DB 오류 → 빈 배열 반환 (non-fatal)", async () => {
    const { superAdminDb } = await import("@workspace/db");
    (superAdminDb.execute as any).mockRejectedValueOnce(new Error("DB down"));

    const msgs = await buildRecentContext("case_001", 3);
    expect(msgs).toHaveLength(0);
  });
});
