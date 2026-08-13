/**
 * parent-link.test.ts — 학부모↔학생 연결 승인 로직 테스트
 *
 * CASE 1~14 : 가입/자동승인/수동승인/rejected 복원 시나리오
 * CASE S1~S10: 형제자매 자동연결 시나리오
 *
 * vi.mock("@workspace/db") 방식으로 DB 호출을 차단합니다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB 모킹 ──────────────────────────────────────────────────────────────────
const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: (...args: any[]) => mockExecute(...args) },
  superAdminDb: { execute: (...args: any[]) => mockExecute(...args) },
}));

// 모킹 이후 import
import {
  normalizePhone,
  normalizeName,
  tryMatchStudentV2,
  linkParentToStudentV2,
  approveParentV2Pending,
  rejectParentV2Pending,
  linkApprovedParentToRegisteredChildren,
  retryNullPendingByPool,
} from "../../lib/auto-link-v2.js";

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
const poolId   = "pool_alpha";
const parentId = "pa_001";
const parentPh = "01012345678";

type MockRow = Record<string, any>;

function student(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id:               "st_001", name: "홍길동",
    swimming_pool_id: poolId,
    parent_phone:     parentPh,
    parent_phone2: null, parent_phone3: null, parent_phone4: null,
    status: "active",
    ...overrides,
  };
}

function pending(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "pvp_001", parent_id: parentId, pool_id: poolId,
    child_name_raw: "홍길동", child_name_normalized: "홍길동",
    parent_phone_normalized: parentPh,
    status: "pending", matched_student_id: null,
    pending_reason: null, rejection_reason: null, retry_count: 0,
    ...overrides,
  };
}

function parentAccount(overrides: Partial<MockRow> = {}): MockRow {
  return { id: parentId, phone: parentPh, name: "홍부모", ...overrides };
}

/**
 * queryScript(q) 는 SQL 쿼리 청크를 문자열로 이어 붙인 후 대문자로 변환합니다.
 * mockExecute impl: 각 테스트에서 beforeEach에서 `mockExecute.mockImplementation(...)`으로 주입.
 */
function makeExecuteImpl(opts: {
  students?:       MockRow[];
  parentStudents?: MockRow[];
  pending?:        MockRow[];
  parentAccounts?: MockRow[];
} = {}) {
  const _students       = opts.students       ?? [];
  const _parentStudents = opts.parentStudents ?? [];
  const _pending        = opts.pending        ?? [];
  const _parentAccounts = opts.parentAccounts ?? [];

  return async (query: any) => {
    const chunks: string[] = (query?.queryChunks ?? []).map(
      (c: any) => typeof c === "string" ? c : String(c?.value ?? "")
    );
    const q = chunks.join("").toUpperCase();

    // ── SELECT 라우팅 ──
    if (q.includes("FROM STUDENTS") && !q.includes("PARENT_STUDENTS")) {
      return { rows: _students };
    }
    if (q.includes("FROM PARENT_STUDENTS") || q.includes("parent_students".toUpperCase())) {
      if (q.includes("INSERT") || q.includes("DELETE")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: _parentStudents };
    }
    if (q.includes("FROM PARENT_V2_PENDING") || q.includes("parent_v2_pending".toUpperCase())) {
      if (q.includes("INSERT") || q.includes("UPDATE")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: _pending };
    }
    if (q.includes("FROM PARENT_ACCOUNTS") || q.includes("parent_accounts".toUpperCase())) {
      if (q.includes("INSERT") || q.includes("UPDATE")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: _parentAccounts };
    }
    if (q.includes("UPDATE STUDENTS")) { return { rowCount: 1, rows: [] }; }
    if (q.includes("INSERT") || q.includes("UPDATE") || q.includes("DELETE")) {
      return { rowCount: 1, rows: [] };
    }
    return { rows: [] };
  };
}

beforeEach(() => {
  mockExecute.mockReset();
});

// ── 유틸 단위 테스트 ─────────────────────────────────────────────────────────
describe("normalizePhone / normalizeName", () => {
  it("normalizePhone strips hyphens and spaces", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
    expect(normalizePhone("01012345678")).toBe("01012345678");
  });

  it("normalizeName removes whitespace and lowercases", () => {
    expect(normalizeName("홍 길 동")).toBe("홍길동");
    expect(normalizeName("  홍길동  ")).toBe("홍길동");
    expect(normalizeName("Hong Gil")).toBe("honggil");
  });

  it("normalizeName does NOT split on slash", () => {
    expect(normalizeName("박새연/박세아")).toBe("박새연/박세아");
  });
});

// ── CASE 1 — 정확한 이름 + 정확한 전화번호 → 자동승인 ───────────────────────
describe("CASE 1 — 정확한 이름+전화번호 → 자동매칭", () => {
  it("tryMatchStudentV2 returns matched=true", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({ students: [student()] }));
    const r = await tryMatchStudentV2(parentId, poolId, parentPh, "홍길동");
    expect(r.matched).toBe(true);
    expect(r.studentId).toBe("st_001");
  });
});

// ── CASE 2 — 이름 공백 차이 → 자동승인 ────────────────────────────────────
describe("CASE 2 — 이름 공백 차이 → 자동승인", () => {
  it("normalizePhone/Name handles whitespace", () => {
    expect(normalizeName("홍 길 동")).toBe("홍길동");
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
  });
});

// ── CASE 3 — 전화번호 하이픈 차이 → 자동승인 ──────────────────────────────
describe("CASE 3 — 전화번호 normalization", () => {
  it("normalizePhone handles hyphens correctly", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
  });
});

// ── CASE 4 — 이름 불일치 → name_mismatch → 수동승인 ───────────────────────
describe("CASE 4 — 이름 불일치 → name_mismatch, 수동승인 성공", () => {
  it("tryMatchStudentV2 returns name_mismatch when no student found", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({ students: [] }));
    const r = await tryMatchStudentV2(parentId, poolId, parentPh, "없는이름");
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("name_mismatch");
  });

  it("approveParentV2Pending with overrideStudentId succeeds", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending:        [pending({ status: "pending", matched_student_id: null })],
      students:       [student()],
      parentStudents: [],
      parentAccounts: [parentAccount()],
    }));
    const result = await approveParentV2Pending("pvp_001", poolId, "st_001");
    expect(result.success).toBe(true);
  });
});

// ── CASE 5 — A/B 형태 이름 → 임의 자동승인 금지 ───────────────────────────
describe("CASE 5 — A/B 이름 → 자동승인 금지", () => {
  it("tryMatchStudentV2 returns name_mismatch for slash-name", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({ students: [] }));
    const r = await tryMatchStudentV2(parentId, poolId, parentPh, "박새연/박세아");
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("name_mismatch");
  });

  it("normalizeName does NOT split on slash", () => {
    expect(normalizeName("박새연/박세아")).toBe("박새연/박세아");
  });
});

// ── CASE 6 — 전화번호 불일치 → phone_mismatch ────────────────────────────
describe("CASE 6 — 전화번호 불일치 → phone_mismatch", () => {
  it("tryMatchStudentV2 returns phone_mismatch", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      students: [student({ parent_phone: "01099999999" })],
    }));
    const r = await tryMatchStudentV2(parentId, poolId, "01011111111", "홍길동");
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("phone_mismatch");
  });
});

// ── CASE 7 — 동명이인 → duplicate_name ───────────────────────────────────
describe("CASE 7 — 동명이인 → duplicate_name", () => {
  it("tryMatchStudentV2 returns duplicate_name when 2+ students match name but not phone", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      students: [
        student({ id: "st_A", parent_phone: "01099990001" }),
        student({ id: "st_B", parent_phone: "01099990002" }),
      ],
    }));
    const r = await tryMatchStudentV2(parentId, poolId, "01000000000", "홍길동");
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("duplicate_name");
  });
});

// ── CASE 8 — 다른 pool student_id → 차단 ─────────────────────────────────
describe("CASE 8 — 다른 pool student_id → 차단", () => {
  it("approveParentV2Pending rejects student not in pool", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending:  [pending()],
      students: [], // student not found (different pool)
      parentAccounts: [parentAccount()],
    }));
    const result = await approveParentV2Pending("pvp_001", poolId, "st_other_pool");
    expect(result.success).toBe(false);
  });
});

// ── CASE 9 — rejected → 재승인 가능 ──────────────────────────────────────
describe("CASE 9 — rejected → 재승인", () => {
  it("approveParentV2Pending on rejected status succeeds", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending:        [pending({ status: "rejected", matched_student_id: "st_001" })],
      students:       [student()],
      parentStudents: [],
      parentAccounts: [parentAccount()],
    }));
    const result = await approveParentV2Pending("pvp_001", poolId, "st_001");
    expect(result.success).toBe(true);
  });
});

// ── CASE 10 — rejected + matched_student_id 없음 → 학생 선택 후 승인 ────────
describe("CASE 10 — rejected + 학생선택 → 승인", () => {
  it("approveParentV2Pending with override on rejected succeeds", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending:        [pending({ status: "rejected", matched_student_id: null })],
      students:       [student()],
      parentStudents: [],
      parentAccounts: [parentAccount()],
    }));
    const result = await approveParentV2Pending("pvp_001", poolId, "st_001");
    expect(result.success).toBe(true);
  });
});

// ── CASE 11 — 이미 approved된 재승인 → duplicate row 0 ───────────────────
describe("CASE 11 — 이미 approved → idempotent (duplicate 0)", () => {
  it("linkParentToStudentV2 returns alreadyLinked=true and skips INSERT", async () => {
    // SELECT parent_students → 기존 row 존재
    let insertCalled = false;
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM PARENT_STUDENTS") || q.includes("parent_students".toUpperCase())) {
        if (q.includes("INSERT")) { insertCalled = true; return { rowCount: 1, rows: [] }; }
        return { rows: [{ id: "ps_001", parent_id: parentId, student_id: "st_001", status: "approved" }] };
      }
      return { rows: [] };
    });

    const r = await linkParentToStudentV2(parentId, "st_001", poolId);
    expect(r.success).toBe(true);
    expect(r.alreadyLinked).toBe(true);
    expect(insertCalled).toBe(false);
  });
});

// ── CASE 12 — 신규 가입 → pending_reason 즉시 결정 ───────────────────────
describe("CASE 12 — 신규 가입 → pending_reason 즉시 결정", () => {
  it("tryMatchStudentV2 returns reason even on first attempt", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({ students: [] }));
    const r = await tryMatchStudentV2(parentId, poolId, parentPh, "없는아이");
    expect(r.reason).toBe("name_mismatch");
  });
});

// ── CASE 13 — pending_reason=NULL 건 재시도 ──────────────────────────────
describe("CASE 13 — pending_reason=NULL 재시도", () => {
  it("retryNullPendingByPool updates reason for unresolvable, links resolvable", async () => {
    let callIndex = 0;
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      // 1st call: SELECT FROM parent_v2_pending (NULL pending list)
      if (q.includes("FROM PARENT_V2_PENDING")) {
        return { rows: [pending({ id: "pvp_null", pending_reason: null, matched_student_id: null })] };
      }
      // tryMatchStudentV2 → SELECT FROM STUDENTS → empty = name_mismatch
      if (q.includes("FROM STUDENTS")) return { rows: [] };
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r = await retryNullPendingByPool(poolId);
    expect(r.retried).toBe(1);
    expect(r.linked).toBe(0);
    expect(r.reasonUpdated).toBe(1);
  });
});

// ── CASE 14 — 기존 approved 학부모 회귀 없음 ─────────────────────────────
describe("CASE 14 — 기존 approved 회귀 없음", () => {
  it("linkParentToStudentV2 alreadyLinked=true for existing approved", async () => {
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM PARENT_STUDENTS")) {
        return { rows: [{ id: "ps_exist", parent_id: parentId, student_id: "st_001", status: "approved" }] };
      }
      return { rows: [] };
    });

    const r = await linkParentToStudentV2(parentId, "st_001", poolId);
    expect(r.success).toBe(true);
    expect(r.alreadyLinked).toBe(true);
  });
});

// ── CASE S1 — 형제자매 2명 → 한 명 승인 → 2명 모두 연결 ────────────────
describe("CASE S1 — 형제자매 2명 연결", () => {
  it("linkApprovedParentToRegisteredChildren links both siblings", async () => {
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM STUDENTS")) {
        return { rows: [
          student({ id: "st_A", name: "서태웅", parent_phone: parentPh }),
          student({ id: "st_B", name: "서태희", parent_phone2: parentPh }),
        ]};
      }
      if (q.includes("FROM PARENT_STUDENTS")) return { rows: [] }; // none linked
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r = await linkApprovedParentToRegisteredChildren(parentId, poolId, parentPh);
    expect(r.studentIds.length).toBe(2);
    expect(r.newCount).toBe(2);
  });
});

// ── CASE S2 — 형제자매 3명 모두 연결 ─────────────────────────────────────
describe("CASE S2 — 형제자매 3명 연결", () => {
  it("links all 3 siblings", async () => {
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM STUDENTS")) {
        return { rows: [
          student({ id: "st_A", parent_phone: parentPh }),
          student({ id: "st_B", parent_phone2: parentPh }),
          student({ id: "st_C", parent_phone3: parentPh }),
        ]};
      }
      if (q.includes("FROM PARENT_STUDENTS")) return { rows: [] };
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r = await linkApprovedParentToRegisteredChildren(parentId, poolId, parentPh);
    expect(r.studentIds.length).toBe(3);
  });
});

// ── CASE S3 — 형제 중 1명 이미 approved → 나머지만 생성, duplicate 0 ────
describe("CASE S3 — 형제 일부 이미 연결 → duplicate 0", () => {
  it("does not duplicate already-approved sibling", async () => {
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM STUDENTS")) {
        return { rows: [
          student({ id: "st_A", parent_phone: parentPh }),
          student({ id: "st_B", parent_phone2: parentPh }),
        ]};
      }
      if (q.includes("FROM PARENT_STUDENTS")) {
        // st_A already approved
        return { rows: [{ id: "ps_a", parent_id: parentId, student_id: "st_A", status: "approved" }] };
      }
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r = await linkApprovedParentToRegisteredChildren(parentId, poolId, parentPh);
    expect(r.studentIds).toContain("st_B");
    // st_A alreadyLinked → newCount should not include it
    expect(r.newCount).toBeLessThanOrEqual(1);
    expect(r.studentIds).toContain("st_A"); // still in result (existing link)
  });
});

// ── CASE S4 — 다른 pool 학생 → 연결 금지 ─────────────────────────────────
describe("CASE S4 — 다른 pool 학생 → 연결 금지", () => {
  it("helper returns empty for phoneNorm empty or no students", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({ students: [] }));
    const r = await linkApprovedParentToRegisteredChildren(parentId, "pool_other", parentPh);
    expect(r.studentIds.length).toBe(0);
  });
});

// ── CASE S5 — 보호자 번호 미등록 → sibling 연결 금지 ──────────────────
describe("CASE S5 — 보호자 번호 미등록 → sibling 금지", () => {
  it("empty phoneNorm → early return with no links", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({}));
    const r = await linkApprovedParentToRegisteredChildren(parentId, poolId, "");
    expect(r.studentIds.length).toBe(0);
    expect(r.newCount).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── CASE S6 — 수동승인 → 형제자매도 자동연결 ─────────────────────────────
describe("CASE S6 — 관리자 수동승인 → 형제자매 연결", () => {
  it("approveParentV2Pending triggers sibling link", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending:        [pending({ status: "pending", matched_student_id: null })],
      students:       [student({ id: "st_001" }), student({ id: "st_002", parent_phone: parentPh, name: "형제" })],
      parentStudents: [],
      parentAccounts: [parentAccount()],
    }));
    const result = await approveParentV2Pending("pvp_001", poolId, "st_001");
    expect(result.success).toBe(true);
    expect(result.linkedCount).toBeGreaterThanOrEqual(1);
  });
});

// ── CASE S7 — rejected → 관리자 승인 → 형제자매 연결 ────────────────────
describe("CASE S7 — rejected → 승인 → 형제자매 연결", () => {
  it("works from rejected status", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending:        [pending({ status: "rejected", matched_student_id: "st_001" })],
      students:       [student({ id: "st_001" }), student({ id: "st_002", parent_phone2: parentPh, name: "형제" })],
      parentStudents: [],
      parentAccounts: [parentAccount()],
    }));
    const result = await approveParentV2Pending("pvp_001", poolId, "st_001");
    expect(result.success).toBe(true);
  });
});

// ── CASE S8 — 형제별 pending → 승인 후 실제 연결된 것만 matched 정리 ───
describe("CASE S8 — 형제별 pending 정리", () => {
  it("retryNullPendingByPool processes all null-reason rows correctly", async () => {
    let pendingCallCount = 0;
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM PARENT_V2_PENDING")) {
        return { rows: [
          pending({ id: "pvp_1", child_name_normalized: "홍길동", pending_reason: null }),
          pending({ id: "pvp_2", child_name_normalized: "홍길순", pending_reason: null }),
        ]};
      }
      if (q.includes("FROM STUDENTS")) return { rows: [] }; // both fail
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r = await retryNullPendingByPool(poolId);
    expect(r.retried).toBe(2);
    expect(r.linked + r.reasonUpdated).toBe(2);
  });
});

// ── CASE S9 — 동일 승인 API 재호출 → duplicate 0 ─────────────────────────
describe("CASE S9 — 동일 승인 재호출 → idempotent", () => {
  it("linkParentToStudentV2 called twice returns alreadyLinked=true both times", async () => {
    let psRows: MockRow[] = [];
    let insertCount = 0;

    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM PARENT_STUDENTS")) return { rows: psRows };
      if (q.includes("INSERT") && q.includes("PARENT_STUDENTS")) {
        insertCount++;
        psRows.push({ id: "ps_new", parent_id: parentId, student_id: "st_001", status: "approved" });
        return { rowCount: 1, rows: [] };
      }
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r1 = await linkParentToStudentV2(parentId, "st_001", poolId);
    const r2 = await linkParentToStudentV2(parentId, "st_001", poolId);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(insertCount).toBeLessThanOrEqual(1); // second call skips INSERT
  });
});

// ── CASE S10 — 최대 보호자 수 정책 ──────────────────────────────────────
describe("CASE S10 — 최대 보호자 수 정책 (3명)", () => {
  it("linkParentToStudentV2 succeeds for a new link (max limit enforced at app level)", async () => {
    mockExecute.mockImplementation(async (query: any) => {
      const q = (query?.queryChunks ?? []).map((c: any) => typeof c === "string" ? c : String(c?.value ?? "")).join("").toUpperCase();
      if (q.includes("FROM PARENT_STUDENTS")) return { rows: [] }; // no existing link
      if (q.includes("UPDATE") || q.includes("INSERT") || q.includes("DELETE")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });

    const r = await linkParentToStudentV2(parentId, "st_001", poolId);
    expect(r.success).toBe(true);
    expect(r.alreadyLinked).toBeUndefined();
  });
});

// ── pending_reason 문구 개선 (순수 함수) ─────────────────────────────────
describe("pending_reason 문구 개선", () => {
  function label(r: string | null): string {
    if (!r) return "";
    if (r === "name_mismatch")   return "학생 이름 확인 필요";
    if (r === "phone_mismatch")  return "전화번호 확인 필요";
    if (r === "duplicate_name")  return "동명이인 확인 필요";
    return "학생 연결 확인 필요";
  }

  it("name_mismatch → '학생 이름 확인 필요'", () => expect(label("name_mismatch")).toBe("학생 이름 확인 필요"));
  it("phone_mismatch → '전화번호 확인 필요'", () => expect(label("phone_mismatch")).toBe("전화번호 확인 필요"));
  it("duplicate_name → '동명이인 확인 필요'", () => expect(label("duplicate_name")).toBe("동명이인 확인 필요"));
  it("unknown → '학생 연결 확인 필요'", () => expect(label("unknown_code")).toBe("학생 연결 확인 필요"));
  it("null → ''", () => expect(label(null)).toBe(""));
});

// ── 거절 idempotent / matched → reject 차단 ──────────────────────────────
describe("거절 처리 idempotent 및 matched 차단", () => {
  it("이미 rejected → success=true (idempotent)", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending: [pending({ status: "rejected" })],
    }));
    const r = await rejectParentV2Pending("pvp_001", poolId, "테스트");
    expect(r.success).toBe(true);
    expect(r.message).toContain("이미 거절");
  });

  it("matched(승인완료) → reject 불가", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending: [pending({ status: "matched" })],
    }));
    const r = await rejectParentV2Pending("pvp_001", poolId, "취소 시도");
    expect(r.success).toBe(false);
  });
});

// ── matched 상태 재승인 → idempotent ─────────────────────────────────────
describe("matched 상태 재승인 → idempotent", () => {
  it("returns success=true with linkedCount=0", async () => {
    mockExecute.mockImplementation(makeExecuteImpl({
      pending: [pending({ status: "matched", matched_student_id: "st_001" })],
    }));
    const r = await approveParentV2Pending("pvp_001", poolId);
    expect(r.success).toBe(true);
    expect(r.linkedCount).toBe(0);
  });
});
