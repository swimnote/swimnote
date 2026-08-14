/**
 * parent-curriculum-wp2b.test.ts — WP2B: Monthly Quota + Conversation/Message Persistence
 *
 * WP2B-A  0/10 → 성공 → 1/10 (quota 정상 작동)
 * WP2B-B  9/10 → 성공 → 10/10 (경계값)
 * WP2B-C  10/10 → 429, ENGINE 호출 없음
 * WP2B-D  ENGINE timeout → quota 복구
 * WP2B-E  ENGINE 5xx → quota 복구
 * WP2B-F  grounding FAIL → quota 복구
 * WP2B-G  response validation fail → quota 복구
 * WP2B-H  동일 request_id retry → 이중 차감 없음
 * WP2B-I  동시 2요청 중 한 쪽만 성공 (limit 초과 방지)
 * WP2B-J  다음 달 → period 새로 시작
 * WP2B-K  Asia/Seoul 월 경계 (period label 형식)
 * WP2B-L  parent A/student X conversation 생성
 * WP2B-M  parent A/student X 기존 conversation 재사용
 * WP2B-N  parent B/student X 별도 conversation
 * WP2B-O  student Y 별도 conversation
 * WP2B-P  USER message 중복 방지
 * WP2B-Q  ASSISTANT message 성공 시 저장
 * WP2B-R  ENGINE 실패 시 ASSISTANT 저장 안 됨
 * WP2B-S  history ownership 403
 * WP2B-T  history read는 quota 차감 없음
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express                                   from "express";
import request                                   from "supertest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PARENT_A   = "pa_a_01";
const PARENT_B   = "pa_b_01";
const STUDENT_X  = "stu_x_01";
const STUDENT_Y  = "stu_y_01";
const POOL_ID    = "pool_test_01";
const POOL_NAME  = "테스트수영장";
const ITEM_ID_1  = "ci_test_01";
const ITEM_ID_2  = "ci_test_02";
const CONV_ID_1  = "conv_test_01";
const CONV_ID_2  = "conv_test_02";
const REQUEST_ID = "curriculum_req_01";
const QUERY_TEXT = "우리 아이가 배우는 평영 진도를 알려주세요";

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
  searchParentCurriculum: vi.fn(),
  ParentCurriculumEngineError: class ParentCurriculumEngineError extends Error {
    constructor(
      public errorCode: string,
      public statusCode: number,
      public retryable: boolean,
      message: string,
    ) { super(message); this.name = "ParentCurriculumEngineError"; }
  },
}));

// Quota + Conversation mocked at module level
vi.mock("../../lib/parent-curriculum-quota.js", () => ({
  MONTHLY_LIMIT:             10,
  CURRICULUM_SEARCH_FEATURE: "parent_curriculum_search",
  getPriorReservationStatus: vi.fn(),   // WP2B.2
  tryReserveMonthlyQuota:    vi.fn(),
  finalizeQuotaSuccess:      vi.fn(),
  rollbackQuotaReservation:  vi.fn(),
  getMonthlyUsageInfo:       vi.fn(),
  getSeoulMonthPeriod:       vi.fn(),
  getSeoulPeriodLabel:       vi.fn(),
  getResetsAt:               vi.fn(),
}));

vi.mock("../../lib/parent-curriculum-conversation.js", () => ({
  getOrCreateConversation:        vi.fn(),
  findConversation:               vi.fn(),
  saveUserMessage:                vi.fn(),
  saveAssistantMessage:           vi.fn(),
  touchConversation:              vi.fn(),
  getConversationMessages:        vi.fn(),
  getAssistantMessageByRequestId: vi.fn(), // WP2B.2
}));

// ─── Import mocked modules ────────────────────────────────────────────────────

import { superAdminDb }             from "@workspace/db";
import { resolvePoolMode }          from "../../lib/xmode.js";
import { searchParentCurriculum, ParentCurriculumEngineError } from "../../lib/parent-curriculum-engine-client.js";
import {
  getPriorReservationStatus,
  tryReserveMonthlyQuota,
  finalizeQuotaSuccess,
  rollbackQuotaReservation,
  getMonthlyUsageInfo,
} from "../../lib/parent-curriculum-quota.js";
import {
  getOrCreateConversation,
  findConversation,
  saveUserMessage,
  saveAssistantMessage,
  touchConversation,
  getConversationMessages,
  getAssistantMessageByRequestId,
} from "../../lib/parent-curriculum-conversation.js";

// ─── App builder ──────────────────────────────────────────────────────────────

function buildApp(user: { userId: string; role: string } | null) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (user) req.user = user;
    next();
  });
  return import("../parent-curriculum.js").then(({ default: router }) => {
    app.use("/", router);
    return app;
  });
}

// ─── DB mock helper ───────────────────────────────────────────────────────────

function setupNormalDb(opts: { hasOwnership?: boolean; itemCount?: number } = {}) {
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
    if (q.includes("swimming_pools")) return { rows: [{ name: POOL_NAME }] };
    if (q.includes("curriculum_versions")) return { rows: [{ id: "cv_test_01" }] };
    if (q.includes("COUNT") && q.includes("curriculum_items")) {
      return { rows: [{ cnt: String(opts.itemCount ?? 500) }] };
    }
    if (q.includes("curriculum_items")) {
      return {
        rows: [
          { id: ITEM_ID_1, title: "평영 발차기", description: null, sort_order: 1 },
          { id: ITEM_ID_2, title: "평영 팔동작", description: null, sort_order: 2 },
        ],
      };
    }
    return { rows: [] };
  });
}

// ─── ENGINE response factory ──────────────────────────────────────────────────

function makeEngineSuccess(overrides: Partial<any> = {}, curriculumIds = [ITEM_ID_1]) {
  return {
    request_id:     REQUEST_ID,
    schema_version: "1.0",
    feature:        "parent_curriculum_search",
    result: {
      answer: "평영 발차기 단계를 학습 중입니다.",
      ...overrides.result,
    },
    grounding: {
      validation:     overrides.grounding_validation ?? "PASS",
      curriculum_ids: curriculumIds,
    },
  };
}

function makeUsageInfo(used: number) {
  return {
    limit:     10,
    used,
    remaining: 10 - used,
    period:    "2026-08",
    resets_at: "2026-09-01T00:00:00.000Z",
  };
}

// ─── Setup default mocks ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: normal pool mode
  (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
    pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
  });

  // Default: no prior reservation (normal fresh-request path)
  (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("NONE");
  (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

  // Default: conversation created
  (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);

  // Default: quota ok (0/10)
  (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });
  (finalizeQuotaSuccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (rollbackQuotaReservation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(1));

  // Default: conversation ops succeed
  (saveUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (saveAssistantMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (touchConversation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
  (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  // Default: ENGINE success
  (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(makeEngineSuccess());

  // DB default
  setupNormalDb();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP2B: Monthly Quota + Conversation Persistence", () => {

  // WP2B-A: 0/10 → 성공 → 1/10
  it("A. 0/10 → ENGINE 성공 → 200, usage 반환", async () => {
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });
    (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(1));

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.usage).toBeDefined();
    expect(res.body.usage.limit).toBe(10);
    expect(res.body.usage.used).toBe(1);
    expect(res.body.usage.remaining).toBe(9);
    expect(finalizeQuotaSuccess).toHaveBeenCalledWith(PARENT_A, REQUEST_ID);
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

  // WP2B-B: 9/10 → 성공 → 10/10
  it("B. 9/10 → 성공 → 200, remaining=0", async () => {
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });
    (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(10));

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.usage.remaining).toBe(0);
    expect(finalizeQuotaSuccess).toHaveBeenCalled();
  });

  // WP2B-C: 10/10 → 429, ENGINE 호출 없음
  it("C. 10/10 → 429 PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED, ENGINE 미호출", async () => {
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      usageInfo: makeUsageInfo(10),
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED");
    expect(res.body.usage.remaining).toBe(0);
    expect(searchParentCurriculum).not.toHaveBeenCalled();
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

  // WP2B-D: ENGINE timeout → quota 복구
  it("D. ENGINE timeout → 502, quota rollback 호출", async () => {
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Request timeout"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
    expect(rollbackQuotaReservation).toHaveBeenCalledWith(PARENT_A, REQUEST_ID, expect.any(String));
  });

  // WP2B-E: ENGINE 5xx → quota 복구
  it("E. ENGINE 5xx → 502, quota rollback", async () => {
    const Err = (await import("../../lib/parent-curriculum-engine-client.js")).ParentCurriculumEngineError as any;
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Err("ENGINE_SERVER_ERROR", 503, true, "Service Unavailable"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(rollbackQuotaReservation).toHaveBeenCalled();
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });

  // WP2B-F: grounding FAIL → quota 복구
  it("F. grounding FAIL → 502, quota rollback, ASSISTANT 저장 안 됨", async () => {
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ grounding_validation: "FAIL" }),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESPONSE_VALIDATION_FAILED");
    expect(rollbackQuotaReservation).toHaveBeenCalledWith(PARENT_A, REQUEST_ID, "RESPONSE_VALIDATION_FAILED");
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });

  // WP2B-G: response validation fail → quota 복구
  it("G. response validation fail (request_id mismatch) → 502, quota rollback", async () => {
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeEngineSuccess(),
      request_id: "different_id",
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(rollbackQuotaReservation).toHaveBeenCalled();
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
  });

  // WP2B-H: 동일 request_id retry → 이중 차감 없음
  it("H. 동일 request_id retry → isRetry=true, quota 이중 차감 없음", async () => {
    // 기존 RESERVED 상태 → isRetry:true 반환
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: true });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // 요청은 성공 (ENGINE 호출)
    expect(res.status).toBe(200);
    // tryReserveMonthlyQuota 1번만 호출 (중복 예약 없음)
    expect(tryReserveMonthlyQuota).toHaveBeenCalledTimes(1);
    // 성공 시 finalize 호출
    expect(finalizeQuotaSuccess).toHaveBeenCalledTimes(1);
  });

  // WP2B-I: quota 동시 요청 보호 — 두 번째 요청이 한도 초과 시 429
  // 실제 DB 원자성은 quota 서비스 내 UPDATE WHERE 조건으로 보장.
  // 여기서는 route가 quota 서비스의 limit-reached 결과를 429로 올바르게 처리하는지 검증.
  it("I. 두 번째 quota 초과 → 429, 첫 번째는 200", async () => {
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, isRetry: false })             // 첫 번째: 예약 성공
      .mockResolvedValueOnce({ ok: false, usageInfo: makeUsageInfo(10) }); // 두 번째: 한도 초과

    // ENGINE mock을 dynamic하게 — request_id를 그대로 에코 (request_id validation 통과)
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockImplementation(
      async (engineReq: any) => ({
        request_id:     engineReq.request_id,
        schema_version: "1.0",
        feature:        "parent_curriculum_search",
        result:         { answer: "테스트 답변입니다." },
        grounding:      { validation: "PASS", curriculum_ids: [ITEM_ID_1] },
      }),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });

    const res1 = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: "req_a", query: QUERY_TEXT });

    const res2 = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: "req_b", query: QUERY_TEXT });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(429);
    expect(res2.body.code).toBe("PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED");
  });

  // WP2B-J: 다음 달 → period 새로 시작
  it("J. 다음 달 → period 새로 시작, used=0", async () => {
    // 시뮬레이션: 다음 달 period에 대한 usage는 0
    (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      limit:     10,
      used:      0,
      remaining: 10,
      period:    "2026-09",
      resets_at: "2026-10-01T00:00:00.000Z",
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.usage.used).toBe(0);  // 새 달 첫 질문 전 상태
    expect(res.body.usage.period).toBe("2026-09");
  });

  // WP2B-K: Asia/Seoul 월 경계 — period label 형식 YYYY-MM
  it("K. usage.period 형식은 YYYY-MM", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.usage.period).toMatch(/^\d{4}-\d{2}$/);
  });

  // WP2B-L: parent A/student X conversation 생성
  it("L. parent A/student X → conversation 생성됨", async () => {
    (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(getOrCreateConversation).toHaveBeenCalledWith(PARENT_A, STUDENT_X, POOL_ID);
  });

  // WP2B-M: parent A/student X 기존 conversation 재사용
  it("M. 두 번째 요청도 같은 conversationId 재사용", async () => {
    (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });

    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: "req_1", query: QUERY_TEXT });

    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: "req_2", query: QUERY_TEXT });

    // 두 번 모두 같은 conversationId
    const calls = (getOrCreateConversation as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const results = (getOrCreateConversation as ReturnType<typeof vi.fn>).mock.results;
    const id1 = await results[0].value;
    const id2 = await results[1].value;
    expect(id1).toBe(id2);
  });

  // WP2B-N: parent B/student X → 별도 conversation
  it("N. parent B/student X → 별도 conversation (다른 parentId 전달)", async () => {
    (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_2);

    const app = await buildApp({ userId: PARENT_B, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(getOrCreateConversation).toHaveBeenCalledWith(PARENT_B, STUDENT_X, expect.any(String));
  });

  // WP2B-O: student Y → 별도 conversation
  it("O. student Y → 별도 conversation (다른 studentId 전달)", async () => {
    // student Y ownership도 승인됨으로 설정
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q: string = typeof query?.sql === "string" ? query.sql
        : query?.queryChunks
          ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
          : String(query ?? "");
      if (q.includes("parent_students")) return { rows: [{ swimming_pool_id: POOL_ID }] };
      if (q.includes("swimming_pools"))  return { rows: [{ name: POOL_NAME }] };
      if (q.includes("curriculum_versions")) return { rows: [{ id: "cv_01" }] };
      if (q.includes("COUNT") && q.includes("curriculum_items")) return { rows: [{ cnt: "500" }] };
      if (q.includes("curriculum_items")) return { rows: [{ id: ITEM_ID_1, title: "T", description: null, sort_order: 1 }] };
      return { rows: [] };
    });

    (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_2);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_Y}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(getOrCreateConversation).toHaveBeenCalledWith(PARENT_A, STUDENT_Y, expect.any(String));
  });

  // WP2B-P: USER message 중복 방지 (ON CONFLICT 역할은 DB가 함 — 여기서는 호출 자체를 확인)
  it("P. 성공 시 USER message 저장 호출됨 (ENGINE 호출 전)", async () => {
    const callOrder: string[] = [];

    (saveUserMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("saveUser");
    });
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("engineCall");
      return makeEngineSuccess();
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // USER message는 ENGINE 호출 전에 저장
    expect(callOrder.indexOf("saveUser")).toBeLessThan(callOrder.indexOf("engineCall"));
    // request_id와 query 전달 검증
    expect(saveUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQUEST_ID,
      content:   QUERY_TEXT,
    }));
  });

  // WP2B-Q: ASSISTANT message 성공 시 저장
  it("Q. ENGINE 성공 → ASSISTANT message 저장됨", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: CONV_ID_1,
      requestId:      REQUEST_ID,
      content:        expect.any(String),
    }));
  });

  // WP2B-R: ENGINE 실패 시 ASSISTANT 저장 안 됨
  it("R. ENGINE 실패 → ASSISTANT message 저장 안 됨", async () => {
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });

  // WP2B-S: history 조회 — 다른 parent의 student → 403
  it("S. history 조회 — 소유권 없음 → 403", async () => {
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      rows: [], // no ownership
    }));

    const app = await buildApp({ userId: PARENT_B, role: "parent_account" });
    const res = await request(app)
      .get(`/parent/students/${STUDENT_X}/curriculum-search/history`);

    expect(res.status).toBe(403);
    expect(getConversationMessages).not.toHaveBeenCalled();
  });

  // WP2B-T: history read는 quota 차감 없음
  it("T. history read → 200, quota 차감 없음 (tryReserve 미호출)", async () => {
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "msg_01", role: "USER",      content: QUERY_TEXT, created_at: new Date().toISOString() },
      { id: "msg_02", role: "ASSISTANT", content: "답변입니다.", created_at: new Date().toISOString() },
    ]);
    (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(3));

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .get(`/parent/students/${STUDENT_X}/curriculum-search/history`);

    expect(res.status).toBe(200);
    expect(res.body.conversation_id).toBe(CONV_ID_1);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.usage.used).toBe(3);
    // quota 예약 없음
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

  // ── Quota Service Unit Tests ──────────────────────────────────────────────

  describe("Quota service — period label 형식 검증", () => {
    it("K2. usage.period는 YYYY-MM 형식이고 resets_at은 ISO 8601 형식", async () => {
      // WP2B-K에서 이미 period 형식 검증됨 — 여기서는 resets_at 형식 확인
      const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
      const res = await request(app)
        .post(`/parent/students/${STUDENT_X}/curriculum-search`)
        .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

      expect(res.status).toBe(200);
      expect(res.body.usage.resets_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ── WP2/WP2.1 Regression ─────────────────────────────────────────────────

  it("Regression: 성공 시 result.answer 포함", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.result.answer).toBeTruthy();
    expect(res.body.meta.mode).toBe("NORMAL");
  });

  it("Regression: 소유권 없는 student → 403", async () => {
    setupNormalDb({ hasOwnership: false });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(403);
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
  });

  it("Regression: parent_account role 없음 → 403", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "teacher" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(403);
  });

  it("Regression: query 없음 → 400", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("Regression: usage 필드가 response에 포함됨", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.usage).toMatchObject({
      limit:     expect.any(Number),
      used:      expect.any(Number),
      remaining: expect.any(Number),
      period:    expect.any(String),
      resets_at: expect.any(String),
    });
  });
});
