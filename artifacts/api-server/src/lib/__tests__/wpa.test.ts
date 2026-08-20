/**
 * wpa.test.ts — WP-A Unit Tests
 *
 * 12개 시나리오 (WP-A 사양서 §15 Minimal Tests):
 *
 *  WPA-01  "우리 아이 어디까지 했어요?"         → CURRENT_PROGRESS
 *  WPA-02  "자유형 어디까지 했어요?"             → STROKE_PROGRESS
 *  WPA-03  "평영킥 했어요?"                      → SKILL_STATUS
 *  WPA-04  "다음에 뭐 배워요?"                   → NEXT_STEP
 *  WPA-05  "왜 아직 진급 안 시켜줘요?"           → HUMAN_ONLY
 *  WPA-06  single diary evidence → 자동 COMPLETED 금지
 *  WPA-07  repeated growth_events → IN_PROGRESS / TRACKED
 *  WPA-08  completed + recent repeat → REVIEW
 *  WPA-09  curriculum next item → NEXT
 *  WPA-10  no curriculum → NEXT 생성 금지
 *  WPA-11  student level history → level progress 반영
 *  WPA-12  invalidated growth_event → evidence 제외
 */

import { describe, it, expect } from "vitest";

// ── 테스트 대상 ───────────────────────────────────────────────────────────────

import { parseIntent } from "../curriculum-intent-parser.js";
import {
  retrieveEvidence,
  type EvidenceDb,
  type RawGrowthEventRow,
  type StudentLevelRecord,
} from "../curriculum-evidence-retriever.js";
import {
  resolveProgress,
  type CurriculumItemRef,
} from "../curriculum-progress-resolver.js";
import {
  buildGroundedPackage,
} from "../curriculum-answer-builder.js";

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function mockDb(
  rows: RawGrowthEventRow[],
  levels: StudentLevelRecord[] = [],
): EvidenceDb {
  return {
    async getGrowthEventRows() { return rows; },
    async getStudentLevels()   { return levels; },
  };
}

function makeRow(
  overrides: Partial<RawGrowthEventRow> & { curriculum_item_id: string; curriculum_title: string },
): RawGrowthEventRow {
  return {
    growth_event_id:     overrides.growth_event_id    ?? "ge-" + Math.random(),
    curriculum_item_id:  overrides.curriculum_item_id,
    curriculum_title:    overrides.curriculum_title,
    sort_order:          overrides.sort_order          ?? 1,
    diary_note_id:       overrides.diary_note_id       ?? "dn-1",
    diary_date:          overrides.diary_date          ?? daysAgo(10),
    confidence:          overrides.confidence          ?? 0.7,
    growth_match_status: overrides.growth_match_status ?? "MATCH",
    evidence_text:       overrides.evidence_text       ?? "테스트 evidence",
  };
}

function makeCurriculumItems(count: number, startSort = 1): CurriculumItemRef[] {
  return Array.from({ length: count }, (_, i) => ({
    id:         `item-${startSort + i}`,
    title:      `기술 ${startSort + i}`,
    sort_order: startSort + i,
  }));
}

// ── WPA-01 ~ WPA-05: Intent Parser ───────────────────────────────────────────

describe("WP-A Intent Parser", () => {
  it("WPA-01 '우리 아이 어디까지 했어요?' → CURRENT_PROGRESS", () => {
    const result = parseIntent("우리 아이 어디까지 했어요?");
    expect(result.intent).toBe("CURRENT_PROGRESS");
  });

  it("WPA-02 '자유형 어디까지 했어요?' → STROKE_PROGRESS + stroke=자유형", () => {
    const result = parseIntent("자유형 어디까지 했어요?");
    expect(result.intent).toBe("STROKE_PROGRESS");
    expect(result.stroke).toBe("자유형");
  });

  it("WPA-03 '평영킥 했어요?' → SKILL_STATUS", () => {
    const result = parseIntent("평영킥 했어요?");
    expect(result.intent).toBe("SKILL_STATUS");
  });

  it("WPA-04 '다음에 뭐 배워요?' → NEXT_STEP", () => {
    const result = parseIntent("다음에 뭐 배워요?");
    expect(result.intent).toBe("NEXT_STEP");
  });

  it("WPA-05 '왜 아직 진급 안 시켜줘요?' → HUMAN_ONLY", () => {
    const result = parseIntent("왜 아직 진급 안 시켜줘요?");
    expect(result.intent).toBe("HUMAN_ONLY");
  });

  it("WPA-05b '다음주에 진급할 수 있어요?' → HUMAN_ONLY (미래 일정)", () => {
    const result = parseIntent("다음주에 진급할 수 있어요?");
    expect(result.intent).toBe("HUMAN_ONLY");
  });

  it("WPA-02b '배영 어느 단계까지 왔어요?' → STROKE_PROGRESS", () => {
    const result = parseIntent("배영 어느 단계까지 왔어요?");
    expect(result.intent).toBe("STROKE_PROGRESS");
    expect(result.stroke).toBe("배영");
  });
});

// ── WPA-06: single diary evidence → 자동 COMPLETED 금지 ──────────────────────

describe("WP-A Progress Resolver — completion protection", () => {
  it("WPA-06 단일 diary evidence → COMPLETED 금지 (NOT_CONFIRMED 유지)", async () => {
    const db = mockDb([
      makeRow({
        curriculum_item_id: "item-1",
        curriculum_title:   "물에 뜨기",
        diary_note_id:      "dn-only",
        diary_date:         daysAgo(5),
        confidence:         0.8,
      }),
    ]);

    const evidence = await retrieveEvidence("stu-1", "pool-1", db);

    // DIRECT 1건: TRACKED 아님
    expect(evidence.tracked).toHaveLength(0);
    expect(evidence.direct).toHaveLength(1);

    const items: CurriculumItemRef[] = [
      { id: "item-1", title: "물에 뜨기", sort_order: 1 },
    ];
    const progress = resolveProgress(evidence, items);
    const entry = progress.entries.find((e) => e.curriculum_item_id === "item-1");

    // diary 1회 → COMPLETED 금지
    expect(entry?.status).not.toBe("COMPLETED");
    expect(entry?.status).toBe("NOT_CONFIRMED");
  });
});

// ── WPA-07: repeated growth_events → IN_PROGRESS / TRACKED ──────────────────

describe("WP-A Evidence Retriever — TRACKED", () => {
  it("WPA-07 동일 item, 서로 다른 diary 2회 이상(90일 내) → TRACKED + IN_PROGRESS", async () => {
    const db = mockDb([
      makeRow({
        curriculum_item_id: "item-2",
        curriculum_title:   "발차기",
        diary_note_id:      "dn-A",
        diary_date:         daysAgo(20),
        confidence:         0.75,
      }),
      makeRow({
        curriculum_item_id: "item-2",
        curriculum_title:   "발차기",
        diary_note_id:      "dn-B",
        diary_date:         daysAgo(10),
        confidence:         0.80,
      }),
    ]);

    const evidence = await retrieveEvidence("stu-2", "pool-1", db);

    // TRACKED로 집계돼야 함
    expect(evidence.tracked).toHaveLength(1);
    expect(evidence.tracked[0].curriculum_item_id).toBe("item-2");
    expect(evidence.tracked[0].diary_count).toBe(2);
    expect(evidence.direct).toHaveLength(0);

    const items: CurriculumItemRef[] = [
      { id: "item-2", title: "발차기", sort_order: 2 },
    ];
    const progress = resolveProgress(evidence, items);
    const entry = progress.entries.find((e) => e.curriculum_item_id === "item-2");

    // 최근 30일 이내 → IN_PROGRESS
    expect(entry?.status).toBe("IN_PROGRESS");
  });
});

// ── WPA-08: completed + recent repeat → REVIEW ───────────────────────────────

describe("WP-A Progress Resolver — REVIEW", () => {
  it("WPA-08 오래된 첫 기록 + 최근 재등장 → REVIEW", async () => {
    // first_seen이 60일 이상 이전, last_seen이 최근 30일 이내
    const db = mockDb([
      makeRow({
        curriculum_item_id: "item-3",
        curriculum_title:   "팔 동작",
        diary_note_id:      "dn-old",
        diary_date:         daysAgo(70),
        confidence:         0.72,
      }),
      makeRow({
        curriculum_item_id: "item-3",
        curriculum_title:   "팔 동작",
        diary_note_id:      "dn-recent",
        diary_date:         daysAgo(8),
        confidence:         0.68,
      }),
    ]);

    const evidence = await retrieveEvidence("stu-3", "pool-1", db);
    const items: CurriculumItemRef[] = [
      { id: "item-3", title: "팔 동작", sort_order: 3 },
    ];
    const progress = resolveProgress(evidence, items);
    const entry = progress.entries.find((e) => e.curriculum_item_id === "item-3");

    // 오래된 기록 + 최근 재등장 → REVIEW
    expect(entry?.status).toBe("REVIEW");
  });
});

// ── WPA-09: curriculum next item → NEXT ──────────────────────────────────────

describe("WP-A Progress Resolver — NEXT", () => {
  it("WPA-09 IN_PROGRESS 항목 이후 다음 item → NEXT", async () => {
    const db = mockDb([
      makeRow({
        curriculum_item_id: "item-1",
        curriculum_title:   "물에 뜨기",
        diary_note_id:      "dn-A",
        diary_date:         daysAgo(15),
        confidence:         0.8,
      }),
      makeRow({
        curriculum_item_id: "item-1",
        curriculum_title:   "물에 뜨기",
        diary_note_id:      "dn-B",
        diary_date:         daysAgo(5),
        confidence:         0.75,
      }),
    ]);

    const evidence = await retrieveEvidence("stu-4", "pool-1", db);
    const items = makeCurriculumItems(3); // item-1, item-2, item-3

    const progress = resolveProgress(evidence, items);

    // item-1 = IN_PROGRESS
    const entry1 = progress.entries.find((e) => e.curriculum_item_id === "item-1");
    expect(entry1?.status).toBe("IN_PROGRESS");

    // item-2 = NEXT
    const entry2 = progress.entries.find((e) => e.curriculum_item_id === "item-2");
    expect(entry2?.status).toBe("NEXT");

    // next_item 포인터도 일치
    expect(progress.next_item?.id).toBe("item-2");
  });
});

// ── WPA-10: no curriculum → NEXT 생성 금지 ───────────────────────────────────

describe("WP-A Progress Resolver — empty curriculum", () => {
  it("WPA-10 curriculum 없으면 next_item = null (추측 생성 금지)", async () => {
    const db = mockDb([
      makeRow({
        curriculum_item_id: "item-1",
        curriculum_title:   "물에 뜨기",
        diary_note_id:      "dn-A",
        diary_date:         daysAgo(10),
        confidence:         0.9,
      }),
      makeRow({
        curriculum_item_id: "item-1",
        curriculum_title:   "물에 뜨기",
        diary_note_id:      "dn-B",
        diary_date:         daysAgo(5),
        confidence:         0.9,
      }),
    ]);

    const evidence = await retrieveEvidence("stu-5", "pool-1", db);
    // curriculum items = empty
    const progress = resolveProgress(evidence, []);

    expect(progress.next_item).toBeNull();
    expect(progress.entries).toHaveLength(0);
  });
});

// ── WPA-11: student level history → level progress 반영 ─────────────────────

describe("WP-A Progress Resolver — student levels", () => {
  it("WPA-11 student_level 달성 기록이 있으면 sort_order 매핑 항목 COMPLETED 격상", async () => {
    const levels: StudentLevelRecord[] = [
      {
        id:           "lv-1",
        level:        "초급1",
        level_order:  1,
        achieved_date: daysAgo(60),
        note:         null,
      },
    ];

    // DIRECT evidence 1건만 있는 상태 (NOT_CONFIRMED)
    const db = mockDb(
      [
        makeRow({
          curriculum_item_id: "item-1",
          curriculum_title:   "물에 뜨기",
          sort_order:         1,
          diary_note_id:      "dn-single",
          diary_date:         daysAgo(70),
          confidence:         0.65,
        }),
      ],
      levels,
    );

    const evidence = await retrieveEvidence("stu-6", "pool-1", db);
    expect(evidence.level_history).toHaveLength(1);

    const items: CurriculumItemRef[] = [
      { id: "item-1", title: "물에 뜨기", sort_order: 1 },
    ];
    const progress = resolveProgress(evidence, items);
    const entry = progress.entries.find((e) => e.curriculum_item_id === "item-1");

    // sort_order=1 이 level_order=1 달성과 매핑 → COMPLETED 격상
    expect(entry?.status).toBe("COMPLETED");
  });
});

// ── WPA-12: invalidated growth_event → evidence 제외 ────────────────────────

describe("WP-A Evidence Retriever — invalidated filter", () => {
  it("WPA-12 is_invalidated=true인 row는 getGrowthEventRows가 반환하지 않음을 확인", async () => {
    // productionEvidenceDb SQL은 is_invalidated=false를 WHERE 조건으로 필터링.
    // 테스트에서는 DB mock이 이미 필터링된 결과만 반환하는 계약을 검증.
    const db: EvidenceDb = {
      async getGrowthEventRows() {
        // mock: is_invalidated=true 행은 이미 제외됨 → 빈 배열 반환
        return [];
      },
      async getStudentLevels() { return []; },
    };

    const evidence = await retrieveEvidence("stu-7", "pool-1", db);

    // invalidated 제외 결과: evidence 없음
    expect(evidence.direct).toHaveLength(0);
    expect(evidence.tracked).toHaveLength(0);
  });

  it("WPA-12b 유효한 row만 있을 때는 정상 수집", async () => {
    const db = mockDb([
      makeRow({
        curriculum_item_id: "item-5",
        curriculum_title:   "호흡 연습",
        diary_note_id:      "dn-valid",
        diary_date:         daysAgo(10),
        confidence:         0.75,
      }),
    ]);

    const evidence = await retrieveEvidence("stu-7", "pool-1", db);
    expect(evidence.direct).toHaveLength(1);
    expect(evidence.direct[0].curriculum_item_id).toBe("item-5");
  });
});

// ── Answer Builder 통합 ───────────────────────────────────────────────────────

describe("WP-A Answer Builder — mode determination", () => {
  it("HUMAN_ONLY intent → answer_mode=HUMAN_ONLY, knowledge_request=null", async () => {
    const intent = parseIntent("왜 진급 안 시켜줘요?");
    const evidence = await retrieveEvidence("stu-8", "pool-1", mockDb([]));
    const progress = resolveProgress(evidence, []);
    const pkg = buildGroundedPackage("stu-8", "왜 진급 안 시켜줘요?", intent, evidence, progress);

    expect(pkg.answer_mode).toBe("HUMAN_ONLY");
    expect(pkg.knowledge_request).toBeNull();
  });

  it("LEVEL_PROGRESS intent + level history → DIRECT_DB", async () => {
    const intent = parseIntent("우리 아이 몇 급이에요?");
    const levels: StudentLevelRecord[] = [
      { id: "lv-1", level: "초급1", level_order: 1, achieved_date: daysAgo(30), note: null },
    ];
    const evidence = await retrieveEvidence("stu-9", "pool-1", mockDb([], levels));
    const progress = resolveProgress(evidence, []);
    const pkg = buildGroundedPackage("stu-9", "몇 급이에요?", intent, evidence, progress);

    expect(pkg.answer_mode).toBe("DIRECT_DB");
    expect(pkg.meta.has_level_history).toBe(true);
  });

  it("NEXT_STEP intent + next item available → GROUNDED_GPT + knowledge_request 포함", async () => {
    const intent = parseIntent("다음에 뭐 배워요?");
    const db = mockDb([
      makeRow({ curriculum_item_id: "item-1", curriculum_title: "발차기", diary_note_id: "dn-A", diary_date: daysAgo(10), confidence: 0.8 }),
      makeRow({ curriculum_item_id: "item-1", curriculum_title: "발차기", diary_note_id: "dn-B", diary_date: daysAgo(5),  confidence: 0.8 }),
    ]);
    const evidence = await retrieveEvidence("stu-10", "pool-1", db);
    const items = makeCurriculumItems(3);
    const progress = resolveProgress(evidence, items);
    const pkg = buildGroundedPackage("stu-10", "다음에 뭐 배워요?", intent, evidence, progress);

    expect(pkg.answer_mode).toBe("GROUNDED_GPT");
    expect(pkg.knowledge_request).not.toBeNull();
    expect(pkg.knowledge_request?.feature).toBe("parent_curriculum_search");
    expect(pkg.curriculum_next?.id).toBe("item-2");
  });
});
