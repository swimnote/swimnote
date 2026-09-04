/**
 * GAUGE-08: Parent Curriculum Progress Context Integration
 *
 * Tests for:
 *   - buildStudentProgress() — SCP 조회 + PcStudentProgress 반환
 *   - engine schema compatibility (PcStudentProgress 확장)
 *   - quota / AI call 불변 확인
 *
 * buildStudentProgress는 superAdminDb를 내부에서 사용하므로
 * @workspace/db를 vi.mock으로 대체한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(),
  },
}));

import { superAdminDb } from "@workspace/db";
const mockExec = superAdminDb.execute as ReturnType<typeof vi.fn>;

import { buildStudentProgress } from "../parent-curriculum-scope-builder.js";
import type { PcStudentProgress, ParentCurriculumEngineRequest } from "../parent-curriculum-engine-client.js";

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

const STUDENT_ID = "stu-gauge08";
const POOL_ID    = "pool-gauge08";

// ─── TC1: SCP 있음 → confirmed_progress_pct = display_confirmed_pct ──────────

describe("TC1: SCP 있음 — confirmed_progress_pct = display_confirmed_pct", () => {
  it("display=42, active=38 → confirmed=42, active_progress=38", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        42,
        active_confirmed_pct:         38,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
        confirmed_at:                 "2026-08-20T10:00:00Z",
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result).toBeDefined();
    expect(result!.confirmed_progress_pct).toBe(42);
    expect(result!.active_progress_pct).toBe(38);
  });
});

// ─── TC2: SCP 없음 → undefined ───────────────────────────────────────────────

describe("TC2: SCP 없음 → undefined (기존 동작 유지)", () => {
  it("returns undefined when no SCP row exists", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result).toBeUndefined();
  });

  it("undefined ≠ {confirmed_progress_pct: 0} (0% 단정 금지)", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result).not.toEqual({ confirmed_progress_pct: 0 });
  });
});

// ─── TC3: cross-pool isolation — student_id + pool_id 둘 다 파라미터 ─────────

describe("TC3: cross-pool isolation — swimming_pool_id filter in SCP query", () => {
  it("query params include both studentId and poolId", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    await buildStudentProgress(STUDENT_ID, POOL_ID);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sqlObj] = mockExec.mock.calls[0];

    // Extract params from drizzle sql`` queryChunks
    const chunks: unknown[] = (sqlObj as any)?.queryChunks ?? [];
    const params = chunks.filter(
      (c) => !(c != null && typeof c === "object" && Array.isArray((c as any).value)),
    );

    expect(params).toContain(STUDENT_ID);
    expect(params).toContain(POOL_ID);
  });

  it("SQL text includes swimming_pool_id column", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    await buildStudentProgress(STUDENT_ID, POOL_ID);

    const [sqlObj] = mockExec.mock.calls[0];
    const chunks: unknown[] = (sqlObj as any)?.queryChunks ?? [];
    const rawSql = chunks
      .filter((c): c is { value: string[] } =>
        c != null && typeof c === "object" && Array.isArray((c as any).value))
      .flatMap((c) => c.value)
      .join("")
      .toLowerCase();

    expect(rawSql).toContain("student_curriculum_progress");
    expect(rawSql).toContain("swimming_pool_id");
    expect(rawSql).toContain("student_id");
  });
});

// ─── TC4: display vs active 분리 — confirmed source는 display ────────────────

describe("TC4: confirmed_progress_pct = display (NOT active)", () => {
  it("display=50, active=35 → confirmed=50, active_progress=35", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        50,
        active_confirmed_pct:         35,
        active_confirmed_rank:        7,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-002",
        observation_session_count:    5,
        confirmed_at:                 null,
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result!.confirmed_progress_pct).toBe(50);
    expect(result!.active_progress_pct).toBe(35);
    // confirmed must NOT equal active when they differ
    expect(result!.confirmed_progress_pct).not.toBe(result!.active_progress_pct);
  });
});

// ─── TC5: observation_session_count 전달 ──────────────────────────────────────

describe("TC5: observation_session_count included in result", () => {
  it("observation_session_count=7 transmitted correctly", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        8,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    7,
        confirmed_at:                 "2026-08-10T00:00:00Z",
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result!.observation_session_count).toBe(7);
  });
});

// ─── TC6: active version/rank/total 전달 ─────────────────────────────────────

describe("TC6: active_version_id, active_confirmed_rank, active_total_count 전달", () => {
  it("all three active fields transmitted from SCP", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        60,
        active_confirmed_pct:         60,
        active_confirmed_rank:        12,
        active_confirmed_total:       30,
        active_curriculum_version_id: "cv-xyz",
        observation_session_count:    6,
        confirmed_at:                 null,
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result!.active_version_id).toBe("cv-xyz");
    expect(result!.active_confirmed_rank).toBe(12);
    expect(result!.active_total_count).toBe(30);
  });

  it("active_version_id null when SCP has no active version", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        null,
        active_confirmed_pct:         null,
        active_confirmed_rank:        0,
        active_confirmed_total:       0,
        active_curriculum_version_id: null,
        observation_session_count:    0,
        confirmed_at:                 null,
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    expect(result!.active_version_id).toBeNull();
  });
});

// ─── TC7: 기존 context fields 유지 ───────────────────────────────────────────

describe("TC7: existing PcStudentProgress field preserved (current_curriculum_id)", () => {
  it("PcStudentProgress interface still has current_curriculum_id optional field", () => {
    // Compile-time check: object with only current_curriculum_id must be valid PcStudentProgress
    const legacy: PcStudentProgress = { current_curriculum_id: "item-001" };
    expect(legacy.current_curriculum_id).toBe("item-001");
    // New gauge fields are optional — omitting them is valid
    expect(legacy.confirmed_progress_pct).toBeUndefined();
  });

  it("buildStudentProgress does not set current_curriculum_id (not known from SCP)", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
        confirmed_at:                 null,
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    // current_curriculum_id is not set by buildStudentProgress
    // (that field comes from groundedPackage.curriculum_current in the route)
    expect(result).not.toHaveProperty("current_curriculum_id");
  });
});

// ─── TC8: engine request shape — student_progress optional field ──────────────

describe("TC8: ParentCurriculumEngineRequest accepts student_progress with gauge fields", () => {
  it("engineRequest with full gauge fields is type-compatible", () => {
    // This is a compile-time shape test — if it builds, the interface is correct
    const fullProgress: PcStudentProgress = {
      current_curriculum_id:    "item-001",
      confirmed_progress_pct:   42,
      active_progress_pct:      38,
      active_confirmed_rank:    5,
      active_total_count:       20,
      active_version_id:        "cv-001",
      observation_session_count: 4,
      confirmed_at:             "2026-08-20T10:00:00Z",
    };

    const req: ParentCurriculumEngineRequest = {
      request_id:     "rq-001",
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      query:          "자유형 배우는 과정",
      context: {
        pool_id:          "pool-001",
        pool_name:        "수영장A",
        student_id:       "stu-001",
        mode:             "X",
        curriculum_scope: {
          source:           "X_POOL",
          curriculum_items: [],
        },
        student_progress: fullProgress,
      },
    };

    expect(req.context.student_progress).toBeDefined();
    expect(req.context.student_progress!.confirmed_progress_pct).toBe(42);
  });

  it("engineRequest with student_progress=undefined is also valid (SCP missing case)", () => {
    const req: ParentCurriculumEngineRequest = {
      request_id:     "rq-002",
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      query:          "배영이 뭔가요",
      context: {
        pool_id:          "pool-001",
        pool_name:        "수영장A",
        student_id:       "stu-001",
        mode:             "X",
        curriculum_scope: {
          source:           "X_POOL",
          curriculum_items: [],
        },
        // student_progress omitted → OK
      },
    };

    expect(req.context.student_progress).toBeUndefined();
  });
});

// ─── TC9: DIRECT_DB path: buildStudentProgress DB call 확인 ──────────────────
// (GAUGE-08 context is only wired in GROUNDED_GPT path inside the route,
// not in DIRECT_DB. Here we just verify buildStudentProgress itself
// doesn't alter DB state.)

describe("TC9: buildStudentProgress is read-only (SELECT only)", () => {
  it("only one execute call (SELECT), no INSERT/UPDATE/DELETE", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    await buildStudentProgress(STUDENT_ID, POOL_ID);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sqlObj] = mockExec.mock.calls[0];
    const chunks: unknown[] = (sqlObj as any)?.queryChunks ?? [];
    const rawSql = chunks
      .filter((c): c is { value: string[] } =>
        c != null && typeof c === "object" && Array.isArray((c as any).value))
      .flatMap((c) => c.value)
      .join("")
      .toLowerCase();

    expect(rawSql).toMatch(/^[\s]*select/);
    expect(rawSql).not.toContain("insert");
    expect(rawSql).not.toContain("update");
    expect(rawSql).not.toContain("delete");
  });
});

// ─── TC10: GROUNDED_GPT quota 정책 영향 없음 ─────────────────────────────────

describe("TC10: quota behavior unchanged — buildStudentProgress adds no quota-consuming call", () => {
  it("buildStudentProgress executes exactly 1 DB call, no AI engine call", async () => {
    mockExec.mockResolvedValueOnce({ rows: [] });

    const fetchSpy = vi.spyOn(globalThis as any, "fetch").mockRejectedValue(
      new Error("fetch must not be called by buildStudentProgress"),
    );

    await expect(
      buildStudentProgress(STUDENT_ID, POOL_ID),
    ).resolves.toBeUndefined(); // empty → undefined

    // No external HTTP call triggered
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // Exactly 1 DB read
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

// ─── TC11: no new AI call from buildStudentProgress ──────────────────────────

describe("TC11: no new AI call — buildStudentProgress is pure DB read", () => {
  it("no fetch() called during SCP query", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
        confirmed_at:                 null,
      }],
    });

    const fetchSpy = vi.spyOn(globalThis as any, "fetch").mockRejectedValue(
      new Error("fetch must not be called"),
    );

    await expect(
      buildStudentProgress(STUDENT_ID, POOL_ID),
    ).resolves.toBeDefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ─── TC12: Professional V2 retrieval count 증가 없음 ─────────────────────────

describe("TC12: Professional V2 retrieval unaffected — buildStudentProgress adds 0 retrieval calls", () => {
  it("only 1 DB execute call, no secondary search/embed", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        30,
        active_confirmed_pct:         30,
        active_confirmed_rank:        3,
        active_confirmed_total:       12,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    3,
        confirmed_at:                 null,
      }],
    });

    await buildStudentProgress(STUDENT_ID, POOL_ID);
    // Only the SCP SELECT was executed — no additional retrieval
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

// ─── TC13: engine strict schema compatibility ─────────────────────────────────

describe("TC13: engine schema compatibility — optional fields not rejected", () => {
  it("PcStudentProgress with all new gauge fields is valid (no required field missing)", () => {
    // Ensure all fields are optional — an empty object is valid
    const empty: PcStudentProgress = {};
    expect(empty).toBeDefined();
  });

  it("confirmed_progress_pct can be null (SCP row with null display)", async () => {
    mockExec.mockResolvedValueOnce({
      rows: [{
        display_confirmed_pct:        null,
        active_confirmed_pct:         null,
        active_confirmed_rank:        0,
        active_confirmed_total:       0,
        active_curriculum_version_id: null,
        observation_session_count:    0,
        confirmed_at:                 null,
      }],
    });

    const result = await buildStudentProgress(STUDENT_ID, POOL_ID);
    // Returns an object (not undefined) because a row exists
    expect(result).toBeDefined();
    expect(result!.confirmed_progress_pct).toBeNull();
    expect(result!.active_version_id).toBeNull();
  });
});
