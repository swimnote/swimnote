/**
 * parent-curriculum.ts — WP2: Parent Curriculum Search API
 *
 * Routes:
 *   POST /parent/students/:studentId/curriculum-search
 *
 * Flow:
 *   Parent JWT 인증
 *   → Parent↔Student 소유권 확인
 *   → Student pool 확인
 *   → resolvePoolMode()
 *   → 모드별 Curriculum Scope 구성
 *   → Student Progress 구성
 *   → ENGINE 호출
 *   → Response 검증
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
  // 6. curriculum_ids subset 검증 (ENGINE이 보낸 IDs가 APP이 허용한 범위 내인지)
  const returnedIds: string[] = response.grounding?.curriculum_ids ?? [];
  for (const id of returnedIds) {
    if (!allowedCurriculumIds.has(id)) {
      return { valid: false, reason: `ENGINE returned unknown curriculum_id: ${id}` };
    }
  }
  return { valid: true };
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /parent/students/:studentId/curriculum-search
 *
 * Body: { request_id: string, query: string }
 *
 * - studentId는 URL path에서 받음
 * - pool_id, mode, curriculum IDs는 client가 임의 전송 불가 (서버가 결정)
 * - Parent는 질문만 전달
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

    // ── 2. Pool 이름 조회 ─────────────────────────────────────────────────────
    const poolResult = await superAdminDb.execute(sql`
      SELECT name
      FROM swimming_pools
      WHERE id = ${poolId}
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    const poolName = ((poolResult.rows[0] as any)?.name as string | null) ?? poolId;

    // ── 3. Pool mode 판정 (resolvePoolMode 재사용) ────────────────────────────
    const modeResult = await resolvePoolMode(poolId);

    if (!modeResult) {
      res.status(404).json({ error: "수영장을 찾을 수 없습니다.", code: "POOL_NOT_FOUND" });
      return;
    }

    const poolMode = modeResult.mode; // "normal" | "x_pending" | "x"

    // ── 4. x_pending → 차단 ──────────────────────────────────────────────────
    if (poolMode === "x_pending") {
      res.status(422).json({
        error: "AI 커리큘럼 검색이 아직 준비 중입니다.",
        code:  "CURRICULUM_SEARCH_NOT_ELIGIBLE",
      });
      return;
    }

    // ── 5. Curriculum Scope 구성 ─────────────────────────────────────────────
    let curriculumScope;
    try {
      if (poolMode === "x") {
        curriculumScope = await buildXCurriculumScope();
      } else {
        // normal
        curriculumScope = await buildNormalCurriculumScope(poolId);
      }
    } catch (err) {
      if (err instanceof CurriculumScopeError) {
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
      res.status(500).json({ error: "서버 오류가 발생했습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    // allowed curriculum IDs (response validation용)
    const allowedCurriculumIds = new Set(
      curriculumScope.curriculum_items.map((item) => item.id),
    );

    // ── 6. Student Progress 구성 ─────────────────────────────────────────────
    const studentProgress = await buildStudentProgress(studentId, poolId).catch(
      () => undefined,
    );

    // ── 7. ENGINE Request 구성 ────────────────────────────────────────────────
    const engineMode: "NORMAL" | "X" = poolMode === "x" ? "X" : "NORMAL";

    const engineRequest: ParentCurriculumEngineRequest = {
      request_id:     request_id.trim(),
      schema_version: "1.0",
      feature:        "parent_curriculum_search",
      query:          query.trim(),
      context: {
        pool_id:          poolId,
        pool_name:        poolName,
        student_id:       studentId,
        mode:             engineMode,
        curriculum_scope: curriculumScope,
        ...(studentProgress ? { student_progress: studentProgress } : {}),
      },
    };

    // ── 8. ENGINE 호출 ────────────────────────────────────────────────────────
    let engineResponse: ParentCurriculumEngineResponse;
    try {
      engineResponse = await searchParentCurriculum(engineRequest);
    } catch (err) {
      if (err instanceof ParentCurriculumEngineError) {
        const code = err.statusCode === 401 ? "ENGINE_UNAUTHORIZED"
                   : err.statusCode === 429 ? "ENGINE_RATE_LIMITED"
                   : err.errorCode;
        console.error(
          `[parent-curriculum] ENGINE error code=${err.errorCode} status=${err.statusCode}`,
        );
        res.status(502).json({
          error:    "AI 분석 서비스에 일시적인 문제가 있습니다.",
          code,
          retryable: err.retryable,
        });
        return;
      }
      console.error("[parent-curriculum] unexpected ENGINE error:", (err as Error).message);
      res.status(502).json({ error: "AI 분석 서비스에 일시적인 문제가 있습니다.", code: "INTERNAL_ERROR" });
      return;
    }

    // ── 9. Response 검증 ──────────────────────────────────────────────────────
    const validation = validateEngineResponse(
      engineResponse,
      request_id.trim(),
      allowedCurriculumIds,
    );

    if (!validation.valid) {
      console.error(
        `[parent-curriculum] ENGINE response validation failed: ${validation.reason}`,
      );
      res.status(502).json({
        error: "AI 응답 검증에 실패했습니다.",
        code:  "RESPONSE_VALIDATION_FAILED",
      });
      return;
    }

    // ── 10. Parent에게 안전한 응답 반환 ──────────────────────────────────────
    // 금지 노출: ENGINE prompt, raw knowledge, grounding traces, JWT, stack trace
    const { answer, current_progress, next_step } = engineResponse.result;

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
    });
  },
);

export default router;
