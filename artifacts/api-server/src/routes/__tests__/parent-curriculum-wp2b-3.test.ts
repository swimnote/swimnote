/**
 * parent-curriculum-wp2b-3.test.ts — WP2B.3: Atomic Success Finalization Fix
 *
 * A  정상 성공 → finalizeCurriculumSearchSuccess 1회 + 200
 * B  finalizeCurriculumSearchSuccess 실패 → 502 (HTTP 성공 반환 금지)
 * C  finalizeCurriculumSearchSuccess 실패 → rollbackQuotaReservation 미호출 (transaction rollback은 내부)
 * D  finalizeCurriculumSearchSuccess 실패 후 동일 request_id 재시도 → RESERVED 유지 → retry 가능
 * E  ENGINE 실패 → finalizeCurriculumSearchSuccess 미호출
 * F  COMPLETED replay → finalizeCurriculumSearchSuccess 미호출 (quota 차감 금지)
 * G  COMPLETED인데 assistant 없는 synthetic corruption → 500 (정상 성공 replay 금지)
 * H  FAILED retry → finalizeCurriculumSearchSuccess 1회 (기존 WP2B.2 동작 유지)
 * I  10/10 limit → finalizeCurriculumSearchSuccess 미호출 (quota 초과)
 * J  history read → finalizeCurriculumSearchSuccess 미호출 (GET 경로)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express                                   from "express";
import request                                   from "supertest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PARENT_A   = "pa_wp3_01";
const STUDENT_X  = "stu_wp3_01";
const POOL_ID    = "pool_wp3_01";
const POOL_NAME  = "WP3테스트수영장";
const ITEM_ID_1  = "ci_wp3_01";
const CONV_ID_1  = "conv_wp3_01";
const REQUEST_ID = "curriculum_req_wp2b3_01";
const QUERY_TEXT = "우리 아이 자유형 진도를 알려주세요";

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

vi.mock("../../lib/parent-curriculum-quota.js", () => ({
  MONTHLY_LIMIT:                   10,
  CURRICULUM_SEARCH_FEATURE:       "parent_curriculum_search",
  getPriorReservationStatus:       vi.fn(),
  tryReserveMonthlyQuota:          vi.fn(),
  finalizeCurriculumSearchSuccess: vi.fn(),  // WP2B.3 핵심
  finalizeQuotaSuccess:            vi.fn(),  // 참조용 (route 성공 경로에서 미호출)
  rollbackQuotaReservation:        vi.fn(),
  getMonthlyUsageInfo:             vi.fn(),
  getSeoulMonthPeriod:             vi.fn(),
  getSeoulPeriodLabel:             vi.fn(),
  getResetsAt:                     vi.fn(),
}));

vi.mock("../../lib/parent-curriculum-conversation.js", () => ({
  getOrCreateConversation:        vi.fn(),
  findConversation:               vi.fn(),
  saveUserMessage:                vi.fn(),
  saveAssistantMessage:           vi.fn(),  // 더 이상 route 성공 경로에서 직접 호출 안 됨
  touchConversation:              vi.fn(),
  getConversationMessages:        vi.fn(),
  getAssistantMessageByRequestId: vi.fn(),
}));

// ─── Import mocked modules ────────────────────────────────────────────────────

import { superAdminDb }                    from "@workspace/db";
import { resolvePoolMode }                 from "../../lib/xmode.js";
import { searchParentCurriculum }          from "../../lib/parent-curriculum-engine-client.js";
import {
  getPriorReservationStatus,
  tryReserveMonthlyQuota,
  finalizeCurriculumSearchSuccess,
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

function setupNormalDb() {
  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
    const q: string = typeof query?.sql === "string" ? query.sql
      : query?.queryChunks
        ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
        : String(query ?? "");
    if (q.includes("parent_students"))     return { rows: [{ swimming_pool_id: POOL_ID }] };
    if (q.includes("swimming_pools"))      return { rows: [{ name: POOL_NAME }] };
    if (q.includes("curriculum_versions")) return { rows: [{ id: "cv_wp3_01" }] };
    if (q.includes("COUNT") && q.includes("curriculum_items")) return { rows: [{ cnt: "300" }] };
    if (q.includes("curriculum_items"))    return { rows: [{ id: ITEM_ID_1, title: "자유형 발차기", description: null, sort_order: 1 }] };
    return { rows: [] };
  });
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeUsageInfo(used: number) {
  return {
    limit:     10,
    used,
    remaining: 10 - used,
    period:    "2026-08",
    resets_at: "2026-09-01T00:00:00.000Z",
  };
}

function makeEngineSuccess(requestId = REQUEST_ID) {
  return {
    request_id:     requestId,
    schema_version: "1.0",
    feature:        "parent_curriculum_search",
    result:         { answer: "자유형 발차기 2단계 학습 중입니다." },
    grounding:      { validation: "PASS", curriculum_ids: [ITEM_ID_1] },
  };
}

function makeStoredAssistantMessage() {
  return {
    id:         "msg_wp3_ast_01",
    role:       "ASSISTANT" as const,
    content:    "자유형 발차기 2단계 학습 중입니다.",
    created_at: "2026-08-14T10:00:00.000Z",
    metadata: {
      intent: null, mode: "NORMAL", curriculum_source: "pool_curriculum",
      result_payload: { answer: "자유형 발차기 2단계 학습 중입니다." },
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Pool mode: normal
  (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
    pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
  });

  // Prior state: NONE (normal fresh request)
  (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("NONE");
  (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

  // Conversation defaults
  (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
  (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
  (saveUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (saveAssistantMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (touchConversation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  // Quota defaults
  (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });
  (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (rollbackQuotaReservation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(1));

  // ENGINE default: success
  (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(makeEngineSuccess());

  setupNormalDb();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP2B.3: Atomic Success Finalization Fix", () => {

  // ── A. 정상 성공 → finalizeCurriculumSearchSuccess 1회 + 200 ────────────────
  it("A. 정상 성공 → finalizeCurriculumSearchSuccess 1회 호출 + 200", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    // 핵심 검증: atomic transaction 함수가 정확히 1회 호출됨
    expect(finalizeCurriculumSearchSuccess).toHaveBeenCalledTimes(1);
    expect(finalizeCurriculumSearchSuccess).toHaveBeenCalledWith(expect.objectContaining({
      parentId:         PARENT_A,
      requestId:        REQUEST_ID,
      conversationId:   CONV_ID_1,
      content:          expect.any(String),
      safeMetadataJson: expect.any(String),
    }));
    // rollback 없음
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
    // saveAssistantMessage 직접 호출 없음 (finalizeCurriculumSearchSuccess 내부 처리)
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });

  // ── A.1. safeMetadataJson에 result_payload 포함 ─────────────────────────────
  it("A.1. finalizeCurriculumSearchSuccess에 전달된 safeMetadataJson에 result_payload 포함", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    const callArg = (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsedMeta = JSON.parse(callArg.safeMetadataJson);
    expect(parsedMeta).toHaveProperty("result_payload");
    expect(parsedMeta.result_payload).toHaveProperty("answer");
  });

  // ── B. finalizeCurriculumSearchSuccess 실패 → 502 (HTTP 성공 반환 금지) ──────
  it("B. finalizeCurriculumSearchSuccess 실패 → 502 반환 (200 금지)", async () => {
    (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("FINALIZATION_FAILED");
    expect(res.body.retryable).toBe(true);
  });

  // ── B.1. finalization 실패 시 response에 answer 없음 ────────────────────────
  it("B.1. finalization 실패 시 response body에 result.answer 없음", async () => {
    (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB timeout"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(res.body.result).toBeUndefined();
  });

  // ── C. finalization 실패 → rollbackQuotaReservation 미호출 ──────────────────
  it("C. finalization 실패 → rollbackQuotaReservation 미호출 (transaction rollback은 내부)", async () => {
    // 설명: finalizeCurriculumSearchSuccess 내부에서 transaction rollback이 처리됨.
    // route는 별도로 rollbackQuotaReservation을 호출하지 않음.
    // → reservation은 RESERVED 유지 (quota 환불 row) → retry 가능.
    (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB error"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // rollback은 transaction 내부에서 자동 처리 → route에서 별도 호출 없음
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

  // ── D. finalization 실패 후 재시도 → 정상 처리 가능 ────────────────────────
  it("D. finalization 실패 후 동일 request_id 재시도 → RESERVED 유지로 retry 가능", async () => {
    // 1차: finalization 실패
    (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB error"),
    );
    // 2차: finalization 성공
    (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });

    const res1 = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });
    expect(res1.status).toBe(502);

    const res2 = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });
    expect(res2.status).toBe(200);

    // 총 2회 호출 (1차 실패 + 2차 성공)
    expect(finalizeCurriculumSearchSuccess).toHaveBeenCalledTimes(2);
  });

  // ── E. ENGINE 실패 → finalizeCurriculumSearchSuccess 미호출 ─────────────────
  it("E. ENGINE 실패 → finalizeCurriculumSearchSuccess 미호출 + rollback 호출", async () => {
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ENGINE timeout"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(502);
    expect(finalizeCurriculumSearchSuccess).not.toHaveBeenCalled();
    // ENGINE 실패 → quota rollback
    expect(rollbackQuotaReservation).toHaveBeenCalledTimes(1);
  });

  // ── F. COMPLETED replay → finalizeCurriculumSearchSuccess 미호출 ─────────────
  it("F. COMPLETED replay → finalizeCurriculumSearchSuccess 미호출 (quota 차감 금지)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStoredAssistantMessage(),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(finalizeCurriculumSearchSuccess).not.toHaveBeenCalled();
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // ── G. COMPLETED + assistant 없음 → 500 (정상 성공 위장 금지) ───────────────
  it("G. COMPLETED인데 assistant 없는 synthetic corruption → 500 (replay 금지)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    // COMPLETED이지만 ASSISTANT message 없음 → 데이터 무결성 오류
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // 정상 성공(200) 반환 금지 — invariant 위반
    expect(res.status).not.toBe(200);
    // ENGINE 재호출 금지
    expect(searchParentCurriculum).not.toHaveBeenCalled();
    // quota 재차감 금지
    expect(finalizeCurriculumSearchSuccess).not.toHaveBeenCalled();
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
  });

  // ── H. FAILED retry → finalizeCurriculumSearchSuccess 1회 ─────────────────
  it("H. FAILED retry → finalizeCurriculumSearchSuccess 1회 호출 (기존 WP2B.2 동작 유지)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("FAILED");
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(finalizeCurriculumSearchSuccess).toHaveBeenCalledTimes(1);
    expect(finalizeCurriculumSearchSuccess).toHaveBeenCalledWith(expect.objectContaining({
      parentId:  PARENT_A,
      requestId: REQUEST_ID,
    }));
  });

  // ── I. 10/10 limit → finalizeCurriculumSearchSuccess 미호출 ─────────────────
  it("I. 10/10 한도 초과 → 429, finalizeCurriculumSearchSuccess 미호출", async () => {
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      usageInfo: { limit: 10, used: 10, remaining: 0, period: "2026-08", resets_at: "2026-09-01T00:00:00.000Z" },
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(429);
    expect(finalizeCurriculumSearchSuccess).not.toHaveBeenCalled();
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // ── J. history read → finalizeCurriculumSearchSuccess 미호출 ─────────────────
  it("J. history GET → 200, finalizeCurriculumSearchSuccess 미호출 (GET 경로)", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .get(`/parent/students/${STUDENT_X}/curriculum-search/history`);

    expect(res.status).toBe(200);
    expect(finalizeCurriculumSearchSuccess).not.toHaveBeenCalled();
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

});
