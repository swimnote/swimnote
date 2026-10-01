import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../../utils/notify.js", () => ({
  notifyGrowthReportPublished: vi.fn(async () => undefined),
}));

import { notifyGrowthReportPublished } from "../../utils/notify.js";
import {
  ALL_PRODUCT_STATUSES,
  ALLOWED_TRANSITIONS,
  autoApproveAndPublishForDelivery,
  transitionReportStatus,
  InvalidTransitionError,
  publishGrowthReport,
  PublishPreconditionError,
  PublishNotAllowedError,
  type AnalysisStatus,
} from "../growth-report-service.js";
import {
  DISCARD_REASONS,
  discardReportVersion,
  publishGrowthReports,
} from "../growth-report-production-service.js";
import { monthlyPublicationGuard } from "../growth-report-publication-guard.js";

function sqlText(query: any): string {
  const pieces: string[] = [];
  const visit = (chunk: any): void => {
    if (typeof chunk === "string") {
      pieces.push(chunk);
    } else if (Array.isArray(chunk?.queryChunks)) {
      chunk.queryChunks.forEach(visit);
    } else if (Array.isArray(chunk?.value)) {
      chunk.value.forEach(visit);
    } else if (typeof chunk?.value === "string") {
      pieces.push(chunk.value);
    }
  };
  query?.queryChunks?.forEach(visit);
  return pieces.join("");
}

const POOL_ID = "pool-publication-test";
const REPORT_ID = "gr-publication-test";
const STUDENT_ID = "student-publication-test";

describe("monthly V1 publication guard", () => {
  afterEach(() => vi.clearAllMocks());

  it("checks V1 eligibility, report quality, cycle/pool, active student, and continued class history", () => {
    const text = sqlText(monthlyPublicationGuard("gr"));

    for (const fragment of [
      "eligibility_version >= 4",
      "exclusion_code IS NULL",
      "attendance_count >= 3",
      "source_event_count >= 1",
      "COMPLETE_WITH_PARENT_EVIDENCE",
      "grounding_result",
      "growth_framing_result",
      "report_type = 'monthly'",
      "NOW() >=",
      "INTERVAL '1 month' + INTERVAL '4 days'",
      "AT TIME ZONE 'Asia/Seoul'",
      "publication_cycle.report_period = gr.report_period",
      "publication_student.status = 'active'",
      "publication_student.deleted_at IS NULL",
      "publication_pool.deactivated_at IS NULL",
      "publication_pool.deletion_scheduled_at IS NULL",
      "publication_history.left_at",
      "publication_class.is_deleted = false",
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it("rejects unsafe SQL aliases", () => {
    expect(() => monthlyPublicationGuard('gr) OR true --')).toThrow("Invalid monthly publication guard alias");
  });

  it("fails closed when the guarded UPDATE returns no claim and never notifies", async () => {
    const calls: string[] = [];
    const db = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        calls.push(text);
        if (text.includes("WITH claimable")) return { rows: [] };
        if (text.includes("SELECT id, product_status")) {
          return { rows: [{ id: REPORT_ID, product_status: "READY_TO_SEND" }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as any;

    const result = await publishGrowthReports(db, {
      poolId: POOL_ID,
      reportIds: [REPORT_ID],
      actorId: "admin-1",
    });

    expect(result).toMatchObject({
      requested_count: 1,
      published_count: 0,
      already_published_count: 0,
      skipped_count: 1,
      push_attempted_count: 0,
    });
    const claim = calls.find(text => text.includes("WITH claimable"));
    expect(claim).toBeDefined();
    expect(claim).toContain("eligibility_version");
    expect(notifyGrowthReportPublished).not.toHaveBeenCalled();
  });

  it("notifies only rows returned from the guarded UPDATE", async () => {
    const calls: string[] = [];
    const db = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        calls.push(text);
        if (text.includes("WITH claimable")) {
          return {
            rows: [{
              id: REPORT_ID,
              student_id: STUDENT_ID,
              swimming_pool_id: POOL_ID,
              report_period: "2026-08",
              published_at: "2026-09-01T00:00:00.000Z",
              previous_status: "READY_TO_SEND",
            }],
          };
        }
        if (text.includes("SELECT id, product_status")) {
          return { rows: [{ id: REPORT_ID, product_status: "PUBLISHED" }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    } as any;

    const result = await publishGrowthReports(db, {
      poolId: POOL_ID,
      reportIds: [REPORT_ID],
      actorId: "admin-1",
    });

    expect(result.published_count).toBe(1);
    expect(result.push_attempted_count).toBe(1);
    expect(vi.mocked(notifyGrowthReportPublished)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyGrowthReportPublished)).toHaveBeenCalledWith(expect.objectContaining({
      reportId: REPORT_ID,
      studentId: STUDENT_ID,
      poolId: POOL_ID,
    }));
    expect(calls.find(text => text.includes("WITH claimable"))).toContain("eligibility_version");
  });

  it("traditional publish fails closed unless its atomic UPDATE returns a guarded claim", async () => {
    const calls: string[] = [];
    const current = {
      id: REPORT_ID,
      product_status: "APPROVED",
      report_content: { summary_text: "성장 내용" },
      report_fact_package: { grounding_result: "PASS", growth_framing_result: "PASS" },
      sns_summary: { headline: "요약" },
      teacher_reviewed_at: "2026-08-30T00:00:00Z",
      swimming_pool_id: POOL_ID,
      deleted_at: null,
      published_at: null,
    };
    const db = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        calls.push(text);
        if (text.includes("UPDATE growth_reports AS gr")) return { rows: [] };
        if (text.includes("SELECT product_status, deleted_at, published_at")) {
          return { rows: [{ product_status: "APPROVED", deleted_at: null }] };
        }
        if (text.includes("FROM growth_reports")) return { rows: [current] };
        return { rows: [], rowCount: 0 };
      }),
    } as any;

    await expect(publishGrowthReport({
      db,
      reportId: REPORT_ID,
      actorId: "admin-1",
      actorType: "pool_admin",
    })).rejects.toBeInstanceOf(PublishPreconditionError);
    const claim = calls.find(text => text.includes("UPDATE growth_reports AS gr"));
    expect(claim).toContain("eligibility_version");
    expect(claim).toContain("source_event_count");
    expect(claim).toContain("publication_history");
  });

  it("automatic publication rejects without touching the database", async () => {
    const db = { execute: vi.fn() } as any;
    await expect(autoApproveAndPublishForDelivery({
      db,
      reportId: REPORT_ID,
      actorId: "SYSTEM_MONTHLY_AUTO",
    })).rejects.toBeInstanceOf(PublishNotAllowedError);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("lifecycle transition uses expected-from CAS and writes no audit on a lost race", async () => {
    const calls: string[] = [];
    const db = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        calls.push(text);
        if (text.includes("SELECT id, product_status, swimming_pool_id, deleted_at")) {
          return { rows: [{
            id: REPORT_ID,
            product_status: "REVIEW_REQUIRED",
            swimming_pool_id: POOL_ID,
            deleted_at: null,
          }] };
        }
        if (text.includes("UPDATE growth_reports")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
    } as any;

    await expect(transitionReportStatus({
      db,
      reportId: REPORT_ID,
      toStatus: "APPROVED",
      actorType: "pool_admin",
      actorId: "admin-1",
    })).rejects.toBeInstanceOf(InvalidTransitionError);

    const update = calls.find(text => text.includes("UPDATE growth_reports"));
    expect(update).toContain("AND product_status =");
    expect(update).toContain("RETURNING id");
    expect(calls.some(text => text.includes("next_audit_version"))).toBe(false);
  });

  it("supports EXCLUDED and DATA_ACCUMULATING while keeping terminal transitions explicit", () => {
    const accumulatingStatus: AnalysisStatus = "DATA_ACCUMULATING";
    expect(accumulatingStatus).toBe("DATA_ACCUMULATING");
    expect(ALL_PRODUCT_STATUSES.has("EXCLUDED")).toBe(true);
    expect(ALLOWED_TRANSITIONS.EXCLUDED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.REVIEW_REQUIRED).toContain("READY_FOR_ANALYSIS");
    expect(ALLOWED_TRANSITIONS.REVIEW_REQUIRED).toContain("DISCARDED");
    expect(ALLOWED_TRANSITIONS.APPROVED).toContain("DISCARDED");
  });

  it("keeps discard reasons a strict runtime enum", async () => {
    const db = {
      execute: vi.fn(async () => ({
        rows: [{
          id: REPORT_ID,
          product_status: "READY_TO_SEND",
          swimming_pool_id: POOL_ID,
          deleted_at: null,
        }],
      })),
    } as any;

    expect(DISCARD_REASONS).toEqual([
      "글자·레이아웃 오류",
      "내용 오류",
      "데이터 누락",
      "기타",
    ]);
    await expect(discardReportVersion(db, {
      reportId: REPORT_ID,
      poolId: POOL_ID,
      actorId: "admin-1",
      reason: "free-form text" as any,
    })).rejects.toMatchObject({ code: "INVALID_DISCARD_REASON" });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit admin discard from REVIEW_REQUIRED", async () => {
    const row = {
      id: REPORT_ID,
      product_status: "REVIEW_REQUIRED",
      swimming_pool_id: POOL_ID,
      deleted_at: null,
    };
    const db = {
      execute: vi.fn(async (query: any) => {
        const text = sqlText(query);
        if (text.includes("next_audit_version")) return { rows: [{ v: 1 }] };
        if (text.includes("INSERT INTO audit_logs")) return { rows: [], rowCount: 1 };
        if (text.includes("SELECT id, product_status")) return { rows: [row] };
        if (text.includes("UPDATE growth_reports") && text.includes("RETURNING id")) {
          return { rows: [{ id: REPORT_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    } as any;

    await expect(discardReportVersion(db, {
      reportId: REPORT_ID,
      poolId: POOL_ID,
      actorId: "admin-1",
      reason: "내용 오류",
    })).resolves.toBeUndefined();
    expect(db.execute.mock.calls.some(([query]: any[]) =>
      sqlText(query).includes("SET product_status ="),
    )).toBe(true);
  });
});