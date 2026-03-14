import type { Request, Response, NextFunction } from "express";
import { verifyToken, SUPER_ADMIN_PERMISSIONS, type PlatformPermissions } from "../lib/auth.js";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    poolId?: string | null;
    permissions?: PlatformPermissions;
  };
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
    req.user = payload;
    next();
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
    const perms = req.user.permissions || {};
    if (!perms[perm]) {
      res.status(403).json({ success: false, message: `'${perm}' 권한이 없습니다.`, error: "permission_denied", required_permission: perm });
      return;
    }
    next();
  };
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
