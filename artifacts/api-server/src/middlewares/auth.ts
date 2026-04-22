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
  };
}

// ── 탈퇴 계정 캐시 (1분 TTL) — DB 부하 최소화 ──────────────────────────
const WITHDRAWN_CACHE_TTL_MS = 60_000;
const withdrawnCache = new Map<string, { withdrawn: boolean; at: number }>();

function isWithdrawnCached(userId: string): boolean | null {
  const entry = withdrawnCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.at > WITHDRAWN_CACHE_TTL_MS) {
    withdrawnCache.delete(userId);
    return null;
  }
  return entry.withdrawn;
}
function setWithdrawnCache(userId: string, withdrawn: boolean) {
  withdrawnCache.set(userId, { withdrawn, at: Date.now() });
}

// 탈퇴 체크 대상 역할 (users 테이블 소속)
const SKIP_WITHDRAWAL_ROLES = new Set([
  "super_admin", "platform_admin", "super_manager",
  "parent_account", "parent", // parent_accounts 테이블 소속 — 별도 처리
]);

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
    req.user = payload;

    // 탈퇴 체크 불필요 역할은 즉시 통과
    if (SKIP_WITHDRAWAL_ROLES.has(payload.role)) {
      next();
      return;
    }

    // pool_admin / teacher / sub_admin — 탈퇴 요청 계정 차단
    const userId = payload.userId;
    const cached = isWithdrawnCached(userId);
    if (cached === true) {
      res.status(401).json({ success: false, message: "탈퇴 처리된 계정입니다.", error: "account_withdrawn" });
      return;
    }
    if (cached === false) {
      next();
      return;
    }

    // 캐시 미스 → users 테이블 DB 조회 (비동기)
    superAdminDb.execute(sql`
      SELECT is_activated, withdrawal_requested_at FROM users
      WHERE id = ${userId} LIMIT 1
    `).then(result => {
      const row = result.rows[0] as any;
      if (!row) {
        // users 테이블에 없음 = 삭제된 계정
        setWithdrawnCache(userId, true);
        res.status(401).json({ success: false, message: "존재하지 않는 계정입니다.", error: "account_deleted" });
        return;
      }
      // is_activated=false(탈퇴 처리) 또는 withdrawal_requested_at 존재(탈퇴 예약)
      const isWithdrawn = !row.is_activated || !!row.withdrawal_requested_at;
      setWithdrawnCache(userId, isWithdrawn);
      if (isWithdrawn) {
        res.status(401).json({ success: false, message: "탈퇴 처리된 계정입니다.", error: "account_withdrawn" });
        return;
      }
      next();
    }).catch(err => {
      console.error("[requireAuth] 탈퇴 체크 DB 오류:", err);
      // DB 오류 시 통과 (서비스 안정성 우선)
      next();
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
 * JWT role이 DB의 실제 roles 배열에 포함되어 있는지 확인한다.
 * super 계열(super_admin, platform_admin, super_manager)은 검증 생략.
 * 사용: 역할 전환/검증 등 민감한 엔드포인트에 적용
 */
export function requireDbRoleCheck(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
    return;
  }
  const { userId, role } = req.user;
  // super 계열은 DB 검증 생략
  if (["super_admin", "platform_admin", "super_manager"].includes(role)) {
    next(); return;
  }
  // DB에서 해당 userId의 roles 배열 조회 후 role 포함 여부 확인
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
      // DB 오류 시 통과 (서비스 안정성 우선)
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
