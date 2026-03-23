/**
 * readonlyGuard.ts — 수영장 읽기전용 상태 쓰기 차단 미들웨어
 *
 * is_readonly = true 이거나 subscription_status ∈ {'payment_failed','pending_deletion','deleted'} 인 풀의
 * POST / PUT / PATCH / DELETE 요청을 403으로 차단한다.
 *
 * 예외:
 *   - GET / HEAD / OPTIONS (읽기)
 *   - super_admin 역할
 *   - /auth/** 경로 (로그인/회원가입)
 *   - /billing/**, /cards/** (결제 복구 경로)
 *   - /pricing/** (공개 요금제 조회)
 *   - JWT 없거나 풀 없는 요청 (개별 라우터가 처리)
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "swim-platform-secret-key-2024";

const BLOCKED_STATUSES = new Set(["payment_failed", "pending_deletion", "deleted"]);

const BYPASS_PREFIXES = ["/auth", "/billing", "/cards", "/pricing", "/health", "/super"];

export async function requireWritable(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) { next(); return; }

  const path = req.path ?? "";
  if (BYPASS_PREFIXES.some(p => path.startsWith(p))) { next(); return; }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { next(); return; }

  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;

    if (payload?.role === "super_admin" || payload?.role === "platform_admin") { next(); return; }

    const poolId = payload?.poolId ?? payload?.swimming_pool_id;
    if (!poolId) { next(); return; }

    const [pool] = (await db.execute(sql`
      SELECT is_readonly, subscription_status FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];

    if (pool?.is_readonly || BLOCKED_STATUSES.has(pool?.subscription_status)) {
      const isAdmin = payload?.role === "pool_admin";
      res.status(403).json({
        error: isAdmin
          ? "결제 실패로 인해 서비스 이용이 제한되었습니다. 결제 관리 화면에서 재결제를 진행해주세요."
          : "현재 일부 기능 이용이 제한되었습니다. 관리자에게 문의해주세요.",
        code: "READONLY_MODE",
        readonly: true,
        subscription_status: pool?.subscription_status,
      });
      return;
    }
  } catch (_) {
    // JWT 검증 실패는 requireAuth 에서 처리
  }

  next();
}
