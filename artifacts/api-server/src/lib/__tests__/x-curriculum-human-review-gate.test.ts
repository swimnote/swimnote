/**
 * x-curriculum-human-review-gate.test.ts
 *
 * P0 Fix — X Curriculum Human Review Gate Alignment
 *
 * 테스트 케이스:
 *   A. 신규 정상 파일 → REVIEW_PENDING (READY 아님, X 활성 아님)
 *   B. super_admin approve → activate → READY
 *   C. revision request → 재업로드 → REVIEW_PENDING (READY 아님)
 *   D. 기존 active curriculum + 새 version → 승인 전 기존 유지, 승인 후 교체
 *   E. validation fail → HARD_BLOCKED → approve/activate/READY 불가
 *   F. 기존 READY pool → idempotent (회귀 없음)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.mock hoisting ──────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: vi.fn() },
}));

vi.mock("../objectStorage.js", () => ({
  downloadFromR2: vi.fn(),
  uploadToR2: vi.fn(),
}));

vi.mock("../docxParser.js", () => ({
  parseCurriculumDocx: vi.fn(),
}));

import {
  processLocalCurriculumForReview,
  approveAndActivateLocalCurriculum,
} from "../curriculum-orchestration.js";
import { superAdminDb } from "@workspace/db";
import { downloadFromR2 } from "../objectStorage.js";
import { parseCurriculumDocx } from "../docxParser.js";

// ── 공통 픽스처 ──────────────────────────────────────────────────────────────

const POOL_ID = "pool_test_001";
const ACTOR_ID = "user_pool_admin_001";
const SUPER_ADMIN_ID = "user_super_admin_001";
const VERSION_ID = "cv_test_001";
const PROFILE_ID = "xcp_test_001";
const OLD_ACTIVE_VERSION_ID = "cv_old_active_001";
const FILE_R2_KEY = "x-setup/pool_test_001/curriculum/v1_file.docx";

const MOCK_POOL_ROW = { id: POOL_ID, name: "테스트 수영장" };
const MOCK_FILE_ROW = { id: "xsf_001", r2_key: FILE_R2_KEY, submission_version: 1 };
const MOCK_DOCX_BUFFER = Buffer.from("fake docx content");
const MOCK_PARSED = {
  basic_info: {},
  teaching_summary: {},
  total_declared_levels: 5,
  template_version: "1.0",
  levels: [
    {
      level_order: 1, level_name: "기초", level_color: null, target_students: null,
      strokes: null, skills: null, learning_contents: null, objectives: null,
      promotion_criteria: null, test_method: null, detailed_skills: null,
      common_errors: null, correction_methods: null, drills: null, age_notes: null,
      teaching_focus: null, notes: null,
    },
  ],
  searchable_items: [
    {
      sort_order: 1, title: "자유형 킥", description: "킥 연습",
      canonical_key: "freestyle_kick", level_order: 1, display_no: "1",
      stroke: "freestyle", domain: null, skill_group: null, atomic_skill: null,
    },
    {
      sort_order: 2, title: "배영 팔동작", description: "팔 연습",
      canonical_key: "backstroke_arm", level_order: 2, display_no: "2",
      stroke: "backstroke", domain: null, skill_group: null, atomic_skill: null,
    },
  ],
};

// ── DB execute mock 헬퍼 ──────────────────────────────────────────────────────

function sqlStr(query: any): string {
  return String(
    query?.sql ??
    (Array.isArray(query?.queryChunks)
      ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : c?.value ?? "")).join("")
      : String(query ?? ""))
  );
}

function setupDbMockForReviewParse(opts: {
  poolExists?: boolean;
  fileExists?: boolean;
  alreadyActive?: boolean;
  draftExists?: boolean;
} = {}) {
  const { poolExists = true, fileExists = true, alreadyActive = false, draftExists = false } = opts;

  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
    const q = sqlStr(query);
    if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
    if (q.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (q.includes("FROM swimming_pools") && q.includes("SELECT id, name"))
      return { rows: poolExists ? [MOCK_POOL_ROW] : [] };
    if (q.includes("FROM x_setup_files") && q.includes("is_current = true"))
      return { rows: fileExists ? [MOCK_FILE_ROW] : [] };
    // alreadyActive check (is_active = true)
    if (q.includes("source_content_hash") && q.includes("is_active           = true"))
      return { rows: alreadyActive ? [{ id: VERSION_ID }] : [] };
    // existingDraft check (is_active = false)
    if (q.includes("source_content_hash") && q.includes("is_active           = false"))
      return { rows: draftExists ? [{ id: VERSION_ID }] : [] };
    if (q.includes("INSERT INTO x_curriculum_profiles")) return { rows: [] };
    if (q.includes("UPDATE x_curriculum_profiles") && q.includes("STRUCTURED")) return { rows: [] };
    if (q.includes("UPDATE x_curriculum_profiles") && q.includes("FAILED")) return { rows: [] };
    if (q.includes("UPDATE x_curriculum_profiles") && q.includes("PROCESSING")) return { rows: [] };
    if (q.includes("FROM x_curriculum_profiles")) return { rows: [{ id: PROFILE_ID }] };
    if (q.includes("DELETE FROM x_curriculum_levels")) return { rows: [] };
    if (q.includes("INSERT INTO x_curriculum_levels")) return { rows: [] };
    if (q.includes("is_global_reference = true")) return { rows: [] };
    if (q.includes("INSERT INTO curriculum_versions")) return { rows: [] };
    if (q.includes("FROM curriculum_versions") && q.includes("version_name"))
      return { rows: [{ id: VERSION_ID }] };
    if (q.includes("INSERT INTO curriculum_items")) return { rows: [] };
    if (q.includes("curriculum_version_id")) return { rows: [] };
    return { rows: [] };
  });
}

function setupDbMockForApproveActivate(opts: {
  profileStatus?: string;
  versionIsActive?: boolean;
  existingActiveVersionId?: string | null;
  commitFails?: boolean;
} = {}) {
  const {
    profileStatus = "STRUCTURED",
    versionIsActive = false,
    existingActiveVersionId = null,
    commitFails = false,
  } = opts;

  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
    const q = sqlStr(query);
    if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
    if (q.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (q.includes("FROM swimming_pools") && q.includes("SELECT id, name"))
      return { rows: [MOCK_POOL_ROW] };
    if (q.includes("FROM x_curriculum_profiles") && q.includes("curriculum_version_id"))
      return { rows: [{ id: PROFILE_ID, status: profileStatus, curriculum_version_id: VERSION_ID }] };
    // version SELECT by id — 고유 패턴: is_global_reference = false (등호 양쪽 공백 없음)
    if (q.includes("FROM curriculum_versions") && q.includes("is_global_reference = false"))
      return { rows: [{ id: VERSION_ID, is_active: versionIsActive, import_status: versionIsActive ? "ACTIVE" : "DRAFT", source_content_hash: "abc123" }] };
    if (q.includes("COUNT(*)") && q.includes("curriculum_items"))
      return { rows: [{ cnt: 10 }] };
    if (q.includes("UPDATE x_curriculum_profiles") && q.includes("APPROVED")) return { rows: [] };
    if (q.includes("UPDATE curriculum_versions") && q.includes("approved_at")) return { rows: [] };
    // old active SELECT — 고유 패턴: is_active        = true (공백 다수)
    if (q.includes("FROM curriculum_versions") && q.includes("archived_at"))
      return existingActiveVersionId
        ? { rows: [{ id: existingActiveVersionId, is_global_reference: false }] }
        : { rows: [] };
    if (q.trim() === "BEGIN") return { rows: [] };
    if (q.trim() === "COMMIT") {
      if (commitFails) throw new Error("TX_COMMIT_FAILED");
      return { rows: [] };
    }
    if (q.trim() === "ROLLBACK") return { rows: [] };
    if (q.includes("UPDATE curriculum_versions") && q.includes("is_active   = false")) return { rows: [] };
    if (q.includes("UPDATE curriculum_versions") && q.includes("ACTIVE")) return { rows: [] };
    if (q.includes("UPDATE swimming_pools") && q.includes("READY")) return { rows: [] };
    if (q.includes("UPDATE x_curriculum_profiles") && q.includes("ACTIVATED")) return { rows: [] };
    return { rows: [] };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (downloadFromR2 as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    data: MOCK_DOCX_BUFFER,
  });
  (parseCurriculumDocx as ReturnType<typeof vi.fn>).mockReturnValue(MOCK_PARSED);
});

// ════════════════════════════════════════════════════════════════════════════
// CASE A: 신규 정상 파일 → REVIEW_PENDING (READY 아님, X 활성 아님)
// ════════════════════════════════════════════════════════════════════════════
describe("CASE A — 신규 정상 파일", () => {
  it("upload 후 processLocalCurriculumForReview → REVIEW_PENDING", async () => {
    setupDbMockForReviewParse({ alreadyActive: false, draftExists: false });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("REVIEW_PENDING");
    expect(result.hard_error_count).toBe(0);
    expect(result.canonical_node_count).toBe(2);
    expect(result.version_id).toBe(VERSION_ID);
  });

  it("REVIEW_PENDING 결과에 activated_version_id 없음 (activate 미수행)", async () => {
    setupDbMockForReviewParse({ alreadyActive: false, draftExists: false });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).not.toBe("READY");
    expect((result as any).activated_version_id).toBeUndefined();
  });

  it("swimming_pools READY UPDATE 미호출 확인", async () => {
    setupDbMockForReviewParse({ alreadyActive: false, draftExists: false });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const poolReadyCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => {
        const q = sqlStr(args[0]);
        return q.includes("swimming_pools") && q.includes("READY");
      }
    );
    expect(poolReadyCalls).toHaveLength(0);
  });

  it("profile auto-approve UPDATE 미호출 확인", async () => {
    setupDbMockForReviewParse({ alreadyActive: false, draftExists: false });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const approvedCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => {
        const q = sqlStr(args[0]);
        return q.includes("x_curriculum_profiles") && q.includes("APPROVED");
      }
    );
    expect(approvedCalls).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE B: super_admin approve → activate → READY
// ════════════════════════════════════════════════════════════════════════════
describe("CASE B — super_admin approve", () => {
  it("approveAndActivateLocalCurriculum → READY", async () => {
    setupDbMockForApproveActivate({ profileStatus: "STRUCTURED", versionIsActive: false });

    const result = await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    expect(result.status).toBe("READY");
    expect(result.hard_error_count).toBe(0);
    expect(result.activated_version_id).toBe(VERSION_ID);
  });

  it("profile APPROVED UPDATE 호출 확인 (reviewed_by = super_admin)", async () => {
    const calls: string[] = [];
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q = sqlStr(query);
      calls.push(q);
      if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
      if (q.includes("INSERT INTO audit_logs")) return { rows: [] };
      if (q.includes("FROM swimming_pools")) return { rows: [MOCK_POOL_ROW] };
      if (q.includes("FROM x_curriculum_profiles")) return { rows: [{ id: PROFILE_ID, status: "STRUCTURED", curriculum_version_id: VERSION_ID }] };
      // version lookup by id (고유: is_global_reference = false)
      if (q.includes("FROM curriculum_versions") && q.includes("is_global_reference = false")) return { rows: [{ id: VERSION_ID, is_active: false, import_status: "DRAFT", source_content_hash: "abc" }] };
      // old active check (고유: archived_at)
      if (q.includes("FROM curriculum_versions") && q.includes("archived_at")) return { rows: [] };
      if (q.includes("COUNT(*)")) return { rows: [{ cnt: 5 }] };
      if (q.trim() === "BEGIN" || q.trim() === "COMMIT" || q.trim() === "ROLLBACK") return { rows: [] };
      return { rows: [] };
    });

    await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    const approveCall = calls.find(
      (q) => q.includes("x_curriculum_profiles") && q.includes("APPROVED")
    );
    expect(approveCall).toBeDefined();
  });

  it("swimming_pools.xmode_config_status = READY 설정됨", async () => {
    const calls: string[] = [];
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q = sqlStr(query);
      calls.push(q);
      if (q.includes("next_audit_version")) return { rows: [{ v: 1 }] };
      if (q.includes("INSERT INTO audit_logs")) return { rows: [] };
      if (q.includes("FROM swimming_pools")) return { rows: [MOCK_POOL_ROW] };
      if (q.includes("FROM x_curriculum_profiles")) return { rows: [{ id: PROFILE_ID, status: "STRUCTURED", curriculum_version_id: VERSION_ID }] };
      if (q.includes("FROM curriculum_versions") && q.includes("is_global_reference = false")) return { rows: [{ id: VERSION_ID, is_active: false, import_status: "DRAFT", source_content_hash: "abc" }] };
      if (q.includes("FROM curriculum_versions") && q.includes("archived_at")) return { rows: [] };
      if (q.includes("COUNT(*)")) return { rows: [{ cnt: 5 }] };
      if (q.trim() === "BEGIN" || q.trim() === "COMMIT" || q.trim() === "ROLLBACK") return { rows: [] };
      return { rows: [] };
    });

    await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    const readyCall = calls.find((q) => q.includes("swimming_pools") && q.includes("READY"));
    expect(readyCall).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE C: revision request 후 재업로드 → REVIEW_PENDING
// ════════════════════════════════════════════════════════════════════════════
describe("CASE C — revision request 후 재업로드", () => {
  it("재업로드 후 processLocalCurriculumForReview → REVIEW_PENDING", async () => {
    setupDbMockForReviewParse({ alreadyActive: false, draftExists: false });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("REVIEW_PENDING");
    expect(result.status).not.toBe("READY");
  });

  it("approve 없이는 pool READY 전환 없음", async () => {
    setupDbMockForReviewParse({ alreadyActive: false });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const poolReadyCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => {
        const q = sqlStr(args[0]);
        return q.includes("swimming_pools") && q.includes("READY");
      }
    );
    expect(poolReadyCalls).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE D: 기존 active curriculum + 새 version → 승인 전 기존 active 유지
// ════════════════════════════════════════════════════════════════════════════
describe("CASE D — 기존 active curriculum 보호", () => {
  it("processLocalCurriculumForReview: 기존 active version deactivate 없음", async () => {
    setupDbMockForReviewParse({ alreadyActive: false, draftExists: false });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const deactivateCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => {
        const q = sqlStr(args[0]);
        return q.includes("curriculum_versions") && q.includes("is_active   = false");
      }
    );
    expect(deactivateCalls).toHaveLength(0);
  });

  it("approveAndActivateLocalCurriculum: 기존 active deactivate + 새 active (atomic)", async () => {
    setupDbMockForApproveActivate({
      profileStatus: "STRUCTURED",
      versionIsActive: false,
      existingActiveVersionId: OLD_ACTIVE_VERSION_ID,
    });

    const result = await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    expect(result.status).toBe("READY");
    expect(result.deactivated_version_id).toBe(OLD_ACTIVE_VERSION_ID);
    expect(result.activated_version_id).toBe(VERSION_ID);
  });

  it("TX 실패 시 HARD_BLOCKED + ROLLBACK 호출됨", async () => {
    setupDbMockForApproveActivate({
      profileStatus: "STRUCTURED",
      versionIsActive: false,
      commitFails: true,
    });

    const result = await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("db_transaction_failed");

    const rollbackCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => sqlStr(args[0]).trim() === "ROLLBACK"
    );
    expect(rollbackCalls.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE E: validation fail → HARD_BLOCKED
// ════════════════════════════════════════════════════════════════════════════
describe("CASE E — validation fail", () => {
  it("parse 실패 → HARD_BLOCKED (parse_failed)", async () => {
    setupDbMockForReviewParse();
    (parseCurriculumDocx as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("Invalid DOCX structure");
    });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("parse_failed");
  });

  it("searchable_items 비어있음 → HARD_BLOCKED (canonical_count_zero)", async () => {
    setupDbMockForReviewParse();
    (parseCurriculumDocx as ReturnType<typeof vi.fn>).mockReturnValue({
      ...MOCK_PARSED,
      searchable_items: [],
    });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("canonical_count_zero");
  });

  it("duplicate canonical_key → HARD_BLOCKED (duplicate_canonical_key)", async () => {
    setupDbMockForReviewParse();
    (parseCurriculumDocx as ReturnType<typeof vi.fn>).mockReturnValue({
      ...MOCK_PARSED,
      searchable_items: [MOCK_PARSED.searchable_items[0], MOCK_PARSED.searchable_items[0]],
    });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("duplicate_canonical_key");
  });

  it("HARD_BLOCKED 상태에서 approve 시도 → 차단됨", async () => {
    setupDbMockForApproveActivate({ profileStatus: "FAILED" });

    const result = await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.block_message).toContain("승인 불가");
  });

  it("HARD_BLOCKED — swimming_pools READY 설정 없음", async () => {
    setupDbMockForReviewParse();
    (parseCurriculumDocx as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("parse fail");
    });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const poolReadyCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => {
        const q = sqlStr(args[0]);
        return q.includes("swimming_pools") && q.includes("READY");
      }
    );
    expect(poolReadyCalls).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE F: 기존 READY pool 보호 (회귀 없음)
// ════════════════════════════════════════════════════════════════════════════
describe("CASE F — 기존 READY pool 보호", () => {
  it("동일 hash 이미 ACTIVE → IDEMPOTENT_READY", async () => {
    setupDbMockForReviewParse({ alreadyActive: true });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("IDEMPOTENT_READY");
    expect(result.idempotent).toBe(true);
    expect(result.existing_active_version_id).toBe(VERSION_ID);
  });

  it("IDEMPOTENT_READY — profile APPROVED/ACTIVATED update 없음", async () => {
    setupDbMockForReviewParse({ alreadyActive: true });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const approvedCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => {
        const q = sqlStr(args[0]);
        return (
          q.includes("x_curriculum_profiles") &&
          (q.includes("APPROVED") || q.includes("ACTIVATED"))
        );
      }
    );
    expect(approvedCalls).toHaveLength(0);
  });

  it("IDEMPOTENT_READY — swimming_pools UPDATE 없음", async () => {
    setupDbMockForReviewParse({ alreadyActive: true });

    await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    const poolCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => sqlStr(args[0]).includes("UPDATE swimming_pools")
    );
    expect(poolCalls).toHaveLength(0);
  });

  it("approveAndActivateLocalCurriculum: 이미 ACTIVE version → idempotent READY", async () => {
    setupDbMockForApproveActivate({ profileStatus: "ACTIVATED", versionIsActive: true });

    const result = await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    expect(result.status).toBe("READY");
    expect(result.idempotent).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 추가: 파일 없음 / pool 없음 케이스
// ════════════════════════════════════════════════════════════════════════════
describe("에러 케이스", () => {
  it("pool 없음 → HARD_BLOCKED", async () => {
    setupDbMockForReviewParse({ poolExists: false });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("parse_failed");
  });

  it("파일 없음 → HARD_BLOCKED", async () => {
    setupDbMockForReviewParse({ fileExists: false });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("parse_failed");
  });

  it("R2 다운로드 실패 → HARD_BLOCKED", async () => {
    setupDbMockForReviewParse({ fileExists: true });
    (downloadFromR2 as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, data: null });

    const result = await processLocalCurriculumForReview(POOL_ID, ACTOR_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.hard_errors).toContain("parse_failed");
  });

  it("super_admin approve: profile 없음 → HARD_BLOCKED", async () => {
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q = sqlStr(query);
      if (q.includes("FROM swimming_pools")) return { rows: [MOCK_POOL_ROW] };
      if (q.includes("FROM x_curriculum_profiles")) return { rows: [] };
      return { rows: [] };
    });

    const result = await approveAndActivateLocalCurriculum(POOL_ID, SUPER_ADMIN_ID);

    expect(result.status).toBe("HARD_BLOCKED");
    expect(result.block_message).toContain("프로필");
  });
});
