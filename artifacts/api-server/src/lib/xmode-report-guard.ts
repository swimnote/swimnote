/**
 * xmode-report-guard.ts — GR1: X Mode Report Access Foundation
 *
 * 범위 (GR1):
 *   - resolveReportXAccess(): pool의 X 접근 검증 (서버 측 DB 조회)
 *   - requireReportXAccess(): Express middleware (후속 GR routes에 적용 가능)
 *   - checkPublishedReportXPolicy(): PUBLISHED report viewing 정책 (분리)
 *
 * 원칙:
 *   - 기존 resolvePoolMode() / requireXMode()를 재사용 (새 fake entitlement 금지)
 *   - UI guard만으로 끝내지 않음 (서버 측 DB 검증 필수)
 *   - PUBLISHED data는 X 만료 후에도 삭제하지 않음
 *   - xmode_entitlement=true 인 경우에만 신규 report 생성/분석 허용
 *
 * GR1에서는 Foundation service/middleware까지만.
 * 실제 후속 routes(GR3 이후)에 적용 가능하게 한다.
 */
import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { resolvePoolMode, type PoolModeResult } from "./xmode.js";

// ── 결과 타입 ──────────────────────────────────────────────────────────────────

export type ReportXAccessResult =
  | { allowed: true; mode: "x"; poolId: string; modeResult: PoolModeResult }
  | {
      allowed: false;
      reason:
        | "POOL_NOT_FOUND"
        | "XMODE_NOT_ENTITLED"
        | "XMODE_NOT_READY"
        | "UNKNOWN_ROLE"
        | "POOL_ID_MISSING";
      poolId?: string;
      modeResult?: PoolModeResult;
    };

// ── resolveReportPoolId — role별 poolId DB 직접 조회 ────────────────────────

/**
 * resolveReportPoolId — JWT poolId 신뢰 금지. DB 직접 조회.
 *
 * 기존 requireXMode와 동일한 방식을 재사용.
 * JWT poolId를 신뢰하지 않고 DB에서 직접 조회한다.
 */
export async function resolveReportPoolId(params: {
  role: string;
  userId: string;
  queryPoolId?: string;
  paramPoolId?: string;
}): Promise<string | null> {
  const { role, userId, queryPoolId, paramPoolId } = params;

  if (role === "pool_admin" || role === "teacher") {
    const row = await superAdminDb.execute(sql`
      SELECT swimming_pool_id FROM users
      WHERE id = ${userId}
      LIMIT 1
    `);
    return (row.rows[0] as any)?.swimming_pool_id ?? null;
  }

  if (role === "parent_account") {
    const row = await superAdminDb.execute(sql`
      SELECT swimming_pool_id FROM parent_accounts
      WHERE id = ${userId}
      LIMIT 1
    `);
    return (row.rows[0] as any)?.swimming_pool_id ?? null;
  }

  if (role === "super_admin") {
    return queryPoolId ?? paramPoolId ?? null;
  }

  return null;
}

// ── resolveReportXAccess — 서버 측 X 접근 검증 ────────────────────────────────

/**
 * resolveReportXAccess — pool의 실제 X 접근 가능 여부 확인
 *
 * 기존 resolvePoolMode()를 재사용.
 * mode==="x" (xmode_entitlement=true + xmode_config_status=READY)일 때만 허용.
 *
 * PUBLISHED report viewing 정책은 checkPublishedReportXPolicy()로 분리.
 * 신규 생성/분석 접근은 이 함수로 검증.
 */
export async function resolveReportXAccess(
  poolId: string,
): Promise<ReportXAccessResult> {
  const modeResult = await resolvePoolMode(poolId);

  if (!modeResult) {
    return { allowed: false, reason: "POOL_NOT_FOUND", poolId };
  }

  if (!modeResult.xmode_entitlement) {
    return { allowed: false, reason: "XMODE_NOT_ENTITLED", poolId, modeResult };
  }

  if (modeResult.mode !== "x") {
    return { allowed: false, reason: "XMODE_NOT_READY", poolId, modeResult };
  }

  return { allowed: true, mode: "x", poolId, modeResult };
}

// ── checkPublishedReportXPolicy — PUBLISHED report viewing 정책 ───────────────

export type PublishedReportViewPolicy =
  | { viewAllowed: true }
  | { viewAllowed: false; reason: "NOT_PUBLISHED" | "XMODE_EXPIRED_RESTRICT" };

/**
 * checkPublishedReportXPolicy — PUBLISHED report viewing 정책
 *
 * PUBLISHED data는 X 만료 후에도 삭제하지 않는다.
 * 현재 정책: PUBLISHED report는 X 만료 후에도 viewing 허용 (데이터 보존 원칙).
 * 향후 정책 변경 시 이 함수만 수정.
 *
 * @param isPublished report가 PUBLISHED 상태인지
 * @param xmodeEntitlement 현재 pool xmode_entitlement
 */
export function checkPublishedReportXPolicy(
  isPublished: boolean,
  _xmodeEntitlement: boolean,
): PublishedReportViewPolicy {
  if (!isPublished) {
    return { viewAllowed: false, reason: "NOT_PUBLISHED" };
  }

  // PUBLISHED data는 X 만료 후에도 보존 — 현재 정책: viewing 허용
  // TODO(GR8): Product Policy에 따라 정책 구체화
  return { viewAllowed: true };
}

// ── requireReportXAccess — Express middleware (foundation) ────────────────────

export interface ReportAuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    poolId?: string;
  };
  resolvedReportPoolId?: string;
  resolvedReportXAccess?: ReportXAccessResult;
}

/**
 * requireReportXAccess — GR1 foundation middleware
 *
 * 후속 GR routes(GR3 이후)에 배치하는 X 접근 Guard.
 * 기존 requireXMode와 동일한 poolId 결정 방식을 재사용.
 *
 * super_admin: req.query.pool_id 또는 req.params.pool_id
 * pool_admin / teacher: users 테이블 DB 직접 조회
 * parent_account: parent_accounts 테이블 DB 직접 조회
 * 그 외: fail-closed 403
 *
 * PUBLISHED report viewing은 별도 정책(checkPublishedReportXPolicy) 적용.
 */
export function requireReportXAccess(
  req: ReportAuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "UNAUTHORIZED",
      message: "인증이 필요합니다.",
    });
    return;
  }

  const { role, userId } = req.user;
  const queryPoolId = (req.query as any).pool_id as string | undefined;
  const paramPoolId = (req.params as any).pool_id as string | undefined;

  const knownRoles = new Set(["pool_admin", "teacher", "parent_account", "super_admin"]);

  if (!knownRoles.has(role)) {
    res.status(403).json({
      success: false,
      error: "UNKNOWN_ROLE",
      message: "권한이 없습니다.",
    });
    return;
  }

  resolveReportPoolId({ role, userId, queryPoolId, paramPoolId })
    .then(async (poolId) => {
      if (!poolId) {
        res.status(400).json({
          success: false,
          error: "POOL_ID_MISSING",
          message: "수영장을 찾을 수 없습니다.",
        });
        return;
      }

      const access = await resolveReportXAccess(poolId);

      if (!access.allowed) {
        const statusMap: Record<string, number> = {
          POOL_NOT_FOUND: 404,
          XMODE_NOT_ENTITLED: 403,
          XMODE_NOT_READY: 403,
        };
        const status = statusMap[access.reason] ?? 403;
        res.status(status).json({
          success: false,
          error: access.reason,
          message: access.reason === "POOL_NOT_FOUND"
            ? "수영장을 찾을 수 없습니다."
            : "X 모드 접근 권한이 없습니다.",
        });
        return;
      }

      // 검증 결과를 req에 저장 (route handler에서 재사용)
      req.resolvedReportPoolId = poolId;
      req.resolvedReportXAccess = access;

      next();
    })
    .catch((err) => {
      console.error("[requireReportXAccess] DB 오류:", err);
      res.status(500).json({
        success: false,
        error: "SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      });
    });
}
