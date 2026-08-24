/**
 * parent-curriculum.ts — WP2 / WP2.1 / WP2B / WP2B.2 / WP2B.3 / WP1.2 / WP-B / WP-D
 *
 * Routes:
 *   POST /parent/students/:studentId/curriculum-search/conversations   (WP-D: 새 대화 생성)
 *   GET  /parent/students/:studentId/curriculum-search/conversations   (WP-D: 대화 목록)
 *   POST /parent/students/:studentId/curriculum-search
 *   GET  /parent/students/:studentId/curriculum-search/history
 *
 * POST Flow (WP-B canonical order):
 *   1. Parent JWT 인증
 *   2. Parent↔Student 소유권 확인
 *   3. request_id prior state 확인 (getPriorReservationStatus)
 *      IF COMPLETED → persisted result replay → RETURN (quota 차감 없음, ENGINE 금지)
 *   4. Conversation 조회/생성
 *   5. Pool 이름 + mode 판정
 *   6. Normal mode → CURRICULUM_NOT_AVAILABLE (quota 0)
 *   7. x_pending → CURRICULUM_SEARCH_NOT_ELIGIBLE (quota 0)
 *   8. Curriculum Scope 구성 (X 모드 only; 300개 미만 → NOT_READY)
 *   9. WP-A: Intent Parser
 *   10. WP-A: Evidence Retriever
 *   11. WP-A: Progress Resolver
 *   12. WP-A: Answer Builder → answer_mode 결정
 *   13. answer_mode 분기:
 *       DIRECT_DB  → save messages, return deterministic answer (quota 0)
 *       HUMAN_ONLY → save messages, return safe answer (quota 0)
 *       GROUNDED_GPT → continue ↓
 *   14. Monthly quota 확인 + 예약 (GROUNDED_GPT only)
 *   15. USER message 저장
 *   16. Recent conversation context 구성
 *   17. ENGINE 호출 (GROUNDED_GPT only)
 *   18. Response 검증 (overclaim 포함)
 *   19. 성공: finalizeCurriculumSearchSuccess (atomic transaction)
 *   20. 실패: quota rollback
 *   21. 사용량 포함 안전한 응답 반환
 *
 * 금지:
 *   - GPT 직접 호출
 *   - Knowledge DB 검색
 *   - Prompt 작성
 *   - 수영 지식 판단
 *   - 다른 수영장 curriculum 참조
 *   - 오래된 TRACKED만으로 COMPLETED 판정
 */

import { Router }         from "express";
import { superAdminDb }   from "@workspace/db";
import { sql }            from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { resolvePoolMode }               from "../lib/xmode.js";
import {
  buildXCurriculumScope,
  buildStudentProgress,
  CurriculumScopeError,
} from "../lib/parent-curriculum-scope-builder.js";
import {
  searchParentCurriculum,
  ParentCurriculumEngineError,
  PC_SCHEMA_VERSION,
  PC_FEATURE,
  type ParentCurriculumEngineRequest,
  type ParentCurriculumEngineResponse,
} from "../lib/parent-curriculum-engine-client.js";
import {
  getPriorReservationStatus,
  tryReserveMonthlyQuota,
  finalizeCurriculumSearchSuccess,
  rollbackQuotaReservation,
  getMonthlyUsageInfo,
  MONTHLY_LIMIT,
} from "../lib/parent-curriculum-quota.js";
import {
  getOrCreateConversation,
  createConversation,
  listConversations,
  getConversationWithOwnership,
  findConversation,
  saveUserMessage,
  saveAssistantMessage,
  touchConversation,
  getConversationMessages,
  getAssistantMessageByRequestId,
  buildRecentConversationContext,
  updateConversationTitleIfBlank,
} from "../lib/parent-curriculum-conversation.js";
import { saveAiTrace }  from "../lib/ai-trace-service.js";
import { AI_FEATURE }   from "../lib/ai-feature-enum.js";

// ── WP-A lib imports ───────────────────────────────────────────────────────────
import { parseIntent }                   from "../lib/curriculum-intent-parser.js";
import { retrieveEvidence }              from "../lib/curriculum-evidence-retriever.js";
import { resolveProgress, type CurriculumItemRef } from "../lib/curriculum-progress-resolver.js";
import { buildGroundedPackage, type GroundedPackage } from "../lib/curriculum-answer-builder.js";

const router = Router();

// ─── Middleware ────────────────────────────────────────────────────────────────

function requireParent(req: AuthRequest, res: any, next: any): void {
  if (!req.user || req.user.role !== "parent_account") {
    res.status(403).json({ error: "학부모 계정만 접근 가능합니다." });
    return;
  }
  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ValidationResult {
  valid:   boolean;
  reason?: string;
}

/**
 * Engine 응답 검증.
 * §20 Overclaim 방지: Engine이 NOT_CONFIRMED 항목을 COMPLETED로 승격할 수 없음.
 * APP deterministic progress가 authority.
 */
function validateEngineResponse(
  response:             ParentCurriculumEngineResponse,
  requestId:            string,
  allowedCurriculumIds: Set<string>,
  groundedPackage?:     GroundedPackage,
): ValidationResult {
  if (response.request_id !== requestId) {
    return { valid: false, reason: "request_id mismatch" };
  }
  if (response.schema_version !== PC_SCHEMA_VERSION) {
    return { valid: false, reason: `unsupported schema_version: ${response.schema_version}` };
  }
  if (response.feature !== PC_FEATURE) {
    return { valid: false, reason: `feature mismatch: ${response.feature}` };
  }
  if (typeof response.result?.answer !== "string" || !response.result.answer) {
    return { valid: false, reason: "result.answer missing or empty" };
  }
  if (response.grounding?.validation !== "PASS") {
    return { valid: false, reason: `grounding.validation=${response.grounding?.validation}` };
  }
  const returnedIds: string[] = response.grounding?.curriculum_ids ?? [];
  for (const id of returnedIds) {
    if (!allowedCurriculumIds.has(id)) {
      return { valid: false, reason: `ENGINE returned unknown curriculum_id: ${id}` };
    }
  }

  // §20 Overclaim 검증: Engine이 NOT_CONFIRMED 항목을 COMPLETED로 승격 금지
  if (groundedPackage) {
    const notConfirmedIds = new Set(
      groundedPackage.progress_state.entries
        .filter((e) => e.status === "NOT_CONFIRMED")
        .map((e) => e.curriculum_item_id),
    );
    // Engine이 반환한 curriculum_ids 중 APP이 NOT_CONFIRMED로 판정한 항목이 포함되면
    // current_progress로 사용된 것 — 유일하게 의심스러운 경우만 warn으로 처리
    // (Engine이 curriculum_id를 단순 언급할 수 있으므로 hard-fail은 하지 않되 로그 기록)
    const overclaimed = returnedIds.filter((id) => notConfirmedIds.has(id));
    if (overclaimed.length > 0) {
      console.warn(
        `[parent-curriculum] ENGINE referenced NOT_CONFIRMED items as grounding: ${overclaimed.join(", ")} — APP progress state is authority`,
      );
    }
  }

  return { valid: true };
}

/**
 * DIRECT_DB 경로 deterministic 답변 생성.
 * GPT 호출 없음. 완전 결정론적.
 */
function formatDirectAnswer(pkg: GroundedPackage): string {
  const { intent, meta } = pkg;

  // 레벨 정보
  if (intent.intent === "LEVEL_PROGRESS" && meta.has_level_history) {
    const levelHistory = pkg.evidence.level_history;
    if (levelHistory.length > 0) {
      const latest = levelHistory[levelHistory.length - 1];
      return `현재 ${latest.level ?? "해당 레벨"} 레벨입니다. (${latest.achieved_date} 달성)`;
    }
    return "레벨 정보가 DB에 기록되어 있습니다. 담당 선생님께 확인하시면 정확한 레벨을 안내받을 수 있습니다.";
  }

  // 최근 수업
  if (intent.intent === "RECENT_LESSONS") {
    const current = pkg.curriculum_current;
    if (current) {
      return `최근 수업에서는 '${current.title}' 항목을 중심으로 진행되었습니다.`;
    }
    return "최근 수업 기록이 아직 없습니다. 일지가 작성되면 확인할 수 있습니다.";
  }

  // evidence 없음 fallback
  if (!meta.has_tracked_evidence && !meta.has_level_history) {
    return "아직 기록된 수업 데이터가 없습니다. 수업이 진행되고 일지가 작성되면 커리큘럼 진도를 확인할 수 있습니다.";
  }

  // generic DIRECT_DB fallback
  return "현재 수업 기록을 기반으로 확인한 결과, 아직 커리큘럼 진행 데이터가 충분하지 않습니다. 담당 선생님께 문의하시면 상세 정보를 받을 수 있습니다.";
}

/**
 * HUMAN_ONLY 경로 고정 안전 안내.
 */
const HUMAN_ONLY_ANSWER =
  "진급 시점이나 다음 단계 전환 여부는 실제 수업 수행 상태와 담당 선생님의 판단이 필요합니다. " +
  "정확한 진급 일정은 담당 선생님께 직접 문의해 주세요.";

// ─── WP-D: POST /conversations — 새 대화 생성 ─────────────────────────────────

/**
 * POST /parent/students/:studentId/curriculum-search/conversations
 *
 * 새 conversation 생성. AI 호출 없음. quota 차감 없음.
 * 초기 title: null (첫 USER message 저장 시 자동 생성).
 *
 * Response: { id, title, created_at }
 */
router.post(
  "/parent/students/:studentId/curriculum-search/conversations",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    const ownershipResult = await superAdminDb.execute(sql`
      SELECT ps.swimming_pool_id
      FROM parent_students ps
      WHERE ps.parent_id  = ${parentId}
        AND ps.student_id = ${studentId}
        AND ps.status     = 'approved'
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    if (!ownershipResult.rows.length) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }

    const poolId = (ownershipResult.rows[0] as any).swimming_pool_id as string;

    const conversationId = await createConversation(parentId, studentId, poolId, null)
      .catch((err) => {
        console.error("[parent-curriculum] createConversation failed:", err?.message);
        return null as string | null;
      });

    if (!conversationId) {
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    res.json({
      id:         conversationId,
      title:      null,
      created_at: new Date().toISOString(),
    });
  },
);

// ─── WP-D: GET /conversations — 대화 목록 ─────────────────────────────────────

/**
 * GET /parent/students/:studentId/curriculum-search/conversations
 *
 * 해당 parent/student의 conversation 목록 반환.
 * quota 차감 없음. AI 호출 없음.
 *
 * Response: { conversations: ConversationListItem[] }
 */
router.get(
  "/parent/students/:studentId/curriculum-search/conversations",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    const ownershipResult = await superAdminDb.execute(sql`
      SELECT ps.swimming_pool_id
      FROM parent_students ps
      WHERE ps.parent_id  = ${parentId}
        AND ps.student_id = ${studentId}
        AND ps.status     = 'approved'
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    if (!ownershipResult.rows.length) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }

    const poolId = (ownershipResult.rows[0] as any).swimming_pool_id as string;

    const conversations = await listConversations(parentId, studentId, poolId)
      .catch((err) => {
        console.error("[parent-curriculum] listConversations failed:", err?.message);
        return [] as Awaited<ReturnType<typeof listConversations>>;
      });

    res.json({ conversations });
  },
);

// ─── POST: Curriculum Search ───────────────────────────────────────────────────

/**
 * POST /parent/students/:studentId/curriculum-search
 *
 * Body: { request_id: string, query: string, conversation_id?: string }
 *
 * WP-D: conversation_id optional additive field.
 *   - 있음: ownership 검증 후 해당 conversation 사용
 *   - 없음: 구버전 fallback (getOrCreateConversation)
 */
router.post(
  "/parent/students/:studentId/curriculum-search",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    // ── Request 유효성 검사 ──────────────────────────────────────────────────
    // WP-D: conversation_id optional additive field
    const { request_id, query, conversation_id } = req.body ?? {};

    if (typeof request_id !== "string" || !request_id.trim()) {
      res.status(400).json({ error: "request_id 필수", code: "INVALID_REQUEST" });
      return;
    }
    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({ error: "query 필수", code: "INVALID_REQUEST" });
      return;
    }

    const trimmedRequestId  = request_id.trim();
    const trimmedQuery      = query.trim();
    const clientConvId: string | null =
      typeof conversation_id === "string" && conversation_id.trim()
        ? conversation_id.trim()
        : null;

    // ── 1. Parent↔Student 소유권 확인 ────────────────────────────────────────
    const ownershipResult = await superAdminDb.execute(sql`
      SELECT ps.swimming_pool_id
      FROM parent_students ps
      WHERE ps.parent_id  = ${parentId}
        AND ps.student_id = ${studentId}
        AND ps.status     = 'approved'
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    if (!ownershipResult.rows.length) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }

    const poolId = (ownershipResult.rows[0] as any).swimming_pool_id as string;

    // ── 2. request_id prior state 확인 ───────────────────────────────────────
    //
    // COMPLETED: ENGINE 재호출 금지, quota 차감 금지.
    // 기존 persisted result 반환 (10/10 한도에서도 replay 가능).
    // DIRECT_DB/HUMAN_ONLY는 COMPLETED 상태가 되지 않으므로 replay 대상 아님.
    //
    // FAILED / RESERVED / NONE: 아래 정상 flow 진행.
    const priorStatus = await getPriorReservationStatus(trimmedRequestId).catch(() => "NONE" as const);

    if (priorStatus === "COMPLETED") {
      // COMPLETED replay path (GROUNDED_GPT 성공만 COMPLETED 상태) ───────────
      const convId = await findConversation(parentId, studentId).catch(() => null);
      const assistantMsg = convId
        ? await getAssistantMessageByRequestId(convId, trimmedRequestId).catch(() => null)
        : null;

      if (!assistantMsg) {
        console.error(
          `[parent-curriculum] COMPLETED ${trimmedRequestId} has no assistant message — internal inconsistency`,
        );
        res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
        return;
      }

      const answer      = assistantMsg.content;
      const rp          = assistantMsg.metadata?.result_payload;
      const mode        = (assistantMsg.metadata?.mode ?? "NORMAL") as string;
      const answerMode  = (assistantMsg.metadata as any)?.answer_mode ?? "GROUNDED_GPT";
      const intentName  = (assistantMsg.metadata as any)?.intent_name ?? null;
      const usageInfo   = await getMonthlyUsageInfo(parentId).catch(() => ({
        limit:     MONTHLY_LIMIT,
        used:      -1,
        remaining: -1,
        period:    "",
        resets_at: "",
      }));

      res.json({
        request_id: trimmedRequestId,
        result: {
          answer,
          ...(rp?.current_progress ? { current_progress: rp.current_progress } : {}),
          ...(rp?.next_step        ? { next_step: rp.next_step }               : {}),
        },
        meta:  { mode, answer_mode: answerMode, intent: intentName },
        usage: usageInfo,
      });
      return;
    }

    // ── 3. Conversation 조회/생성 (WP-D) ─────────────────────────────────────
    //
    // conversation_id 있음: ownership 검증 → 해당 conversation 사용
    // conversation_id 없음: 구버전 fallback — 최신 active conversation 또는 신규 생성
    let conversationId: string | null = null;

    if (clientConvId) {
      // WP-D: client가 명시한 conversation — ownership 재검증
      const conv = await getConversationWithOwnership(clientConvId, parentId, studentId, poolId)
        .catch(() => null);
      if (!conv) {
        res.status(403).json({ error: "대화를 찾을 수 없거나 접근 권한이 없습니다.", code: "FORBIDDEN" });
        return;
      }
      conversationId = conv.id;
    } else {
      // 구버전 fallback: ON CONFLICT 없는 SELECT-first + INSERT
      conversationId = await getOrCreateConversation(parentId, studentId, poolId)
        .catch((err) => {
          console.error("[parent-curriculum] conversation fallback failed:", err?.message);
          return null as string | null;
        });
    }

    if (!conversationId) {
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    // ── 4. Pool 이름 조회 ─────────────────────────────────────────────────────
    const poolResult = await superAdminDb.execute(sql`
      SELECT name
      FROM swimming_pools
      WHERE id = ${poolId}
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    const poolName = ((poolResult.rows[0] as any)?.name as string | null) ?? poolId;

    // ── 5. Pool mode 판정 ─────────────────────────────────────────────────────
    const modeResult = await resolvePoolMode(poolId);

    if (!modeResult) {
      res.status(404).json({ error: "수영장을 찾을 수 없습니다.", code: "POOL_NOT_FOUND" });
      return;
    }

    const poolMode = modeResult.mode;

    // ── 6. Normal mode 차단 (§3) ─────────────────────────────────────────────
    //
    // Normal SWIMNOTE 학부모는 커리큘럼 AI 검색을 실행하지 않는다.
    // AI Engine/GPT 호출 0, quota 차감 0.
    if (poolMode === "normal") {
      res.status(422).json({
        error: "현재 수영장에 AI 검색용 커리큘럼이 등록되어 있지 않아 커리큘럼 AI 검색을 이용할 수 없습니다.",
        code:  "CURRICULUM_NOT_AVAILABLE",
      });
      return;
    }

    // ── 7. x_pending 차단 ────────────────────────────────────────────────────
    if (poolMode === "x_pending") {
      res.status(422).json({
        error: "AI 커리큘럼 검색이 아직 준비 중입니다.",
        code:  "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      });
      return;
    }

    // ── 8. Curriculum Scope 구성 (X 모드 only) ───────────────────────────────
    //
    // §4: curriculum_items >= 300 엄격 적용.
    // Production에 X curriculum_items가 없으면 정상적으로 NOT_READY 처리.
    // 500/502 금지.
    let curriculumScope;
    try {
      curriculumScope = await buildXCurriculumScope(poolId);
    } catch (err) {
      if (err instanceof CurriculumScopeError) {
        if (err.code === "CURRICULUM_SEARCH_NOT_ELIGIBLE" ||
            err.code === "NO_ACTIVE_CURRICULUM_VERSION") {
          res.status(422).json({
            error: "AI 커리큘럼 검색이 아직 준비 중입니다. (커리큘럼 데이터 부족)",
            code:  "CURRICULUM_NOT_READY",
          });
          return;
        }
      }
      console.error("[parent-curriculum] scope builder error:", (err as Error).message);
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    const allowedCurriculumIds = new Set(
      curriculumScope.curriculum_items.map((item) => item.id),
    );

    // CurriculumItemRef 형식으로 변환 (WP-A resolver 입력)
    const curriculumItemRefs: CurriculumItemRef[] = curriculumScope.curriculum_items.map((item) => ({
      id:         item.id,
      title:      item.title,
      sort_order: item.order,
    }));

    // ── 9. WP-A: Intent Parser ────────────────────────────────────────────────
    const parsedIntent = parseIntent(trimmedQuery);

    // ── 10. WP-A: Evidence Retriever ─────────────────────────────────────────
    // productionEvidenceDb 기본값 사용 (테스트에서는 mock 주입)
    const emptyBundle = {
      direct:       [] as any[],
      tracked:      [] as any[],
      inferred:     [] as any[],
      level_history: [] as any[],
      retrieved_at: new Date().toISOString(),
    };
    const evidenceBundle = await retrieveEvidence(studentId, poolId)
      .catch((err) => {
        console.error("[parent-curriculum] evidence retrieval failed:", err?.message);
        return emptyBundle;
      });

    // ── 11. WP-A: Progress Resolver ──────────────────────────────────────────
    const progressResolution = resolveProgress(evidenceBundle, curriculumItemRefs);

    // ── 12. WP-A: Answer Builder → answer_mode 결정 ──────────────────────────
    const groundedPackage = buildGroundedPackage(
      studentId,
      trimmedQuery,
      parsedIntent,
      evidenceBundle,
      progressResolution,
    );

    const engineMode: "NORMAL" | "X" = "X"; // poolMode === "x" (normal blocked above)

    // ── 13. answer_mode 분기 ─────────────────────────────────────────────────

    // DIRECT_DB: AI Engine 호출 없음, quota 차감 없음
    if (groundedPackage.answer_mode === "DIRECT_DB") {
      const directAnswer = formatDirectAnswer(groundedPackage);

      await saveUserMessage({
        conversationId,
        requestId: trimmedRequestId,
        content:   trimmedQuery,
      }).catch((err) => {
        console.error("[parent-curriculum] USER message save failed (DIRECT_DB):", err?.message);
      });
      // WP-D: 첫 USER message 기반 title 자동 생성 (GPT 없음)
      await updateConversationTitleIfBlank(conversationId, trimmedQuery).catch(() => undefined);

      const directMeta = {
        intent:            parsedIntent.intent,
        mode:              engineMode,
        curriculum_source: curriculumScope.source,
        result_payload:    { answer: directAnswer },
      } as any;
      directMeta.answer_mode = "DIRECT_DB";
      directMeta.intent_name = parsedIntent.intent;

      await saveAssistantMessage({
        conversationId,
        requestId: trimmedRequestId,
        content:   directAnswer,
        meta:      directMeta,
      }).catch((err) => {
        console.error("[parent-curriculum] ASSISTANT message save failed (DIRECT_DB):", err?.message);
      });
      await touchConversation(conversationId).catch(() => undefined);

      const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
        limit:     MONTHLY_LIMIT,
        used:      0,
        remaining: MONTHLY_LIMIT,
        period:    "",
        resets_at: "",
      }));

      res.json({
        request_id: trimmedRequestId,
        result:     { answer: directAnswer },
        meta:       { mode: engineMode, answer_mode: "DIRECT_DB", intent: parsedIntent.intent },
        usage:      usageInfo,
      });
      return;
    }

    // HUMAN_ONLY: AI Engine 호출 없음, quota 차감 없음
    if (groundedPackage.answer_mode === "HUMAN_ONLY") {
      await saveUserMessage({
        conversationId,
        requestId: trimmedRequestId,
        content:   trimmedQuery,
      }).catch((err) => {
        console.error("[parent-curriculum] USER message save failed (HUMAN_ONLY):", err?.message);
      });
      // WP-D: 첫 USER message 기반 title 자동 생성 (GPT 없음)
      await updateConversationTitleIfBlank(conversationId, trimmedQuery).catch(() => undefined);

      const humanMeta = {
        intent:            parsedIntent.intent,
        mode:              engineMode,
        curriculum_source: curriculumScope.source,
        result_payload:    { answer: HUMAN_ONLY_ANSWER },
      } as any;
      humanMeta.answer_mode = "HUMAN_ONLY";
      humanMeta.intent_name = parsedIntent.intent;

      await saveAssistantMessage({
        conversationId,
        requestId: trimmedRequestId,
        content:   HUMAN_ONLY_ANSWER,
        meta:      humanMeta,
      }).catch((err) => {
        console.error("[parent-curriculum] ASSISTANT message save failed (HUMAN_ONLY):", err?.message);
      });
      await touchConversation(conversationId).catch(() => undefined);

      const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
        limit:     MONTHLY_LIMIT,
        used:      0,
        remaining: MONTHLY_LIMIT,
        period:    "",
        resets_at: "",
      }));

      res.json({
        request_id: trimmedRequestId,
        result:     { answer: HUMAN_ONLY_ANSWER },
        meta:       { mode: engineMode, answer_mode: "HUMAN_ONLY", intent: parsedIntent.intent },
        usage:      usageInfo,
      });
      return;
    }

    // GROUNDED_GPT ─────────────────────────────────────────────────────────────

    // ── 14. Monthly Quota 확인 + 예약 (GROUNDED_GPT only) ────────────────────
    //
    // GROUNDED_GPT만 quota를 소비. DIRECT_DB/HUMAN_ONLY는 이미 리턴했으므로
    // 여기까지 도달한 요청은 모두 GROUNDED_GPT.
    //
    // FAILED 재시도: 내부에서 FAILED→RESERVED atomic 전환.
    // RESERVED 재시도: isRetry:true 반환 (quota 재차감 없음).
    const reserveResult = await tryReserveMonthlyQuota(parentId, trimmedRequestId)
      .catch((err) => {
        console.error("[parent-curriculum] quota reserve failed:", err?.message);
        return null as Awaited<ReturnType<typeof tryReserveMonthlyQuota>> | null;
      });

    if (!reserveResult) {
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    if (!reserveResult.ok) {
      const { usageInfo } = reserveResult;
      res.status(429).json({
        error: "이번 달 커리큘럼 검색 사용 한도에 도달했습니다.",
        code:  "PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED",
        usage: usageInfo,
      });
      return;
    }

    // ── 15. USER Message 저장 ─────────────────────────────────────────────────
    // ENGINE 호출 전 저장 (성공/실패 무관).
    // FAILED retry 시 기존 USER message 재사용 (ON CONFLICT DO NOTHING).
    await saveUserMessage({
      conversationId,
      requestId: trimmedRequestId,
      content:   trimmedQuery,
    }).catch((err) => {
      console.error("[parent-curriculum] USER message save failed:", err?.message);
    });
    // WP-D: 첫 USER message 기반 title 자동 생성 (GPT 없음)
    await updateConversationTitleIfBlank(conversationId, trimmedQuery).catch(() => undefined);

    // ── 16. Recent Conversation Context 구성 (WP1.2) ─────────────────────────
    const recentConversation = await buildRecentConversationContext(
      conversationId,
      trimmedRequestId,
    ).catch((err) => {
      console.error("[parent-curriculum] recent context fetch failed:", err?.message);
      return [] as Array<{ role: "USER" | "ASSISTANT"; content: string }>;
    });

    // ── 17. ENGINE Request 구성 ───────────────────────────────────────────────
    //
    // WP-A Grounded Package → Engine context mapping.
    // APP deterministic progress를 Engine에 전달 (overclaim 방지 context).
    //
    // GAUGE-08: SCP gauge context (optional, fire-and-forget on failure).
    // confirmed_progress_pct = display_confirmed_pct (학부모 UI gauge 값 — 의미: "진행 위치")
    // Security: studentId + poolId 둘 다 전달 (단독 조회 금지).
    const scpProgress = await buildStudentProgress(studentId, poolId).catch((err) => {
      console.error("[parent-curriculum] SCP progress fetch failed:", err?.message);
      return undefined;
    });

    const wpAStudentProgress =
      (groundedPackage.curriculum_current || scpProgress)
        ? {
            ...(groundedPackage.curriculum_current
              ? { current_curriculum_id: groundedPackage.curriculum_current.id }
              : {}),
            ...scpProgress,
          }
        : undefined;

    const engineRequest: ParentCurriculumEngineRequest = {
      request_id:     trimmedRequestId,
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      query:          trimmedQuery,
      context: {
        pool_id:          poolId,
        pool_name:        poolName,
        student_id:       studentId,
        mode:             engineMode,
        curriculum_scope: curriculumScope,
        ...(wpAStudentProgress           ? { student_progress:    wpAStudentProgress    } : {}),
        ...(recentConversation.length    ? { recent_conversation: recentConversation    } : {}),
      },
    };

    // ── 17b. ENGINE 호출 ──────────────────────────────────────────────────────
    const pcEngineStartMs = Date.now();
    let engineResponse: ParentCurriculumEngineResponse;
    // AI01-05: actual HTTP call counts returned from engine client
    let pcActualCallCount = 0;
    let pcRetryCount      = 0;
    try {
      const callResult = await searchParentCurriculum(engineRequest);
      engineResponse    = callResult.response;
      pcActualCallCount = callResult.actualCallCount;
      pcRetryCount      = callResult.retryCount;
    } catch (err) {
      // AI01-05: engine client increments actualCallCount before fetch;
      // on error, count as 1 attempt if URL was configured (i.e. HTTP was sent)
      const httpWasSent = !(err instanceof ParentCurriculumEngineError &&
                            (err as ParentCurriculumEngineError).errorCode === "ENGINE_URL_NOT_CONFIGURED");
      pcActualCallCount = httpWasSent ? 1 : 0;
      pcRetryCount      = 0;

      const errorCode = err instanceof ParentCurriculumEngineError
        ? (err.statusCode === 401 ? "ENGINE_UNAUTHORIZED"
          : err.statusCode === 429 ? "ENGINE_RATE_LIMITED"
          : err.errorCode)
        : "ENGINE_UNKNOWN_ERROR";

      await rollbackQuotaReservation(parentId, trimmedRequestId, errorCode);

      if (err instanceof ParentCurriculumEngineError) {
        console.error(
          `[parent-curriculum] ENGINE error code=${err.engineErrorCode} status=${err.engineStatus} content-type=${err.engineContentType ?? "unknown"}`,
        );
        res.status(502).json({
          error:              "커리큘럼 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
          code:               errorCode,
          retryable:          err.retryable,
          // Diagnostic fields — safe to expose (no secrets, no PII, no payloads)
          engine_status:      err.engineStatus,
          engine_error_code:  err.engineErrorCode,
          request_id:         trimmedRequestId,
        });
        void saveAiTrace({
          status: 'FAILED', request_id: trimmedRequestId, internal_id: trimmedRequestId,
          pool_id: poolId, actor_id: parentId, contract_version: '1.0',
          feature: AI_FEATURE.PARENT_CURRICULUM_AI, pool_mode: poolMode,
          user_role: 'parent_account', result_generated: false,
          trigger_type: 'USER_ACTION', service: 'search',
          error_stage: 'CURRICULUM_SEARCH', error_code: errorCode,
          latency_ms: Date.now() - pcEngineStartMs,
          logical_request_count: 1,
          actual_call_count:     pcActualCallCount,
          retry_count:           pcRetryCount,
        }).catch(() => {});
        return;
      }
      console.error("[parent-curriculum] unexpected ENGINE error:", (err as Error).message);
      res.status(502).json({
        error: "커리큘럼 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
        code:  "INTERNAL_ERROR",
      });
      void saveAiTrace({
        status: 'FAILED', request_id: trimmedRequestId, internal_id: trimmedRequestId,
        pool_id: poolId, actor_id: parentId, contract_version: '1.0',
        feature: AI_FEATURE.PARENT_CURRICULUM_AI, pool_mode: poolMode,
        user_role: 'parent_account', result_generated: false,
        trigger_type: 'USER_ACTION', service: 'search',
        error_stage: 'CURRICULUM_SEARCH', error_code: 'ENGINE_UNKNOWN_ERROR',
        latency_ms: Date.now() - pcEngineStartMs,
        logical_request_count: 1,
        actual_call_count:     pcActualCallCount,
        retry_count:           pcRetryCount,
      }).catch(() => {});
      return;
    }

    // ── 18. Response 검증 (overclaim 포함) ────────────────────────────────────
    const validation = validateEngineResponse(
      engineResponse,
      trimmedRequestId,
      allowedCurriculumIds,
      groundedPackage, // §20 overclaim check
    );

    if (!validation.valid) {
      console.error(
        `[parent-curriculum] ENGINE response validation failed: ${validation.reason}`,
      );
      await rollbackQuotaReservation(parentId, trimmedRequestId, "RESPONSE_VALIDATION_FAILED");
      res.status(502).json({
        error: "AI 응답 검증에 실패했습니다.",
        code:  "RESPONSE_VALIDATION_FAILED",
      });
      return;
    }

    // ── 19. 성공 확정: ASSISTANT + quota 원자적 transaction (WP2B.3) ──────────
    //
    // finalizeCurriculumSearchSuccess는 단일 DB transaction으로:
    //   ① ASSISTANT message INSERT (idempotent)
    //   ② reservation RESERVED → COMPLETED
    //   ③ usage reserved_count -1, completed_count +1
    // 를 원자적으로 실행한다.

    const { answer, current_progress, next_step } = engineResponse.result as any;
    const engineIntentMeta = (engineResponse.meta as any)?.intent ?? null;

    // §17 Metadata snapshot: WP-A fields + engine result
    // 민감정보/내부 secret 저장 금지. Evidence body 전체 저장 금지.
    const safeMetadataJson = JSON.stringify({
      intent:            parsedIntent.intent,
      intent_name:       parsedIntent.intent,
      answer_mode:       "GROUNDED_GPT",
      mode:              engineMode,
      curriculum_source: curriculumScope.source,
      // WP-A progress snapshot (summary only, diary body 제외)
      progress_state: groundedPackage.progress_state.entries.map((e) => ({
        curriculum_item_id: e.curriculum_item_id,
        status:             e.status,
        sort_order:         e.sort_order,
      })),
      curriculum_current: groundedPackage.curriculum_current
        ? { id: groundedPackage.curriculum_current.id, title: groundedPackage.curriculum_current.title }
        : null,
      curriculum_next: groundedPackage.curriculum_next
        ? { id: groundedPackage.curriculum_next.id, title: groundedPackage.curriculum_next.title }
        : null,
      // Engine grounding
      knowledge_ids: engineResponse.grounding?.knowledge_ids ?? [],
      validation:    validation.valid ? "PASS" : "FAIL",
      quota_charged: true,
      // COMPLETED replay용 (raw trace / prompt 금지)
      result_payload: {
        answer,
        ...(current_progress !== undefined ? { current_progress } : {}),
        ...(next_step        !== undefined ? { next_step }        : {}),
      },
    });

    try {
      await finalizeCurriculumSearchSuccess({
        parentId,
        requestId:        trimmedRequestId,
        conversationId,
        content:          answer,
        safeMetadataJson,
      });
    } catch (err) {
      console.error("[parent-curriculum] success finalization failed:", (err as Error).message);
      res.status(502).json({
        error:     "결과 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        code:      "FINALIZATION_FAILED",
        retryable: true,
      });
      return;
    }

    await touchConversation(conversationId).catch(() => undefined);

    // CS-PA1 / AI01-05: 성공 trace
    void saveAiTrace({
      status:                'SUCCESS',
      request_id:            trimmedRequestId,
      internal_id:           trimmedRequestId,
      pool_id:               poolId,
      actor_id:              parentId,
      contract_version:      '1.0',
      feature:               AI_FEATURE.PARENT_CURRICULUM_AI,
      pool_mode:             poolMode,
      user_role:             'parent_account',
      result_generated:      true,
      trigger_type:          'USER_ACTION',
      service:               'search',
      generation_mode:       engineMode,
      model:                 (engineResponse.meta as any)?.model ?? null,
      latency_ms:            (engineResponse.meta as any)?.latency_ms ?? (Date.now() - pcEngineStartMs),
      input_tokens:          null,
      output_tokens:         null,
      total_tokens:          null,
      logical_request_count: 1,
      actual_call_count:     pcActualCallCount,
      retry_count:           pcRetryCount,
    }).catch(() => {});

    // ── 20. 사용량 조회 + 안전한 응답 반환 ───────────────────────────────────
    const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
      limit:     MONTHLY_LIMIT,
      used:      -1,
      remaining: -1,
      period:    "",
      resets_at: "",
    }));

    const contextUsed =
      typeof engineResponse.meta?.conversation_context_used === "boolean"
        ? engineResponse.meta.conversation_context_used
        : recentConversation.length > 0;

    res.json({
      request_id: trimmedRequestId,
      result: {
        answer,
        ...(current_progress !== undefined ? { current_progress } : {}),
        ...(next_step        !== undefined ? { next_step }        : {}),
      },
      meta: {
        mode: engineMode,
        answer_mode: "GROUNDED_GPT",
        intent: parsedIntent.intent,
        conversation_context_used: contextUsed,
      },
      usage: usageInfo,
    });
  },
);

// ─── GET: History ──────────────────────────────────────────────────────────────

/**
 * GET /parent/students/:studentId/curriculum-search/history
 *
 * 대화 이력 조회. quota 차감 없음. ownership 검증 필수.
 *
 * WP-D: ?conversation_id=<id> optional query param
 *   - 있음: ownership 검증 후 해당 conversation messages 반환
 *   - 없음: 기존 동작 (최신 active conversation) — backward compat
 */
router.get(
  "/parent/students/:studentId/curriculum-search/history",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    // WP-D: optional conversation_id query param
    const clientConvIdQuery: string | null =
      typeof req.query.conversation_id === "string" && req.query.conversation_id.trim()
        ? req.query.conversation_id.trim()
        : null;

    const ownershipResult = await superAdminDb.execute(sql`
      SELECT ps.swimming_pool_id
      FROM parent_students ps
      WHERE ps.parent_id  = ${parentId}
        AND ps.student_id = ${studentId}
        AND ps.status     = 'approved'
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    if (!ownershipResult.rows.length) {
      res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
      return;
    }

    // ── WP-C eligibility pre-check (non-charging, backward-compatible) ──────────
    // Additive fields: eligible: boolean, reason?: string
    // No AI/GPT call, no quota charge. Existing fields unchanged.
    const poolId = (ownershipResult.rows[0] as any)?.swimming_pool_id as string | null;
    if (poolId) {
      const modeResult = await resolvePoolMode(poolId).catch(() => null);
      if (modeResult) {
        const pm = modeResult.mode;

        // Normal pool → never eligible
        if (pm === "normal" || pm === "x_pending") {
          const u = await getMonthlyUsageInfo(parentId).catch(() => ({
            limit: MONTHLY_LIMIT, used: 0, remaining: MONTHLY_LIMIT, period: "", resets_at: "",
          }));
          res.json({
            eligible: false,
            reason: "CURRICULUM_NOT_AVAILABLE",
            conversation_id: null,
            messages: [],
            usage: u,
          });
          return;
        }

        // X pool → check searchable curriculum count (no charge)
        if (pm === "x") {
          try {
            await buildXCurriculumScope(poolId);
            // scope ok — fall through to normal history load (eligible: true)
          } catch (scopeErr) {
            if (
              scopeErr instanceof CurriculumScopeError &&
              (scopeErr.code === "CURRICULUM_SEARCH_NOT_ELIGIBLE" ||
               scopeErr.code === "NO_ACTIVE_CURRICULUM_VERSION")
            ) {
              const u = await getMonthlyUsageInfo(parentId).catch(() => ({
                limit: MONTHLY_LIMIT, used: 0, remaining: MONTHLY_LIMIT, period: "", resets_at: "",
              }));
              res.json({
                eligible: false,
                reason: "CURRICULUM_NOT_READY",
                conversation_id: null,
                messages: [],
                usage: u,
              });
              return;
            }
            // Unexpected scope error — treat as eligible; POST will surface the real error
          }
        }
      }
    }

    // ── WP-D: conversation_id 분기 ────────────────────────────────────────────
    let conversationId: string | null = null;

    if (clientConvIdQuery) {
      // WP-D: client 지정 conversation — ownership 검증
      const poolIdStr = (ownershipResult.rows[0] as any)?.swimming_pool_id as string | null;
      if (!poolIdStr) {
        res.status(403).json({ error: "접근 권한이 없습니다.", code: "FORBIDDEN" });
        return;
      }
      const conv = await getConversationWithOwnership(clientConvIdQuery, parentId, studentId, poolIdStr)
        .catch(() => null);
      if (!conv) {
        res.status(403).json({ error: "대화를 찾을 수 없거나 접근 권한이 없습니다.", code: "FORBIDDEN" });
        return;
      }
      conversationId = conv.id;
    } else {
      // 기존 동작: 최신 active conversation (backward compat)
      conversationId = await findConversation(parentId, studentId).catch(() => null);
    }

    if (!conversationId) {
      const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
        limit:     MONTHLY_LIMIT,
        used:      0,
        remaining: MONTHLY_LIMIT,
        period:    "",
        resets_at: "",
      }));
      res.json({ eligible: true, conversation_id: null, messages: [], usage: usageInfo });
      return;
    }

    const rawMessages = await getConversationMessages(conversationId).catch(() => []);

    // Safe projection: strip raw metadata, expose only result?: { current_progress?, next_step? }
    // 금지: grounding trace / raw prompt / knowledge documents / intent / curriculum_source 노출
    const messages = rawMessages.map((msg) => {
      if (msg.role === "ASSISTANT") {
        const rp = (msg as any).metadata?.result_payload;
        const result = rp
          ? {
              ...(rp.current_progress ? { current_progress: rp.current_progress } : {}),
              ...(rp.next_step        ? { next_step:         rp.next_step }        : {}),
            }
          : undefined;
        return {
          id:         msg.id,
          role:       msg.role,
          content:    msg.content,
          created_at: msg.created_at,
          ...(result ? { result } : {}),
        };
      }
      // USER: metadata 없음
      return {
        id:         msg.id,
        role:       msg.role,
        content:    msg.content,
        created_at: msg.created_at,
      };
    });

    const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
      limit:     MONTHLY_LIMIT,
      used:      0,
      remaining: MONTHLY_LIMIT,
      period:    "",
      resets_at: "",
    }));

    res.json({ eligible: true, conversation_id: conversationId, messages, usage: usageInfo });
  },
);

export default router;
