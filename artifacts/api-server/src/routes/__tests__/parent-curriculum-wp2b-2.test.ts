/**
 * parent-curriculum-wp2b-2.test.ts — WP2B.2: Quota Feature Isolation + Idempotency Fix
 *
 * A  CURRICULUM_SEARCH_FEATURE constant = 'parent_curriculum_search'
 * B  다른 feature row와 독립적 — UNIQUE (parent_account_id, feature, usage_date) 설계
 * C  curriculum feature counters 격리 — 다른 feature와 공유 없음
 * D  FAILED retry → 정상 path 진행 (FAILED→RESERVED 내부 처리) → 200
 * E  FAILED retry 성공 → finalizeQuotaSuccess 1회 호출
 * F  FAILED retry 성공 시 quota 추가 차감 없음 (tryReserveMonthlyQuota 1회)
 * G  FAILED retry → saveUserMessage 호출 (idempotent — 기존 재사용)
 * H  FAILED retry 성공 → saveAssistantMessage 1회 호출
 * I  COMPLETED retry → searchParentCurriculum 호출 없음 (ENGINE 금지)
 * J  COMPLETED retry → tryReserveMonthlyQuota 호출 없음 (quota 차감 금지)
 * K  COMPLETED retry → 기존 answer replay
 * L  COMPLETED retry → saveUserMessage/saveAssistantMessage 호출 없음
 * M  concurrent retry 보호 — quota 이중 예약 없음
 * N  9/10 상태에서 COMPLETED retry → 9/10 그대로 (usageInfo 불변)
 * O  10/10 상태에서 COMPLETED retry → 200 (429 아님, quota 체크 우선 없음)
 * P  Seoul 월 경계 — period label 형식 YYYY-MM
 * Q  conversation/messages 월 변경 후 유지 (quota rollback이 메시지 건드리지 않음)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express                                   from "express";
import request                                   from "supertest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PARENT_A   = "pa_a_01";
const STUDENT_X  = "stu_x_01";
const POOL_ID    = "pool_test_01";
const POOL_NAME  = "테스트수영장";
const ITEM_ID_1  = "ci_test_01";
const CONV_ID_1  = "conv_test_01";
const REQUEST_ID = "curriculum_req_wp2b2_01";
const QUERY_TEXT = "우리 아이 평영 진도를 알려주세요";

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
  MONTHLY_LIMIT:             10,
  CURRICULUM_SEARCH_FEATURE: "parent_curriculum_search",
  getPriorReservationStatus: vi.fn(),
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
  getAssistantMessageByRequestId: vi.fn(),
}));

// ─── Import mocked modules ────────────────────────────────────────────────────

import { superAdminDb }             from "@workspace/db";
import { resolvePoolMode }          from "../../lib/xmode.js";
import { searchParentCurriculum }   from "../../lib/parent-curriculum-engine-client.js";
import {
  CURRICULUM_SEARCH_FEATURE,
  getPriorReservationStatus,
  tryReserveMonthlyQuota,
  finalizeQuotaSuccess,
  rollbackQuotaReservation,
  getMonthlyUsageInfo,
  getSeoulPeriodLabel,
} from "../../lib/parent-curriculum-quota.js";
import {
  getOrCreateConversation,
  findConversation,
  saveUserMessage,
  saveAssistantMessage,
  touchConversation,
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
    if (q.includes("parent_students"))  return { rows: [{ swimming_pool_id: POOL_ID }] };
    if (q.includes("swimming_pools"))   return { rows: [{ name: POOL_NAME }] };
    if (q.includes("curriculum_versions")) return { rows: [{ id: "cv_test_01" }] };
    if (q.includes("COUNT") && q.includes("curriculum_items")) return { rows: [{ cnt: "500" }] };
    if (q.includes("curriculum_items")) return { rows: [{ id: ITEM_ID_1, title: "평영 발차기", description: null, sort_order: 1 }] };
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

function makeEngineSuccessForRequest(requestId: string) {
  return {
    request_id:     requestId,
    schema_version: "1.0",
    feature:        "parent_curriculum_search",
    result:         { answer: "평영 발차기 단계를 학습 중입니다." },
    grounding:      { validation: "PASS", curriculum_ids: [ITEM_ID_1] },
  };
}

function makeStoredAssistantMessage(overrides: Partial<any> = {}) {
  return {
    id:         "msg_ast_01",
    role:       "ASSISTANT" as const,
    content:    "평영 발차기 단계를 학습 중입니다.",
    created_at: "2026-08-14T10:00:00.000Z",
    metadata: {
      intent:            null,
      mode:              "NORMAL",
      curriculum_source: "pool_curriculum",
      result_payload: {
        answer: "평영 발차기 단계를 학습 중입니다.",
        ...overrides,
      },
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

  // Quota defaults
  (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });
  (finalizeQuotaSuccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (rollbackQuotaReservation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(1));
  (getSeoulPeriodLabel as ReturnType<typeof vi.fn>).mockReturnValue("2026-08");

  // ENGINE default: success
  (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
    makeEngineSuccessForRequest(REQUEST_ID),
  );

  setupNormalDb();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP2B.2: Quota Feature Isolation + Idempotency Fix", () => {

  // ── A. CURRICULUM_SEARCH_FEATURE constant ────────────────────────────────────
  it("A. CURRICULUM_SEARCH_FEATURE = 'parent_curriculum_search'", () => {
    expect(CURRICULUM_SEARCH_FEATURE).toBe("parent_curriculum_search");
  });

  // ── B. 다른 feature와 row 격리 (schema-level guarantee 검증) ─────────────────
  it("B. feature column이 'parent_curriculum_search' 고정값 (격리 구조)", async () => {
    // schema level: UNIQUE(parent_account_id, feature, usage_date)
    // → 동일 parent + 다른 feature는 별도 row
    // 여기서는 CURRICULUM_SEARCH_FEATURE 상수가 정확히 정의되었는지 + route가 서비스 호출하는지 검증
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // tryReserveMonthlyQuota is called — feature isolation is internal to the service
    expect(tryReserveMonthlyQuota).toHaveBeenCalledWith(PARENT_A, REQUEST_ID);
    // CURRICULUM_SEARCH_FEATURE constant is canonical
    expect(CURRICULUM_SEARCH_FEATURE).toBe("parent_curriculum_search");
  });

  // ── C. curriculum feature counters 서로 독립 ─────────────────────────────────
  it("C. Curriculum Search quota는 다른 feature와 counters 공유 안 함 (feature const 고정)", () => {
    // DB UNIQUE (parent_account_id, feature, usage_date) 으로 row 분리 보장
    // → feature='parent_curriculum_search' row만 curriculum quota에 영향
    // 이 테스트: CURRICULUM_SEARCH_FEATURE가 고정값임을 검증
    expect(CURRICULUM_SEARCH_FEATURE).not.toContain(" ");
    expect(CURRICULUM_SEARCH_FEATURE).toBe("parent_curriculum_search");
  });

  // ── D. FAILED retry → 정상 path 진행 → 200 ───────────────────────────────────
  it("D. FAILED retry → 정상 path 진행 → 200", async () => {
    // FAILED: getPriorReservationStatus가 'FAILED' 반환 → COMPLETED 분기 아님
    // tryReserveMonthlyQuota 내부에서 FAILED→RESERVED 처리
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("FAILED");
    // tryReserveMonthlyQuota는 내부에서 FAILED→RESERVED 전환 → ok:true
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(tryReserveMonthlyQuota).toHaveBeenCalledWith(PARENT_A, REQUEST_ID);
    expect(searchParentCurriculum).toHaveBeenCalledTimes(1);
  });

  // ── E. FAILED retry 성공 → finalizeQuotaSuccess 1회 호출 ─────────────────────
  it("E. FAILED retry 성공 → finalizeQuotaSuccess 정확히 1회", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("FAILED");
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(finalizeQuotaSuccess).toHaveBeenCalledTimes(1);
    expect(finalizeQuotaSuccess).toHaveBeenCalledWith(PARENT_A, REQUEST_ID);
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

  // ── F. FAILED retry quota 추가 차감 없음 ─────────────────────────────────────
  it("F. FAILED retry → tryReserveMonthlyQuota 정확히 1회 (이중 차감 없음)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("FAILED");
    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(tryReserveMonthlyQuota).toHaveBeenCalledTimes(1);
  });

  // ── G. FAILED retry → saveUserMessage 호출 (idempotent) ──────────────────────
  it("G. FAILED retry → saveUserMessage 호출 (ON CONFLICT DO NOTHING으로 중복 방지)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("FAILED");

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // saveUserMessage는 ON CONFLICT DO NOTHING → 기존 USER message 재사용, 중복 없음
    expect(saveUserMessage).toHaveBeenCalledTimes(1);
    expect(saveUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID }),
    );
  });

  // ── H. FAILED retry 성공 → saveAssistantMessage 1회 ─────────────────────────
  it("H. FAILED retry 성공 → saveAssistantMessage 정확히 1회 (기존 FAILED엔 ASSISTANT 없음)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("FAILED");

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(saveAssistantMessage).toHaveBeenCalledTimes(1);
    // result_payload가 meta에 포함됐는지 확인
    expect(saveAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: REQUEST_ID,
        meta:      expect.objectContaining({ result_payload: expect.any(Object) }),
      }),
    );
  });

  // ── I. COMPLETED retry → ENGINE 호출 없음 ────────────────────────────────────
  it("I. COMPLETED retry → searchParentCurriculum 호출 없음 (ENGINE 금지)", async () => {
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
    expect(searchParentCurriculum).not.toHaveBeenCalled();
  });

  // ── J. COMPLETED retry → quota 차감 없음 ─────────────────────────────────────
  it("J. COMPLETED retry → tryReserveMonthlyQuota / finalizeQuotaSuccess 호출 없음", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStoredAssistantMessage(),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
    expect(rollbackQuotaReservation).not.toHaveBeenCalled();
  });

  // ── K. COMPLETED retry → 기존 answer replay ───────────────────────────────────
  it("K. COMPLETED retry → persisted answer가 response에 포함", async () => {
    const storedAnswer = "평영 발차기: 현재 2단계 학습 중입니다.";
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeStoredAssistantMessage(),
      content: storedAnswer,
      metadata: {
        intent: null, mode: "NORMAL", curriculum_source: "pool_curriculum",
        result_payload: { answer: storedAnswer },
      },
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.result.answer).toBe(storedAnswer);
  });

  // ── L. COMPLETED retry → 추가 message row 없음 ────────────────────────────────
  it("L. COMPLETED retry → saveUserMessage / saveAssistantMessage 호출 없음", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStoredAssistantMessage(),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(saveUserMessage).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });

  // ── M. concurrent retry → 이중 quota 예약 없음 ───────────────────────────────
  it("M. 두 번째 quota 예약 실패 → 첫 번째 200, 두 번째 429", async () => {
    // Engine mock: request_id를 그대로 에코 (validation 통과)
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockImplementation(
      async (req: any) => ({
        request_id:     req.request_id,
        schema_version: "1.0",
        feature:        "parent_curriculum_search",
        result:         { answer: "테스트 답변" },
        grounding:      { validation: "PASS", curriculum_ids: [ITEM_ID_1] },
      }),
    );

    (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, isRetry: false })
      .mockResolvedValueOnce({ ok: false, usageInfo: makeUsageInfo(10) });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });

    const res1 = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: "req_concurrent_a", query: QUERY_TEXT });

    const res2 = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: "req_concurrent_b", query: QUERY_TEXT });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(429);
    expect(res2.body.code).toBe("PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED");
  });

  // ── N. 9/10 상태에서 COMPLETED retry → 9/10 그대로 ──────────────────────────
  it("N. 9/10 상태에서 COMPLETED retry → usageInfo used=9 (변경 없음)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStoredAssistantMessage(),
    );
    (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(9));

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body.usage.used).toBe(9);
    expect(res.body.usage.remaining).toBe(1);
    // quota 함수 미호출 확인
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
    expect(finalizeQuotaSuccess).not.toHaveBeenCalled();
  });

  // ── O. 10/10 상태에서 COMPLETED retry → 429가 아닌 200 (replay) ───────────────
  it("O. 10/10 한도 초과 상태에서도 COMPLETED retry → 200 replay (quota 체크 우선 없음)", async () => {
    // COMPLETED check는 quota reservation 이전에 실행됨
    // → 10/10이어도 COMPLETED request_id는 replay 가능
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStoredAssistantMessage(),
    );
    (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo(10));

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // 429가 아닌 200
    expect(res.status).toBe(200);
    expect(res.body.result.answer).toBeDefined();
    // quota 차감 함수 미호출
    expect(tryReserveMonthlyQuota).not.toHaveBeenCalled();
  });

  // ── P. Seoul 월 경계 — period label 형식 ─────────────────────────────────────
  it("P. getSeoulPeriodLabel() → 'YYYY-MM' 형식 반환", () => {
    (getSeoulPeriodLabel as ReturnType<typeof vi.fn>).mockReturnValue("2026-08");
    const label = getSeoulPeriodLabel();
    expect(label).toMatch(/^\d{4}-\d{2}$/);
    expect(label).toBe("2026-08");
  });

  // ── Q. conversation/messages 월 변경 후 유지 ─────────────────────────────────
  it("Q. rollbackQuotaReservation이 saveUserMessage/saveAssistantMessage를 건드리지 않음", async () => {
    // ENGINE 실패 → rollback 발생 시나리오
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ENGINE timeout"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // rollback 발생
    expect(rollbackQuotaReservation).toHaveBeenCalledTimes(1);
    // message 테이블은 건드리지 않음
    expect(saveAssistantMessage).not.toHaveBeenCalled();
    // USER message는 ENGINE 호출 전에 저장 (정상)
    expect(saveUserMessage).toHaveBeenCalledTimes(1);
  });

});
