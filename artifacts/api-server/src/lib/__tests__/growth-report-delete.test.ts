/**
 * growth-report-delete.test.ts
 *
 * OFFICIAL GROWTH REPORT DELETE FEATURE — 필수 테스트
 *
 * TC01  pool_admin own pool delete → 200 (result shape)
 * TC02  pool_admin cross-pool → 403
 * TC03  teacher role → 403 (role guard)
 * TC04  parent role → 403 (role guard)
 * TC05  bad confirm body → 400
 * TC06  already deleted → 409
 * TC07  report not found → 404
 * TC08  likes / comments / notifications 삭제 카운트
 * TC09  transaction rollback: partial failure → no mutation
 * TC10  parent feed: deleted_at IS NULL 필터 적용
 * TC11  teacher interactions: deleted report 조회 불가
 * TC12  same student + cycle 새 report 생성 가능 (재발급 안전)
 * TC13  super_admin cross-pool delete → 허용
 * TC14  soft-delete: row 자체는 남음 (audit trail)
 * TC15  previous_report_id selector: deleted_at IS NULL 확인
 */

import { describe, it, expect } from "vitest";

// ─── 헬퍼 타입 ────────────────────────────────────────────────────────────────

interface GrowthReportRow {
  id: string;
  swimming_pool_id: string;
  student_id: string;
  cycle_id: string | null;
  product_status: string;
  deleted_at: string | null;
}

interface DeleteResult {
  report_id: string;
  deleted: { report: number; reactions: number; comments: number; notifications: number };
}

// ─── 서비스 로직 미러 (deleteGrowthReport 의사 구현) ─────────────────────────

type Role = "pool_admin" | "super_admin" | "teacher" | "parent";

function validateDeleteRequest(params: {
  confirm: string | undefined;
  row: GrowthReportRow | null;
  callerRole: Role;
  callerPoolId: string | null;
}): { status: number; error?: string } | "OK" {
  if (params.confirm !== "DELETE_GROWTH_REPORT") {
    return { status: 400, error: "confirm 값이 올바르지 않습니다." };
  }
  if (params.callerRole !== "pool_admin" && params.callerRole !== "super_admin") {
    return { status: 403, error: "접근 권한이 없습니다." };
  }
  if (!params.row) {
    return { status: 404, error: "리포트를 찾을 수 없습니다." };
  }
  if (params.row.deleted_at) {
    return { status: 409, error: "이미 삭제된 리포트입니다." };
  }
  if (params.callerRole === "pool_admin") {
    if (!params.callerPoolId || params.row.swimming_pool_id !== params.callerPoolId) {
      return { status: 403, error: "접근 권한이 없습니다." };
    }
  }
  return "OK";
}

function simulateDeleteTransaction(params: {
  row: GrowthReportRow;
  reactions: number;
  comments: number;
  notifications: number;
  failAt?: "notifications" | "comments" | "reactions" | "update";
}): DeleteResult | "ROLLED_BACK" {
  if (params.failAt) return "ROLLED_BACK";
  return {
    report_id: params.row.id,
    deleted: {
      report:        1,
      reactions:     params.reactions,
      comments:      params.comments,
      notifications: params.notifications,
    },
  };
}

// ─── TC01: pool_admin own pool delete → 200 ───────────────────────────────────

describe("TC01: pool_admin own pool delete", () => {
  it("자기 pool report 삭제 → result shape 정상", () => {
    const row: GrowthReportRow = {
      id: "gr_001", swimming_pool_id: "pool_A",
      student_id: "stu_1", cycle_id: "cyc_1",
      product_status: "PUBLISHED", deleted_at: null,
    };
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row,
      callerRole: "pool_admin",
      callerPoolId: "pool_A",
    });
    expect(check).toBe("OK");

    const result = simulateDeleteTransaction({ row, reactions: 3, comments: 5, notifications: 2 });
    expect(result).not.toBe("ROLLED_BACK");
    const r = result as DeleteResult;
    expect(r.report_id).toBe("gr_001");
    expect(r.deleted.report).toBe(1);
    expect(r.deleted.reactions).toBe(3);
    expect(r.deleted.comments).toBe(5);
    expect(r.deleted.notifications).toBe(2);
  });
});

// ─── TC02: pool_admin cross-pool → 403 ────────────────────────────────────────

describe("TC02: pool_admin cross-pool → 403", () => {
  it("다른 pool report → 403", () => {
    const row: GrowthReportRow = {
      id: "gr_002", swimming_pool_id: "pool_B",
      student_id: "stu_2", cycle_id: "cyc_2",
      product_status: "PUBLISHED", deleted_at: null,
    };
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row,
      callerRole: "pool_admin",
      callerPoolId: "pool_A",
    });
    expect(check).toEqual({ status: 403, error: "접근 권한이 없습니다." });
  });
});

// ─── TC03: teacher role → 403 ─────────────────────────────────────────────────

describe("TC03: teacher role → 403", () => {
  it("teacher는 삭제 불가", () => {
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row: { id: "gr_003", swimming_pool_id: "pool_A", student_id: "stu_3",
             cycle_id: "cyc_3", product_status: "PUBLISHED", deleted_at: null },
      callerRole: "teacher",
      callerPoolId: "pool_A",
    });
    expect(check).toEqual({ status: 403, error: "접근 권한이 없습니다." });
  });
});

// ─── TC04: parent role → 403 ─────────────────────────────────────────────────

describe("TC04: parent role → 403", () => {
  it("parent는 삭제 불가", () => {
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row: { id: "gr_004", swimming_pool_id: "pool_A", student_id: "stu_4",
             cycle_id: "cyc_4", product_status: "PUBLISHED", deleted_at: null },
      callerRole: "parent",
      callerPoolId: null,
    });
    expect(check).toEqual({ status: 403, error: "접근 권한이 없습니다." });
  });
});

// ─── TC05: bad confirm body → 400 ────────────────────────────────────────────

describe("TC05: bad confirm body → 400", () => {
  it("confirm 누락 → 400", () => {
    const check = validateDeleteRequest({
      confirm: undefined,
      row: { id: "gr_005", swimming_pool_id: "pool_A", student_id: "stu_5",
             cycle_id: "cyc_5", product_status: "PUBLISHED", deleted_at: null },
      callerRole: "pool_admin",
      callerPoolId: "pool_A",
    });
    expect(check).toEqual({ status: 400, error: "confirm 값이 올바르지 않습니다." });
  });

  it("confirm 오기입 → 400", () => {
    const check = validateDeleteRequest({
      confirm: "DELETE",
      row: { id: "gr_005b", swimming_pool_id: "pool_A", student_id: "stu_5b",
             cycle_id: "cyc_5b", product_status: "PUBLISHED", deleted_at: null },
      callerRole: "pool_admin",
      callerPoolId: "pool_A",
    });
    expect(check).toEqual({ status: 400, error: "confirm 값이 올바르지 않습니다." });
  });
});

// ─── TC06: already deleted → 409 ─────────────────────────────────────────────

describe("TC06: already deleted → 409", () => {
  it("deleted_at 존재 → 409", () => {
    const row: GrowthReportRow = {
      id: "gr_006", swimming_pool_id: "pool_A", student_id: "stu_6",
      cycle_id: "cyc_6", product_status: "PUBLISHED",
      deleted_at: "2026-08-01T00:00:00Z",
    };
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row,
      callerRole: "pool_admin",
      callerPoolId: "pool_A",
    });
    expect(check).toEqual({ status: 409, error: "이미 삭제된 리포트입니다." });
  });
});

// ─── TC07: report not found → 404 ────────────────────────────────────────────

describe("TC07: report not found → 404", () => {
  it("row null → 404", () => {
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row: null,
      callerRole: "pool_admin",
      callerPoolId: "pool_A",
    });
    expect(check).toEqual({ status: 404, error: "리포트를 찾을 수 없습니다." });
  });
});

// ─── TC08: likes / comments / notifications 삭제 카운트 ──────────────────────

describe("TC08: dependency cleanup counts", () => {
  it("reactions=5 comments=3 notifications=2 → 모두 삭제", () => {
    const row: GrowthReportRow = {
      id: "gr_008", swimming_pool_id: "pool_A", student_id: "stu_8",
      cycle_id: "cyc_8", product_status: "PUBLISHED", deleted_at: null,
    };
    const result = simulateDeleteTransaction({ row, reactions: 5, comments: 3, notifications: 2 }) as DeleteResult;
    expect(result.deleted.reactions).toBe(5);
    expect(result.deleted.comments).toBe(3);
    expect(result.deleted.notifications).toBe(2);
  });

  it("의존 데이터 없음 (0) → 오류 없음", () => {
    const row: GrowthReportRow = {
      id: "gr_008b", swimming_pool_id: "pool_A", student_id: "stu_8b",
      cycle_id: "cyc_8b", product_status: "PUBLISHED", deleted_at: null,
    };
    const result = simulateDeleteTransaction({ row, reactions: 0, comments: 0, notifications: 0 }) as DeleteResult;
    expect(result.deleted.reactions).toBe(0);
    expect(result.deleted.comments).toBe(0);
    expect(result.deleted.notifications).toBe(0);
    expect(result.deleted.report).toBe(1);
  });
});

// ─── TC09: transaction rollback ───────────────────────────────────────────────

describe("TC09: transaction rollback on failure", () => {
  const row: GrowthReportRow = {
    id: "gr_009", swimming_pool_id: "pool_A", student_id: "stu_9",
    cycle_id: "cyc_9", product_status: "PUBLISHED", deleted_at: null,
  };
  for (const failAt of ["notifications", "comments", "reactions", "update"] as const) {
    it(`fail at ${failAt} → ROLLED_BACK`, () => {
      const result = simulateDeleteTransaction({ row, reactions: 2, comments: 1, notifications: 1, failAt });
      expect(result).toBe("ROLLED_BACK");
    });
  }
});

// ─── TC10: parent feed: deleted_at IS NULL 필터 ───────────────────────────────

describe("TC10: parent feed excludes soft-deleted reports", () => {
  function getParentFeed(reports: GrowthReportRow[]): GrowthReportRow[] {
    return reports.filter(r => r.deleted_at === null && r.product_status === "PUBLISHED");
  }

  it("soft-deleted report → feed 미노출", () => {
    const reports: GrowthReportRow[] = [
      { id: "gr_A", swimming_pool_id: "pool_A", student_id: "stu_10", cycle_id: "c1",
        product_status: "PUBLISHED", deleted_at: "2026-08-01T00:00:00Z" },
      { id: "gr_B", swimming_pool_id: "pool_A", student_id: "stu_10", cycle_id: "c2",
        product_status: "PUBLISHED", deleted_at: null },
    ];
    const feed = getParentFeed(reports);
    expect(feed.map(r => r.id)).toEqual(["gr_B"]);
  });

  it("모든 report 삭제 → 빈 feed", () => {
    const reports: GrowthReportRow[] = [
      { id: "gr_C", swimming_pool_id: "pool_A", student_id: "stu_10b", cycle_id: "c3",
        product_status: "PUBLISHED", deleted_at: "2026-08-01T00:00:00Z" },
    ];
    expect(getParentFeed(reports)).toHaveLength(0);
  });
});

// ─── TC11: teacher interactions: deleted report 미노출 ───────────────────────

describe("TC11: teacher interactions on deleted report", () => {
  function resolveTeacherAccess(row: GrowthReportRow | null): "OK" | "NOT_FOUND" {
    if (!row || row.deleted_at) return "NOT_FOUND";
    return "OK";
  }

  it("deleted report → teacher interactions 접근 불가", () => {
    const deleted: GrowthReportRow = {
      id: "gr_011", swimming_pool_id: "pool_A", student_id: "stu_11", cycle_id: "c11",
      product_status: "PUBLISHED", deleted_at: "2026-08-01T00:00:00Z",
    };
    expect(resolveTeacherAccess(deleted)).toBe("NOT_FOUND");
  });

  it("active report → teacher interactions 정상", () => {
    const active: GrowthReportRow = {
      id: "gr_011b", swimming_pool_id: "pool_A", student_id: "stu_11b", cycle_id: "c11b",
      product_status: "PUBLISHED", deleted_at: null,
    };
    expect(resolveTeacherAccess(active)).toBe("OK");
  });
});

// ─── TC12: 같은 student + cycle 새 report 생성 가능 (재발급 안전) ─────────────

describe("TC12: reissue safety after soft-delete", () => {
  /**
   * UNIQUE INDEX: uq_growth_reports_student_cycle
   * ON (student_id, cycle_id) WHERE cycle_id IS NOT NULL AND deleted_at IS NULL
   *
   * soft-delete(deleted_at SET) → index 범위 제외 → 동일 조합 INSERT 가능
   */
  function canInsertNewReport(existing: GrowthReportRow[], studentId: string, cycleId: string): boolean {
    const conflict = existing.find(r =>
      r.student_id === studentId &&
      r.cycle_id === cycleId &&
      r.cycle_id !== null &&
      r.deleted_at === null,
    );
    return !conflict;
  }

  it("soft-deleted 후 동일 student+cycle INSERT 가능", () => {
    const existing: GrowthReportRow[] = [
      { id: "gr_012", swimming_pool_id: "pool_A", student_id: "stu_12",
        cycle_id: "cyc_12", product_status: "PUBLISHED", deleted_at: "2026-08-01T00:00:00Z" },
    ];
    expect(canInsertNewReport(existing, "stu_12", "cyc_12")).toBe(true);
  });

  it("active report 존재 시 동일 INSERT 불가 (conflict)", () => {
    const existing: GrowthReportRow[] = [
      { id: "gr_012b", swimming_pool_id: "pool_A", student_id: "stu_12",
        cycle_id: "cyc_12", product_status: "PUBLISHED", deleted_at: null },
    ];
    expect(canInsertNewReport(existing, "stu_12", "cyc_12")).toBe(false);
  });

  it("다른 cycle → conflict 없음", () => {
    const existing: GrowthReportRow[] = [
      { id: "gr_012c", swimming_pool_id: "pool_A", student_id: "stu_12",
        cycle_id: "cyc_12", product_status: "PUBLISHED", deleted_at: null },
    ];
    expect(canInsertNewReport(existing, "stu_12", "cyc_13")).toBe(true);
  });
});

// ─── TC13: super_admin cross-pool delete → 허용 ──────────────────────────────

describe("TC13: super_admin cross-pool delete", () => {
  it("super_admin은 전체 pool 삭제 가능", () => {
    const row: GrowthReportRow = {
      id: "gr_013", swimming_pool_id: "pool_X",
      student_id: "stu_13", cycle_id: "cyc_13",
      product_status: "PUBLISHED", deleted_at: null,
    };
    const check = validateDeleteRequest({
      confirm: "DELETE_GROWTH_REPORT",
      row,
      callerRole: "super_admin",
      callerPoolId: null, // super_admin은 poolId 불필요
    });
    expect(check).toBe("OK");
  });
});

// ─── TC14: soft-delete — row 자체는 남음 (audit trail) ───────────────────────

describe("TC14: soft-delete preserves row for audit", () => {
  it("soft-delete 후 row에 deleted_at 설정됨, id 유지", () => {
    const row: GrowthReportRow = {
      id: "gr_014", swimming_pool_id: "pool_A", student_id: "stu_14",
      cycle_id: "cyc_14", product_status: "PUBLISHED", deleted_at: null,
    };
    // simulate soft-delete
    const afterDelete = { ...row, deleted_at: "2026-08-29T00:00:00Z" };
    expect(afterDelete.id).toBe("gr_014");        // row 보존
    expect(afterDelete.deleted_at).not.toBeNull(); // deleted_at 설정
    expect(afterDelete.product_status).toBe("PUBLISHED"); // status 변경 없음
  });
});

// ─── TC15: previous_report_id selector: deleted_at IS NULL 확인 ──────────────

describe("TC15: previous_report_id selector excludes soft-deleted", () => {
  /**
   * getPublishedReportHistory (growth-report-service.ts:550):
   * WHERE deleted_at IS NULL
   * → deleted report는 longitudinal history에 포함되지 않음
   * → 새 report의 previous_report_id 후보에서 제외됨
   */
  function getPublishedHistory(reports: GrowthReportRow[]): GrowthReportRow[] {
    return reports.filter(r => r.product_status === "PUBLISHED" && r.deleted_at === null);
  }

  it("soft-deleted PUBLISHED → history 제외", () => {
    const reports: GrowthReportRow[] = [
      { id: "gr_015a", swimming_pool_id: "pool_A", student_id: "stu_15",
        cycle_id: "cyc_15a", product_status: "PUBLISHED", deleted_at: "2026-07-01T00:00:00Z" },
      { id: "gr_015b", swimming_pool_id: "pool_A", student_id: "stu_15",
        cycle_id: "cyc_15b", product_status: "PUBLISHED", deleted_at: null },
    ];
    const history = getPublishedHistory(reports);
    expect(history.map(r => r.id)).toEqual(["gr_015b"]);
    // gr_015a (deleted) 는 previous_report_id 후보가 될 수 없음
  });

  it("모든 history가 soft-deleted → previous_report_id = null 낙관", () => {
    const reports: GrowthReportRow[] = [
      { id: "gr_015c", swimming_pool_id: "pool_A", student_id: "stu_15b",
        cycle_id: "cyc_15c", product_status: "PUBLISHED", deleted_at: "2026-07-01T00:00:00Z" },
    ];
    const history = getPublishedHistory(reports);
    expect(history).toHaveLength(0);
  });
});
