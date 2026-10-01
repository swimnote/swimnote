import { describe, expect, it } from "vitest";
import { initGrowthReportMonthlyIntegritySchema } from "../../migrations/growth-report-monthly-integrity.js";
import {
  backfillLegacyMonthlyTargets,
  sealMonthlyTargets,
} from "../growth-report-monthly-targets.js";

function queryText(query: any): string {
  return query?.queryChunks
    ? query.queryChunks.map((chunk: any) =>
        typeof chunk === "string" ? chunk : (chunk?.value ?? "")
      ).join("")
    : String(query?.sql ?? query ?? "");
}

function liveSealDb(options: {
  candidates?: any[];
  qualifyingStudentIds?: string[];
} = {}) {
  const targets: any[] = [];
  const candidateRows = options.candidates ?? [
    { student_id: "eligible-student", qualifying_class_group_ids: ["class-a"] },
    { student_id: "no-source-student", qualifying_class_group_ids: ["class-b"] },
  ];
  const qualifyingStudentIds = options.qualifyingStudentIds ?? ["eligible-student"];
  const cycle: any = {
    id: "cycle-a",
    swimming_pool_id: "pool-a",
    report_period: "2026-08",
    analysis_from: null,
    eligible_total: null,
    eligibility_sealed_at: null,
  };
  let candidateReads = 0;
  let attendanceReads = 0;
  let diaryReads = 0;
  let insertedTargetCount = 0;
  let reportInsertSql = "";
  let openReportUpdateSql = "";
  let candidateSql = "";
  const execute = async (query: any) => {
    const text = queryText(query);
    if (text.includes("FROM students s")) candidateSql = text;
    if (text.includes("INSERT INTO growth_reports")) reportInsertSql = text;
    if (text.includes("UPDATE growth_reports gr")) openReportUpdateSql = text;
    if (text.includes("recognized_lessons")) {
      attendanceReads++;
      return { rows: [{ cnt: 3 }] };
    }
    if (text.includes("FROM class_diaries cd")) {
      const candidate = candidateRows[diaryReads];
      diaryReads++;
      return {
        rows: qualifyingStudentIds.includes(candidate?.student_id) ? [{ id: "diary-a" }] : [],
      };
    }
    if (text.includes("FROM students s")) {
      candidateReads++;
      return { rows: candidateRows };
    }
    if (text.includes("FROM swimming_pools")) return { rows: [{ id: "pool-a" }] };
    if (text.includes("FROM growth_report_cycles") && text.includes("FOR UPDATE")) {
      return { rows: [cycle] };
    }
    if (text.includes("FROM growth_report_eligible_targets")) {
      return {
        rows: [...targets].sort((a, b) => a.student_id.localeCompare(b.student_id)).map((target) => ({
          student_id: target.student_id,
          confirmed_at: target.confirmed_at,
          eligibility_version: target.eligibility_version,
          eligibility_evidence: target.eligibility_evidence,
          source_provenance: target.source_provenance,
        })),
      };
    }
    if (text.includes("INSERT INTO growth_report_eligible_targets")) {
      const studentId = qualifyingStudentIds[insertedTargetCount++]!;
      targets.push({
        student_id: studentId,
        confirmed_at: "2026-09-01T00:00:00.000Z",
        eligibility_version: 4,
        eligibility_evidence: {
          eligibility_version: 4,
          attendance_count: 3,
          source_event_count: 1,
          reregistered: true,
        },
        source_provenance: "LIVE_SEAL",
      });
      return { rows: [] };
    }
    if (text.includes("SET eligible_total")) {
      cycle.eligible_total = targets.length;
      cycle.eligibility_sealed_at = new Date("2026-09-01T00:00:00.000Z");
      return { rows: [] };
    }
    if (text.includes("SELECT id, swimming_pool_id, report_period, analysis_from")) {
      return { rows: [cycle] };
    }
    return { rows: [] };
  };
  const db: any = {
    execute,
    transaction: async (operation: (tx: any) => Promise<unknown>) => operation(db),
  };
  return {
    db, targets, getCandidateReads: () => candidateReads,
    getAttendanceReads: () => attendanceReads, getReportInsertSql: () => reportInsertSql,
    getOpenReportUpdateSql: () => openReportUpdateSql,
    getCandidateSql: () => candidateSql,
  };
}

describe("monthly target sealing and legacy restoration", () => {
  it("seals only students passing recognized attendance and diary eligibility, then reuses the manifest", async () => {
    const fixture = liveSealDb();
    const input = { cycleId: "cycle-a", poolId: "pool-a", reportPeriod: "2026-08" };

    const first = await sealMonthlyTargets(fixture.db, input);
    expect(first.eligibleTotal).toBe(1);
    expect(first.targets.map((target) => target.studentId)).toEqual(["eligible-student"]);
    expect(first.targets[0]?.sourceProvenance).toBe("LIVE_SEAL");
    expect(first.targets[0]?.eligibilityEvidence).toMatchObject({
      eligibility_version: 4,
      attendance_count: 3,
      source_event_count: 1,
    });
    expect(fixture.getReportInsertSql()).toContain("target.eligibility_version");
    expect(fixture.getReportInsertSql()).toContain("target.eligibility_evidence->>'attendance_count'");
    expect(fixture.getReportInsertSql()).toContain("target.eligibility_evidence->>'source_event_count'");
    expect(fixture.getOpenReportUpdateSql()).toContain("gr.product_status = 'OPEN'");
    expect(fixture.getOpenReportUpdateSql()).toContain("gr.analysis_request_id IS NULL");
    expect(fixture.getOpenReportUpdateSql()).toContain("COALESCE(gr.eligibility_version, 0) = 0");
    expect(fixture.getAttendanceReads()).toBe(2);

    const repeated = await sealMonthlyTargets(fixture.db, input);
    expect(repeated.targets.map((target) => target.studentId)).toEqual(["eligible-student"]);
    expect(fixture.getCandidateReads()).toBe(1);
  });

  it("keeps cutoff-qualified same-pool members when sealing is delayed past a timestamped withdrawal/deletion", async () => {
    const fixture = liveSealDb({
      candidates: [
        { student_id: "withdrawn-after-cutoff", qualifying_class_group_ids: ["class-a"] },
        { student_id: "deleted-after-cutoff", qualifying_class_group_ids: ["class-b"] },
      ],
      qualifyingStudentIds: ["withdrawn-after-cutoff", "deleted-after-cutoff"],
    });
    const manifest = await sealMonthlyTargets(fixture.db, {
      cycleId: "cycle-a",
      poolId: "pool-a",
      reportPeriod: "2026-08",
    });

    expect(manifest.targets.map((target) => target.studentId)).toEqual([
      "deleted-after-cutoff",
      "withdrawn-after-cutoff",
    ]);
    expect(fixture.getCandidateSql()).toContain("sch.swimming_pool_id =");
    expect(fixture.getCandidateSql()).toContain("sch.enrolled_at <");
    expect(fixture.getCandidateSql()).toContain("sch.left_at >= ");
    expect(fixture.getCandidateSql()).toContain("s.withdrawn_at >=");
    expect(fixture.getCandidateSql()).toContain("s.deleted_at >=");
    expect(fixture.getCandidateSql()).toContain("s.status = 'active'");
    expect(fixture.getCandidateSql()).toContain("AT TIME ZONE 'Asia/Seoul'");
  });

  it("refuses live recalculation when an unsealed cycle has prior eligibility or request evidence", async () => {
    const calls: string[] = [];
    const db: any = {
      execute: async (query: any) => {
        const text = queryText(query);
        calls.push(text);
        if (text.includes("FROM growth_report_cycles") && text.includes("FOR UPDATE")) {
          return { rows: [{
            id: "legacy-cycle",
            swimming_pool_id: "pool-a",
            report_period: "2026-08",
            analysis_from: null,
            eligible_total: null,
            eligibility_sealed_at: null,
          }] };
        }
        if (text.includes("FROM growth_reports")) return { rows: [{ id: "prior-report" }] };
        return { rows: [] };
      },
      transaction: async (operation: (tx: any) => Promise<unknown>) => operation(db),
    };

    await expect(sealMonthlyTargets(db, {
      cycleId: "legacy-cycle",
      poolId: "pool-a",
      reportPeriod: "2026-08",
    })).rejects.toThrow("backfillLegacyMonthlyTargets");
    expect(calls.some((text) => text.includes("FROM students"))).toBe(false);
  });

  it("backfills only v4+ saved eligible evidence and validates the persisted request context", async () => {
    const targetRows: any[] = [];
    const cycle: any = {
      id: "legacy-cycle",
      swimming_pool_id: "pool-a",
      report_period: "2026-08",
      analysis_from: null,
      eligible_total: null,
      eligibility_sealed_at: null,
    };
    const savedRequest = {
      request_id: "request-a",
      report_id: "report-a",
      snapshot: {
        payload_hash: "hash-a",
        created_at: "2026-09-15T00:00:00.000Z",
      },
      context: {
        student_id: "student-a",
        pool_id: "pool-a",
        report_period: "2026-08",
      },
    };
    const db: any = {
      execute: async (query: any) => {
        const text = queryText(query);
        if (text.includes("transaction_timestamp()")) {
          return { rows: [{ recorded_at: "2026-10-05T00:00:00.000Z" }] };
        }
        if (text.includes("FROM growth_report_cycles") && text.includes("FOR UPDATE")) {
          return { rows: [cycle] };
        }
        if (text.includes("FROM growth_reports")) {
          expect(text).toContain("eligibility_version >=");
          expect(text).toContain("attendance_count >=");
          expect(text).toContain("source_event_count >=");
          expect(text).toContain("exclusion_code IS NULL");
          return { rows: [{
            report_id: "report-a",
            student_id: "student-a",
            cycle_id: "legacy-cycle",
            report_period: "2026-08",
            swimming_pool_id: "pool-a",
            analysis_request_id: "request-a",
            analysis_request_payload: savedRequest,
            snapshot_hash: "hash-a",
            eligibility_version: 4,
            attendance_count: 3,
            source_event_count: 1,
            exclusion_code: null,
          }] };
        }
        if (text.includes("INSERT INTO growth_report_eligible_targets")) {
          targetRows.push({
            student_id: "student-a",
            confirmed_at: "2026-09-15T00:00:00.000Z",
            eligibility_version: 4,
            eligibility_evidence: {
              source: "SAVED_GROWTH_REPORT_ELIGIBILITY",
              request_snapshot_created_at: "2026-09-15T00:00:00.000Z",
              backfilled_at: "2026-10-05T00:00:00.000Z",
            },
            source_provenance: "LEGACY_STORED_EVIDENCE",
          });
          return { rows: [] };
        }
        if (text.includes("FROM growth_report_eligible_targets")) {
          return { rows: targetRows };
        }
        if (text.includes("SET eligible_total")) {
          cycle.eligible_total = 1;
          cycle.eligibility_sealed_at = new Date("2026-09-01T00:00:00.000Z");
          return { rows: [] };
        }
        if (text.includes("SELECT id, swimming_pool_id, report_period, analysis_from")) {
          return { rows: [cycle] };
        }
        return { rows: [] };
      },
      transaction: async (operation: (tx: any) => Promise<unknown>) => operation(db),
    };

    const manifest = await backfillLegacyMonthlyTargets(db, {
      poolId: "pool-a",
      reportPeriod: "2026-08",
    });
    expect(manifest.eligibleTotal).toBe(1);
    expect(manifest.targets[0]?.confirmedAt).toBe("2026-09-15T00:00:00.000Z");
    expect(manifest.targets[0]?.eligibilityEvidence).toMatchObject({
      request_snapshot_created_at: "2026-09-15T00:00:00.000Z",
      backfilled_at: "2026-10-05T00:00:00.000Z",
    });
    expect(manifest.targets[0]?.sourceProvenance).toBe("LEGACY_STORED_EVIDENCE");
    expect(manifest.targets[0]?.studentId).toBe("student-a");
  });

  it("defines additive target and claim schema without student-delete cascade", async () => {
    const statements: string[] = [];
    await initGrowthReportMonthlyIntegritySchema({
      execute: async (query: any) => {
        statements.push(queryText(query));
        return { rows: [] };
      },
    } as any);
    const migration = statements.join("\n");
    for (const column of [
      "eligible_total", "eligibility_sealed_at", "ready_at",
      "analysis_claim_token", "analysis_lease_until", "analysis_next_attempt_at",
      "analysis_call_started_at", "analysis_uncertain_at",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("PRIMARY KEY (cycle_id, student_id)");
    expect(migration).toContain("REFERENCES growth_report_cycles(id) ON DELETE RESTRICT");
    expect(migration).not.toMatch(/REFERENCES\s+students|ON DELETE CASCADE/i);
    expect(migration).not.toContain("DROP CONSTRAINT");
  });
});