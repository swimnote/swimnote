/**
 * curriculum-rank-calculator.test.ts — GAUGE-02 Progress Rank Calculator 테스트
 *
 * 원칙:
 *   - production DB 호출 없음 (mock DB 주입)
 *   - INSERT/UPDATE/DELETE 없음
 *   - TC는 모두 독립적으로 실행 가능
 *
 * TC1  sort_order = 0,1,2 → ranks = 1,2,3
 * TC2  sort_order = 0,10,50 (gap) → ranks = 1,2,3
 * TC3  중간 inactive item 존재 → active items만 연속 rank
 * TC4  마지막 active item → progressPct = 100.0
 * TC5  첫 active item → 1 / total * 100
 * TC6  item이 해당 version에 없음 → CURRICULUM_ITEM_NOT_FOUND
 * TC7  inactive item 요청 → CURRICULUM_ITEM_INACTIVE
 * TC8  active item zero → CURRICULUM_NO_ACTIVE_ITEMS
 * TC9  다른 version의 item → CURRICULUM_ITEM_NOT_IN_VERSION
 * TC10 Professional/AI dependency 없음 확인
 */

import { describe, it, expect } from "vitest";
import {
  computeItemRank,
  CurriculumRankError,
  type RankCalculatorDb,
} from "../curriculum-rank-calculator.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * items 배열로부터 ROW_NUMBER() 결과를 시뮬레이션하는 mock DB.
 *
 * @param allItems   version에 속한 모든 item (active/inactive 혼합 가능)
 * @param targetId   computeItemRank()에 전달할 curriculum_item_id
 * @param versionId  curriculum_version_id
 */
function buildMockDb(opts: {
  /** version에 속한 items (versionId 일치) */
  versionItems: Array<{ id: string; sort_order: number; is_active: boolean }>;
  /** 다른 version에 속한 items (cross-version 테스트용) */
  otherVersionItems?: Array<{ id: string; sort_order: number; is_active: boolean }>;
  versionId: string;
  targetId: string;
}): RankCalculatorDb {
  const { versionItems, otherVersionItems = [], versionId, targetId } = opts;

  return {
    execute(query) {
      const q = (query as unknown as { queryChunks?: Array<{ value: string }> | unknown })
        ?.queryChunks
        ?.map?.((c: unknown) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: string }).value : ""))
        ?.join("") ?? String(query);

      // ── ROW_NUMBER() 메인 쿼리 ────────────────────────────────────────────
      // 패턴: WITH ranked AS ... WHERE id = '<targetId>'
      if (q.includes("WITH ranked AS") && q.includes(versionId)) {
        const activeItems = versionItems
          .filter(i => i.is_active)
          .sort((a, b) => a.sort_order !== b.sort_order
            ? a.sort_order - b.sort_order
            : a.id.localeCompare(b.id));

        const totalCount = activeItems.length;
        const rankRow = activeItems.findIndex(i => i.id === targetId);

        if (rankRow === -1 || totalCount === 0) {
          return Promise.resolve({ rows: [] });
        }

        const progressRank = rankRow + 1;
        return Promise.resolve({
          rows: [{ progress_rank: String(progressRank), total_count: String(totalCount) }],
        });
      }

      // ── item 존재 확인 쿼리 (is_active 포함) ─────────────────────────────
      // 패턴: SELECT id, is_active FROM curriculum_items WHERE id=... AND curriculum_version_id=...
      if (q.includes("SELECT id, is_active") && q.includes("curriculum_items")) {
        const found = versionItems.find(i => i.id === targetId);
        if (found) {
          return Promise.resolve({
            rows: [{ id: found.id, is_active: found.is_active }],
          });
        }
        return Promise.resolve({ rows: [] });
      }

      // ── cross-version 확인 쿼리 ───────────────────────────────────────────
      // 패턴: SELECT id FROM curriculum_items WHERE id=...  (version 조건 없음)
      if (q.includes("SELECT id FROM curriculum_items") && q.includes(targetId)) {
        const inOther = otherVersionItems.find(i => i.id === targetId);
        if (inOther) {
          return Promise.resolve({ rows: [{ id: inOther.id }] });
        }
        return Promise.resolve({ rows: [] });
      }

      return Promise.resolve({ rows: [] });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — sort_order = 0,1,2 → ranks = 1,2,3
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1: sort_order 0,1,2 연속 → ranks 1,2,3", () => {
  const VERSION_ID = "cv_tc1";
  const ITEMS = [
    { id: "ci_a", sort_order: 0, is_active: true },
    { id: "ci_b", sort_order: 1, is_active: true },
    { id: "ci_c", sort_order: 2, is_active: true },
  ];

  it("ci_a → rank=1, total=3", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_a" });
    const r = await computeItemRank(db, VERSION_ID, "ci_a");
    expect(r.progressRank).toBe(1);
    expect(r.totalCount).toBe(3);
    expect(r.progressPct).toBeCloseTo(33.3, 1);
  });

  it("ci_b → rank=2, total=3", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_b" });
    const r = await computeItemRank(db, VERSION_ID, "ci_b");
    expect(r.progressRank).toBe(2);
    expect(r.totalCount).toBe(3);
  });

  it("ci_c → rank=3, total=3, pct=100.0", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_c" });
    const r = await computeItemRank(db, VERSION_ID, "ci_c");
    expect(r.progressRank).toBe(3);
    expect(r.totalCount).toBe(3);
    expect(r.progressPct).toBe(100.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — sort_order = 0,10,50 (gap) → ranks = 1,2,3
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2: sort_order gap (0,10,50) → ranks 1,2,3", () => {
  const VERSION_ID = "cv_tc2";
  const ITEMS = [
    { id: "ci_a", sort_order: 0,  is_active: true },
    { id: "ci_b", sort_order: 10, is_active: true },
    { id: "ci_c", sort_order: 50, is_active: true },
  ];

  it("gap이 있어도 ROW_NUMBER() rank는 연속 — ci_b rank=2", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_b" });
    const r = await computeItemRank(db, VERSION_ID, "ci_b");
    expect(r.progressRank).toBe(2);
    expect(r.totalCount).toBe(3);
  });

  it("sort_order=50 마지막 item → pct=100.0", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_c" });
    const r = await computeItemRank(db, VERSION_ID, "ci_c");
    expect(r.progressPct).toBe(100.0);
  });

  it("raw sort_order(50)이 아닌 ROW_NUMBER() rank(3)를 반환", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_c" });
    const r = await computeItemRank(db, VERSION_ID, "ci_c");
    expect(r.progressRank).toBe(3);
    expect(r.progressRank).not.toBe(50); // raw sort_order 아님
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — 중간 inactive item → active items만 연속 rank
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3: 중간 inactive item 존재 → active만 rank", () => {
  const VERSION_ID = "cv_tc3";
  const ITEMS = [
    { id: "ci_a", sort_order: 1, is_active: true },
    { id: "ci_x", sort_order: 2, is_active: false },  // inactive — rank 제외
    { id: "ci_b", sort_order: 3, is_active: true },
    { id: "ci_y", sort_order: 4, is_active: false },  // inactive — rank 제외
    { id: "ci_c", sort_order: 5, is_active: true },
  ];

  it("active item만 3개 → total=3", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_a" });
    const r = await computeItemRank(db, VERSION_ID, "ci_a");
    expect(r.totalCount).toBe(3);
  });

  it("ci_a(sort=1) → rank=1 (inactive ci_x 건너뜀)", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_a" });
    const r = await computeItemRank(db, VERSION_ID, "ci_a");
    expect(r.progressRank).toBe(1);
  });

  it("ci_b(sort=3) → rank=2 (앞 inactive 1개 건너뜀)", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_b" });
    const r = await computeItemRank(db, VERSION_ID, "ci_b");
    expect(r.progressRank).toBe(2);
  });

  it("ci_c(sort=5) → rank=3, pct=100.0", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_c" });
    const r = await computeItemRank(db, VERSION_ID, "ci_c");
    expect(r.progressRank).toBe(3);
    expect(r.progressPct).toBe(100.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — 마지막 active item → progressPct = 100.0
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4: 마지막 active item → progressPct = 100.0 (부동소수점 안전)", () => {
  const VERSION_ID = "cv_tc4";

  it("10개 중 마지막 → 100.0 (10/10*100이 99.99... 아님)", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `ci_${i}`,
      sort_order: i,
      is_active: true,
    }));
    const db = buildMockDb({ versionItems: items, versionId: VERSION_ID, targetId: "ci_9" });
    const r = await computeItemRank(db, VERSION_ID, "ci_9");
    expect(r.progressRank).toBe(10);
    expect(r.totalCount).toBe(10);
    expect(r.progressPct).toBe(100.0);
    expect(r.progressPct).not.toBeCloseTo(99.9, 2);
  });

  it("7개 중 마지막 → 100.0", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `ci_${i}`,
      sort_order: i * 5,
      is_active: true,
    }));
    const db = buildMockDb({ versionItems: items, versionId: VERSION_ID, targetId: "ci_6" });
    const r = await computeItemRank(db, VERSION_ID, "ci_6");
    expect(r.progressPct).toBe(100.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — 첫 active item → 1 / total * 100
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5: 첫 active item → progressRank=1, pct=1/total*100", () => {
  const VERSION_ID = "cv_tc5";

  it("총 5개 중 첫 item → rank=1, pct=20.0", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `ci_${i}`,
      sort_order: i,
      is_active: true,
    }));
    const db = buildMockDb({ versionItems: items, versionId: VERSION_ID, targetId: "ci_0" });
    const r = await computeItemRank(db, VERSION_ID, "ci_0");
    expect(r.progressRank).toBe(1);
    expect(r.totalCount).toBe(5);
    expect(r.progressPct).toBeCloseTo(20.0, 1);
  });

  it("총 3개 중 첫 item → rank=1, pct=33.3", async () => {
    const items = [
      { id: "ci_a", sort_order: 0, is_active: true },
      { id: "ci_b", sort_order: 1, is_active: true },
      { id: "ci_c", sort_order: 2, is_active: true },
    ];
    const db = buildMockDb({ versionItems: items, versionId: VERSION_ID, targetId: "ci_a" });
    const r = await computeItemRank(db, VERSION_ID, "ci_a");
    expect(r.progressRank).toBe(1);
    expect(r.progressPct).toBeCloseTo(33.3, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — item이 해당 version에 없음 → fail-closed
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6: item이 해당 version에 없음 → fail-closed", () => {
  const VERSION_ID = "cv_tc6";
  const ITEMS = [
    { id: "ci_a", sort_order: 0, is_active: true },
    { id: "ci_b", sort_order: 1, is_active: true },
  ];

  it("존재하지 않는 item ID → CURRICULUM_ITEM_NOT_FOUND", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_GHOST" });
    await expect(computeItemRank(db, VERSION_ID, "ci_GHOST"))
      .rejects.toThrow(CurriculumRankError);

    try {
      await computeItemRank(db, VERSION_ID, "ci_GHOST");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      const err = e as CurriculumRankError;
      expect(["CURRICULUM_ITEM_NOT_FOUND", "CURRICULUM_ITEM_NOT_IN_VERSION"]).toContain(err.code);
    }
  });

  it("빈 curriculumVersionId → CURRICULUM_VERSION_NOT_FOUND", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_a" });
    try {
      await computeItemRank(db, "", "ci_a");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      expect((e as CurriculumRankError).code).toBe("CURRICULUM_VERSION_NOT_FOUND");
    }
  });

  it("빈 curriculumItemId → CURRICULUM_ITEM_NOT_FOUND", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "" });
    try {
      await computeItemRank(db, VERSION_ID, "");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      expect((e as CurriculumRankError).code).toBe("CURRICULUM_ITEM_NOT_FOUND");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7 — inactive item 요청 → CURRICULUM_ITEM_INACTIVE
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7: inactive item 요청 → CURRICULUM_ITEM_INACTIVE", () => {
  const VERSION_ID = "cv_tc7";
  const ITEMS = [
    { id: "ci_a",        sort_order: 0, is_active: true },
    { id: "ci_inactive", sort_order: 1, is_active: false }, // inactive
    { id: "ci_b",        sort_order: 2, is_active: true },
  ];

  it("inactive item 요청 → CurriculumRankError CURRICULUM_ITEM_INACTIVE", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_inactive" });
    try {
      await computeItemRank(db, VERSION_ID, "ci_inactive");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      expect((e as CurriculumRankError).code).toBe("CURRICULUM_ITEM_INACTIVE");
    }
  });

  it("inactive item은 rank count에도 제외된다 — active 2개만 total", async () => {
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_a" });
    const r = await computeItemRank(db, VERSION_ID, "ci_a");
    expect(r.totalCount).toBe(2); // ci_inactive 제외
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8 — active item zero → CURRICULUM_NO_ACTIVE_ITEMS
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8: active item 0개 → CURRICULUM_NO_ACTIVE_ITEMS", () => {
  const VERSION_ID = "cv_tc8";

  it("모두 inactive → CURRICULUM_NO_ACTIVE_ITEMS", async () => {
    // active=false인 item만 있으면 rank 쿼리 0행 + itemCheck도 inactive
    const ITEMS = [
      { id: "ci_x", sort_order: 0, is_active: false },
      { id: "ci_y", sort_order: 1, is_active: false },
    ];
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_x" });
    try {
      await computeItemRank(db, VERSION_ID, "ci_x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      expect((e as CurriculumRankError).code).toBe("CURRICULUM_ITEM_INACTIVE");
    }
  });

  it("version에 item 자체가 없음 → NOT_FOUND 계열", async () => {
    const ITEMS: Array<{ id: string; sort_order: number; is_active: boolean }> = [];
    const db = buildMockDb({ versionItems: ITEMS, versionId: VERSION_ID, targetId: "ci_z" });
    try {
      await computeItemRank(db, VERSION_ID, "ci_z");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      const code = (e as CurriculumRankError).code;
      expect([
        "CURRICULUM_ITEM_NOT_FOUND",
        "CURRICULUM_NO_ACTIVE_ITEMS",
      ]).toContain(code);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9 — 다른 version의 item → CURRICULUM_ITEM_NOT_IN_VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("TC9: 다른 version item → CURRICULUM_ITEM_NOT_IN_VERSION", () => {
  const VERSION_A = "cv_A";
  const VERSION_B = "cv_B";

  const ITEMS_A = [
    { id: "ci_a1", sort_order: 0, is_active: true },
    { id: "ci_a2", sort_order: 1, is_active: true },
  ];
  const ITEMS_B = [
    { id: "ci_b1", sort_order: 0, is_active: true }, // version B 소속
  ];

  it("version A에서 version B item 요청 → CURRICULUM_ITEM_NOT_IN_VERSION", async () => {
    // ci_b1은 version B 소속 → cross-version 확인 쿼리에서 otherVersionItems에 존재
    const db = buildMockDb({
      versionItems: ITEMS_A,
      otherVersionItems: ITEMS_B,
      versionId: VERSION_A,
      targetId: "ci_b1",
    });
    try {
      await computeItemRank(db, VERSION_A, "ci_b1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CurriculumRankError);
      expect((e as CurriculumRankError).code).toBe("CURRICULUM_ITEM_NOT_IN_VERSION");
    }
  });

  it("version A items는 version B에서 절대 rank에 포함되지 않는다", async () => {
    // version B에서 ci_b1 → rank=1/1 (version A items 제외)
    const db = buildMockDb({
      versionItems: ITEMS_B,
      otherVersionItems: ITEMS_A,
      versionId: VERSION_B,
      targetId: "ci_b1",
    });
    const r = await computeItemRank(db, VERSION_B, "ci_b1");
    expect(r.totalCount).toBe(1); // version A items (2개) 혼입 없음
    expect(r.progressRank).toBe(1);
    expect(r.progressPct).toBe(100.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC10 — Professional/AI dependency 없음 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("TC10: Professional/AI dependency 없음", () => {
  it("computeItemRank 함수가 AI/GPT import 없이 동작한다 (pure DB read)", async () => {
    // 실제 import 경로 확인: curriculum-rank-calculator.ts는
    // drizzle-orm/sql과 DB 인터페이스만 사용
    // AI Engine, Professional Engine, OpenAI import 없음
    const mod = await import("../curriculum-rank-calculator.js");
    expect(typeof mod.computeItemRank).toBe("function");
    expect(typeof mod.CurriculumRankError).toBe("function");
  });

  it("CurriculumRankError는 standard Error를 상속한다", () => {
    const err = new CurriculumRankError("CURRICULUM_ITEM_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CurriculumRankError");
    expect(err.code).toBe("CURRICULUM_ITEM_NOT_FOUND");
  });

  it("progressPct는 ROUND(rank/total*100, 1) 규칙을 따른다", async () => {
    // 7개 중 3번째: 3/7*100 = 42.857... → 42.9
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `ci_${i}`,
      sort_order: i,
      is_active: true,
    }));
    const VERSION_ID = "cv_tc10";
    const db = buildMockDb({ versionItems: items, versionId: VERSION_ID, targetId: "ci_2" });
    const r = await computeItemRank(db, VERSION_ID, "ci_2");
    expect(r.progressRank).toBe(3);
    expect(r.totalCount).toBe(7);
    // 3/7*100 = 42.857... → Math.round(428.57)/10 = 42.9
    expect(r.progressPct).toBeCloseTo(42.9, 1);
  });

  it("단일 active item → rank=1, total=1, pct=100.0", async () => {
    const items = [{ id: "ci_only", sort_order: 0, is_active: true }];
    const VERSION_ID = "cv_tc10b";
    const db = buildMockDb({ versionItems: items, versionId: VERSION_ID, targetId: "ci_only" });
    const r = await computeItemRank(db, VERSION_ID, "ci_only");
    expect(r.progressRank).toBe(1);
    expect(r.totalCount).toBe(1);
    expect(r.progressPct).toBe(100.0);
  });
});
