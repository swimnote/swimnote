import type { Request, Response, NextFunction } from "express";
import { verifyToken, TOKEN_VERSION, SUPER_ADMIN_PERMISSIONS, type PlatformPermissions } from "../lib/auth.js";
import { AuthErrorCodes } from "../lib/auth-error-codes.js";
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
  const path = req.path ?? req.url ?? '';
  const isAiPath = path.includes('/v1/teacher-diary') || path.includes('/ai/diary');
  if (isAiPath) {
    const authHeader = req.headers.authorization;
    const hasToken = Boolean(authHeader?.startsWith('Bearer '));
    console.log(`[requireAuth] AI_REQUEST path=${path} method=${req.method} has_token=${hasToken}`);
  }
  const authHeader = req.headers.authorization;
  // Expo Go 등 환경에서 Image 컴포넌트가 Authorization 헤더를 전송 못할 때
  // ?token= 쿼리 파라미터를 폴백으로 허용 (GET 전용 파일 서빙 엔드포인트)
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
  if (!rawToken) {
    res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
    return;
  }
  const token = rawToken;
  try {
    const payload = verifyToken(token);
    if (payload.tv !== TOKEN_VERSION) {
      if (isAiPath) console.log(`[requireAuth] AI_REQUEST token_version_mismatch path=${path}`);
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
    if (isAiPath) console.log(`[requireAuth] AI_REQUEST invalid_token path=${path}`);
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

    // ── pool_admin JWT: DB roles 실시간 확인 (캐시 없음, 권한 회수 즉시 반영) ──────
    // 캐시 없는 이유: 다중 인스턴스 환경에서 인스턴스 간 캐시 무효화가 불가하므로
    // DB 직접 조회가 유일하게 안전한 방법. pool_admin API는 사용자 직접 탭 요청이라
    // SELECT 1회 추가 부하는 허용 수준.
    if (req.user.role === "pool_admin" && roles.includes("pool_admin")) {
      superAdminDb.execute(sql`SELECT roles FROM users WHERE id = ${req.user.userId} LIMIT 1`)
        .then(result => {
          const row = result.rows[0] as any;
          const dbRoles: string[] = Array.isArray(row?.roles) ? row.roles : [];
          if (!dbRoles.includes("pool_admin")) {
            res.status(403).json({
              success: false,
              code: AuthErrorCodes.ROLE_REVOKED,
              message: "관리자 권한이 회수되었습니다.",
            });
            return;
          }
          next();
        })
        .catch(err => {
          console.error("[requireRole] pool_admin DB 권한 확인 오류:", err);
          res.status(503).json({
            success: false,
            code: AuthErrorCodes.ROLE_CHECK_FAILED,
            message: "권한 확인에 실패했습니다. 잠시 후 다시 시도해주세요.",
          });
        });
      return;
    }
    // ──────────────────────────────────────────────────────────────────────────────

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

// ── requireXMode ──────────────────────────────────────────────────────────
//
// SWIMNOTE X 전용 Route에 배치하는 Guard.
// 요청 사용자의 실제 DB 기준 pool X 상태를 확인하고
// mode === "x"일 때만 다음 미들웨어로 진행한다.
//
// poolId 결정 방식 (JWT poolId 신뢰 금지):
//   pool_admin / teacher   → users.swimming_pool_id DB 직접 조회
//   parent_account         → parent_accounts.swimming_pool_id DB 직접 조회
//   super_admin            → req.query.pool_id 또는 req.params.id
//   그 외                   → fail-closed 403
//
// 주의:
//   - super_admin도 X 상태를 우회하지 않음
//   - 앱 전달 mode 신뢰 금지
//   - 기존 일반 API에 적용 금지
//
import { resolvePoolMode } from "../lib/xmode.js";

export function requireXMode(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: "인증이 필요합니다.", error: "인증이 필요합니다." });
    return;
  }

  const role = req.user.role;
  const userId = req.user.userId;

  const resolvePoolId = async (): Promise<string | null> => {
    if (role === "pool_admin" || role === "teacher") {
      const row = await superAdminDb.execute(
        sql`SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1`,
      );
      return (row.rows[0] as any)?.swimming_pool_id ?? null;
    }
    if (role === "parent_account") {
      const row = await superAdminDb.execute(
        sql`SELECT swimming_pool_id FROM parent_accounts WHERE id = ${userId} LIMIT 1`,
      );
      return (row.rows[0] as any)?.swimming_pool_id ?? null;
    }
    if (role === "super_admin") {
      const qid = (req.query as any).pool_id as string | undefined;
      const pid = (req.params as any).id as string | undefined;
      return qid ?? pid ?? null;
    }
    return null;
  };

  resolvePoolId()
    .then(async (poolId) => {
      if (!poolId) {
        const isUnknownRole = !["pool_admin", "teacher", "parent_account", "super_admin"].includes(role);
        if (isUnknownRole) {
          res.status(403).json({ success: false, message: "권한이 없습니다.", error: "권한이 없습니다." });
        } else {
          res.status(400).json({ success: false, error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." });
        }
        return;
      }

      const result = await resolvePoolMode(poolId);

      if (!result) {
        res.status(404).json({ success: false, error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." });
        return;
      }
      if (!result.xmode_entitlement) {
        res.status(403).json({ success: false, error: "XMODE_NOT_ENTITLED", message: "X 모드가 활성화되지 않은 수영장입니다." });
        return;
      }
      if (result.mode !== "x") {
        res.status(403).json({ success: false, error: "XMODE_NOT_READY", message: "X 모드 설정이 완료되지 않았습니다." });
        return;
      }
      next();
    })
    .catch((err) => {
      console.error("[requireXMode] DB 오류:", err);
      res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    });
}
