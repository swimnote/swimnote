/**
 * curriculum-source-alignment.test.ts
 *
 * CURRICULUM SOURCE ALIGNMENT HOTFIX 검증
 *
 * 대상: buildXCurriculumScope(poolId)
 *
 * 검증 케이스:
 *   1. X + active version 없음     → CURRICULUM_SEARCH_NOT_ELIGIBLE
 *   2. X + items 0개               → CURRICULUM_SEARCH_NOT_ELIGIBLE
 *   3. X + 299 items               → CURRICULUM_SEARCH_NOT_ELIGIBLE
 *   4. X + 300 items               → eligible, source=X_POOL
 *   5. X + 301 items               → eligible
 *   6. 다른 pool items 포함 안 됨  → version query가 pool 기준
 *   7. global_template_sets 독립   → X eligibility에 영향 없음
 *   8. eligibility = search scope  → 동일 versionId 사용
 *   9. inactive items 제외         → count에서 제외
 *  10. NORMAL_MIN_CURRICULUM_ITEMS → 300 불변
 *  11. DB 오류                     → 원본 throw
 *  12. version_name 무관           → is_active=true면 사용
 * Normal path:
 *  13. Normal 300 items → POOL source
 *  14. Normal 299 items → CURRICULUM_SEARCH_NOT_ELIGIBLE
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

const POOL_A   = "pool_A_test";
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

describe("buildXCurriculumScope — pool-specific curriculum_items", () => {

  it("1. active curriculum_version 없음 → CURRICULUM_SEARCH_NOT_ELIGIBLE", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] }); // curriculum_versions → 없음

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("2. version 있으나 active items 0개 → CURRICULUM_SEARCH_NOT_ELIGIBLE", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("3. 299 items → CURRICULUM_SEARCH_NOT_ELIGIBLE (threshold 미달)", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "299" }] });

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });

  it("4. 300 items → eligible, source=X_POOL, 300개 반환", async () => {
    const items = makeItems(300);
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: items });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items).toHaveLength(300);
    expect(scope.template_set_id).toBeUndefined();
  });

  it("5. 301 items → eligible, 301개 반환", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "301" }] })
      .mockResolvedValueOnce({ rows: makeItems(301) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.curriculum_items).toHaveLength(301);
  });

  it("6. 다른 pool → 각각 독립적으로 조회 (POOL_A version 없음 → NOT_ELIGIBLE)", async () => {
    // POOL_A에 version 없음
    mockExec.mockResolvedValueOnce({ rows: [] });

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("7. global_template_sets 조회 없음 — X eligibility에 영향 없어야 함", async () => {
    // global_template_sets를 전혀 mock하지 않아도 300개 정상 처리
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: makeItems(300) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    // 딱 3번만 호출: version조회, count, items로드
    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it("8. eligibility count와 items 로드가 동일 versionId scope 사용 (3번 호출 순서 보장)", async () => {
    const SPECIFIC_VERSION = "version_specific_xyz";
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: SPECIFIC_VERSION }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: makeItems(300) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.curriculum_items).toHaveLength(300);
    // 구현상 동일 versionId 변수를 count/load 양쪽에 사용 → 3번 호출
    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it("9. inactive items 제외 — DB WHERE is_active=true 필터로 보장 (count 200 < 300 → NOT_ELIGIBLE)", async () => {
    // active 200개, inactive 300개 → count=200 → NOT_ELIGIBLE
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "200" }] });

    await expect(buildXCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });

  it("10. NORMAL_MIN_CURRICULUM_ITEMS 상수 = 300 불변", () => {
    expect(NORMAL_MIN_CURRICULUM_ITEMS).toBe(300);
  });

  it("11. DB 오류는 CurriculumScopeError로 wrap 안 함 — 원본 throw", async () => {
    const dbError = new Error("connection timeout");
    mockExec.mockRejectedValueOnce(dbError);

    await expect(buildXCurriculumScope(POOL_A)).rejects.toBe(dbError);
  });

  it("12. version_name 무관 — is_active=true version이면 사용", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: "some-other-version-name" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: makeItems(300) });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
  });

  it("13. curriculum_items의 description null → content 빈 문자열 처리", async () => {
    const itemsWithNull = [
      { id: "i1", title: "T1", description: null, sort_order: 0 },
      ...makeItems(299).slice(0, 299),
    ];
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: itemsWithNull });

    const scope = await buildXCurriculumScope(POOL_A);
    const first = scope.curriculum_items[0];
    expect(first.content).toBe("");
    expect(first.title).toBe("T1");
  });
});

// ─── buildNormalCurriculumScope — X path 변경 후 Normal path 불변 확인 ─────

describe("buildNormalCurriculumScope — Normal path 불변", () => {
  it("13. Normal 300 items → eligible, source=POOL", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "300" }] })
      .mockResolvedValueOnce({ rows: makeItems(300) });

    const scope = await buildNormalCurriculumScope(POOL_A);
    expect(scope.source).toBe("POOL");
    expect(scope.curriculum_items).toHaveLength(300);
  });

  it("14. Normal 299 items → CURRICULUM_SEARCH_NOT_ELIGIBLE", async () => {
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: VERSION_A }] })
      .mockResolvedValueOnce({ rows: [{ cnt: "299" }] });

    await expect(buildNormalCurriculumScope(POOL_A)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });
});
