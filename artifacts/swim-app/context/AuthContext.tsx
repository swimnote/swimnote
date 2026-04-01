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
import React, { createContext, useContext, ReactNode } from "react";
import { SessionProvider, useSession } from "./auth/SessionContext";
import { RoleProvider, useRole } from "./auth/RoleContext";

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

export const AuthContext = createContext<any>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <RoleProvider>
        {children}
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
    isLoading: session.isLoading,
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
    setParentSession: session.setParentSession,
    setAdminSession: session.setAdminSession,
    logout: async () => {
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

    switchRole: role.switchRole,
    setLastUsedRole: role.setActiveRole,
    setLastUsedTenant: role.setActivePoolId,
    setLastSelectedStudent: role.setLastSelectedStudent,
    setActiveRole: role.setActiveRole,
    setActivePoolId: role.setActivePoolId,
  };
}

export function apiRequest(token: string | null, path: string, options: RequestInit = {}) {
  return fetch(`${_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}
