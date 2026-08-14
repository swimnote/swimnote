/**
 * parent-curriculum.ts — WP2 / WP2.1 / WP2B: Parent Curriculum Search API
 *
 * Routes:
 *   POST /parent/students/:studentId/curriculum-search
 *   GET  /parent/students/:studentId/curriculum-search/history
 *
 * Flow (POST):
 *   Parent JWT 인증
 *   → Parent↔Student 소유권 확인
 *   → Conversation 조회/생성
 *   → Monthly quota 확인 + 예약
 *   → Student pool 확인
 *   → resolvePoolMode()
 *   → 모드별 Curriculum Scope 구성
 *   → Student Progress 구성
 *   → USER message 저장
 *   → ENGINE 호출
 *   → Response 검증
 *   → 성공: quota finalize, ASSISTANT message 저장
 *   → 실패: quota rollback
 *   → 안전한 결과 반환
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
  tryReserveMonthlyQuota,
  finalizeQuotaSuccess,
  rollbackQuotaReservation,
  getMonthlyUsageInfo,
  MONTHLY_LIMIT,
} from "../lib/parent-curriculum-quota.js";
import {
  getOrCreateConversation,
  findConversation,
  saveUserMessage,
  saveAssistantMessage,
  touchConversation,
  getConversationMessages,
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

// ─── Response validation ───────────────────────────────────────────────────────

interface ValidationResult {
  valid:   boolean;
  reason?: string;
}

function validateEngineResponse(
  response:             ParentCurriculumEngineResponse,
  requestId:            string,
  allowedCurriculumIds: Set<string>,
): ValidationResult {
  // 1. request_id 일치
  if (response.request_id !== requestId) {
    return { valid: false, reason: "request_id mismatch" };
  }
  // 2. schema_version
  if (response.schema_version !== PC_SCHEMA_VERSION) {
    return { valid: false, reason: `unsupported schema_version: ${response.schema_version}` };
  }
  // 3. feature 일치
  if (response.feature !== PC_FEATURE) {
    return { valid: false, reason: `feature mismatch: ${response.feature}` };
  }
  // 4. result.answer
  if (typeof response.result?.answer !== "string" || !response.result.answer) {
    return { valid: false, reason: "result.answer missing or empty" };
  }
  // 5. grounding.validation === PASS
  if (response.grounding?.validation !== "PASS") {
    return { valid: false, reason: `grounding.validation=${response.grounding?.validation}` };
  }
  // 6. curriculum_ids subset 검증
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

    // ── 2. Conversation 조회/생성 ─────────────────────────────────────────────
    const conversationId = await getOrCreateConversation(parentId, studentId, poolId)
      .catch((err) => {
        console.error("[parent-curriculum] conversation upsert failed:", err?.message);
        return null as string | null;
      });

    if (!conversationId) {
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    // ── 3. Monthly Quota 확인 + 예약 ─────────────────────────────────────────
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
      // 한도 초과
      const { usageInfo } = reserveResult;
      res.status(429).json({
        error: "이번 달 커리큘럼 검색 사용 한도에 도달했습니다.",
        code:  "PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED",
        usage: usageInfo,
      });
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
      await rollbackQuotaReservation(parentId, trimmedRequestId, "POOL_NOT_FOUND");
      res.status(404).json({ error: "수영장을 찾을 수 없습니다.", code: "POOL_NOT_FOUND" });
      return;
    }

    const poolMode = modeResult.mode;

    // ── 6. x_pending → 차단 ──────────────────────────────────────────────────
    if (poolMode === "x_pending") {
      await rollbackQuotaReservation(parentId, trimmedRequestId, "CURRICULUM_SEARCH_NOT_ELIGIBLE");
      res.status(422).json({
        error: "AI 커리큘럼 검색이 아직 준비 중입니다.",
        code:  "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      });
      return;
    }

    // ── 7. Curriculum Scope 구성 ─────────────────────────────────────────────
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

    // ── 8. Student Progress 구성 ─────────────────────────────────────────────
    const studentProgress = await buildStudentProgress(studentId, poolId).catch(() => undefined);

    // ── 9. USER Message 저장 ─────────────────────────────────────────────────
    // ENGINE 호출 전 저장 (성공/실패 무관). ON CONFLICT DO NOTHING으로 retry 안전.
    await saveUserMessage({
      conversationId,
      requestId: trimmedRequestId,
      content:   trimmedQuery,
    }).catch((err) => {
      console.error("[parent-curriculum] USER message save failed:", err?.message);
    });

    // ── 10. ENGINE Request 구성 ───────────────────────────────────────────────
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
        ...(studentProgress ? { student_progress: studentProgress } : {}),
      },
    };

    // ── 11. ENGINE 호출 ───────────────────────────────────────────────────────
    let engineResponse: ParentCurriculumEngineResponse;
    try {
      engineResponse = await searchParentCurriculum(engineRequest);
    } catch (err) {
      // ENGINE 오류 → quota 롤백
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

    // ── 12. Response 검증 ─────────────────────────────────────────────────────
    const validation = validateEngineResponse(
      engineResponse,
      trimmedRequestId,
      allowedCurriculumIds,
    );

    if (!validation.valid) {
      // 검증 실패 → quota 롤백
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

    // ── 13. 성공 확정: quota finalize + ASSISTANT message 저장 ───────────────
    await finalizeQuotaSuccess(parentId, trimmedRequestId).catch((err) => {
      console.error("[parent-curriculum] quota finalize failed:", err?.message);
    });

    const { answer, current_progress, next_step, intent } = engineResponse.result as any;

    await saveAssistantMessage({
      conversationId,
      requestId: trimmedRequestId,
      content:   answer,
      meta: {
        intent:            intent ?? null,
        mode:              engineMode,
        curriculum_source: curriculumScope.source,
      },
    }).catch((err) => {
      console.error("[parent-curriculum] ASSISTANT message save failed:", err?.message);
    });

    await touchConversation(conversationId).catch(() => undefined);

    // ── 14. 사용량 조회 + 안전한 응답 반환 ───────────────────────────────────
    const usageInfo = await getMonthlyUsageInfo(parentId).catch(() => ({
      limit:     MONTHLY_LIMIT,
      used:      -1,
      remaining: -1,
      period:    "",
      resets_at: "",
    }));

    res.json({
      request_id,
      result: {
        answer,
        ...(current_progress ? { current_progress } : {}),
        ...(next_step        ? { next_step }        : {}),
      },
      meta: {
        mode: engineMode,
      },
      usage: usageInfo,
    });
  },
);

// ─── GET: History ──────────────────────────────────────────────────────────────

/**
 * GET /parent/students/:studentId/curriculum-search/history
 *
 * Parent UI WP3를 위한 대화 이력 조회.
 * 과거 대화 열람은 quota 차감 없음.
 * ownership 검증 필수.
 */
router.get(
  "/parent/students/:studentId/curriculum-search/history",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;

    // ── 소유권 확인 ───────────────────────────────────────────────────────────
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

    // ── Conversation 조회 ─────────────────────────────────────────────────────
    const conversationId = await findConversation(parentId, studentId).catch(() => null);

    // conversation 없음 → 빈 history
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

    // ── 메시지 조회 ──────────────────────────────────────────────────────────
    const messages = await getConversationMessages(conversationId).catch(() => []);
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
