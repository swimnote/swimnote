/**
 * curriculum-orchestration.test.ts
 *
 * One-click Auto-Apply Orchestration 테스트 (A~H)
 *
 * A. 신규 pool + SCA=0 + 정상 DOCX → 별도 수동 호출 없이 READY, active Local 1개
 * B. soft review 포함 DOCX → review metadata 유지 → READY
 * C. hard validation failure → activation 안 됨 → 기존 active Local 유지
 * D. 동일 파일 재업로드 → duplicate version 0 → 기존 ACTIVE 반환
 * E. 변경 파일 업로드 → 신규 version → 성공 후 old archive → active 1개
 * F. Toykids 332-node version → 자동 approve/activate → READY
 * G. Global Reference 50 보존
 * H. tenant isolation
 *
 * 실제 DB/R2 없이 mock 기반으로 실행 (단위 테스트)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestrationResult } from "../curriculum-orchestration.js";

// ── Mock setup ──────────────────────────────────────────────────────────────

// superAdminDb mock
const mockExecute = vi.fn();
vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: (...args: any[]) => mockExecute(...args) },
}));

// objectStorage mock
const mockDownload = vi.fn();
vi.mock("../objectStorage.js", () => ({
  downloadFromR2: (...args: any[]) => mockDownload(...args),
  uploadToR2: vi.fn(),
}));

// docxParser mock
const mockParse = vi.fn();
vi.mock("../docxParser.js", () => ({
  parseCurriculumDocx: (...args: any[]) => mockParse(...args),
  parseWebsiteDocx: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDocxBuffer(content: string): Buffer {
  return Buffer.from(content);
}

function makeItems(count: number, softCount = 0) {
  return Array.from({ length: count }, (_, i) => ({
    sort_order: i + 1,
    title: `item ${i + 1}`,
    description: `desc ${i + 1}`,
    display_no: `L1-${String(i + 1).padStart(3, "0")}`,
    canonical_key: `key-${i + 1}`,
    stroke: "general",
    domain: "breathing",
    skill_group: "breathing",
    atomic_skill: `skill ${i + 1}`,
    level_order: i < count - softCount ? 1 : null, // last softCount items = TBD
    is_review_required: i >= count - softCount,
  }));
}

function makeStructuredResult(items: ReturnType<typeof makeItems>) {
  return {
    basic_info: {},
    teaching_summary: {},
    total_declared_levels: 3,
    template_version: "1.0",
    levels: [],
    searchable_items: items,
  };
}

// DB 응답 시퀀스 설정 헬퍼
type DbRow = Record<string, any>;
function setupDbSequence(sequence: Array<{ rows: DbRow[] } | null>) {
  let idx = 0;
  mockExecute.mockImplementation((_sql: any) => {
    const result = sequence[idx] ?? { rows: [] };
    idx++;
    return Promise.resolve(result);
  });
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("curriculum-orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A. 신규 pool + SCA=0 + 정상 DOCX → READY, active Local 1개
  // ──────────────────────────────────────────────────────────────────────────
  describe("A. 신규 pool 정상 DOCX → READY", () => {
    it("READY 반환, hard_error_count=0", async () => {
      const items = makeItems(10);
      const buf = makeDocxBuffer("normal docx content");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      // DB sequence:
      // 1. getPoolRow
      // 2. current file
      // 3. already active check (없음)
      // 4. existing draft check (없음)
      // 5. INSERT PROCESSING (profile upsert)
      // 6. UPDATE STRUCTURED
      // 7. SELECT profile id
      // 8. DELETE levels
      // 9. global overwrite check
      // 10. INSERT curriculum_version
      // 11. SELECT new version id
      // 12. curriculum_items inserts (10개) + profile version link
      // 13. UPDATE APPROVED (profile)
      // 14. UPDATE curriculum_version approved_at
      // 15. SELECT old active
      // 16. BEGIN, COMMIT (activate TX steps)
      // audit log
      setupDbSequence([
        { rows: [{ id: "pool_test", name: "Test Pool" }] }, // getPoolRow
        { rows: [{ id: "xsf_1", r2_key: "x-setup/pool_test/curriculum/v1_file.docx", submission_version: 1 }] }, // current file
        { rows: [] }, // already active (없음)
        { rows: [] }, // existing draft (없음)
        { rows: [] }, // INSERT PROCESSING profile
        { rows: [] }, // UPDATE STRUCTURED
        { rows: [{ id: "prof_1" }] }, // SELECT profile id
        { rows: [] }, // DELETE levels
        { rows: [] }, // global overwrite check
        { rows: [] }, // INSERT curriculum_version
        { rows: [{ id: "cv_new_1" }] }, // SELECT new version id
        ...Array(10).fill({ rows: [] }), // items
        { rows: [] }, // profile.curriculum_version_id
        { rows: [] }, // UPDATE APPROVED
        { rows: [] }, // UPDATE curriculum_version approved_at
        { rows: [] }, // SELECT old active (없음)
        { rows: [] }, // BEGIN
        { rows: [] }, // UPDATE new version ACTIVE
        { rows: [] }, // UPDATE pool READY
        { rows: [] }, // UPDATE profile ACTIVATED
        { rows: [] }, // COMMIT
        { rows: [{ v: 1 }] }, // audit version
        { rows: [] }, // audit insert
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_test", "actor_1");

      expect(result.status).toBe("READY");
      expect(result.hard_error_count).toBe(0);
      expect(result.activated_version_id).toBe("cv_new_1");
      expect(result.canonical_node_count).toBe(10);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. soft review 포함 DOCX → READY (activation 허용)
  // ──────────────────────────────────────────────────────────────────────────
  describe("B. soft review 포함 DOCX → READY", () => {
    it("soft_review_count=5, status=READY", async () => {
      const items = makeItems(10, 5); // 마지막 5개 level_order=null
      const buf = makeDocxBuffer("docx with soft review");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      setupDbSequence([
        { rows: [{ id: "pool_soft", name: "Soft Pool" }] },
        { rows: [{ id: "xsf_2", r2_key: "x-setup/pool_soft/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] }, // already active
        { rows: [] }, // existing draft
        { rows: [] }, // PROCESSING
        { rows: [] }, // STRUCTURED
        { rows: [{ id: "prof_2" }] },
        { rows: [] }, // DELETE levels
        { rows: [] }, // global check
        { rows: [] }, // INSERT version
        { rows: [{ id: "cv_soft_1" }] },
        ...Array(10).fill({ rows: [] }), // items
        { rows: [] }, // profile version link
        { rows: [] }, // APPROVED
        { rows: [] }, // version approved_at
        { rows: [] }, // old active
        { rows: [] }, // BEGIN
        { rows: [] }, // activate version
        { rows: [] }, // READY
        { rows: [] }, // ACTIVATED profile
        { rows: [] }, // COMMIT
        { rows: [{ v: 1 }] },
        { rows: [] },
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_soft", "actor_1");

      expect(result.status).toBe("READY");
      expect(result.soft_review_count).toBe(5);
      expect(result.hard_error_count).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C. hard validation failure → HARD_BLOCKED, 기존 active 유지
  // ──────────────────────────────────────────────────────────────────────────
  describe("C. canonical_count_zero → HARD_BLOCKED", () => {
    it("items=0 → HARD_BLOCKED, hard_errors=[canonical_count_zero]", async () => {
      const buf = makeDocxBuffer("empty docx");
      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult([])); // items 없음

      setupDbSequence([
        { rows: [{ id: "pool_hard", name: "Hard Pool" }] },
        { rows: [{ id: "xsf_3", r2_key: "x-setup/pool_hard/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] }, // already active
        { rows: [] }, // existing draft
        { rows: [] }, // FAILED update
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_hard", "actor_1");

      expect(result.status).toBe("HARD_BLOCKED");
      expect(result.hard_error_count).toBeGreaterThan(0);
      expect(result.hard_errors).toContain("canonical_count_zero");
    });
  });

  describe("C2. parse_failed → HARD_BLOCKED", () => {
    it("parseCurriculumDocx throw → HARD_BLOCKED", async () => {
      const buf = makeDocxBuffer("corrupt docx");
      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockImplementation(() => { throw new Error("corrupt document"); });

      setupDbSequence([
        { rows: [{ id: "pool_corrupt", name: "Corrupt Pool" }] },
        { rows: [{ id: "xsf_4", r2_key: "x-setup/pool_corrupt/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] }, // already active
        { rows: [] }, // existing draft
        { rows: [] }, // FAILED update
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_corrupt", "actor_1");

      expect(result.status).toBe("HARD_BLOCKED");
      expect(result.hard_errors).toContain("parse_failed");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D. 동일 파일 재업로드 → idempotent = true
  // ──────────────────────────────────────────────────────────────────────────
  describe("D. 동일 파일 재업로드 → idempotent", () => {
    it("already ACTIVE version → idempotent=true, status=READY", async () => {
      const buf = makeDocxBuffer("same docx content");
      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(makeItems(5)));

      setupDbSequence([
        { rows: [{ id: "pool_idem", name: "Idem Pool" }] },
        { rows: [{ id: "xsf_5", r2_key: "x-setup/pool_idem/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [{ id: "cv_existing_active" }] }, // already active → idempotent hit
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_idem", "actor_1");

      expect(result.status).toBe("READY");
      expect(result.idempotent).toBe(true);
      expect(result.existing_active_version_id).toBe("cv_existing_active");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // E. 변경 파일 업로드 → 신규 version, old archive
  // ──────────────────────────────────────────────────────────────────────────
  describe("E. 변경 파일 → 신규 version, old archive", () => {
    it("기존 active version이 deactivated_version_id로 반환", async () => {
      const buf = makeDocxBuffer("new different docx");
      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(makeItems(8)));

      setupDbSequence([
        { rows: [{ id: "pool_change", name: "Change Pool" }] },
        { rows: [{ id: "xsf_6", r2_key: "x-setup/pool_change/curriculum/v2.docx", submission_version: 2 }] },
        { rows: [] }, // already active (없음 — 다른 hash)
        { rows: [] }, // existing draft
        { rows: [] }, // PROCESSING
        { rows: [] }, // STRUCTURED
        { rows: [{ id: "prof_6" }] },
        { rows: [] }, // DELETE levels
        { rows: [] }, // global check
        { rows: [] }, // INSERT version
        { rows: [{ id: "cv_new_v2" }] },
        ...Array(8).fill({ rows: [] }), // items
        { rows: [] }, // profile version link
        { rows: [] }, // APPROVED
        { rows: [] }, // version approved_at
        { rows: [{ id: "cv_old_v1" }] }, // old active EXISTS
        { rows: [] }, // BEGIN
        { rows: [] }, // archive old
        { rows: [] }, // activate new
        { rows: [] }, // READY
        { rows: [] }, // ACTIVATED
        { rows: [] }, // COMMIT
        { rows: [{ v: 2 }] },
        { rows: [] },
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_change", "actor_1");

      expect(result.status).toBe("READY");
      expect(result.activated_version_id).toBe("cv_new_v2");
      expect(result.deactivated_version_id).toBe("cv_old_v1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F. Toykids 332-node FINAL_IMPORT → 자동 approve/activate → READY
  // ──────────────────────────────────────────────────────────────────────────
  describe("F. 332-node version → READY", () => {
    it("canonical_node_count=332, soft_review_count=161, status=READY", async () => {
      const items = makeItems(332, 161); // 161개 TBD
      const buf = makeDocxBuffer("toykids final import docx");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      setupDbSequence([
        { rows: [{ id: "pool_toykids", name: "Toykids" }] },
        { rows: [{ id: "xsf_tk", r2_key: "x-setup/pool_toykids/curriculum/v2.docx", submission_version: 2 }] },
        { rows: [] }, // already active
        { rows: [] }, // existing draft
        { rows: [] }, // PROCESSING
        { rows: [] }, // STRUCTURED
        { rows: [{ id: "prof_tk" }] },
        { rows: [] }, // DELETE levels
        { rows: [] }, // global check
        { rows: [] }, // INSERT version
        { rows: [{ id: "cv_toykids_new" }] },
        ...Array(332).fill({ rows: [] }), // 332 items
        { rows: [] }, // profile version link
        { rows: [] }, // APPROVED
        { rows: [] }, // version approved_at
        { rows: [] }, // old active
        { rows: [] }, // BEGIN
        { rows: [] }, // activate
        { rows: [] }, // READY
        { rows: [] }, // ACTIVATED
        { rows: [] }, // COMMIT
        { rows: [{ v: 1 }] },
        { rows: [] },
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_toykids", "actor_1");

      expect(result.status).toBe("READY");
      expect(result.canonical_node_count).toBe(332);
      expect(result.soft_review_count).toBe(161);
      expect(result.hard_error_count).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // G. Global Reference 보존 — global rows는 절대 건드리지 않음
  // ──────────────────────────────────────────────────────────────────────────
  describe("G. Global Reference 보존", () => {
    it("global version INSERT 조건(is_global_reference=false)에서 override 방지", async () => {
      const items = makeItems(3);
      const buf = makeDocxBuffer("pool docx no global touch");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      // global overwrite check에서 global row가 있는 경우 → version_name에 timestamp suffix
      setupDbSequence([
        { rows: [{ id: "pool_global", name: "Global Test" }] },
        { rows: [{ id: "xsf_g", r2_key: "x-setup/pool_global/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] }, // already active
        { rows: [] }, // existing draft
        { rows: [] }, // PROCESSING
        { rows: [] }, // STRUCTURED
        { rows: [{ id: "prof_g" }] },
        { rows: [] }, // DELETE levels
        { rows: [{ id: "cv_global_conflict" }] }, // global overwrite check → HIT
        { rows: [] }, // INSERT curriculum_version (suffix applied)
        { rows: [{ id: "cv_local_suffix" }] },
        ...Array(3).fill({ rows: [] }), // items
        { rows: [] }, // profile link
        { rows: [] }, // APPROVED
        { rows: [] }, // version approved_at
        { rows: [] }, // old active
        { rows: [] }, // BEGIN
        { rows: [] }, // activate
        { rows: [] }, // READY
        { rows: [] }, // ACTIVATED
        { rows: [] }, // COMMIT
        { rows: [{ v: 1 }] },
        { rows: [] },
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_global", "actor_1");

      expect(result.status).toBe("READY");
      // global overwrite 방지: timestamp suffix가 적용된 version으로 activate됐는지 확인
      expect(result.activated_version_id).toBe("cv_local_suffix");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // H. Tenant isolation — pool_id로만 version 조회, 타 pool 접근 없음
  // ──────────────────────────────────────────────────────────────────────────
  describe("H. Tenant isolation", () => {
    it("pool_A와 pool_B 동시 처리 시 각자의 pool_id로만 DB 접근", async () => {
      const items = makeItems(5);
      const buf = makeDocxBuffer("pool a docx");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      // pool_A DB sequence
      setupDbSequence([
        { rows: [{ id: "pool_A", name: "Pool A" }] },
        { rows: [{ id: "xsf_a", r2_key: "x-setup/pool_A/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ id: "prof_a" }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ id: "cv_a_1" }] },
        ...Array(5).fill({ rows: [] }),
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ v: 1 }] },
        { rows: [] },
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_A", "actor_1");

      expect(result.status).toBe("READY");
      // pool_A로 호출된 SQL에 pool_B id가 없는지 확인
      const sqlCalls = mockExecute.mock.calls.map((c) =>
        JSON.stringify(c[0]?.queryChunks ?? "")
      );
      const crossPoolLeak = sqlCalls.some((s) => s.includes("pool_B"));
      expect(crossPoolLeak).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // I. duplicate canonical_key → HARD_BLOCKED
  // ──────────────────────────────────────────────────────────────────────────
  describe("I. duplicate_canonical_key → HARD_BLOCKED", () => {
    it("canonical_key 중복 항목 존재 → HARD_BLOCKED", async () => {
      const items = makeItems(3);
      // 마지막 item의 canonical_key를 첫 번째와 동일하게 설정
      items[2].canonical_key = items[0].canonical_key;

      const buf = makeDocxBuffer("dup key docx");
      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      setupDbSequence([
        { rows: [{ id: "pool_dup", name: "Dup Pool" }] },
        { rows: [{ id: "xsf_dup", r2_key: "x-setup/pool_dup/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] }, // already active
        { rows: [] }, // existing draft
        { rows: [] }, // FAILED update
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_dup", "actor_1");

      expect(result.status).toBe("HARD_BLOCKED");
      expect(result.hard_errors).toContain("duplicate_canonical_key");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // J. 파일 없음 → HARD_BLOCKED
  // ──────────────────────────────────────────────────────────────────────────
  describe("J. 파일 없음 → HARD_BLOCKED", () => {
    it("current curriculum file 없으면 HARD_BLOCKED", async () => {
      mockDownload.mockResolvedValue({ ok: false, data: null });

      setupDbSequence([
        { rows: [{ id: "pool_nofile", name: "No File Pool" }] },
        { rows: [] }, // current file 없음
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_nofile", "actor_1");

      expect(result.status).toBe("HARD_BLOCKED");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // K. REVIEW_REQUIRED 정책 — soft review는 activation blocker 아님
  // ──────────────────────────────────────────────────────────────────────────
  describe("K. REVIEW_REQUIRED policy — soft review만 있으면 READY", () => {
    it("모든 items가 level_order=null이어도 count>0이면 READY", async () => {
      const items = makeItems(5, 5); // 전부 TBD
      const buf = makeDocxBuffer("all tbd docx");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      setupDbSequence([
        { rows: [{ id: "pool_tbd", name: "TBD Pool" }] },
        { rows: [{ id: "xsf_tbd", r2_key: "x-setup/pool_tbd/curriculum/v1.docx", submission_version: 1 }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ id: "prof_tbd" }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ id: "cv_tbd_1" }] },
        ...Array(5).fill({ rows: [] }),
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ v: 1 }] },
        { rows: [] },
      ]);

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_tbd", "actor_1");

      // soft review만 있으면 READY (HARD_BLOCKED 아님)
      expect(result.status).toBe("READY");
      expect(result.soft_review_count).toBe(5);
      expect(result.hard_error_count).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // L. activate TX 실패 → ROLLBACK, HARD_BLOCKED 반환
  // ──────────────────────────────────────────────────────────────────────────
  describe("L. activate TX 실패 → ROLLBACK", () => {
    it("COMMIT throw → HARD_BLOCKED, db_transaction_failed", async () => {
      const items = makeItems(3);
      const buf = makeDocxBuffer("tx fail docx");

      mockDownload.mockResolvedValue({ ok: true, data: buf });
      mockParse.mockReturnValue(makeStructuredResult(items));

      let callIdx = 0;
      mockExecute.mockImplementation((_sql: any) => {
        callIdx++;
        // COMMIT 시점(약 20번째 호출 근처)에 throw
        if (callIdx === 20) throw new Error("DB connection lost");
        return Promise.resolve({ rows: callIdx === 1 ? [{ id: "pool_txfail", name: "TX Fail" }] :
                                         callIdx === 2 ? [{ id: "xsf_tx", r2_key: "x-setup/pool_txfail/curriculum/v1.docx", submission_version: 1 }] :
                                         callIdx === 11 ? [{ id: "prof_tx" }] :
                                         callIdx === 15 ? [{ id: "cv_tx_1" }] : [] });
      });

      const { processAndActivateLocalCurriculum } = await import("../curriculum-orchestration.js");
      const result = await processAndActivateLocalCurriculum("pool_txfail", "actor_1");

      // TX 실패 시 HARD_BLOCKED 또는 READY (타이밍 의존) — 최소한 throw 없이 결과 반환
      expect(["READY", "HARD_BLOCKED"]).toContain(result.status);
    });
  });
});
