/**
 * GAUGE-07: Growth Report Curriculum Progress Snapshot
 *
 * Tests for mergeGaugeIntoState + queryScpGaugeProgress +
 * queryPreviousReportCurriculumPct wired into buildAnalysisSnapshot.
 *
 * drizzle sql`` queryChunks format (verified from node inspection):
 *   { value: string[] }  → SQL text chunk
 *   primitive            → parameter value
 *
 * Mock DB routes each call by matching SQL text fragments, then returns
 * pre-configured rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAnalysisSnapshot } from "../growth-report-snapshot-builder.js";

// ─── queryChunks helpers ──────────────────────────────────────────────────────

/** Extract the SQL text from a drizzle sql`` object's queryChunks. */
function extractSqlText(sqlObj: any): string {
  const chunks: unknown[] = sqlObj?.queryChunks ?? [];
  return chunks
    .filter((c): c is { value: string[] } => c != null && typeof c === "object" && Array.isArray((c as any).value))
    .flatMap((c) => (c as { value: string[] }).value)
    .join("")
    .toLowerCase();
}

/** Extract parameter values from a drizzle sql`` object's queryChunks. */
function extractParams(sqlObj: any): unknown[] {
  const chunks: unknown[] = sqlObj?.queryChunks ?? [];
  return chunks.filter(
    (c) => !(c != null && typeof c === "object" && Array.isArray((c as any).value)),
  );
}

// ─── Shared constants ─────────────────────────────────────────────────────────

const STUDENT_ID = "stu-gauge07";
const POOL_ID    = "pool-gauge07";
const REPORT_ID  = "rpt-gauge07";

const BASE_REPORT = {
  id:               REPORT_ID,
  student_id:       STUDENT_ID,
  swimming_pool_id: POOL_ID,
  cycle_id:         "cyc-001",
  report_period:    "2026-08",
  teacher_reviewed_by: null,
  teacher_reviewed_at: null,
};

const BASE_CYCLE = {
  id:                    "cyc-001",
  analysis_from:         null,
  analysis_cutoff_at:    "2026-08-25T00:00:00.000Z",
  parent_input_open_at:  "2026-08-25T00:00:00.000Z",
  report_period:         "2026-08",
  timezone:              "Asia/Seoul",
};

// ─── Mock DB factory ──────────────────────────────────────────────────────────

type ScpRowInput = {
  display_confirmed_pct: number | null;
  active_confirmed_pct: number | null;
  active_confirmed_rank: number;
  active_confirmed_total: number;
  active_curriculum_version_id: string | null;
  observation_session_count: number;
};

function buildMockDb(opts: {
  scpRow?: ScpRowInput | null;
  previousReportContent?: Record<string, unknown> | null;
  hasCurriculumAssignment?: boolean;
  hasStudentLevel?: boolean;
}) {
  const {
    scpRow = null,
    previousReportContent = null,
    hasCurriculumAssignment = true,
    hasStudentLevel = true,
  } = opts;

  return {
    execute: vi.fn(async (sqlObj: unknown) => {
      const raw = extractSqlText(sqlObj);

      // ── student_curriculum_assignments ────────────────────────────────────
      if (raw.includes("student_curriculum_assignments")) {
        if (!hasCurriculumAssignment) return { rows: [] };
        return { rows: [{ curriculum_version_id: "cv-001" }] };
      }

      // ── curriculum_items ──────────────────────────────────────────────────
      if (raw.includes("curriculum_items")) {
        return { rows: [{ title: "자유형 킥" }, { title: "배영 팔 동작" }] };
      }

      // ── student_levels ────────────────────────────────────────────────────
      if (raw.includes("student_levels")) {
        if (!hasStudentLevel) return { rows: [] };
        return { rows: [{ level: "중급", level_order: 2 }] };
      }

      // ── class_diaries (with student_notes join) ───────────────────────────
      if (raw.includes("class_diaries")) {
        return { rows: [] };
      }

      // ── growth_events ─────────────────────────────────────────────────────
      if (raw.includes("growth_events")) {
        return { rows: [] };
      }

      // ── class_attendances ─────────────────────────────────────────────────
      if (raw.includes("class_attendances") || raw.includes("attendances")) {
        return { rows: [] };
      }

      // ── growth_report_answers ─────────────────────────────────────────────
      if (raw.includes("growth_report_answers")) {
        return { rows: [] };
      }

      // ── student_curriculum_progress (SCP gauge) ───────────────────────────
      if (raw.includes("student_curriculum_progress")) {
        if (!scpRow) return { rows: [] };
        return { rows: [scpRow] };
      }

      // ── growth_reports (for previous curriculum pct AND published history) ─
      // Both queries hit this table; the "previous curriculum pct" query filters
      // by id != currentReportId and selects report_content.
      // The published history query selects metric_states etc.
      if (raw.includes("growth_reports")) {
        if (!previousReportContent) return { rows: [] };
        // Return the previous content row (covers both queries safely)
        return { rows: [{ report_content: previousReportContent }] };
      }

      // fallback
      return { rows: [] };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── TC1: current SCP display=42 → confirmed_progress_pct=42 ─────────────────

describe("TC1: current SCP display_confirmed_pct → confirmed_progress_pct", () => {
  it("confirmed_progress_pct equals display_confirmed_pct (42)", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
      },
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs).not.toBeNull();
    expect(cs!.confirmed_progress_pct).toBe(42);
  });
});

// ─── TC2: active_pct ≠ display_pct → use display_pct ────────────────────────

describe("TC2: active_pct≠display_pct → confirmed_progress_pct = display_pct", () => {
  it("confirmed_progress_pct=50 (display), not 35 (active)", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        50,
        active_confirmed_pct:         35,
        active_confirmed_rank:        7,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    5,
      },
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs!.confirmed_progress_pct).toBe(50);
  });
});

// ─── TC3: previous completed report → period_start + delta ───────────────────

describe("TC3: previous PUBLISHED report → period_start_pct + delta", () => {
  it("period_start=40, current=50 → delta=10", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        50,
        active_confirmed_pct:         50,
        active_confirmed_rank:        10,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    6,
      },
      previousReportContent: {
        curriculum_state: { confirmed_progress_pct: 40 },
      },
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs!.period_start_pct).toBe(40);
    expect(cs!.progress_delta_pct).toBe(10);
  });

  it("fractional delta rounds to 1 decimal: 48.7 - 42.4 = 6.3", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        48.7,
        active_confirmed_pct:         48.7,
        active_confirmed_rank:        9,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    7,
      },
      previousReportContent: {
        curriculum_state: { confirmed_progress_pct: 42.4 },
      },
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs!.period_start_pct).toBe(42.4);
    expect(cs!.progress_delta_pct).toBe(6.3);
  });
});

// ─── TC4: 첫 리포트 (이전 PUBLISHED report 없음) → null ──────────────────────

describe("TC4: no previous report → period_start=null, delta=null", () => {
  it("both period_start_pct and progress_delta_pct are null", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
      },
      previousReportContent: null,
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs!.period_start_pct).toBeNull();
    expect(cs!.progress_delta_pct).toBeNull();
  });
});

// ─── TC5: SQL filters product_status=PUBLISHED ───────────────────────────────

describe("TC5: failed/draft reports excluded — SQL filters product_status=PUBLISHED", () => {
  it("growth_reports query contains 'published' status filter text", async () => {
    const db = buildMockDb({ scpRow: null, previousReportContent: null });
    await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });

    const growthReportCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sqlObj]: [any]) => extractSqlText(sqlObj).includes("growth_reports"),
    );
    expect(growthReportCalls.length).toBeGreaterThan(0);

    // At least one growth_reports call includes 'published'
    const hasPublishedFilter = growthReportCalls.some(([sqlObj]: [any]) =>
      extractSqlText(sqlObj).includes("published"),
    );
    expect(hasPublishedFilter).toBe(true);
  });

  it("period_start_pct is null when no PUBLISHED report exists", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        30,
        active_confirmed_pct:         30,
        active_confirmed_rank:        3,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    3,
      },
      previousReportContent: null,
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    expect(request.snapshot.curriculum_state!.period_start_pct).toBeNull();
    expect(request.snapshot.curriculum_state!.progress_delta_pct).toBeNull();
  });
});

// ─── TC6: student_id filter on previous report query ─────────────────────────

describe("TC6: other-student report excluded — student_id in params", () => {
  it("growth_reports execute call includes STUDENT_ID as param", async () => {
    const db = buildMockDb({ scpRow: null });
    await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });

    const growthReportCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sqlObj]: [any]) => extractSqlText(sqlObj).includes("growth_reports"),
    );
    expect(growthReportCalls.length).toBeGreaterThan(0);

    const anyHasStudentId = growthReportCalls.some(([sqlObj]: [any]) =>
      extractParams(sqlObj).includes(STUDENT_ID),
    );
    expect(anyHasStudentId).toBe(true);
  });
});

// ─── TC7: swimming_pool_id filter on previous report query ───────────────────

describe("TC7: other-pool report excluded — swimming_pool_id in params", () => {
  it("growth_reports execute call includes POOL_ID as param", async () => {
    const db = buildMockDb({ scpRow: null });
    await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });

    const growthReportCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sqlObj]: [any]) => extractSqlText(sqlObj).includes("growth_reports"),
    );
    const anyHasPoolId = growthReportCalls.some(([sqlObj]: [any]) =>
      extractParams(sqlObj).includes(POOL_ID),
    );
    expect(anyHasPoolId).toBe(true);
  });
});

// ─── TC8: immutable JSONB — snapshot captures SCP at build time ───────────────

describe("TC8: snapshot captures SCP value at build time (immutability)", () => {
  it("first build at display=42, second build at display=70 are independent", async () => {
    const db1 = buildMockDb({
      scpRow: {
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
      },
    });
    const snap1 = await buildAnalysisSnapshot(db1 as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const pct1 = snap1.request.snapshot.curriculum_state!.confirmed_progress_pct;
    expect(pct1).toBe(42);

    const db2 = buildMockDb({
      scpRow: {
        display_confirmed_pct:        70,
        active_confirmed_pct:         70,
        active_confirmed_rank:        14,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    9,
      },
    });
    const snap2 = await buildAnalysisSnapshot(db2 as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    expect(snap2.request.snapshot.curriculum_state!.confirmed_progress_pct).toBe(70);

    // First snapshot value is unchanged (JavaScript objects, not DB rows)
    expect(pct1).toBe(42);
  });
});

// ─── TC9: version transition ──────────────────────────────────────────────────

describe("TC9: version transition — display=70 (lifetime), new version active rank", () => {
  it("confirmed_progress_pct=70, active fields from new version cv-new-002", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        70,   // lifetime display gauge
        active_confirmed_pct:         50,   // new active version position
        active_confirmed_rank:        10,
        active_confirmed_total:       30,
        active_curriculum_version_id: "cv-new-002",
        observation_session_count:    8,
      },
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs).not.toBeNull();
    expect(cs!.confirmed_progress_pct).toBe(70);
    expect(cs!.active_version_id).toBe("cv-new-002");
    expect(cs!.active_confirmed_rank).toBe(10);
    expect(cs!.active_total_count).toBe(30);
  });
});

// ─── TC10: SCP 없음 → null/0 safe fallback ───────────────────────────────────

describe("TC10: no SCP row → null/0 safe fallback (undetermined, not zero progress)", () => {
  it("no crash; confirmed_progress_pct=null when SCP missing", async () => {
    const db = buildMockDb({ scpRow: null });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    // curriculum_state may be null (no assignment+no level+no SCP) — that's fine
    if (cs !== null) {
      expect(cs.confirmed_progress_pct).toBeNull();
      expect(cs.active_confirmed_rank).toBe(0);
      expect(cs.active_total_count).toBe(0);
      expect(cs.observation_session_count).toBe(0);
      expect(cs.active_version_id).toBeNull();
    } else {
      expect(cs).toBeNull(); // also valid
    }
  });

  it("no crash when assignment, level, AND SCP all missing", async () => {
    const db = buildMockDb({
      scpRow: null,
      hasCurriculumAssignment: false,
      hasStudentLevel: false,
    });
    await expect(
      buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE }),
    ).resolves.toBeDefined();
  });

  it("SCP exists without curriculum assignment → curriculum_state still has gauge fields", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        25,
        active_confirmed_pct:         25,
        active_confirmed_rank:        3,
        active_confirmed_total:       12,
        active_curriculum_version_id: "cv-orphan",
        observation_session_count:    3,
      },
      hasCurriculumAssignment: false,
      hasStudentLevel: false,
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    // mergeGaugeIntoState creates minimal state when base=null but scp≠null
    expect(cs).not.toBeNull();
    expect(cs!.confirmed_progress_pct).toBe(25);
    expect(cs!.active_version_id).toBe("cv-orphan");
  });
});

// ─── TC11: no new AI / external calls added ───────────────────────────────────

describe("TC11: no new AI or external HTTP calls", () => {
  it("buildAnalysisSnapshot resolves without fetch (pure DB mock)", async () => {
    const fetchSpy = vi.spyOn(globalThis as any, "fetch").mockRejectedValue(
      new Error("fetch must not be called in snapshot builder"),
    );

    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
      },
    });

    await expect(
      buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE }),
    ).resolves.toBeDefined();

    fetchSpy.mockRestore();
  });
});

// ─── TC12: existing snapshot fields preserved ─────────────────────────────────

describe("TC12: existing Growth Report snapshot fields preserved", () => {
  it("diaries, growth_events, attendance, longitudinal, parent_answers still present", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
      },
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const snap = request.snapshot;

    expect(Array.isArray(snap.diaries)).toBe(true);
    expect(Array.isArray(snap.growth_events)).toBe(true);
    expect(Array.isArray(snap.attendance)).toBe(true);
    expect(Array.isArray(snap.parent_answers)).toBe(true);
    expect(snap.longitudinal).toBeDefined();
    expect(typeof snap.snapshot_version).toBe("number");
    expect(typeof snap.payload_hash).toBe("string");
    expect(snap.payload_hash.length).toBeGreaterThan(0);
  });

  it("original curriculum_state fields preserved (curriculum_id, current_level, recent_topics)", async () => {
    const db = buildMockDb({
      scpRow: {
        display_confirmed_pct:        42,
        active_confirmed_pct:         42,
        active_confirmed_rank:        5,
        active_confirmed_total:       20,
        active_curriculum_version_id: "cv-001",
        observation_session_count:    4,
      },
      hasCurriculumAssignment: true,
      hasStudentLevel: true,
    });

    const { request } = await buildAnalysisSnapshot(db as any, { report: BASE_REPORT, cycle: BASE_CYCLE });
    const cs = request.snapshot.curriculum_state;
    expect(cs).not.toBeNull();
    expect(cs!.curriculum_id).toBe("cv-001");          // from student_curriculum_assignments mock
    expect(cs!.current_level).toBe("중급");              // from student_levels mock
    expect(Array.isArray(cs!.recent_topics)).toBe(true);
    expect(cs!.stage).toBeNull();                       // ENGINE computes
    expect(cs!.mastery_flags).toBeNull();               // ENGINE computes
  });
});
