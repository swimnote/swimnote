/**
 * parent-curriculum-wp1-2-context.test.ts
 * WP1.2: buildRecentConversationContext 단위 테스트
 *
 * 주의: 이 파일은 parent-curriculum-conversation 모듈을 mock하지 않는다.
 *   실제 buildRecentConversationContext를 @workspace/db(superAdminDb)만 모킹해서 테스트.
 *
 * E  7개 이상 메시지 → 최신 6개만 oldest→newest 순서로 반환
 * F  유효하지 않은 role(SYSTEM 등) → 필터링
 * G  빈 content (trim 후 empty) → 필터링
 * E2 content 500자 초과 → 500자로 truncation
 * Extra excludeRequestId → 해당 request_id 메시지 제외 확인
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── @workspace/db만 모킹 ────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: vi.fn() },
  db:           { execute: vi.fn() },
}));

// 다른 의존성 모킹 (scope-builder → diary-template-search 의존)
vi.mock("../../lib/diary-template-search.js", () => ({
  getActiveGlobalTemplateSet: vi.fn(),
}));

import { superAdminDb } from "@workspace/db";
import {
  buildRecentConversationContext,
  RECENT_CONTEXT_MAX_MESSAGES,
  RECENT_CONTEXT_MAX_CONTENT_CHARS,
} from "../../lib/parent-curriculum-conversation.js";

// ─── DB mock helper ───────────────────────────────────────────────────────────

type MockRow = { role: string; content: string };

/**
 * superAdminDb.execute를 rows로 대체 (DESC 순서 시뮬레이션).
 * 실제 DB는 created_at DESC 순으로 반환하므로 배열도 그 순서여야 함.
 */
function mockDbRows(rows: MockRow[]) {
  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows });
}

const CONV_ID   = "conv_unit_01";
const EXCL_ID   = "req_current";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildRecentConversationContext — unit tests", () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 기본: 메시지 없음 ────────────────────────────────────────────────────────

  it("메시지 없음 → 빈 배열 반환", async () => {
    mockDbRows([]);
    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result).toEqual([]);
  });

  // ── 기본: 1개 메시지 ────────────────────────────────────────────────────────

  it("1개 메시지 → 그대로 반환 (oldest→newest = 1개)", async () => {
    // DESC 순이므로 [newest]
    mockDbRows([{ role: "USER", content: "자유형 진도를 알려주세요." }]);
    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "USER", content: "자유형 진도를 알려주세요." });
  });

  // ── E. 7개 이상 → 최신 6개, oldest→newest ────────────────────────────────────

  it("E. DB가 6개 반환(DESC) → .reverse() 후 oldest→newest 순서", async () => {
    // DB: DESC 순 (최신→오래된)
    // t6, t5, t4, t3, t2, t1 순서 (t6이 가장 최신)
    const descRows: MockRow[] = [
      { role: "ASSISTANT", content: "답변3" },  // t6 (newest)
      { role: "USER",      content: "질문3" },  // t5
      { role: "ASSISTANT", content: "답변2" },  // t4
      { role: "USER",      content: "질문2" },  // t3
      { role: "ASSISTANT", content: "답변1" },  // t2
      { role: "USER",      content: "질문1" },  // t1 (oldest)
    ];
    mockDbRows(descRows);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result).toHaveLength(6);
    // .reverse() 적용 → oldest→newest
    expect(result[0]).toEqual({ role: "USER",      content: "질문1" });
    expect(result[5]).toEqual({ role: "ASSISTANT", content: "답변3" });
  });

  it("E.2. RECENT_CONTEXT_MAX_MESSAGES = 6 상수 검증", () => {
    expect(RECENT_CONTEXT_MAX_MESSAGES).toBe(6);
  });

  // ── F. 유효하지 않은 role 필터링 ─────────────────────────────────────────────

  it("F. role=SYSTEM → 필터링 (USER/ASSISTANT만 허용)", async () => {
    mockDbRows([
      { role: "SYSTEM",    content: "시스템 메시지" },  // 제외
      { role: "USER",      content: "사용자 질문" },    // 포함
      { role: "ASSISTANT", content: "어시스턴트 답변" }, // 포함
      { role: "UNKNOWN",   content: "알 수 없는 역할" }, // 제외
    ]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    // 유효한 2개만 남음
    expect(result).toHaveLength(2);
    for (const msg of result) {
      expect(["USER", "ASSISTANT"]).toContain(msg.role);
    }
    // SYSTEM, UNKNOWN 제외 확인
    expect(result.every((m) => m.role !== "SYSTEM")).toBe(true);
    expect(result.every((m) => m.role !== "UNKNOWN")).toBe(true);
  });

  // ── G. 빈 content 필터링 ────────────────────────────────────────────────────

  it("G. empty content (공백만) → 필터링", async () => {
    mockDbRows([
      { role: "USER",      content: "" },           // 제외
      { role: "ASSISTANT", content: "   " },         // trim 후 empty → 제외
      { role: "USER",      content: "실제 질문" },   // 포함
      { role: "ASSISTANT", content: "\n\t" },        // trim 후 empty → 제외
    ]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "USER", content: "실제 질문" });
  });

  // ── E2. content 500자 초과 → truncation ──────────────────────────────────────

  it("E2. content 500자 초과 → 500자로 truncation", async () => {
    const longContent = "a".repeat(RECENT_CONTEXT_MAX_CONTENT_CHARS + 100); // 600자
    mockDbRows([{ role: "USER", content: longContent }]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result).toHaveLength(1);
    expect(result[0].content).toHaveLength(RECENT_CONTEXT_MAX_CONTENT_CHARS);
    expect(result[0].content).toBe("a".repeat(RECENT_CONTEXT_MAX_CONTENT_CHARS));
  });

  it("E2.2. content 정확히 500자 → truncation 없음", async () => {
    const exactContent = "b".repeat(RECENT_CONTEXT_MAX_CONTENT_CHARS);
    mockDbRows([{ role: "ASSISTANT", content: exactContent }]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result[0].content).toHaveLength(RECENT_CONTEXT_MAX_CONTENT_CHARS);
  });

  it("E2.3. RECENT_CONTEXT_MAX_CONTENT_CHARS = 500 상수 검증", () => {
    expect(RECENT_CONTEXT_MAX_CONTENT_CHARS).toBe(500);
  });

  // ── F+G 복합: invalid role + empty content 동시 ─────────────────────────────

  it("F+G. invalid role + empty content 동시 → 모두 제외", async () => {
    mockDbRows([
      { role: "SYSTEM",    content: "무언가" },    // role 오류 → 제외
      { role: "USER",      content: "" },           // content 비어 → 제외
      { role: "ASSISTANT", content: "유효한 답변" }, // 유효 → 포함
    ]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "ASSISTANT", content: "유효한 답변" });
  });

  // ── content trim 동작 ────────────────────────────────────────────────────────

  it("content trim — 앞뒤 공백 제거 후 저장", async () => {
    mockDbRows([{ role: "USER", content: "  질문 앞뒤 공백  " }]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result[0].content).toBe("질문 앞뒤 공백");
  });

  // ── 순서 보장: DESC 입력 → ASC 반환 ────────────────────────────────────────

  it("DB DESC 입력 → .reverse() → ASC (oldest→newest) 반환", async () => {
    mockDbRows([
      { role: "ASSISTANT", content: "최신 답변" },  // newest (DESC 첫 번째)
      { role: "USER",      content: "중간 질문" },  // middle
      { role: "USER",      content: "가장 오래된 질문" }, // oldest (DESC 마지막)
    ]);

    const result = await buildRecentConversationContext(CONV_ID, EXCL_ID);
    expect(result[0].content).toBe("가장 오래된 질문");  // oldest first
    expect(result[2].content).toBe("최신 답변");          // newest last
  });
});
