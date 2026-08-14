/**
 * parent-curriculum.test.ts — WP2: Parent Curriculum Search APP API
 *
 * TC-A  승인된 Parent + NORMAL eligible (≥300 items) → 200
 * TC-B  NORMAL < 300 items → 422 CURRICULUM_SEARCH_NOT_ELIGIBLE
 * TC-C  승인된 Parent + X ACTIVE → 200
 * TC-D  x_pending → 422 CURRICULUM_SEARCH_NOT_ELIGIBLE
 * TC-E  entitlement false → NORMAL mode (resolvePoolMode → normal)
 * TC-F  다른 Parent의 student → 403
 * TC-G  NORMAL scope: pool_id 격리 검증 (다른 pool 혼입 없음)
 * TC-H  X scope: POOL items 혼입 없음 (source=X_GLOBAL만)
 * TC-I  X: inactive/no active global set → 422
 * TC-J  student progress 없음 → 200 (optional field 생략)
 * TC-K  request_id mismatch response → 502 RESPONSE_VALIDATION_FAILED
 * TC-L  unknown curriculum ID response → 502 RESPONSE_VALIDATION_FAILED
 * TC-M  ENGINE 401 → 502
 * TC-N  ENGINE 429 → 502
 * TC-O  ENGINE 5xx → 502
 * TC-P  timeout → 502
 * TC-Q  grounding.validation != PASS → 502
 * TC-R  무인증 → 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express                                   from "express";
import request                                   from "supertest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PARENT_ID    = "pa_test_01";
const OTHER_PARENT = "pa_other_01";
const STUDENT_ID   = "stu_test_01";
const POOL_ID      = "pool_test_01";
const POOL_NAME    = "테스트수영장";
const VERSION_ID   = "cv_test_01";
const ITEM_ID_1    = "ci_test_01";
const ITEM_ID_2    = "ci_test_02";
const GLOBAL_SET_ID = "gts_test_01";
const TPL_ID_1     = "dt_test_01";
const REQUEST_ID   = "curriculum_abc123";
const QUERY_TEXT   = "우리 아이는 지금 평영을 어디까지 배우고 있나요?";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: vi.fn() },
  db:           { execute: vi.fn() },
}));

vi.mock("../../middlewares/auth.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    requireAuth: vi.fn((req: any, _res: any, next: any) => next()),
  };
});

vi.mock("../../lib/xmode.js", () => ({
  resolvePoolMode: vi.fn(),
}));

vi.mock("../../lib/diary-template-search.js", () => ({
  getActiveGlobalTemplateSet: vi.fn(),
}));

vi.mock("../../lib/parent-curriculum-engine-client.js", () => ({
  PC_SCHEMA_VERSION: "1.0",
  PC_FEATURE:        "parent_curriculum_search",
  searchParentCurriculum:     vi.fn(),
  ParentCurriculumEngineError: class ParentCurriculumEngineError extends Error {
    constructor(
      public errorCode: string,
      public statusCode: number,
      public retryable: boolean,
      message: string,
    ) { super(message); this.name = "ParentCurriculumEngineError"; }
  },
}));

// WP2B / WP2B.2: quota + conversation modules — mocked so WP2 tests are unaffected
vi.mock("../../lib/parent-curriculum-quota.js", () => ({
  MONTHLY_LIMIT:             10,
  CURRICULUM_SEARCH_FEATURE: "parent_curriculum_search",
  getPriorReservationStatus: vi.fn().mockResolvedValue("NONE"),  // WP2B.2: default no prior
  tryReserveMonthlyQuota:    vi.fn().mockResolvedValue({ ok: true, isRetry: false }),
  finalizeQuotaSuccess:      vi.fn().mockResolvedValue(undefined),
  rollbackQuotaReservation:  vi.fn().mockResolvedValue(undefined),
  getMonthlyUsageInfo:       vi.fn().mockResolvedValue({
    limit: 10, used: 0, remaining: 10, period: "2026-08", resets_at: "2026-09-01T00:00:00.000Z",
  }),
  getSeoulMonthPeriod: vi.fn().mockReturnValue("2026-08-01"),
  getSeoulPeriodLabel: vi.fn().mockReturnValue("2026-08"),
  getResetsAt:         vi.fn().mockReturnValue("2026-09-01T00:00:00.000Z"),
}));

vi.mock("../../lib/parent-curriculum-conversation.js", () => ({
  getOrCreateConversation:        vi.fn().mockResolvedValue("conv_default_01"),
  findConversation:               vi.fn().mockResolvedValue("conv_default_01"),
  saveUserMessage:                vi.fn().mockResolvedValue(undefined),
  saveAssistantMessage:           vi.fn().mockResolvedValue(undefined),
  touchConversation:              vi.fn().mockResolvedValue(undefined),
  getConversationMessages:        vi.fn().mockResolvedValue([]),
  getAssistantMessageByRequestId: vi.fn().mockResolvedValue(null), // WP2B.2
}));

// ─── Import mocked modules ────────────────────────────────────────────────────

import { superAdminDb }             from "@workspace/db";
import { resolvePoolMode }          from "../../lib/xmode.js";
import { getActiveGlobalTemplateSet } from "../../lib/diary-template-search.js";
import {
  searchParentCurriculum,
  ParentCurriculumEngineError,
} from "../../lib/parent-curriculum-engine-client.js";

// ─── Helper: build test Express app ──────────────────────────────────────────

function buildApp(user: { userId: string; role: string; poolId?: string } | null) {
  const app = express();
  app.use(express.json());

  // Inject fake user (or no user for unauthenticated tests)
  app.use((req: any, _res: any, next: any) => {
    if (user) req.user = user;
    next();
  });

  // Lazy import to pick up mocks
  return import("../parent-curriculum.js").then(({ default: router }) => {
    app.use("/", router);
    return app;
  });
}

// ─── DB mock factory helpers ──────────────────────────────────────────────────

/**
 * Configure superAdminDb.execute to handle query routing based on keywords.
 * opts.hasOwnership: parent_students ownership check
 * opts.itemCount:    curriculum_items COUNT result
 * opts.items:        curriculum_items rows
 * opts.noProgress:   no student_curriculum_assignments row
 */
function setupNormalDb(opts: {
  hasOwnership?: boolean;
  itemCount?:    number;
  items?:        Array<{ id: string; title: string; description: string | null; sort_order: number }>;
  noProgress?:   boolean;
}) {
  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
    const q: string = typeof query?.sql === "string" ? query.sql
      : query?.queryChunks
        ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
        : String(query ?? "");

    // parent_students ownership check
    if (q.includes("parent_students")) {
      return opts.hasOwnership !== false
        ? { rows: [{ swimming_pool_id: POOL_ID }] }
        : { rows: [] };
    }
    // swimming_pools name
    if (q.includes("swimming_pools")) {
      return { rows: [{ name: POOL_NAME }] };
    }
    // curriculum_versions active
    if (q.includes("curriculum_versions")) {
      return { rows: [{ id: VERSION_ID }] };
    }
    // curriculum_items COUNT
    if (q.includes("COUNT") && q.includes("curriculum_items")) {
      return { rows: [{ cnt: String(opts.itemCount ?? 500) }] };
    }
    // curriculum_items load
    if (q.includes("curriculum_items")) {
      return {
        rows: opts.items ?? [
          { id: ITEM_ID_1, title: "평영 발차기", description: "발차기 기초", sort_order: 1 },
          { id: ITEM_ID_2, title: "평영 팔동작", description: "팔동작 기초", sort_order: 2 },
        ],
      };
    }
    // student_curriculum_assignments
    if (q.includes("student_curriculum_assignments")) {
      return opts.noProgress
        ? { rows: [] }
        : { rows: [{ curriculum_version_id: VERSION_ID }] };
    }
    return { rows: [] };
  });
}

function setupXDb(opts: { hasOwnership?: boolean; templates?: any[] } = {}) {
  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
    const q: string = typeof query?.sql === "string" ? query.sql
      : query?.queryChunks
        ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
        : String(query ?? "");

    if (q.includes("parent_students")) {
      return opts.hasOwnership !== false
        ? { rows: [{ swimming_pool_id: POOL_ID }] }
        : { rows: [] };
    }
    if (q.includes("swimming_pools")) {
      return { rows: [{ name: POOL_NAME }] };
    }
    if (q.includes("diary_templates")) {
      return {
        rows: opts.templates ?? [
          { id: TPL_ID_1, title: "평영", content: "평영 발차기 템플릿", level_name: "초급", sort_order: 1 },
        ],
      };
    }
    if (q.includes("student_curriculum_assignments")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

// ─── Success ENGINE response factory ─────────────────────────────────────────

function makeEngineSuccess(
  overrides: Partial<any> = {},
  curriculumIds: string[] = [ITEM_ID_1],
) {
  return {
    request_id:     overrides.request_id     ?? REQUEST_ID,
    schema_version: overrides.schema_version ?? "1.0",
    feature:        overrides.feature        ?? "parent_curriculum_search",
    result: {
      answer:           "현재 평영 발차기 단계를 진행 중입니다.",
      current_progress: { title: "평영 발차기", summary: "기초 단계" },
    },
    grounding: {
      curriculum_ids:  overrides.curriculum_ids  ?? curriculumIds,
      knowledge_ids:   ["kn_01"],
      validation:      overrides.grounding_validation ?? "PASS",
    },
    meta: { intent: "CURRENT_PROGRESS", mode: "NORMAL" },
    ...overrides,
  };
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WP2 — Parent Curriculum Search", () => {

  // TC-A: NORMAL eligible → 200
  it("A. 승인된 Parent + NORMAL eligible (≥300 items) → 200 with answer", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1, ITEM_ID_2]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.result.answer).toBeTruthy();
    expect(res.body.meta.mode).toBe("NORMAL");
    expect(res.body.request_id).toBe(REQUEST_ID);
  });

  // TC-B: NORMAL < 300 → 422
  it("B. NORMAL < 300 items → 422 CURRICULUM_SEARCH_NOT_ELIGIBLE", async () => {
    setupNormalDb({ itemCount: 150 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CURRICULUM_SEARCH_NOT_ELIGIBLE");
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // TC-C: X ACTIVE → 200
  it("C. 승인된 Parent + X ACTIVE → 200 with answer", async () => {
    setupXDb();
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "x", xmode_entitlement: true, xmode_config_status: "READY",
    });
    (getActiveGlobalTemplateSet as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: GLOBAL_SET_ID, version_name: "v1.0" },
    );
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ grounding_validation: "PASS", curriculum_ids: [TPL_ID_1] }, [TPL_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.meta.mode).toBe("X");

    // Verify ENGINE received X mode request
    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineCall.context.mode).toBe("X");
    expect(engineCall.context.curriculum_scope.source).toBe("X_GLOBAL");
    expect(engineCall.context.curriculum_scope.template_set_id).toBe(GLOBAL_SET_ID);
  });

  // TC-D: x_pending → 422
  it("D. x_pending → X_GLOBAL 차단 → 422", async () => {
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q: string = typeof query?.sql === "string" ? query.sql
        : query?.queryChunks
          ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
          : String(query ?? "");
      if (q.includes("parent_students")) return { rows: [{ swimming_pool_id: POOL_ID }] };
      if (q.includes("swimming_pools")) return { rows: [{ name: POOL_NAME }] };
      return { rows: [] };
    });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "x_pending", xmode_entitlement: true, xmode_config_status: "CURRICULUM_PENDING",
    });

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CURRICULUM_SEARCH_NOT_ELIGIBLE");
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // TC-E: entitlement false → NORMAL mode
  it("E. entitlement false → NORMAL mode (pool 300개 이상일 때)", async () => {
    setupNormalDb({ itemCount: 400 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineCall.context.mode).toBe("NORMAL");
    expect(engineCall.context.curriculum_scope.source).toBe("POOL");
  });

  // TC-F: 다른 Parent의 student → 403
  it("F. 다른 Parent의 student 접근 → 403", async () => {
    setupNormalDb({ hasOwnership: false });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });

    const app = await buildApp({ userId: OTHER_PARENT, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(403);
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // TC-G: NORMAL scope — pool_id 격리 (다른 pool curriculum 혼입 없음)
  it("G. NORMAL scope: ENGINE 요청의 curriculum_scope.source = POOL, pool_id 격리", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1, ITEM_ID_2]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // ENGINE이 받은 scope의 source는 POOL
    expect(engineCall.context.curriculum_scope.source).toBe("POOL");
    // template_set_id 없음 (X_GLOBAL 전용 필드)
    expect(engineCall.context.curriculum_scope.template_set_id).toBeUndefined();
    // pool_id 전달됨
    expect(engineCall.context.pool_id).toBe(POOL_ID);
  });

  // TC-H: X scope — POOL items 혼입 없음
  it("H. X scope: source=X_GLOBAL, POOL items 혼입 없음", async () => {
    setupXDb();
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "x", xmode_entitlement: true, xmode_config_status: "READY",
    });
    (getActiveGlobalTemplateSet as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: GLOBAL_SET_ID, version_name: "v1.0" },
    );
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ curriculum_ids: [TPL_ID_1] }, [TPL_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineCall.context.curriculum_scope.source).toBe("X_GLOBAL");
    // curriculum_items IDs가 x_global template IDs여야 함 (POOL curriculum IDs 없음)
    const ids = engineCall.context.curriculum_scope.curriculum_items.map((i: any) => i.id);
    expect(ids).toContain(TPL_ID_1);
    expect(ids).not.toContain(ITEM_ID_1); // POOL items 혼입 없음
  });

  // TC-I: X inactive/no active global set → 422
  it("I. X: ACTIVE global set 없음 → 422", async () => {
    setupXDb();
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "x", xmode_entitlement: true, xmode_config_status: "READY",
    });
    (getActiveGlobalTemplateSet as ReturnType<typeof vi.fn>).mockResolvedValue(null); // 없음

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CURRICULUM_SEARCH_NOT_ELIGIBLE");
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // TC-J: student progress 없음 → 200 (optional field 생략)
  it("J. student progress 없음 → 200, student_progress 필드 생략", async () => {
    setupNormalDb({ itemCount: 500, noProgress: true });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // student_progress 없거나 undefined
    expect(engineCall.context.student_progress).toBeUndefined();
  });

  // TC-K: request_id mismatch → 502
  it("K. ENGINE response request_id mismatch → 502 RESPONSE_VALIDATION_FAILED", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ request_id: "curriculum_DIFFERENT_ID" }, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESPONSE_VALIDATION_FAILED");
  });

  // TC-L: unknown curriculum ID in response → 502
  it("L. ENGINE returns unknown curriculum_id → 502 RESPONSE_VALIDATION_FAILED", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ curriculum_ids: ["ci_UNKNOWN_ID"] }, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESPONSE_VALIDATION_FAILED");
  });

  // TC-M: ENGINE 401 → 502
  it("M. ENGINE 401 → 502 ENGINE_UNAUTHORIZED", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ParentCurriculumEngineError("UNAUTHORIZED", 401, false, "unauthorized"),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ENGINE_UNAUTHORIZED");
  });

  // TC-N: ENGINE 429 → 502
  it("N. ENGINE 429 → 502 ENGINE_RATE_LIMITED", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ParentCurriculumEngineError("ENGINE_HTTP_ERROR", 429, true, "rate limited"),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ENGINE_RATE_LIMITED");
  });

  // TC-O: ENGINE 5xx → 502
  it("O. ENGINE 5xx → 502", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ParentCurriculumEngineError("INTERNAL_ERROR", 500, true, "server error"),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
  });

  // TC-P: timeout → 502
  it("P. ENGINE timeout (COMPOSITION_TIMEOUT) → 502", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ParentCurriculumEngineError("COMPOSITION_TIMEOUT", 0, true, "timeout"),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.retryable).toBe(true);
  });

  // TC-Q: grounding.validation != PASS → 502
  it("Q. grounding.validation != PASS → 502 RESPONSE_VALIDATION_FAILED", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ grounding_validation: "FAIL" }, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESPONSE_VALIDATION_FAILED");
  });

  // TC-R: 무인증 → 403 (requireParent가 role 확인)
  it("R. parent_account role 없음 → 403", async () => {
    const app = await buildApp({ userId: "user_other", role: "teacher" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(403);
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // TC-S: query 없음 → 400
  it("S. query 없음 → 400 INVALID_REQUEST", async () => {
    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  // TC-T: request_id 없음 → 400
  it("T. request_id 없음 → 400 INVALID_REQUEST", async () => {
    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ query: QUERY_TEXT });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  // ── WP2.1 Student Progress Semantic Fix ─────────────────────────────────────

  // WP2.1-A: assignment(curriculum_version_id) 존재해도 current_curriculum_id 미전송
  it("WP2.1-A. curriculum_version_id 행 있어도 current_curriculum_id 미전송", async () => {
    // noProgress: false → student_curriculum_assignments에 version_id 행 반환되도록 설정
    setupNormalDb({ itemCount: 500, noProgress: false });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // student_progress 자체가 없거나, 있어도 current_curriculum_id 없어야 함
    expect(engineCall.context.student_progress).toBeUndefined();
  });

  // WP2.1-B: current item 확정 불가 → omit (현재 구조상 canonical helper 없음)
  it("WP2.1-B. canonical current item helper 없음 → student_progress 생략", async () => {
    setupNormalDb({ itemCount: 500 });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineCall.context.student_progress).toBeUndefined();
    // student_progress가 있어도 current_curriculum_id는 없어야 함
    if (engineCall.context.student_progress) {
      expect(engineCall.context.student_progress.current_curriculum_id).toBeUndefined();
    }
  });

  // WP2.1-C: version ID 형식이 current_curriculum_id에 들어가지 않음
  it("WP2.1-C. curriculum_version_id(cv_...) 형식이 current_curriculum_id로 전송 금지", async () => {
    setupNormalDb({ itemCount: 500, noProgress: false });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const progress = engineCall.context.student_progress;
    // current_curriculum_id에 VERSION_ID(cv_...) 형식이 들어가면 안 됨
    if (progress?.current_curriculum_id) {
      expect(progress.current_curriculum_id).not.toBe(VERSION_ID);
      expect(progress.current_curriculum_id).not.toMatch(/^cv_/);
    }
    // 현재 구현 상 student_progress 자체가 없는 것이 정상
    expect(progress).toBeUndefined();
  });

  // WP2.1-D: progress 데이터 없음 → student_progress 생략 정상
  it("WP2.1-D. progress 없음 → student_progress undefined, 200 정상 반환", async () => {
    setupNormalDb({ itemCount: 500, noProgress: true });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({}, [ITEM_ID_1]),
    );

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    const engineCall = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineCall.context.student_progress).toBeUndefined();
  });

  // TC-U: NORMAL active version 없음 → 422
  it("U. NORMAL: active curriculum_version 없음 → 422", async () => {
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q: string = typeof query?.sql === "string" ? query.sql
        : query?.queryChunks
          ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
          : String(query ?? "");
      if (q.includes("parent_students")) return { rows: [{ swimming_pool_id: POOL_ID }] };
      if (q.includes("swimming_pools")) return { rows: [{ name: POOL_NAME }] };
      if (q.includes("curriculum_versions")) return { rows: [] }; // 없음
      return { rows: [] };
    });
    (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
      pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
    });

    const app = await buildApp({ userId: PARENT_ID, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_ID}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CURRICULUM_SEARCH_NOT_ELIGIBLE");
  });
});
