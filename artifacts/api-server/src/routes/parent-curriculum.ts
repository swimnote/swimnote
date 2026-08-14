/**
 * parent-curriculum.ts — WP2 / WP2.1 / WP2B / WP2B.2 / WP2B.3 / WP1.2
 *
 * Routes:
 *   POST /parent/students/:studentId/curriculum-search
 *   GET  /parent/students/:studentId/curriculum-search/history
 *
 * POST Flow (WP2B.3 canonical order):
 *   1. Parent JWT 인증
 *   2. Parent↔Student 소유권 확인
 *   3. request_id prior state 확인 (getPriorReservationStatus)
 *      IF COMPLETED → persisted result replay → RETURN (quota 차감 없음, ENGINE 금지)
 *   4. Conversation 조회/생성
 *   5. Monthly quota 확인 + 예약 (FAILED 재시도: FAILED→RESERVED atomic 전환)
 *   6. Pool 이름 + mode 판정
 *   7. Curriculum Scope 구성
 *   8. Student Progress 구성
 *   9. USER message 저장 (idempotent — FAILED retry 시 기존 재사용)
 *   10. ENGINE 호출
 *   11. Response 검증
 *   12. 성공: finalizeCurriculumSearchSuccess (atomic transaction: ASSISTANT + quota 동시 확정)
 *   13. 실패: quota rollback
 *   14. 사용량 포함 안전한 응답 반환
 *
 * 금지:
 *   - GPT 직접 호출
 *   - Knowledge DB 검색
 *   - Prompt 작성
 *   - 수영 지식 판단
 *   - 다른 수영장 curriculum 참조
 */

import { Router }         from "express";
import { superAdminDb }   from "@workspace/db";
import { sql }            from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { resolvePoolMode }               from "../lib/xmode.js";
import {
  buildNormalCurriculumScope,
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
  findConversation,
  saveUserMessage,
  touchConversation,
  getConversationMessages,
  getAssistantMessageByRequestId,
  buildRecentConversationContext,
} from "../lib/parent-curriculum-conversation.js";

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

function validateEngineResponse(
  response:             ParentCurriculumEngineResponse,
  requestId:            string,
  allowedCurriculumIds: Set<string>,
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
  return { valid: true };
}

// ─── POST: Curriculum Search ───────────────────────────────────────────────────

/**
 * POST /parent/students/:studentId/curriculum-search
 *
 * Body: { request_id: string, query: string }
 */
router.post(
  "/parent/students/:studentId/curriculum-search",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    // ── Request 유효성 검사 ──────────────────────────────────────────────────
    const { request_id, query } = req.body ?? {};

    if (typeof request_id !== "string" || !request_id.trim()) {
      res.status(400).json({ error: "request_id 필수", code: "INVALID_REQUEST" });
      return;
    }
    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({ error: "query 필수", code: "INVALID_REQUEST" });
      return;
    }

    const trimmedRequestId = request_id.trim();
    const trimmedQuery     = query.trim();

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
    //
    // FAILED / RESERVED / NONE: 아래 정상 flow 진행.
    const priorStatus = await getPriorReservationStatus(trimmedRequestId).catch(() => "NONE" as const);

    if (priorStatus === "COMPLETED") {
      // COMPLETED replay path ────────────────────────────────────────────────
      const convId = await findConversation(parentId, studentId).catch(() => null);
      const assistantMsg = convId
        ? await getAssistantMessageByRequestId(convId, trimmedRequestId).catch(() => null)
        : null;

      if (!assistantMsg) {
        // Inconsistency — COMPLETED reservation 이 있지만 assistant message 없음
        console.error(
          `[parent-curriculum] COMPLETED ${trimmedRequestId} has no assistant message — internal inconsistency`,
        );
        res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
        return;
      }

      const answer    = assistantMsg.content;
      const rp        = assistantMsg.metadata?.result_payload;
      const mode      = (assistantMsg.metadata?.mode ?? "NORMAL") as string;
      const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
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
        meta:  { mode },
        usage: usageInfo,
      });
      return;
    }

    // ── 3. Conversation 조회/생성 ─────────────────────────────────────────────
    const conversationId = await getOrCreateConversation(parentId, studentId, poolId)
      .catch((err) => {
        console.error("[parent-curriculum] conversation upsert failed:", err?.message);
        return null as string | null;
      });

    if (!conversationId) {
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    // ── 4. Monthly Quota 확인 + 예약 ─────────────────────────────────────────
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

    // ── 5. Pool 이름 조회 ─────────────────────────────────────────────────────
    const poolResult = await superAdminDb.execute(sql`
      SELECT name
      FROM swimming_pools
      WHERE id = ${poolId}
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    const poolName = ((poolResult.rows[0] as any)?.name as string | null) ?? poolId;

    // ── 6. Pool mode 판정 ─────────────────────────────────────────────────────
    const modeResult = await resolvePoolMode(poolId);

    if (!modeResult) {
      await rollbackQuotaReservation(parentId, trimmedRequestId, "POOL_NOT_FOUND");
      res.status(404).json({ error: "수영장을 찾을 수 없습니다.", code: "POOL_NOT_FOUND" });
      return;
    }

    const poolMode = modeResult.mode;

    // ── 7. x_pending → 차단 ──────────────────────────────────────────────────
    if (poolMode === "x_pending") {
      await rollbackQuotaReservation(parentId, trimmedRequestId, "CURRICULUM_SEARCH_NOT_ELIGIBLE");
      res.status(422).json({
        error: "AI 커리큘럼 검색이 아직 준비 중입니다.",
        code:  "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      });
      return;
    }

    // ── 8. Curriculum Scope 구성 ─────────────────────────────────────────────
    let curriculumScope;
    try {
      curriculumScope = poolMode === "x"
        ? await buildXCurriculumScope()
        : await buildNormalCurriculumScope(poolId);
    } catch (err) {
      if (err instanceof CurriculumScopeError) {
        await rollbackQuotaReservation(parentId, trimmedRequestId, err.code);
        if (err.code === "CURRICULUM_SEARCH_NOT_ELIGIBLE") {
          res.status(422).json({
            error: "AI 커리큘럼 검색을 사용할 수 없습니다. (커리큘럼 데이터 부족)",
            code:  "CURRICULUM_SEARCH_NOT_ELIGIBLE",
          });
          return;
        }
        if (
          err.code === "X_GLOBAL_SET_UNAVAILABLE" ||
          err.code === "X_GLOBAL_DATA_INTEGRITY_ERROR"
        ) {
          res.status(422).json({
            error: "AI 커리큘럼 검색이 아직 준비 중입니다.",
            code:  "CURRICULUM_SEARCH_NOT_ELIGIBLE",
          });
          return;
        }
      }
      console.error("[parent-curriculum] scope builder error:", (err as Error).message);
      await rollbackQuotaReservation(parentId, trimmedRequestId, "SCOPE_ERROR");
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    const allowedCurriculumIds = new Set(
      curriculumScope.curriculum_items.map((item) => item.id),
    );

    // ── 9. Student Progress 구성 ─────────────────────────────────────────────
    const studentProgress = await buildStudentProgress(studentId, poolId).catch(() => undefined);

    // ── 10. USER Message 저장 ─────────────────────────────────────────────────
    // ENGINE 호출 전 저장 (성공/실패 무관).
    // FAILED retry 시 기존 USER message 재사용 (ON CONFLICT DO NOTHING).
    await saveUserMessage({
      conversationId,
      requestId: trimmedRequestId,
      content:   trimmedQuery,
    }).catch((err) => {
      console.error("[parent-curriculum] USER message save failed:", err?.message);
    });

    // ── 11. Recent Conversation Context 구성 (WP1.2) ─────────────────────────
    //
    // 최근 3 turn (최대 6 messages)을 ENGINE에 전달 — 후속 질문 이해 보조.
    // 현재 query (trimmedRequestId) 제외. 오래된 순 → 최신 순.
    //
    // 원칙:
    //   - 질문의 지시 대상, 대명사, 후속 질문 맥락 해석에만 사용
    //   - 이전 ASSISTANT 답변을 새로운 Grounding fact로 승격 금지
    //   - fetch 실패 시 조용히 [] 반환 → 기존 WP1 동작 유지
    const recentConversation = await buildRecentConversationContext(
      conversationId,
      trimmedRequestId,
    ).catch((err) => {
      console.error("[parent-curriculum] recent context fetch failed:", err?.message);
      return [] as Array<{ role: "USER" | "ASSISTANT"; content: string }>;
    });

    // ── 12. ENGINE Request 구성 ───────────────────────────────────────────────
    const engineMode: "NORMAL" | "X" = poolMode === "x" ? "X" : "NORMAL";

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
        ...(studentProgress           ? { student_progress:     studentProgress   } : {}),
        ...(recentConversation.length ? { recent_conversation:  recentConversation } : {}),
      },
    };

    // ── 12. ENGINE 호출 ───────────────────────────────────────────────────────
    let engineResponse: ParentCurriculumEngineResponse;
    try {
      engineResponse = await searchParentCurriculum(engineRequest);
    } catch (err) {
      const errorCode = err instanceof ParentCurriculumEngineError
        ? (err.statusCode === 401 ? "ENGINE_UNAUTHORIZED"
          : err.statusCode === 429 ? "ENGINE_RATE_LIMITED"
          : err.errorCode)
        : "ENGINE_UNKNOWN_ERROR";

      await rollbackQuotaReservation(parentId, trimmedRequestId, errorCode);

      if (err instanceof ParentCurriculumEngineError) {
        console.error(
          `[parent-curriculum] ENGINE error code=${err.errorCode} status=${err.statusCode}`,
        );
        res.status(502).json({
          error:     "AI 분석 서비스에 일시적인 문제가 있습니다.",
          code:      errorCode,
          retryable: err.retryable,
        });
        return;
      }
      console.error("[parent-curriculum] unexpected ENGINE error:", (err as Error).message);
      res.status(502).json({
        error: "AI 분석 서비스에 일시적인 문제가 있습니다.",
        code:  "INTERNAL_ERROR",
      });
      return;
    }

    // ── 13. Response 검증 ─────────────────────────────────────────────────────
    const validation = validateEngineResponse(
      engineResponse,
      trimmedRequestId,
      allowedCurriculumIds,
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

    // ── 14. 성공 확정: ASSISTANT + quota 원자적 transaction (WP2B.3) ──────────
    //
    // finalizeCurriculumSearchSuccess는 단일 DB transaction으로:
    //   ① ASSISTANT message INSERT (idempotent)
    //   ② reservation RESERVED → COMPLETED
    //   ③ usage reserved_count -1, completed_count +1
    // 를 원자적으로 실행한다.
    //
    // 실패 시: transaction 자동 rollback → reservation RESERVED 유지 → retry 가능.
    // 보장: "COMPLETED + no persisted result" 상태 불가능.

    const { answer, current_progress, next_step, intent } = engineResponse.result as any;

    const safeMetadataJson = JSON.stringify({
      intent:            intent ?? null,
      mode:              engineMode,
      curriculum_source: curriculumScope.source,
      // result_payload: COMPLETED replay용 (raw trace / prompt 금지)
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
      // Transaction 실패: reservation RESERVED 유지 → 동일 request_id retry 가능.
      // COMPLETED + no persisted result 상태 불가능 (transaction rollback 보장).
      console.error("[parent-curriculum] success finalization failed:", (err as Error).message);
      res.status(502).json({
        error:     "결과 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        code:      "FINALIZATION_FAILED",
        retryable: true,
      });
      return;
    }

    await touchConversation(conversationId).catch(() => undefined);

    // ── 15. 사용량 조회 + 안전한 응답 반환 ───────────────────────────────────
    const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
      limit:     MONTHLY_LIMIT,
      used:      -1,
      remaining: -1,
      period:    "",
      resets_at: "",
    }));

    // WP1.2: ENGINE이 conversation_context_used를 반환하면 pass-through;
    //         없으면 recentConversation 전송 여부로 결정.
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
      meta:  { mode: engineMode, conversation_context_used: contextUsed },
      usage: usageInfo,
    });
  },
);

// ─── GET: History ──────────────────────────────────────────────────────────────

/**
 * GET /parent/students/:studentId/curriculum-search/history
 *
 * 대화 이력 조회. quota 차감 없음. ownership 검증 필수.
 */
router.get(
  "/parent/students/:studentId/curriculum-search/history",
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

    const conversationId = await findConversation(parentId, studentId).catch(() => null);

    if (!conversationId) {
      const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
        limit:     MONTHLY_LIMIT,
        used:      0,
        remaining: MONTHLY_LIMIT,
        period:    "",
        resets_at: "",
      }));
      res.json({ conversation_id: null, messages: [], usage: usageInfo });
      return;
    }

    const messages  = await getConversationMessages(conversationId).catch(() => []);
    const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
      limit:     MONTHLY_LIMIT,
      used:      0,
      remaining: MONTHLY_LIMIT,
      period:    "",
      resets_at: "",
    }));

    res.json({ conversation_id: conversationId, messages, usage: usageInfo });
  },
);

export default router;
