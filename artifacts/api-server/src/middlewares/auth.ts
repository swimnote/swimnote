import type { Request, Response, NextFunction } from "express";
import { verifyToken, TOKEN_VERSION, SUPER_ADMIN_PERMISSIONS, type PlatformPermissions } from "../lib/auth.js";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface AuthRequest extends Omit<Request, "params" | "query"> {
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  user?: {
    userId: string;
    id?: string;
    name?: string;
    email?: string;
    role: string;
    poolId?: string | null;
    permissions?: PlatformPermissions;
    withdrawing?: boolean; // 90일 유예 중: true면 읽기 전용
  };
}

// ── 탈퇴 계정 캐시 (1분 TTL) — DB 부하 최소화 ──────────────────────────
const WITHDRAWN_CACHE_TTL_MS = 60_000;
type WithdrawState = "active" | "retain" | "blocked";
const withdrawnCache = new Map<string, { state: WithdrawState; at: number }>();

function getWithdrawCached(userId: string): WithdrawState | null {
  const entry = withdrawnCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.at > WITHDRAWN_CACHE_TTL_MS) {
    withdrawnCache.delete(userId);
    return null;
  }
  return entry.state;
}
function setWithdrawCache(userId: string, state: WithdrawState) {
  withdrawnCache.set(userId, { state, at: Date.now() });
}
export function clearWithdrawCache(userId: string) {
  withdrawnCache.delete(userId);
}

// 탈퇴 체크 불필요 역할
const SKIP_WITHDRAWAL_ROLES = new Set([
  "super_admin", "platform_admin", "super_manager",
  "parent_account", "parent", // parent_accounts 테이블 소속
]);

// 90일 유예 중에도 허용하는 요청
//  - GET / HEAD / OPTIONS: 읽기
//  - /billing/* : 재구독 결제
function isRetainModeAllowed(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const path = req.path ?? (req as any).url ?? "";
  if (path.startsWith("/billing/")) return true;
  return false;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.tv !== TOKEN_VERSION) {
      res.status(401).json({ success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요.", error: "token_version_mismatch" });
      return;
    }
    req.user = { ...payload };

    // ── super / parent 계열: 탈퇴 체크 불필요 ────────────────────────────
    if (SKIP_WITHDRAWAL_ROLES.has(payload.role)) {
      next();
      return;
    }

    // ── JWT에 withdrawing 플래그가 있으면 즉시 처리 (DB 조회 불필요) ──────
    if (payload.withdrawing === true) {
      req.user.withdrawing = true;
      if (isRetainModeAllowed(req)) {
        next();
      } else {
        res.status(423).json({
          success: false,
          message: "탈퇴 유예 중인 계정입니다. 원래 구독 플랜을 재결제하면 계정이 복구됩니다.",
          error: "account_withdrawing",
        });
      }
      return;
    }

    // ── pool_admin / teacher / sub_admin — DB 탈퇴 상태 체크 ─────────────
    const userId = payload.userId;
    const cached = getWithdrawCached(userId);

    if (cached === "blocked") {
      res.status(401).json({ success: false, message: "탈퇴 처리된 계정입니다.", error: "account_withdrawn" });
      return;
    }
    if (cached === "retain") {
      req.user.withdrawing = true;
      if (isRetainModeAllowed(req)) {
        next();
      } else {
        res.status(423).json({
          success: false,
          message: "탈퇴 유예 중인 계정입니다. 원래 구독 플랜을 재결제하면 계정이 복구됩니다.",
          error: "account_withdrawing",
        });
      }
      return;
    }
    if (cached === "active") {
      next();
      return;
    }

    // 캐시 미스 → DB 조회
    // retain_mode = withdrawal_requested_at IS NOT NULL AND email not anonymized
    superAdminDb.execute(sql`
      SELECT is_activated, withdrawal_requested_at,
        (email NOT LIKE 'deleted_%@deleted.local') AS retain_mode
      FROM users WHERE id = ${userId} LIMIT 1
    `).then(result => {
      const row = result.rows[0] as any;
      if (!row) {
        setWithdrawCache(userId, "blocked");
        res.status(401).json({ success: false, message: "존재하지 않는 계정입니다.", error: "account_deleted" });
        return;
      }

      const hasWithdrawal = !!row.withdrawal_requested_at;
      const isDeactivated = !row.is_activated;
      const isRetain = hasWithdrawal && (row.retain_mode === true || row.retain_mode === "true" || row.retain_mode === 1);

      if (hasWithdrawal || isDeactivated) {
        const state: WithdrawState = isRetain ? "retain" : "blocked";
        setWithdrawCache(userId, state);

        if (state === "retain") {
          req.user!.withdrawing = true;
          if (isRetainModeAllowed(req)) {
            next();
          } else {
            res.status(423).json({
              success: false,
              message: "탈퇴 유예 중인 계정입니다. 원래 구독 플랜을 재결제하면 계정이 복구됩니다.",
              error: "account_withdrawing",
            });
          }
        } else {
          res.status(401).json({ success: false, message: "탈퇴 처리된 계정입니다.", error: "account_withdrawn" });
        }
        return;
      }

      setWithdrawCache(userId, "active");
      next();
    }).catch(err => {
      console.error("[requireAuth] 탈퇴 체크 DB 오류:", err);
      next(); // DB 오류 시 통과 (서비스 안정성 우선)
    });
  } catch {
    res.status(401).json({ success: false, message: "유효하지 않은 토큰입니다.", error: "유효하지 않은 토큰입니다." });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: "권한이 없습니다.", error: "권한이 없습니다." });
      return;
    }
    next();
  };
}

/** 플랫폼 관리자 전용 권한 미들웨어 (super_admin은 항상 통과) */
export function requirePermission(perm: keyof PlatformPermissions) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
      return;
    }
    const role = req.user.role;
    if (role === "super_admin") { next(); return; }
    if (role !== "platform_admin") {
      res.status(403).json({ success: false, message: "플랫폼 관리자만 접근 가능합니다.", error: "forbidden" });
      return;
    }
    const perms: Partial<PlatformPermissions> = req.user.permissions || {};
    if (!perms[perm]) {
      res.status(403).json({ success: false, message: `'${perm}' 권한이 없습니다.`, error: "permission_denied", required_permission: perm });
      return;
    }
    next();
  };
}

/**
 * DB roles 배열 기반 역할 검증 미들웨어 (클라이언트 조작 방지)
 */
export function requireDbRoleCheck(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
    return;
  }
  const { userId, role } = req.user;
  if (["super_admin", "platform_admin", "super_manager"].includes(role)) {
    next(); return;
  }
  superAdminDb.execute(sql`SELECT roles, role AS primary_role FROM users WHERE id = ${userId} LIMIT 1`)
    .then(result => {
      const row = result.rows[0] as any;
      if (!row) { res.status(403).json({ success: false, message: "계정을 찾을 수 없습니다.", error: "user_not_found" }); return; }
      const dbRoles: string[] = row.roles?.length ? row.roles : [row.primary_role];
      if (!dbRoles.includes(role)) {
        res.status(403).json({ success: false, message: "현재 역할에 대한 DB 권한이 없습니다.", error: "invalid_role" });
        return;
      }
      next();
    })
    .catch(err => {
      console.error("[requireDbRoleCheck] DB 오류:", err);
      next();
    });
}

/** super_admin 또는 권한 있는 platform_admin만 허용 */
export function requirePlatformRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
      return;
    }
    if (!["super_admin", "platform_admin", ...roles].includes(req.user.role)) {
      res.status(403).json({ success: false, message: "권한이 없습니다.", error: "forbidden" });
      return;
    }
    next();
  };
}
