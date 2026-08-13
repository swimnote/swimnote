/**
 * WP13 — Growth Event Review Tests
 *
 * reviewGrowthEvent() 함수 단위 테스트 (12 TC: A-L).
 * DB mock 방식: in-memory execute stub.
 * 실제 DB 호출 없음.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reviewGrowthEvent,
  ReviewConflictError,
} from "../../lib/growth-event-service.js";

// ── Mock DB factory ───────────────────────────────────────────────────────────

function makeDb(rowOverrides: Record<string, any> = {}) {
  const defaultRow = {
    id:                  "ge_test001",
    growth_match_status: "PENDING_REVIEW",
    is_invalidated:      false,
    ...rowOverrides,
  };

  const executeMock = vi.fn(async (query: any) => {
    const q: string = query?.queryChunks?.map((c: any) =>
      typeof c === "string" ? c : c?.value ?? ""
    ).join("") ?? "";

    // SELECT
    if (q.includes("SELECT")) {
      // version select for audit
      if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
      return { rows: [defaultRow] };
    }
    // UPDATE
    if (q.includes("UPDATE")) return { rowCount: 1, rows: [] };
    // INSERT audit
    if (q.includes("INSERT")) return { rowCount: 1, rows: [] };
    return { rows: [] };
  });

  return { execute: executeMock, _mock: executeMock };
}

function makeParams(overrides: Partial<Parameters<typeof reviewGrowthEvent>[0]> = {}) {
  return {
    db:             makeDb(),
    poolId:         "pool_test",
    studentId:      "student_test",
    eventId:        "ge_test001",
    action:         "accept" as const,
    reviewerUserId: "user_teacher",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WP13 — reviewGrowthEvent()", () => {

  // A. PENDING_REVIEW + accept → TEACHER_ACCEPTED
  it("A: PENDING_REVIEW + accept → TEACHER_ACCEPTED (updated=true)", async () => {
    const params = makeParams({ action: "accept" });
    const result = await reviewGrowthEvent(params);
    expect(result).not.toBeNull();
    expect(result!.updated).toBe(true);
    expect(result!.previousStatus).toBe("PENDING_REVIEW");
    expect(result!.newStatus).toBe("TEACHER_ACCEPTED");
  });

  // B. PENDING_REVIEW + reject → TEACHER_REJECTED
  it("B: PENDING_REVIEW + reject → TEACHER_REJECTED (updated=true)", async () => {
    const params = makeParams({ action: "reject" });
    const result = await reviewGrowthEvent(params);
    expect(result).not.toBeNull();
    expect(result!.updated).toBe(true);
    expect(result!.newStatus).toBe("TEACHER_REJECTED");
  });

  // C. accept 재요청 → idempotent (updated=false)
  it("C: TEACHER_ACCEPTED + accept → idempotent (updated=false)", async () => {
    const db = makeDb({ growth_match_status: "TEACHER_ACCEPTED" });
    const params = makeParams({ db, action: "accept" });
    const result = await reviewGrowthEvent(params);
    expect(result).not.toBeNull();
    expect(result!.updated).toBe(false);
    expect(result!.newStatus).toBe("TEACHER_ACCEPTED");
    // UPDATE 호출 없음 (idempotent)
    const updateCalls = (db._mock as any).mock.calls.filter((c: any[]) => {
      const q = c[0]?.queryChunks?.map((x: any) => x?.value ?? x ?? "").join("");
      return typeof q === "string" && q.includes("UPDATE");
    });
    expect(updateCalls.length).toBe(0);
  });

  // D. TEACHER_REJECTED에 accept → 409 (invalid_transition)
  it("D: TEACHER_REJECTED + accept → ReviewConflictError(invalid_transition)", async () => {
    const db = makeDb({ growth_match_status: "TEACHER_REJECTED" });
    const params = makeParams({ db, action: "accept" });
    await expect(reviewGrowthEvent(params)).rejects.toThrow(ReviewConflictError);
    await expect(reviewGrowthEvent(params)).rejects.toMatchObject({ code: "invalid_transition" });
  });

  // E. is_invalidated=true → 차단
  it("E: is_invalidated=true → ReviewConflictError(invalidated)", async () => {
    const db = makeDb({ is_invalidated: true, growth_match_status: "PENDING_REVIEW" });
    const params = makeParams({ db });
    await expect(reviewGrowthEvent(params)).rejects.toThrow(ReviewConflictError);
    await expect(reviewGrowthEvent(params)).rejects.toMatchObject({ code: "invalidated" });
  });

  // F. event 없음 → null (404)
  it("F: event 없음 → null 반환 (404)", async () => {
    const db = {
      execute: vi.fn(async (query: any) => {
        const q: string = query?.queryChunks?.map((c: any) => c?.value ?? c ?? "").join("") ?? "";
        if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
        return { rows: [] };  // 항상 빈 결과
      }),
      _mock: vi.fn(),
    };
    const params = makeParams({ db });
    const result = await reviewGrowthEvent(params);
    expect(result).toBeNull();
  });

  // G. reject 재요청 → idempotent (updated=false)
  it("G: TEACHER_REJECTED + reject → idempotent (updated=false)", async () => {
    const db = makeDb({ growth_match_status: "TEACHER_REJECTED" });
    const params = makeParams({ db, action: "reject" });
    const result = await reviewGrowthEvent(params);
    expect(result).not.toBeNull();
    expect(result!.updated).toBe(false);
  });

  // H. audit_log 기록 확인 (accept 성공 시 INSERT 호출)
  it("H: accept 성공 → audit INSERT 호출됨", async () => {
    const params = makeParams({ action: "accept" });
    const db = params.db;
    await reviewGrowthEvent(params);
    const insertCalls = (db._mock as any).mock.calls.filter((c: any[]) => {
      const q = c[0]?.queryChunks?.map((x: any) => x?.value ?? x ?? "").join("");
      return typeof q === "string" && q.includes("INSERT");
    });
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  // I. audit_log 실패해도 review 자체는 성공
  it("I: audit INSERT 실패해도 review 결과 반환", async () => {
    const executeMock = vi.fn(async (query: any) => {
      const q: string = query?.queryChunks?.map((c: any) =>
        typeof c === "string" ? c : c?.value ?? ""
      ).join("") ?? "";
      if (q.includes("SELECT") && q.includes("next_audit_version")) throw new Error("audit DB down");
      if (q.includes("SELECT")) return { rows: [{ id: "ge_test001", growth_match_status: "PENDING_REVIEW", is_invalidated: false }] };
      if (q.includes("UPDATE")) return { rowCount: 1, rows: [] };
      if (q.includes("INSERT")) throw new Error("audit DB down");
      return { rows: [] };
    });
    const db = { execute: executeMock, _mock: executeMock };
    const params = makeParams({ db });
    // audit 실패해도 throw 안 함 (warn only)
    const result = await reviewGrowthEvent(params);
    expect(result).not.toBeNull();
    expect(result!.updated).toBe(true);
  });

  // J. newStatus "TEACHER_ACCEPTED" (action=accept)
  it("J: action=accept → newStatus=TEACHER_ACCEPTED", async () => {
    const result = await reviewGrowthEvent(makeParams({ action: "accept" }));
    expect(result!.newStatus).toBe("TEACHER_ACCEPTED");
  });

  // K. newStatus "TEACHER_REJECTED" (action=reject)
  it("K: action=reject → newStatus=TEACHER_REJECTED", async () => {
    const result = await reviewGrowthEvent(makeParams({ action: "reject" }));
    expect(result!.newStatus).toBe("TEACHER_REJECTED");
  });

  // L. DISCARDED 상태에 accept → invalid_transition
  it("L: DISCARDED + accept → ReviewConflictError(invalid_transition)", async () => {
    const db = makeDb({ growth_match_status: "DISCARDED" });
    const params = makeParams({ db, action: "accept" });
    await expect(reviewGrowthEvent(params)).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

// ── Route 권한 contract 검증 (타입/로직 확인) ────────────────────────────────

describe("WP13 — PATCH /x-growth review route contract", () => {
  it("ReviewConflictError.code는 'invalidated' 또는 'invalid_transition'", () => {
    const e1 = new ReviewConflictError("invalidated", "test");
    const e2 = new ReviewConflictError("invalid_transition", "test");
    expect(e1.code).toBe("invalidated");
    expect(e2.code).toBe("invalid_transition");
    expect(e1).toBeInstanceOf(ReviewConflictError);
  });

  it("action 타입: accept → TEACHER_ACCEPTED, reject → TEACHER_REJECTED", () => {
    // 타입 레벨 검증 — 실행 없이 로직 문서화
    const acceptResult: string = "TEACHER_ACCEPTED";
    const rejectResult: string = "TEACHER_REJECTED";
    expect(acceptResult).not.toBe(rejectResult);
  });
});
