/**
 * parent-curriculum-wp1-2.test.ts — WP1.2: Recent Conversation Context Support
 *
 * 검증 대상: POST /parent/students/:studentId/curriculum-search
 *   (ENGINE 전송 contract + route 동작)
 *
 * A  recent_conversation 없음 → engine request에 recent_conversation 미포함,
 *    conversation_context_used: false
 * B  이전 교환 있음 (평영 context) → engine request에 recent_conversation 포함,
 *    conversation_context_used: true
 * C  context 메시지 순서 보장 — 오래된 순 → 최신 순 (oldest → newest)
 * D  정확히 6개 → 6개 전부 엔진에 전달
 * H  recent_conversation 존재해도 grounding.curriculum_ids 검증 유지
 *    (ENGINE이 미허가 curriculum_id 반환 → 502)
 * I  ENGINE meta.conversation_context_used: true → 응답에 그대로 반영
 * J  회화 context 없는 기존 정상 성공 경로 회귀
 * K  buildRecentConversationContext fetch 실패 → [] 폴백 → 502 없이 성공
 *
 * 참고: 메시지 내부 validation (E: 7개 trim, F: invalid role, G: empty content)은
 *   buildRecentConversationContext 단위테스트(parent-curriculum-wp1-2-context.test.ts)에서 검증.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express                                   from "express";
import request                                   from "supertest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PARENT_A   = "pa_wp12_01";
const STUDENT_X  = "stu_wp12_01";
const POOL_ID    = "pool_wp12_01";
const POOL_NAME  = "WP1.2테스트수영장";
const ITEM_ID_1  = "ci_wp12_01";
const CONV_ID_1  = "conv_wp12_01";
const REQUEST_ID = "req_wp12_001";
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
  finalizeCurriculumSearchSuccess: vi.fn(),
  finalizeQuotaSuccess:            vi.fn(),
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
  saveAssistantMessage:           vi.fn(),
  touchConversation:              vi.fn(),
  getConversationMessages:        vi.fn(),
  getAssistantMessageByRequestId: vi.fn(),
  buildRecentConversationContext: vi.fn(), // WP1.2 핵심 mock
}));

// ─── Import mocked modules ────────────────────────────────────────────────────

import { superAdminDb }             from "@workspace/db";
import { resolvePoolMode }          from "../../lib/xmode.js";
import { searchParentCurriculum }   from "../../lib/parent-curriculum-engine-client.js";
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
  touchConversation,
  getAssistantMessageByRequestId,
  buildRecentConversationContext,
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
    if (q.includes("curriculum_versions")) return { rows: [{ id: "cv_wp12_01" }] };
    if (q.includes("COUNT") && q.includes("curriculum_items")) return { rows: [{ cnt: "300" }] };
    if (q.includes("curriculum_items"))    return { rows: [{ id: ITEM_ID_1, title: "자유형 발차기", description: null, sort_order: 1 }] };
    return { rows: [] };
  });
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeUsageInfo(used = 1) {
  return {
    limit: 10, used, remaining: 10 - used,
    period: "2026-08", resets_at: "2026-09-01T00:00:00.000Z",
  };
}

function makeEngineSuccess(extra?: Partial<any>) {
  return {
    request_id:     REQUEST_ID,
    schema_version: "1.0",
    feature:        "parent_curriculum_search",
    result:         { answer: "자유형 발차기 2단계 학습 중입니다." },
    grounding:      { validation: "PASS", curriculum_ids: [ITEM_ID_1] },
    ...extra,
  };
}

// ─── beforeEach defaults ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Pool mode: NORMAL
  (resolvePoolMode as ReturnType<typeof vi.fn>).mockResolvedValue({
    pool_id: POOL_ID, mode: "normal", xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED",
  });

  // Prior state: NONE (fresh request)
  (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("NONE");
  (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

  // Conversation defaults
  (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
  (findConversation as ReturnType<typeof vi.fn>).mockResolvedValue(CONV_ID_1);
  (saveUserMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (touchConversation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

  // WP1.2: 기본값 = 이전 대화 없음
  (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  // Quota defaults
  (tryReserveMonthlyQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, isRetry: false });
  (finalizeCurriculumSearchSuccess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (rollbackQuotaReservation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getMonthlyUsageInfo as ReturnType<typeof vi.fn>).mockResolvedValue(makeUsageInfo());

  // ENGINE: 기본 성공
  (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(makeEngineSuccess());

  setupNormalDb();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP1.2: Recent Conversation Context Support (route-level)", () => {

  // ── A. recent_conversation 없음 → engine request 미포함, context_used: false ──

  it("A. 이전 대화 없음 → recent_conversation 미포함, conversation_context_used: false", async () => {
    // buildRecentConversationContext returns [] (beforeEach default)
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);

    // ENGINE 호출 검증: context에 recent_conversation 없음
    expect(searchParentCurriculum).toHaveBeenCalledTimes(1);
    const engineReq = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineReq.context).not.toHaveProperty("recent_conversation");

    // meta.conversation_context_used: false
    expect(res.body.meta).toHaveProperty("conversation_context_used", false);
  });

  // ── B. 이전 대화 있음 → recent_conversation 포함, context_used: true ───────

  it("B. 이전 평영 context → recent_conversation 포함, conversation_context_used: true", async () => {
    const recentMessages = [
      { role: "USER",      content: "우리 아이 평영을 배우고 있어요. 지금 어떤 단계인가요?" },
      { role: "ASSISTANT", content: "현재 평영 킥 2단계를 학습 중입니다." },
    ];
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue(recentMessages);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: "그 다음은 뭘 배우나요?" });

    expect(res.status).toBe(200);

    // ENGINE 호출 검증: recent_conversation 포함
    const engineReq = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineReq.context.recent_conversation).toEqual(recentMessages);

    // meta.conversation_context_used: true
    expect(res.body.meta).toHaveProperty("conversation_context_used", true);
  });

  // ── C. context 순서 보장 — 오래된 순 → 최신 순 ─────────────────────────────

  it("C. recent_conversation 순서 = oldest → newest (buildRecentConversationContext가 보장한 순서 유지)", async () => {
    const ordered = [
      { role: "USER",      content: "첫 번째 질문" },
      { role: "ASSISTANT", content: "첫 번째 답변" },
      { role: "USER",      content: "두 번째 질문" },
    ];
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue(ordered);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    const engineReq = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineReq.context.recent_conversation).toEqual(ordered);
    // 첫 번째가 가장 오래된 메시지
    expect(engineReq.context.recent_conversation[0].role).toBe("USER");
    expect(engineReq.context.recent_conversation[0].content).toBe("첫 번째 질문");
    // 마지막이 가장 최신
    expect(engineReq.context.recent_conversation[2].content).toBe("두 번째 질문");
  });

  // ── D. 정확히 6개 → 6개 전부 엔진에 전달 ────────────────────────────────────

  it("D. 정확히 6개 메시지 → ENGINE에 6개 전달", async () => {
    const sixMessages = [
      { role: "USER",      content: "질문1" },
      { role: "ASSISTANT", content: "답변1" },
      { role: "USER",      content: "질문2" },
      { role: "ASSISTANT", content: "답변2" },
      { role: "USER",      content: "질문3" },
      { role: "ASSISTANT", content: "답변3" },
    ];
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue(sixMessages);

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    const engineReq = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineReq.context.recent_conversation).toHaveLength(6);
    expect(engineReq.context.recent_conversation).toEqual(sixMessages);
  });

  // ── H. grounding.curriculum_ids 검증 — context 있어도 유지 ──────────────────

  it("H. recent_conversation 있어도 미허가 curriculum_id 반환 시 502", async () => {
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "USER",      content: "평영 진도를 알려주세요." },
      { role: "ASSISTANT", content: "평영 킥 2단계 중입니다." },
    ]);

    // ENGINE이 허가되지 않은 curriculum_id 반환
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id:     REQUEST_ID,
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      result:         { answer: "어떤 답변" },
      grounding: {
        validation:     "PASS",
        curriculum_ids: ["UNKNOWN_ID_NOT_IN_SCOPE"],  // 미허가 id
      },
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // grounding 검증 실패 → 502
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("RESPONSE_VALIDATION_FAILED");
  });

  // ── I. ENGINE meta.conversation_context_used pass-through ────────────────────

  it("I. ENGINE meta.conversation_context_used: true → 응답에 반영", async () => {
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "USER", content: "이전 질문" },
    ]);
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ meta: { conversation_context_used: true, intent: "NEXT_STEP" } }),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: "그 다음은?" });

    expect(res.status).toBe(200);
    expect(res.body.meta.conversation_context_used).toBe(true);
  });

  it("I.2. ENGINE meta.conversation_context_used: false → false로 반영 (context 있어도 엔진 우선)", async () => {
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "USER", content: "이전 질문" },
    ]);
    (searchParentCurriculum as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEngineSuccess({ meta: { conversation_context_used: false } }),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    // ENGINE이 false를 명시하면 false
    expect(res.body.meta.conversation_context_used).toBe(false);
  });

  // ── J. 회화 context 없는 기존 정상 성공 경로 회귀 ─────────────────────────────

  it("J. 기존 정상 성공 경로 회귀 — context 없음, 200 + answer 포함", async () => {
    // buildRecentConversationContext = [] (beforeEach default)
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("request_id", REQUEST_ID);
    expect(res.body.result).toHaveProperty("answer");
    expect(res.body.usage).toHaveProperty("limit", 10);

    // finalizeCurriculumSearchSuccess 1회
    expect(finalizeCurriculumSearchSuccess).toHaveBeenCalledTimes(1);

    // buildRecentConversationContext가 호출됨 (CONV_ID_1, REQUEST_ID)
    expect(buildRecentConversationContext).toHaveBeenCalledWith(CONV_ID_1, REQUEST_ID);
  });

  // ── K. buildRecentConversationContext fetch 실패 → [] 폴백 → 정상 성공 ────────

  it("K. buildRecentConversationContext 실패 → 조용히 [] 폴백 → 502 없이 정상 응답", async () => {
    (buildRecentConversationContext as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // fetch 실패해도 [] 폴백으로 정상 진행
    expect(res.status).toBe(200);
    // recent_conversation 없이 ENGINE 호출됨
    const engineReq = (searchParentCurriculum as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineReq.context).not.toHaveProperty("recent_conversation");
    // conversation_context_used: false
    expect(res.body.meta.conversation_context_used).toBe(false);
  });

  // ── buildRecentConversationContext 호출 인자 검증 ─────────────────────────────

  it("buildRecentConversationContext가 올바른 인자(conversationId, requestId)로 호출됨", async () => {
    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    // conversationId: getOrCreateConversation 반환값, requestId: 현재 request_id
    expect(buildRecentConversationContext).toHaveBeenCalledWith(CONV_ID_1, REQUEST_ID);
  });

  // ── COMPLETED replay → buildRecentConversationContext 미호출 ─────────────────

  it("COMPLETED replay → buildRecentConversationContext 미호출 (기존 결과 직접 반환)", async () => {
    (getPriorReservationStatus as ReturnType<typeof vi.fn>).mockResolvedValue("COMPLETED");
    (getAssistantMessageByRequestId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id:         "msg_replay_01",
      role:       "ASSISTANT",
      content:    "자유형 발차기 2단계 학습 중입니다.",
      created_at: "2026-08-14T10:00:00.000Z",
      metadata: {
        intent: null, mode: "NORMAL", curriculum_source: "pool_curriculum",
        result_payload: { answer: "자유형 발차기 2단계 학습 중입니다." },
      },
    });

    const app = await buildApp({ userId: PARENT_A, role: "parent_account" });
    const res = await request(app)
      .post(`/parent/students/${STUDENT_X}/curriculum-search`)
      .send({ request_id: REQUEST_ID, query: QUERY_TEXT });

    expect(res.status).toBe(200);
    // COMPLETED replay 경로에서는 ENGINE 미호출
    expect(searchParentCurriculum).not.toHaveBeenCalled();
    // buildRecentConversationContext도 미호출 (replay = 기존 결과 직접 반환)
    expect(buildRecentConversationContext).not.toHaveBeenCalled();
  });
});
