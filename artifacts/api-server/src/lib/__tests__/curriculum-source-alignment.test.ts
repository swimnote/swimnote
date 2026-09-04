/**
 * curriculum-source-alignment.test.ts
 *
 * buildXCurriculumScope eligibility 정책 검증
 *
 * X MODE 정책 변경 (2.0.0):
 *   - 300개 threshold 제거 — items >= 1이면 eligible
 *   - active version 없음 또는 items 0개 → CURRICULUM_NOT_REGISTERED
 *
 * 검증 케이스:
 * CASE 1  X + curriculum 50개  → eligible (X MODE threshold 제거)
 * CASE 2  X + curriculum 1개   → eligible
 * CASE 3  X + curriculum 0개   → CURRICULUM_NOT_REGISTERED
 * CASE 4  Normal Mode          → Normal 정책 불변 (300개 gate 유지)
 * CASE 5  X + version 없음     → CURRICULUM_NOT_REGISTERED
 * CASE 6  X + active version 있으나 items 0 → CURRICULUM_NOT_REGISTERED
 * CASE 7  pool_id scope 독립   → 다른 pool 데이터 혼입 없음
 * CASE 8  ToyKids 50 items     → eligible (300 gate 없이 PASS)
 * 기타:
 *   inactive items 제외
 *   DB 오류 원본 throw
 *   version_name 무관
 *   NORMAL_MIN_CURRICULUM_ITEMS 상수 300 불변
 *   Normal 299 items → CURRICULUM_SEARCH_NOT_ELIGIBLE
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  buildXCurriculumScope,
  buildNormalCurriculumScope,
  CurriculumScopeError,
  NORMAL_MIN_CURRICULUM_ITEMS,
} from "../parent-curriculum-scope-builder.js";

// ─── Mock superAdminDb ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(),
  },
}));

import { superAdminDb } from "@workspace/db";
const mockExec = superAdminDb.execute as ReturnType<typeof vi.fn>;

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const POOL_A    = "pool_A_test";
const POOL_B    = "pool_B_test";
const VERSION_A = "version_A_test";

const makeItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id:          `item_${i}`,
    title:       `항목 ${i}`,
    description: `설명 ${i}`,
    sort_order:  i,
  }));

// ─── 테스트 ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildXCurriculumScope — X MODE eligibility (개수 threshold 제거)", () => {

  it("CASE 1: X + curriculum 50개 → eligible (300 gate 없음)", async () => {
    const items = makeItems(50);
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] }) // version
      .mockResolvedValueOnce({ rows: [{ cnt: "50" }] })     // count
      .mockResolvedValueOnce({ rows: items });               // items load

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items).toHaveLength(50);
  });

  it("CASE 2: X + curriculum 1개 → eligible", async () => {
    const items = makeItems(1);
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "1" }] })
      .mockResolvedValueOnce({ rows: items });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items).toHaveLength(1);
  });

  it("CASE 3: X + curriculum 0개 → CURRICULUM_NOT_REGISTERED", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] }) // version 있음
      .mockResolvedValueOnce({ rows: [{ cnt: "0" }] });     // items 0개

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_NOT_REGISTERED",
    });
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("CASE 5: X + active version 없음 → CURRICULUM_NOT_REGISTERED", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] }); // version 없음

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_NOT_REGISTERED",
    });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("CASE 6: X + version 있으나 items 0개 → CURRICULUM_NOT_REGISTERED", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_NOT_REGISTERED",
    });
  });

  it("CASE 7: pool_id scope — 다른 pool version이 없으면 NOT_REGISTERED", async () => {
    // POOL_B에는 version 없음 → POOL_A 데이터가 혼입되지 않음
    mockExec.mockResolvedValueOnce({ rows: [] });

    await expect(buildXCurriculumScope(POOL_B)).rejects.toMatchObject({
      code: "CURRICULUM_NOT_REGISTERED",
    });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("CASE 8: ToyKids 50 items → eligible (300 gate 없이 PASS)", async () => {
    // 토이키즈스윔클럽 실제 데이터 시뮬레이션
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: "cv_bw6pee53qf4l2ipi" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "50" }] })
      .mockResolvedValueOnce({ rows: makeItems(50) });

    const scope = await buildXCurriculumScope("pool_1780849364252_l9k44rbk3");
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items).toHaveLength(50);
  });

  it("X + 299 items → eligible (300 threshold 제거됨)", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "299" }] })
      .mockResolvedValueOnce({ rows: makeItems(299) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items).toHaveLength(299);
  });

  it("X + 300 items → eligible, source=X_POOL", async () => {
    const items = makeItems(300);
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: items });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items).toHaveLength(300);
  });

  it("inactive items 제외 — count 0 → CURRICULUM_NOT_REGISTERED", async () => {
    // active 0개 → 미등록 처리
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_NOT_REGISTERED",
    });
  });

  it("inactive items 있어도 active 50개 → eligible", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "50" }] }) // active only count
      .mockResolvedValueOnce({ rows: makeItems(50) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.curriculum_items).toHaveLength(50);
  });

  it("DB 오류는 CurriculumScopeError로 wrap 안 함 — 원본 throw", async () => {
    const dbError = new Error("connection timeout");
    mockExec.mockRejectedValueOnce(dbError);

    await expect(buildXCurriculumScope(POOL_A)).rejects.toBe(dbError);
  });

  it("version_name 무관 — is_active=true version이면 사용", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: "any-version-name-whatsoever" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "50" }] })
      .mockResolvedValueOnce({ rows: makeItems(50) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
  });

  it("curriculum_items의 description null → content 빈 문자열 처리", async () => {
    const itemsWithNull = [
      { id: "i1", title: "T1", description: null, sort_order: 0 },
    ];
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "1" }] })
      .mockResolvedValueOnce({ rows: itemsWithNull });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.curriculum_items[0].content).toBe("");
    expect(scope.curriculum_items[0].title).toBe("T1");
  });

  it("global_template_sets 참조 없음 — 딱 3번만 호출", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "50" }] })
      .mockResolvedValueOnce({ rows: makeItems(50) });

    await buildXCurriculumScope(POOL_A);
    expect(mockExec).toHaveBeenCalledTimes(3);
  });
});

// ─── NORMAL_MIN_CURRICULUM_ITEMS 상수 불변 확인 ───────────────────────────────

describe("NORMAL_MIN_CURRICULUM_ITEMS 상수 불변 (CASE 4 전제)", () => {
  it("NORMAL_MIN_CURRICULUM_ITEMS = 300 (Normal path 기준 유지)", () => {
    expect(NORMAL_MIN_CURRICULUM_ITEMS).toBe(300);
  });
});

// ─── buildNormalCurriculumScope — Normal path 불변 확인 (CASE 4) ──────────────

describe("buildNormalCurriculumScope — Normal path 불변 (CASE 4)", () => {

  it("Normal 300 items → eligible, source=POOL", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: makeItems(300) });

    const scope = await buildNormalCurriculumScope(POOL_A);
    expect(scope.source).toBe("POOL");
    expect(scope.curriculum_items).toHaveLength(300);
  });

  it("Normal 299 items → CURRICULUM_SEARCH_NOT_ELIGIBLE (300 gate 유지)", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "299" }] });

    await expect(buildNormalCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });

  it("Normal 50 items → CURRICULUM_SEARCH_NOT_ELIGIBLE (300 gate 유지)", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "50" }] });

    await expect(buildNormalCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });

  it("Normal version 없음 → CURRICULUM_SEARCH_NOT_ELIGIBLE", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    await expect(buildNormalCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });
});
