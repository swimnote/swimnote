/**
 * deactivationGuard.ts — 구독 취소 후 90일 비활성화 수영장 접근 차단 미들웨어
 *
 * deactivated_at IS NOT NULL → 모든 요청 차단 (GET 포함)
 * 예외: /auth, /billing, /pricing, /health, /super 경로
 *
 * 응답 코드: 403 POOL_DEACTIVATED
 * 앱이 이 코드를 받으면 재구독 안내 화면으로 이동해야 한다.
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "swim-platform-secret-key-2024";

const BYPASS_PREFIXES = ["/auth", "/billing", "/cards", "/pricing", "/health", "/super"];

export async function requireNotDeactivated(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const path = req.path ?? "";
  if (BYPASS_PREFIXES.some(p => path.startsWith(p))) { next(); return; }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { next(); return; }

  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;

    if (["super_admin", "platform_admin", "super_manager"].includes(payload?.role)) {
      next(); return;
    }

    const poolId = payload?.poolId ?? payload?.swimming_pool_id;
    if (!poolId) { next(); return; }

    const [pool] = (await superAdminDb.execute(sql`
      SELECT deactivated_at, deletion_scheduled_at, name
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];

    if (!pool?.deactivated_at) { next(); return; }

    const deactivatedAt = new Date(pool.deactivated_at);
    const deletionAt    = pool.deletion_scheduled_at
      ? new Date(pool.deletion_scheduled_at)
      : new Date(deactivatedAt.getTime() + 90 * 24 * 60 * 60 * 1000);

    const now = new Date();
    const daysLeft = Math.max(0, Math.ceil((deletionAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    res.status(403).json({
      success: false,
      error:   "pool_deactivated",
      code:    "POOL_DEACTIVATED",
      message: `구독이 취소되어 서비스 이용이 중단되었습니다. 재구독 시 ${daysLeft}일 이내 모든 데이터가 복구됩니다.`,
      deactivated_at:       pool.deactivated_at,
      deletion_scheduled_at: deletionAt.toISOString(),
      days_until_deletion:  daysLeft,
      pool_name:            pool.name ?? null,
    });
  } catch (_) {
    next();
  }
}
