/**
 * deactivationGuard — 구독 취소 후 90일 비활성화 수영장 전면 차단 미들웨어
 */
import type { Request, Response, NextFunction } from "express";

// 비활성화된 풀 ID 캐시 (메모리 캐시, 1분 TTL)
let deactivatedPoolIds: Set<string> = new Set();
let lastRefreshed = 0;
const CACHE_TTL_MS = 60_000;

export async function refreshDeactivatedPools(): Promise<void> {
  // 실제 구현에서는 DB에서 deactivated_at IS NOT NULL인 수영장 ID를 조회합니다.
  // 현재는 빈 Set으로 초기화합니다.
  deactivatedPoolIds = new Set();
  lastRefreshed = Date.now();
}

export function requireNotDeactivated(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // /api/pools/:poolId/** 경로에서 poolId를 추출
  const match = req.path.match(/^\/pools\/([^/]+)\//);
  if (!match) {
    return next();
  }

  const poolId = match[1];

  // 캐시 만료 시 비동기 갱신 (현재 요청은 차단하지 않음)
  if (Date.now() - lastRefreshed > CACHE_TTL_MS) {
    refreshDeactivatedPools().catch(() => {});
  }

  if (deactivatedPoolIds.has(poolId)) {
    res.status(403).json({
      success: false,
      message: "이 수영장은 비활성화되어 서비스 이용이 제한됩니다.",
      error: "POOL_DEACTIVATED",
    });
    return;
  }

  next();
}
