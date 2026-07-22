/**
 * AuthContext — SessionContext + RoleContext 조합 Provider
 * 얇은 래퍼: 두 Context를 하나의 Provider 트리로 묶고,
 * 기존 useAuth() 인터페이스를 유지하여 하위 호환성 보장.
 *
 * 코드 접근:
 *   - 세션 데이터만 필요하면 → useSession()
 *   - 역할 데이터만 필요하면 → useRole()
 *   - 기존 코드 그대로 유지 → useAuth()
 */
import React, { createContext, useContext, useEffect, useRef, ReactNode } from "react";
import { Alert, AppState, AppStateStatus } from "react-native";
import { router } from "expo-router";
import { SessionProvider, useSession, API_BASE as _ROLES_API_BASE } from "./auth/SessionContext";
import { RoleProvider, useRole } from "./auth/RoleContext";
import { AuthErrorCodes } from "@/constants/auth-error-codes";

export type {
  SessionKind,
  AdminUser,
  ParentAccount,
  PoolInfo,
  OwnedPool,
  AccountEntry,
} from "./auth/SessionContext";

export { safeJson, API_BASE } from "./auth/SessionContext";
import { API_BASE as _API_BASE } from "./auth/SessionContext";

// 전역 강제 로그아웃 핸들러 — account_withdrawn/account_deleted 401 수신 시 호출
let _globalLogoutHandler: (() => void) | null = null;
export function setGlobalLogoutHandler(fn: () => void) { _globalLogoutHandler = fn; }
export function clearGlobalLogoutHandler() { _globalLogoutHandler = null; }

// 전역 권한 회수 핸들러 — ROLE_REVOKED 403 수신 시 호출
let _globalRoleRevokedHandler: (() => Promise<void>) | null = null;
export function setGlobalRoleRevokedHandler(fn: () => Promise<void>) { _globalRoleRevokedHandler = fn; }
export function clearGlobalRoleRevokedHandler() { _globalRoleRevokedHandler = null; }

// single-flight: ROLE_REVOKED 동시 다발 시 중복 실행 방지
let _isHandlingRoleRevoked = false;

/**
 * handleRoleRevoked — 관리자 권한 회수 처리 (순수 async 함수)
 * 의존성을 매개변수로 주입받으므로 향후 RoleManager.ts로 분리 용이
 */
async function _handleRoleRevokedLogic(deps: {
  switchRole: (role: string) => Promise<void>;
  onLogout: () => Promise<void>;
}): Promise<void> {
  const { switchRole, onLogout } = deps;
  try {
    await switchRole("teacher");
    clearApiCache();
    router.replace("/(teacher)/today-schedule");
    Alert.alert(
      "권한 변경 안내",
      "관리자 권한이 회수되어 선생님 모드로 전환되었습니다.",
    );
  } catch (e) {
    console.error("[RoleRevoked] teacher 전환 실패, 로그아웃 처리:", e);
    clearApiCache();
    await onLogout();
  }
}

// ─── GET 인메모리 캐시 ────────────────────────────────────────────────────────
// 규칙: GET 2xx 응답만 캐시 / 쓰기 요청 시 관련 캐시 자동 삭제 / 30초 TTL
const _CACHE_TTL = 30_000;
interface _CacheEntry { data: unknown; expiresAt: number; }
const _apiCache = new Map<string, _CacheEntry>();

function _makeCacheKey(token: string | null, path: string) {
  return `${token ? token.slice(0, 20) : "anon"}::${path}`;
}
function _getCached(key: string): unknown | null {
  const entry = _apiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _apiCache.delete(key); return null; }
  return entry.data;
}
function _setCached(key: string, data: unknown) {
  _apiCache.set(key, { data, expiresAt: Date.now() + _CACHE_TTL });
}
function _bustRelated(path: string) {
  const base = path.split("?")[0];
  for (const k of _apiCache.keys()) { if (k.includes(base)) _apiCache.delete(k); }
}
export function clearApiCache() { _apiCache.clear(); }
// ─────────────────────────────────────────────────────────────────────────────

export const AuthContext = createContext<any>(null);

// 탈퇴 계정 401 / 권한 회수 403 감지 시 자동 처리 등록 컴포넌트
function WithdrawalGuard({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = useRole();

  useEffect(() => {
    // 탈퇴·삭제 계정 → 강제 로그아웃
    setGlobalLogoutHandler(async () => {
      clearApiCache();
      await session.logout();
      await role.clearRole();
    });

    // 관리자 권한 회수 → teacher 모드 강제 복귀 (single-flight)
    setGlobalRoleRevokedHandler(async () => {
      if (_isHandlingRoleRevoked) return;
      _isHandlingRoleRevoked = true;
      try {
        await _handleRoleRevokedLogic({
          switchRole: role.switchRole,
          onLogout: async () => {
            await session.logout();
            await role.clearRole();
          },
        });
      } finally {
        // 중복 호출 방지 잠금 해제 (약간의 여유 시간 후)
        setTimeout(() => { _isHandlingRoleRevoked = false; }, 5_000);
      }
    });

    return () => {
      clearGlobalLogoutHandler();
      clearGlobalRoleRevokedHandler();
    };
  }, [session.logout, role.switchRole, role.clearRole]);

  return <>{children}</>;
}

// ─── roles 실시간 갱신 로직 ──────────────────────────────────────────────────
// 폴링 주기: 15초 / 조건: admin 로그인 + active + teacher or pool_admin
const ROLES_POLL_INTERVAL_MS = 15_000;

/**
 * applyServerRoleState — 서버 최신 roles 수신 후 세션/라우팅 반영
 *
 * 1. roles 변경 없으면 early return
 * 2. setAdminUser + AsyncStorage 갱신
 * 3. activeRole이 새 roles에 없으면 → ROLE_REVOKED 처리 (teacher 복귀 + Alert)
 * 4. activeRole이 새 roles에 있으면 → 세션 갱신만, 강제 이동 없음
 *
 * single-flight: _isHandlingRoleRevoked 재사용 (ROLE_REVOKED와 충돌 방지)
 */
async function _applyServerRoleState(
  serverRole: string,
  serverRoles: string[],
  deps: {
    adminUser: import("./auth/SessionContext").AdminUser;
    updateAdminProfile: (fields: Partial<import("./auth/SessionContext").AdminUser>) => void;
    activeRole: string | null;
    switchRole: (role: string) => Promise<void>;
    onLogout: () => Promise<void>;
  }
): Promise<void> {
  const { adminUser, updateAdminProfile, activeRole, switchRole, onLogout } = deps;

  // 변경 없으면 early return
  // serverRole(DB base role)은 adminUser.role(현재 활성 JWT role)과 다를 수 있으므로 비교하지 않음.
  // roles 배열만 비교하여 실제 권한 변경 여부를 판단.
  const currentRoles = adminUser.roles?.length ? adminUser.roles : [adminUser.role];
  const normalizedServer = [...serverRoles].sort().join(",");
  const normalizedCurrent = [...currentRoles].sort().join(",");
  if (normalizedServer === normalizedCurrent) return;

  console.log(`[RoleSync] roles 변경 감지: ${normalizedCurrent} → ${normalizedServer}`);

  // roles만 갱신. role 필드는 절대 덮어쓰지 않음.
  // adminUser.role은 switchRole()이 관리하는 현재 활성 JWT role임.
  // serverRole은 DB base role("teacher")이므로 pool_admin 모드를 덮어쓰면 안 됨.
  updateAdminProfile({ roles: serverRoles });

  // activeRole 유효성 확인
  const currentActive = activeRole ?? adminUser.role;
  if (currentActive && !serverRoles.includes(currentActive)) {
    // 현재 역할이 새 roles에 없음 → ROLE_REVOKED 처리
    if (_isHandlingRoleRevoked) return;
    _isHandlingRoleRevoked = true;
    try {
      await _handleRoleRevokedLogic({ switchRole, onLogout });
    } finally {
      setTimeout(() => { _isHandlingRoleRevoked = false; }, 5_000);
    }
  }
  // activeRole이 새 roles에 있으면 → 세션 갱신만 (사용자 강제 이동 없음)
}

// in-flight 잠금: 폴링과 AppState 복귀가 동시에 오더라도 중복 /auth/role-status 호출 방지
let _isRefreshingRoles = false;

/**
 * RolesPollingGuard — roles 실시간 갱신 담당 컴포넌트
 *
 * - 15초 폴링: kind=admin, token 있음, teacher 또는 pool_admin 계정
 * - AppState background→active 복귀 시 즉시 role-status 조회 (임계값 없음)
 * - 폴링/복귀 동시 발생 시 in-flight 잠금으로 중복 방지
 */
function RolesPollingGuard({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = useRole();

  const tokenRef = useRef(session.token);
  const adminUserRef = useRef(session.adminUser);
  const activeRoleRef = useRef(role.activeRole);
  const kindRef = useRef(session.kind);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const updateAdminProfileRef = useRef(session.updateAdminProfile);
  const switchRoleRef = useRef(role.switchRole);
  const logoutRef = useRef(session.logout);
  const clearRoleRef = useRef(role.clearRole);

  useEffect(() => { tokenRef.current = session.token; }, [session.token]);
  useEffect(() => { adminUserRef.current = session.adminUser; }, [session.adminUser]);
  useEffect(() => { activeRoleRef.current = role.activeRole; }, [role.activeRole]);
  useEffect(() => { kindRef.current = session.kind; }, [session.kind]);
  useEffect(() => { updateAdminProfileRef.current = session.updateAdminProfile; }, [session.updateAdminProfile]);
  useEffect(() => { switchRoleRef.current = role.switchRole; }, [role.switchRole]);
  useEffect(() => { logoutRef.current = session.logout; }, [session.logout]);
  useEffect(() => { clearRoleRef.current = role.clearRole; }, [role.clearRole]);

  async function checkRoles() {
    const t = tokenRef.current;
    const user = adminUserRef.current;
    if (!t || !user || kindRef.current !== "admin") return;
    if (_isRefreshingRoles || _isHandlingRoleRevoked) return;

    // teacher 또는 pool_admin 계정만 폴링 (super 계열·parent 제외)
    const currentRole = activeRoleRef.current ?? user.role;
    if (currentRole !== "teacher" && currentRole !== "pool_admin" && currentRole !== "sub_admin") return;

    _isRefreshingRoles = true;
    try {
      const res = await fetch(`${_ROLES_API_BASE}/auth/role-status`, {
        headers: { Authorization: `Bearer ${t}` },
        cache: "no-store",
      });

      // 401 → 기존 로그아웃 정책 적용
      if (res.status === 401) {
        _globalLogoutHandler?.();
        return;
      }
      // 403 ROLE_REVOKED → 기존 핸들러로 위임
      if (res.status === 403) {
        try {
          const body = await res.clone().json().catch(() => ({}));
          if (body?.code === AuthErrorCodes.ROLE_REVOKED) {
            _globalRoleRevokedHandler?.();
          }
        } catch {}
        return;
      }
      // 네트워크 오류·5xx → 현재 세션 유지, 다음 주기에 재시도 (로그아웃 금지)
      if (!res.ok) return;

      const data = await res.json().catch(() => null);
      if (!data?.success || !data.roles || !adminUserRef.current) return;

      await _applyServerRoleState(data.role, data.roles, {
        adminUser: adminUserRef.current,
        updateAdminProfile: updateAdminProfileRef.current,
        activeRole: activeRoleRef.current,
        switchRole: switchRoleRef.current,
        onLogout: async () => {
          clearApiCache();
          await logoutRef.current();
          await clearRoleRef.current();
        },
      });
    } catch {
      // 네트워크 오류: 현재 세션 유지, Alert 없음
    } finally {
      _isRefreshingRoles = false;
    }
  }

  // 15초 폴링
  useEffect(() => {
    if (session.kind !== "admin" || !session.token) return;
    const id = setInterval(() => {
      if (AppState.currentState === "active") {
        checkRoles();
      }
    }, ROLES_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [session.kind, session.token]);

  // AppState background→active 복귀 시 즉시 확인
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === "background" || prev === "inactive") && nextState === "active") {
        checkRoles();
      }
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <RoleProvider>
        <WithdrawalGuard>
          <RolesPollingGuard>
            {children}
          </RolesPollingGuard>
        </WithdrawalGuard>
      </RoleProvider>
    </SessionProvider>
  );
}

export function useAuth() {
  const session = useSession();
  const role = useRole();

  return {
    kind: session.kind,
    adminUser: session.adminUser,
    parentAccount: session.parentAccount,
    token: session.token,
    pool: session.pool,
    parentPoolName: session.parentPoolName,
    isLoading: session.isLoading,
    isAuthenticating: session.isAuthenticating,
    allAccounts: session.allAccounts,
    ownedPools: session.ownedPools,
    parentJoinStatus: session.parentJoinStatus,
    parentJoinRequestId: session.parentJoinRequestId,

    activeRole: role.activeRole,
    activePoolId: role.activePoolId,
    lastUsedRole: role.activeRole,
    lastUsedTenant: role.activePoolId,
    lastSelectedStudent: role.lastSelectedStudent,

    unifiedLogin: session.unifiedLogin,
    completeTotpLogin: session.completeTotpLogin,
    adminLogin: session.adminLogin,
    parentLogin: session.parentLogin,
    kakaoSocialLogin: session.kakaoSocialLogin,
    appleSocialLogin: session.appleSocialLogin,
    setParentSession: session.setParentSession,
    setAdminSession: session.setAdminSession,
    logout: async () => {
      clearApiCache();
      await session.logout();
      await role.clearRole();
    },
    refreshPool: session.refreshPool,
    loadOwnedPools: session.loadOwnedPools,
    switchPool: session.switchPool,
    activateAccount: session.activateAccount,
    updateParentNickname: session.updateParentNickname,
    updateParentProfile: session.updateParentProfile,
    updateAdminProfile: session.updateAdminProfile,
    checkRolePermission: session.checkRolePermission,
    refreshSession: session.refreshSession,
    finishLogin: session.finishLogin,
    pendingRoute: session.pendingRoute,
    clearPendingRoute: session.clearPendingRoute,

    switchRole: role.switchRole,
    setLastUsedRole: role.setActiveRole,
    setLastUsedTenant: role.setActivePoolId,
    setLastSelectedStudent: role.setLastSelectedStudent,
    setActiveRole: role.setActiveRole,
    setActivePoolId: role.setActivePoolId,
  };
}

export async function apiRequest(token: string | null, path: string, options: RequestInit = {}) {
  const url = `${_API_BASE}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET";

  // ── 쓰기 요청: 관련 캐시 즉시 삭제 ──────────────────────────────────────
  if (isWrite) _bustRelated(path);

  // ── GET: 캐시 히트 시 즉시 반환 ──────────────────────────────────────────
  if (!isWrite) {
    try {
      const cacheKey = _makeCacheKey(token, path);
      const cached = _getCached(cacheKey);
      if (cached !== null) {
        console.log(`[API↩] HIT ${path}`);
        // 실제 Response와 동일한 인터페이스 유지 (.ok .status .json() .clone())
        const fakeRes = {
          ok: true,
          status: 200,
          json: async () => cached,
          clone: () => ({ ok: true, status: 200, json: async () => cached }),
        } as unknown as Response;
        return fakeRes;
      }
    } catch {}
  }

  console.log(`[API→] ${method} ${url}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") throw new Error("요청 시간이 초과됐습니다. 네트워크 연결을 확인해주세요.");
    throw e;
  }
  clearTimeout(timeoutId);
  console.log(`[API←] ${res.status} ${url}`);

  // ── GET 2xx 응답만 캐시 저장 ─────────────────────────────────────────────
  if (!isWrite && res.ok) {
    try {
      const cacheKey = _makeCacheKey(token, path);
      const clonedForCache = res.clone();
      clonedForCache.json().then(data => _setCached(cacheKey, data)).catch(() => {});
    } catch {}
  }

  // ── 탈퇴/삭제 계정 → 전역 강제 로그아웃 ─────────────────────────────────
  if (res.status === 401) {
    try {
      const cloned = res.clone();
      const body = await cloned.json().catch(() => ({}));
      if (body?.error === "account_withdrawn" || body?.error === "account_deleted") {
        console.warn("[apiRequest] 탈퇴 계정 감지 → 강제 로그아웃");
        _globalLogoutHandler?.();
      }
    } catch {}
  }

  // ── ROLE_REVOKED → teacher 모드 강제 복귀 ────────────────────────────────
  if (res.status === 403) {
    try {
      const cloned = res.clone();
      const body = await cloned.json().catch(() => ({}));
      if (body?.code === AuthErrorCodes.ROLE_REVOKED) {
        console.warn("[apiRequest] ROLE_REVOKED 감지 → teacher 모드 강제 복귀");
        _globalRoleRevokedHandler?.();
      }
    } catch {}
  }

  return res;
}
