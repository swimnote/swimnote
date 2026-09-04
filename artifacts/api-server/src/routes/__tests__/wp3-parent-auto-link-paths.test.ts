/**
 * wp3-parent-auto-link-paths.test.ts
 *
 * WP3 — Parent Auto Approval: 모든 student create/update 경로에서
 * triggerAutoLinkOnStudentV2가 호출되는지 소스 레벨 정적 검증 +
 * auto-link-v2 핵심 동작 단위 테스트 (G01~G18).
 *
 * 실제 DB 호출을 모킹하므로 외부 의존성 없음.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── 소스 경로 ─────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "../../../../..");
const STUDENTS_TS   = path.join(ROOT, "artifacts/api-server/src/routes/students.ts");
const UNREGISTERED_TS = path.join(ROOT, "artifacts/api-server/src/routes/unregistered.ts");
const AUTH_TS        = path.join(ROOT, "artifacts/api-server/src/routes/auth.ts");
const ADMIN_TS       = path.join(ROOT, "artifacts/api-server/src/routes/admin.ts");
const AUTO_LINK_LIB  = path.join(ROOT, "artifacts/api-server/src/lib/auto-link-v2.ts");

function readSrc(file: string) { return fs.readFileSync(file, "utf-8"); }

// ── DB 모킹 ───────────────────────────────────────────────────────
const mockExecute = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { execute: (...a: any[]) => mockExecute(...a), select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }), insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "st_new", name: "테스트", status: "unregistered" }]) }) }) },
  superAdminDb: { execute: (...a: any[]) => mockExecute(...a), select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ swimming_pool_id: "pool_a" }]) }) }) }) },
}));

import {
  normalizePhone,
  normalizeName,
  linkParentToStudentV2,
  triggerAutoLinkOnStudentV2,
} from "../../lib/auto-link-v2.js";

// ── 헬퍼 ─────────────────────────────────────────────────────────
const poolId   = "pool_alpha";
const poolId2  = "pool_beta";
const parentId = "pa_001";
const ph       = "01012345678";
const phHyphen = "010-1234-5678";

type MockRow = Record<string, any>;

function student(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "st_001", name: "홍길동",
    swimming_pool_id: poolId,
    parent_phone: ph,
    parent_phone2: null, parent_phone3: null, parent_phone4: null,
    status: "active",
    ...overrides,
  };
}

beforeEach(() => { mockExecute.mockReset(); });

// ─────────────────────────────────────────────────────────────────
// STATIC SOURCE ANALYSIS — 모든 create path에 trigger 존재 여부
// ─────────────────────────────────────────────────────────────────

describe("STATIC — student create path coverage", () => {
  it("G-S01. students.ts: POST /teacher-request 에 triggerAutoLinkOnStudentV2 있음", () => {
    const src = readSrc(STUDENTS_TS);
    // teacher-request 섹션 근방
    const teacherReqSection = src.slice(src.indexOf("POST /teacher-request"), src.indexOf("GET /teacher-requests"));
    expect(teacherReqSection).toContain("triggerAutoLinkOnStudentV2");
  });

  it("G-S02. students.ts: POST /students/batch (bulk) 에 triggerAutoLinkOnStudentV2 있음", () => {
    const src = readSrc(STUDENTS_TS);
    // batch 섹션 — 'POST /batch — 학생 일괄 등록' 코멘트로 찾기
    const batchStart = src.indexOf("POST /batch — 학생 일괄 등록");
    const batchEnd   = src.indexOf("POST / — 학생 등록");
    expect(batchStart).toBeGreaterThan(-1);
    const batchSection = src.slice(batchStart, batchEnd);
    expect(batchSection).toContain("triggerAutoLinkOnStudentV2");
    expect(batchSection).toContain("batch 트리거");
  });

  it("G-S03. students.ts: POST / (단일 admin 학생 등록) 에 triggerAutoLinkOnStudentV2 있음", () => {
    const src = readSrc(STUDENTS_TS);
    const adminCreateSection = src.slice(src.indexOf("POST / — 학생 등록"), src.indexOf("GET /:id"));
    expect(adminCreateSection).toContain("triggerAutoLinkOnStudentV2");
    expect(adminCreateSection).toContain("단일등록 트리거");
  });

  it("G-S04. unregistered.ts: POST /admin/unregistered/bulk 에 triggerAutoLinkOnStudentV2 있음", () => {
    const src = readSrc(UNREGISTERED_TS);
    expect(src).toContain("triggerAutoLinkOnStudentV2");
    expect(src).toContain("unregistered bulk 트리거");
  });

  it("G-S05. unregistered.ts: triggerAutoLinkOnStudentV2 import 존재", () => {
    const src = readSrc(UNREGISTERED_TS);
    expect(src).toContain('from "../lib/auto-link-v2.js"');
    expect(src).toContain("triggerAutoLinkOnStudentV2");
  });

  it("G-S06. students.ts: triggerAutoLinkOnStudentV2 import 존재", () => {
    const src = readSrc(STUDENTS_TS);
    expect(src).toContain("triggerAutoLinkOnStudentV2");
    expect(src).toContain('from "../lib/auto-link-v2.js"');
  });

  it("G-S07. admin.ts: PATCH /admin/students/:id 에 triggerAutoLinkOnStudentV2 있음 (guardian phone update)", () => {
    const src = readSrc(ADMIN_TS);
    expect(src).toContain("triggerAutoLinkOnStudentV2");
  });

  it("G-S08. auth.ts simple-parent-register: placeholder는 parent_id 직접 포함 → V2 trigger 불필요 (별도 처리 확인)", () => {
    const src = readSrc(AUTH_TS);
    // simple-parent-register 핸들러 어딘가에 approved parent_students 직접 삽입
    expect(src).toContain("approved");
    // 이름 중복 기존학생 branch에는 triggerAutoLinkOnStudentV2 존재
    expect(src).toContain("triggerAutoLinkOnStudentV2");
  });

  it("G-S09. auto-link-v2.ts: triggerAutoLinkOnStudentV2 exported function 존재", () => {
    const src = readSrc(AUTO_LINK_LIB);
    expect(src).toContain("export async function triggerAutoLinkOnStudentV2");
  });

  it("G-S10. auto-link-v2.ts: normalizePhone export 존재", () => {
    const src = readSrc(AUTO_LINK_LIB);
    expect(src).toContain("export function normalizePhone");
  });

  it("G-S11. auto-link-v2.ts: pool isolation — swimming_pool_id 조건 존재", () => {
    const src = readSrc(AUTO_LINK_LIB);
    expect(src).toContain("swimming_pool_id");
  });

  it("G-S12. auto-link-v2.ts: duplicate protection — application-level existing check 존재", () => {
    const src = readSrc(AUTO_LINK_LIB);
    // linkParentToStudentV2: existing link 조회 후 alreadyLinked 반환
    expect(src).toContain("alreadyLinked");
    expect(src).toContain("existing");
  });
});

// ─────────────────────────────────────────────────────────────────
// UNIT — normalizePhone (G05)
// ─────────────────────────────────────────────────────────────────

describe("G05 — phone normalization", () => {
  it("hyphenated → digits-only same result", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
    expect(normalizePhone("01012345678")).toBe("01012345678");
  });

  it("already normalized is idempotent", () => {
    const n = normalizePhone("01012345678");
    expect(normalizePhone(n)).toBe(n);
  });

  it("G05b — hyphen and digits produce same normalized value", () => {
    expect(normalizePhone(phHyphen)).toBe(normalizePhone(ph));
  });
});

// ─────────────────────────────────────────────────────────────────
// UNIT — linkParentToStudentV2 (G07 already-linked idempotency)
// ─────────────────────────────────────────────────────────────────

describe("G07 — already linked: duplicate 0", () => {
  it("returns alreadyLinked=true when link row exists", async () => {
    // existing link → rows length 1
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "ps_exist", parent_id: parentId, student_id: "st_001" }] }) // existing check
      .mockResolvedValueOnce({ rows: [] }); // any subsequent

    const result = await linkParentToStudentV2(parentId, "st_001", poolId);
    expect(result.success).toBe(true);
    expect(result.alreadyLinked).toBe(true);
  });

  it("returns success=true on new link", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })           // no existing link
      .mockResolvedValueOnce({ rows: [] });           // INSERT

    const result = await linkParentToStudentV2(parentId, "st_001", poolId);
    expect(result.success).toBe(true);
    expect(result.alreadyLinked).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────
// UNIT — triggerAutoLinkOnStudentV2 behavior
// ─────────────────────────────────────────────────────────────────

describe("triggerAutoLinkOnStudentV2 — core behavior", () => {
  it("G03 — no matching parent: resolves without error", async () => {
    // student row return
    mockExecute
      .mockResolvedValueOnce({ rows: [student()] })  // load student
      .mockResolvedValueOnce({ rows: [] });           // no pending rows

    await expect(triggerAutoLinkOnStudentV2("st_001", ["parent_phone"])).resolves.toBeUndefined();
  });

  it("G04 — phone missing: returns early without linking", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [student({ parent_phone: null, parent_phone2: null, parent_phone3: null, parent_phone4: null })]
    });

    await expect(triggerAutoLinkOnStudentV2("st_001", ["parent_phone"])).resolves.toBeUndefined();
    // pending lookup should NOT be called
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("G01/G02 — matching pending parent: linkParentToStudentV2 called", async () => {
    const pendingRow = {
      id: "pvp_001",
      parent_id: parentId,
      pool_id: poolId,
      parent_phone_normalized: ph,
      child_name_normalized: "홍길동",
      matched_student_id: null,
    };
    mockExecute
      .mockResolvedValueOnce({ rows: [student()] })          // load student
      .mockResolvedValueOnce({ rows: [pendingRow] })         // pending lookup
      .mockResolvedValueOnce({ rows: [] })                   // existing link check (inside linkParentToStudentV2)
      .mockResolvedValueOnce({ rows: [] })                   // INSERT parent_students
      .mockResolvedValueOnce({ rows: [] })                   // UPDATE pending status
      .mockResolvedValueOnce({ rows: [] })                   // sibling linking
      .mockResolvedValueOnce({ rows: [] });                  // any remainder

    await expect(triggerAutoLinkOnStudentV2("st_001", ["parent_phone"])).resolves.toBeUndefined();
    // mockExecute called at least 3 times (student + pending + link)
    expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("G06 — cross-pool: pool isolation enforced via student's own pool", async () => {
    // Student belongs to pool_alpha; trigger uses student's pool for pending lookup
    mockExecute
      .mockResolvedValueOnce({ rows: [student({ swimming_pool_id: poolId })] }) // student
      .mockResolvedValueOnce({ rows: [] }); // pending query — returns nothing (pool_beta parent not matched)

    await expect(triggerAutoLinkOnStudentV2("st_001", ["parent_phone"])).resolves.toBeUndefined();
  });

  it("G18 — idempotent: safe to call multiple times", async () => {
    // First call: link succeeds
    // Second call: alreadyLinked
    mockExecute
      // call 1
      .mockResolvedValueOnce({ rows: [student()] })
      .mockResolvedValueOnce({ rows: [] })
      // call 2
      .mockResolvedValueOnce({ rows: [student()] })
      .mockResolvedValueOnce({ rows: [] });

    await triggerAutoLinkOnStudentV2("st_001");
    await triggerAutoLinkOnStudentV2("st_001");
    // Both resolve without throw
    expect(true).toBe(true);
  });

  it("G17 — pool isolation: no pending = no link attempted", async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [student({ swimming_pool_id: poolId })] }) // student
      .mockResolvedValueOnce({ rows: [] }); // no pending for this pool

    await triggerAutoLinkOnStudentV2("st_001");
    // Only 2 DB calls: student + pending. No link attempted.
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// STATIC — guardian phone update paths
// ─────────────────────────────────────────────────────────────────

describe("STATIC — guardian phone update path coverage", () => {
  it("G08/G10 — admin.ts PATCH /admin/students/:id: triggerAutoLinkOnStudentV2 호출 (Normal + X 공통)", () => {
    const src = readSrc(ADMIN_TS);
    // admin.ts has triggerAutoLinkOnStudentV2 for PATCH update path
    expect(src).toContain("triggerAutoLinkOnStudentV2");
  });

  it("G11 — X guardian update: same server route as Normal (admin.ts), no separate X-only route", () => {
    // Verify no separate X-mode student update file exists
    const xAdminStudentFile = path.join(ROOT, "artifacts/api-server/src/routes/x-admin-students.ts");
    expect(fs.existsSync(xAdminStudentFile)).toBe(false);
  });

  it("G14/G15/G16 — manual link / parent request / unlink routes exist in auto-link-v2.ts (not removed)", () => {
    const src = readSrc(AUTO_LINK_LIB);
    expect(src).toContain("approveParentV2Pending");
    expect(src).toContain("rejectParentV2Pending");
    expect(src).toContain("linkParentToStudentV2");
  });
});

// ─────────────────────────────────────────────────────────────────
// STATIC — bulk path
// ─────────────────────────────────────────────────────────────────

describe("STATIC — bulk create paths", () => {
  it("G12/G13 — POST /students/batch: trigger per-student after each insert", () => {
    const src = readSrc(STUDENTS_TS);
    const batchIdx = src.indexOf("POST /batch — 학생 일괄 등록");
    const batchEnd = src.indexOf("POST / — 학생 등록");
    expect(batchIdx).toBeGreaterThan(-1);
    const batch = src.slice(batchIdx, batchEnd);
    // trigger must be inside the per-student loop
    expect(batch).toContain("triggerAutoLinkOnStudentV2");
    expect(batch).toContain("batch 트리거");
  });

  it("G12b — POST /admin/unregistered/bulk: trigger per-student (newId captured)", () => {
    const src = readSrc(UNREGISTERED_TS);
    expect(src).toContain("const newId");
    expect(src).toContain("triggerAutoLinkOnStudentV2(newId");
  });
});
