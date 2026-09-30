import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAnalysisSnapshot,
  type BuildSnapshotInput,
} from "../growth-report-snapshot-builder.js";
import { getGrowthReportAnalysisPeriod } from "../growth-report-eligibility.js";
import { analyzeGrowthReport, computeCanonicalHash } from "../growth-report-engine-client.js";

const SEPTEMBER_PERIOD = getGrowthReportAnalysisPeriod("2026-09");

const input: BuildSnapshotInput = {
  report: {
    id: "gr_september_golden",
    student_id: "student_september_golden",
    swimming_pool_id: "pool_september_golden",
    cycle_id: "cycle_september_golden",
    report_period: "2026-09",
  },
  cycle: {
    id: "cycle_september_golden",
    // Batch-created monthly cycles leave this NULL; do not inject a value
    // that the real preparation path does not provide.
    analysis_from: null,
    analysis_cutoff_at: "2026-09-30T15:00:00.000Z",
    parent_input_open_at: "2026-09-30T15:00:00.000Z",
    report_period: "2026-09",
    timezone: "Asia/Seoul",
  },
};

function makeInMemoryDb() {
  const calls: string[] = [];
  const diaryCandidates = [
    {
      id: "diary_sep_1",
      lesson_date: "2026-09-01",
      common_content: "September lesson",
      class_level: null,
      note_content: "Student note",
      note_student_id: input.report.student_id,
    },
    {
      id: "diary_oct_1",
      lesson_date: "2026-10-01",
      common_content: "October lesson",
      class_level: null,
      note_content: "Out of period",
      note_student_id: input.report.student_id,
    },
  ];
  const eventCandidates = [
    {
      id: "event_sep_start",
      student_id: input.report.student_id,
      occurred_at: "2026-08-31T15:00:00.000Z",
      event_type: "observation",
      growth_match_status: "matched",
      confidence: 1,
      evidence_text: "Start boundary",
      evidence_metadata: null,
      evidence_validation: null,
    },
    {
      id: "event_sep_last_millisecond",
      student_id: input.report.student_id,
      occurred_at: "2026-09-30T14:59:59.999Z",
      event_type: "observation",
      growth_match_status: "matched",
      confidence: 1,
      evidence_text: "Last millisecond",
      evidence_metadata: null,
      evidence_validation: null,
    },
    {
      id: "event_oct_start",
      student_id: input.report.student_id,
      occurred_at: "2026-09-30T15:00:00.000Z",
      event_type: "observation",
      growth_match_status: "matched",
      confidence: 1,
      evidence_text: "Cutoff boundary",
      evidence_metadata: null,
      evidence_validation: null,
    },
  ];
  const attendanceCandidates = [
    { id: "attendance_sep_1", student_id: input.report.student_id, date: "2026-09-01", status: "present" },
    { id: "attendance_sep_30", student_id: input.report.student_id, date: "2026-09-30", status: "present" },
    { id: "attendance_oct_1", student_id: input.report.student_id, date: "2026-10-01", status: "present" },
  ];

  return {
    calls,
    async execute(query: any) {
      const queryText = (query?.queryChunks ?? [])
        .map((chunk: any) => typeof chunk === "string" ? chunk : (chunk?.value ?? ""))
        .join("");
      calls.push(queryText.replace(/\s+/g, " ").trim());

      // This in-memory adapter emulates the row selection for the builder's
      // actual SQL predicates; it performs no database or network I/O.
      if (queryText.includes("class_diary_student_notes")) {
        return {
          rows: diaryCandidates.filter(
            (row) => row.lesson_date >= SEPTEMBER_PERIOD.startDate &&
              row.lesson_date < SEPTEMBER_PERIOD.endDateExclusive,
          ),
        };
      }
      if (queryText.includes("FROM growth_events")) {
        return {
          rows: eventCandidates.filter((row) => {
            const occurredAt = Date.parse(row.occurred_at);
            return occurredAt >= Date.parse(SEPTEMBER_PERIOD.startAt) &&
              occurredAt < Date.parse(SEPTEMBER_PERIOD.endAt);
          }),
        };
      }
      if (queryText.includes("FROM attendance")) {
        return {
          rows: attendanceCandidates.filter(
            (row) => row.date >= SEPTEMBER_PERIOD.startDate &&
              row.date < SEPTEMBER_PERIOD.endDateExclusive,
          ),
        };
      }
      if (queryText.includes("FROM growth_report_answers")) {
        return { rows: [{
          question_id: "question_september",
          metric_id: "F001",
          selected_values: ["yes"],
          answered_at: "2026-10-02T01:00:00.000Z",
          parent_account_id: "parent_september",
        }] };
      }
      if (queryText.includes("FROM growth_reports") && queryText.includes("ORDER BY published_at DESC")) {
        return { rows: [{
          report_period: "2026-08",
          analysis_status: "COMPLETE",
          report_content: { metric_states: [{ metric_id: "F001", state: "OBSERVED" }] },
        }] };
      }
      return { rows: [] };
    },
  } as any;
}

describe("WP-AI-V1 September 2026 APP snapshot contract Golden", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds the bounded final request through APP's snapshot builder", async () => {
    const db = makeInMemoryDb();
    const { request } = await buildAnalysisSnapshot(db, input);

    expect(request.context.report_period).toBe("2026-09");
    expect(request.context.analysis_from).toBe("2026-08-31T15:00:00.000Z");
    expect(Date.parse(request.context.analysis_from!)).toBe(
      Date.parse("2026-09-01T00:00:00+09:00"),
    );
    expect(request.context.analysis_cutoff_at).toBe("2026-09-30T15:00:00.000Z");
    expect(Date.parse(request.context.analysis_cutoff_at)).toBe(
      Date.parse("2026-10-01T00:00:00+09:00"),
    );
    expect(request.context.timezone).toBe("Asia/Seoul");
    expect(request.contract_version).toBe("1.0");
    expect(request.snapshot.snapshot_version).toBe("1.0");
    const { payload_hash, ...hashableSnapshot } = request.snapshot;
    expect(payload_hash).toBe(computeCanonicalHash(hashableSnapshot));
    expect(request.parent_answers).toEqual(request.snapshot.parent_answers);
    expect(request.parent_answers).toHaveLength(1);
    expect(request.parent_answers[0]!.selected_values).toEqual(["yes"]);
    expect(request.longitudinal).toEqual(request.snapshot.longitudinal);
    expect(request.longitudinal.previous_report_structured_results).toHaveLength(1);

    expect(request.snapshot.growth_events.map((event) => event.occurred_at)).toEqual([
      "2026-08-31T15:00:00.000Z",
      "2026-09-30T14:59:59.999Z",
    ]);
    expect(request.snapshot.diaries.map((diary) => diary.lesson_date)).toEqual([
      "2026-09-01",
    ]);
    expect(request.snapshot.attendance.map((attendance) => attendance.lesson_date)).toEqual([
      "2026-09-01",
      "2026-09-30",
    ]);

    const growthEventQuery = db.calls.find((query: string) => query.includes("FROM growth_events"));
    const diaryQuery = db.calls.find((query: string) => query.includes("class_diary_student_notes"));
    const attendanceQuery = db.calls.find((query: string) => query.includes("FROM attendance"));
    expect(growthEventQuery).toContain("created_at >=");
    expect(growthEventQuery).toContain(SEPTEMBER_PERIOD.startAt);
    expect(growthEventQuery).toContain("created_at <");
    expect(growthEventQuery).toContain(SEPTEMBER_PERIOD.endAt);
    expect(diaryQuery).toContain("cd.lesson_date >=");
    expect(diaryQuery).toContain(SEPTEMBER_PERIOD.startDate);
    expect(diaryQuery).toContain("cd.lesson_date <");
    expect(diaryQuery).toContain(SEPTEMBER_PERIOD.endDateExclusive);
    expect(attendanceQuery).toContain("date::date >=");
    expect(attendanceQuery).toContain(SEPTEMBER_PERIOD.startDate);
    expect(attendanceQuery).toContain("date::date <");
    expect(attendanceQuery).toContain(SEPTEMBER_PERIOD.endDateExclusive);
  });

  it("sends the ENGINE-consumed root fields in the final HTTP JSON", async () => {
    const { request } = await buildAnalysisSnapshot(makeInMemoryDb(), input);
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://synthetic-engine.invalid");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "synthetic-test-secret-for-wire-golden");
    let wire: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      wire = JSON.parse(options.body as string);
      return { ok: true, json: async () => ({}) };
    }));

    await analyzeGrowthReport(request);
    expect(wire.context).toMatchObject({
      report_period: "2026-09",
      analysis_from: "2026-08-31T15:00:00.000Z",
      analysis_cutoff_at: "2026-09-30T15:00:00.000Z",
      timezone: "Asia/Seoul",
    });
    expect(wire.parent_answers).toEqual(request.snapshot.parent_answers);
    expect(wire.parent_answers).toHaveLength(1);
    expect(wire.longitudinal).toEqual(request.snapshot.longitudinal);
    expect(wire.longitudinal.previous_report_structured_results).toHaveLength(1);
    expect(wire.snapshot.snapshot_version).toBe("1.0");
    const { payload_hash, ...hashableSnapshot } = wire.snapshot;
    expect(payload_hash).toBe(computeCanonicalHash(hashableSnapshot));
  });

  it("does not send APP reviewer metadata as an incompatible ENGINE review object", async () => {
    const { request } = await buildAnalysisSnapshot(makeInMemoryDb(), {
      ...input,
      report: {
        ...input.report,
        teacher_reviewed_by: "teacher_september",
        teacher_reviewed_at: "2026-10-02T01:00:00.000Z",
      },
    });
    expect(request.snapshot).not.toHaveProperty("teacher_review");
  });

  it.each([
    [503, "ATOMIZATION_ERROR", true, true],
    [422, "ATOMIZATION_ERROR", false, false],
    [400, "INVALID_CONTRACT", true, false],
  ])("keeps ENGINE failure %s/%s retryable=%s out of the success path", async (
    status, errorCode, engineRetryable, expectedRetryable,
  ) => {
    const { request } = await buildAnalysisSnapshot(makeInMemoryDb(), input);
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://synthetic-engine.invalid");
    vi.stubEnv("GROWTH_REPORT_ENGINE_SECRET", "synthetic-test-secret-for-wire-golden");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status,
      json: async () => ({ error_code: errorCode, retryable: engineRetryable }),
    })));
    await expect(analyzeGrowthReport(request)).rejects.toMatchObject({
      errorCode,
      retryable: expectedRetryable,
    });
  });

  it("rejects non-KST cycles instead of sending contradictory period boundaries", async () => {
    await expect(buildAnalysisSnapshot(makeInMemoryDb(), {
      ...input, cycle: { ...input.cycle, timezone: "UTC" },
    })).rejects.toThrow("Unsupported growth report timezone");
  });
});