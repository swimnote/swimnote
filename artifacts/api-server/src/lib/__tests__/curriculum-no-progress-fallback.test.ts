/**
 * curriculum-no-progress-fallback.test.ts
 *
 * [PARENT CURRICULUM NO-PROGRESS FALLBACK FIX] 검증.
 *
 * evidence=0인 상황에서:
 *   - CURRICULUM_GENERAL intent → GROUNDED_GPT (pool curriculum 검색 경로)
 *   - PERSONAL_PROGRESS intent → DIRECT_DB (개인 데이터 없음 안내 유지)
 *
 * 테스트 대상:
 *   parseIntent()        — curriculum-intent-parser.ts
 *   determineAnswerMode() — curriculum-answer-builder.ts 내부 로직 (buildGroundedPackage 통해 검증)
 */

import { parseIntent } from "../curriculum-intent-parser.js";
import { buildGroundedPackage } from "../curriculum-answer-builder.js";
import type { EvidenceBundle } from "../curriculum-evidence-retriever.js";
import type { ProgressResolution } from "../curriculum-progress-resolver.js";

// ── 공통 픽스처 ──────────────────────────────────────────────────────────────

const EMPTY_EVIDENCE: EvidenceBundle = {
  direct:        [],
  tracked:       [],
  inferred:      [],
  level_history: [],
  retrieved_at:  "2026-08-01T00:00:00Z",
};

const EMPTY_PROGRESS: ProgressResolution = {
  entries:                  [],
  highest_confirmed_item:   null,
  next_item:                null,
};

function answerMode(query: string): string {
  const intent   = parseIntent(query);
  const pkg      = buildGroundedPackage("s1", query, intent, EMPTY_EVIDENCE, EMPTY_PROGRESS);
  return pkg.answer_mode;
}

// ── CASE 1: evidence=0 + "접영 언제배워?" → GROUNDED_GPT ────────────────────

describe("curriculum-no-progress-fallback — CURRICULUM_GENERAL queries", () => {
  it("case 1: '접영 언제배워?' → intent=CURRICULUM_GENERAL, mode=GROUNDED_GPT", () => {
    const intent = parseIntent("접영 언제배워?");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("접영 언제배워?")).toBe("GROUNDED_GPT");
  });

  it("case 1b: '접영 언제 배워?' (space) → CURRICULUM_GENERAL", () => {
    const intent = parseIntent("접영 언제 배워?");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
  });

  it("case 2: '자유형킥은 언제 해?' → CURRICULUM_GENERAL, GROUNDED_GPT", () => {
    const intent = parseIntent("자유형킥은 언제 해요?");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("자유형킥은 언제 해요?")).toBe("GROUNDED_GPT");
  });

  it("case 2b: '자유형킥' (단어만) → CURRICULUM_GENERAL LOW (stroke-only fallback)", () => {
    const intent = parseIntent("자유형킥");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(intent.confidence).toBe("LOW");
    expect(answerMode("자유형킥")).toBe("GROUNDED_GPT");
  });

  it("case 3: '발차기' → CURRICULUM_GENERAL, GROUNDED_GPT", () => {
    const intent = parseIntent("발차기");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("발차기")).toBe("GROUNDED_GPT");
  });

  it("case 3b: '발차기는 어떻게 배우는 과정이야?' → CURRICULUM_GENERAL", () => {
    const intent = parseIntent("발차기는 어떻게 배우는 과정이야?");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("발차기는 어떻게 배우는 과정이야?")).toBe("GROUNDED_GPT");
  });

  it("'평영 다음에 뭐 배워?' → CURRICULUM_GENERAL or NEXT_STEP, GROUNDED_GPT", () => {
    // "언제 배워" 없음 → NEXT_STEP ("다음에") or CURRICULUM_GENERAL → both GROUNDED_GPT
    const intent = parseIntent("평영 다음에 뭐 배워?");
    expect(["CURRICULUM_GENERAL", "NEXT_STEP"]).toContain(intent.intent);
    expect(answerMode("평영 다음에 뭐 배워?")).toBe("GROUNDED_GPT");
  });

  it("'우리 수영장 접영 과정 알려줘' → CURRICULUM_GENERAL ('과정 알려' trigger)", () => {
    const intent = parseIntent("우리 수영장 접영 과정 알려줘");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("우리 수영장 접영 과정 알려줘")).toBe("GROUNDED_GPT");
  });

  it("'자유형 과정 알려줘' → CURRICULUM_GENERAL", () => {
    const intent = parseIntent("자유형 과정 알려줘");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("자유형 과정 알려줘")).toBe("GROUNDED_GPT");
  });

  it("stroke 포함 CURRICULUM_GENERAL → stroke 필드 존재", () => {
    const intent = parseIntent("접영 언제 배워?");
    expect(intent.stroke).toBe("접영");
  });
});

// ── CASE 4 & 5: 개인 진도 질문 ────────────────────────────────────────────────

describe("curriculum-no-progress-fallback — personal progress queries (evidence=0)", () => {
  it("case 4: '우리 아이 지금 어디까지 했어?' → CURRENT_PROGRESS, DIRECT_DB", () => {
    const intent = parseIntent("우리 아이 지금 어디까지 했어?");
    expect(intent.intent).toBe("CURRENT_PROGRESS");
    expect(answerMode("우리 아이 지금 어디까지 했어?")).toBe("DIRECT_DB");
  });

  it("'어디까지 했어요?' (no personal marker) → CURRENT_PROGRESS, DIRECT_DB", () => {
    // CURRENT_PROGRESS trigger without personal marker still → CURRENT_PROGRESS
    const intent = parseIntent("어디까지 했어요?");
    expect(intent.intent).toBe("CURRENT_PROGRESS");
    expect(answerMode("어디까지 했어요?")).toBe("DIRECT_DB");
  });

  it("case 5: '우리 아이 접영 언제 배워?' → CURRICULUM_GENERAL (언제 배워 trigger wins), GROUNDED_GPT", () => {
    // "언제 배워" trigger fires before personal-marker check per spec §6
    const intent = parseIntent("우리 아이 접영 언제 배워?");
    expect(intent.intent).toBe("CURRICULUM_GENERAL");
    expect(answerMode("우리 아이 접영 언제 배워?")).toBe("GROUNDED_GPT");
  });
});

// ── CASE 6: cross-pool contamination 없음 — intent 레벨에서 pool isolation 확인 ─

describe("curriculum-no-progress-fallback — CURRICULUM_INFO still works", () => {
  it("'커리큘럼' → CURRICULUM_INFO, GROUNDED_GPT (기존 유지)", () => {
    const intent = parseIntent("커리큘럼 알려줘");
    expect(intent.intent).toBe("CURRICULUM_INFO");
    expect(answerMode("커리큘럼 알려줘")).toBe("GROUNDED_GPT");
  });

  it("'빨간 레벨에서는 뭐 배워?' → CURRICULUM_INFO or CURRICULUM_GENERAL, GROUNDED_GPT", () => {
    const intent = parseIntent("빨간 레벨에서는 뭐 배워?");
    expect(["CURRICULUM_GENERAL", "CURRICULUM_INFO", "LEVEL_PROGRESS"]).toContain(intent.intent);
    expect(answerMode("빨간 레벨에서는 뭐 배워?")).toBe("GROUNDED_GPT");
  });
});

// ── CASE 7: Normal 경로 unchanged ─────────────────────────────────────────────

describe("curriculum-no-progress-fallback — normal intent paths unchanged", () => {
  it("HUMAN_ONLY still highest priority", () => {
    const intent = parseIntent("언제 진급 시켜줘요?");
    expect(intent.intent).toBe("HUMAN_ONLY");
  });

  it("STROKE_PROGRESS still fires for personal progress query", () => {
    const intent = parseIntent("자유형 어디까지 했어요?");
    expect(intent.intent).toBe("STROKE_PROGRESS");
    expect(intent.stroke).toBe("자유형");
  });

  it("NEXT_STEP fires for '다음에 뭐 배워요?'", () => {
    const intent = parseIntent("다음에 뭐 배워요?");
    expect(intent.intent).toBe("NEXT_STEP");
  });

  it("RECENT_LESSONS fires for '요즘 뭐 배워요?'", () => {
    const intent = parseIntent("요즘 뭐 배워요?");
    expect(intent.intent).toBe("RECENT_LESSONS");
  });

  it("LEVEL_PROGRESS fires for '몇 급이에요?'", () => {
    const intent = parseIntent("몇 급이에요?");
    expect(intent.intent).toBe("LEVEL_PROGRESS");
  });
});

// ── CASE 8: CURRICULUM_GENERAL quota=0 (DIRECT_DB 아닌 GROUNDED_GPT이므로 quota 차감) ─
// quota 로직은 라우터 레벨 — 여기선 answer_mode가 GROUNDED_GPT임을 확인
describe("curriculum-no-progress-fallback — quota behavior", () => {
  it("CURRICULUM_GENERAL → GROUNDED_GPT (quota +1 경로)", () => {
    expect(answerMode("접영 언제 배워?")).toBe("GROUNDED_GPT");
  });

  it("CURRENT_PROGRESS + no evidence → DIRECT_DB (quota 0)", () => {
    expect(answerMode("어디까지 했나요?")).toBe("DIRECT_DB");
  });
});
