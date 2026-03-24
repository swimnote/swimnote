import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const _DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ||
  (_DOMAIN ? `https://${_DOMAIN}/api` : "/api");

export async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: `Unexpected response (HTTP ${res.status})` }; }
}

export type SessionKind = "admin" | "parent";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  role: "super_admin" | "pool_admin" | "teacher" | "sub_admin" | "platform_admin";
  swimming_pool_id?: string | null;
  roles: string[];
}

export interface ParentAccount {
  id: string;
  name: string;
  nickname?: string | null;
  phone: string;
  swimming_pool_id: string;
  pool_name?: string | null;
  login_id?: string | null;
}

export interface PoolInfo {
  id: string;
  name: string;
  address: string;
  phone: string;
  owner_name: string;
  owner_email: string;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  subscription_status: "trial" | "active" | "expired" | "suspended" | "cancelled" | "payment_failed" | "pending_deletion" | "deleted";
  subscription_start_at?: string | null;
  subscription_end_at?: string | null;
  theme_color?: string | null;
  logo_url?: string | null;
  logo_emoji?: string | null;
  white_label_enabled?: boolean;
  hide_platform_name?: boolean;
  // 읽기전용 / 결제 상태
  is_readonly?: boolean;
  upload_blocked?: boolean;
  readonly_reason?: string | null;
  payment_failed_at?: string | null;
  // 구독 플랜 정보
  subscription_tier?: string;
  member_count?: number;
  member_limit?: number;
  // 스토리지
  used_storage_bytes?: number;
  base_storage_gb?: number;
  extra_storage_gb?: number;
  storage_used_pct?: number;
  // 삭제까지 남은 일수 (결제 실패 시)
  days_until_deletion?: number | null;
  // 최초 결제 할인 여부
  first_payment_used?: boolean;
}

export interface OwnedPool {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  approval_status: string;
  subscription_status: string;
  theme_color: string | null;
  logo_url: string | null;
  logo_emoji: string | null;
  is_primary: boolean;
}

export interface AccountEntry {
  kind: SessionKind;
  token: string;
  user?: AdminUser;
  parent?: ParentAccount;
}

interface AuthContextType {
  kind: SessionKind | null;
  adminUser: AdminUser | null;
  parentAccount: ParentAccount | null;
  token: string | null;
  pool: PoolInfo | null;
  isLoading: boolean;
  allAccounts: AccountEntry[];
  ownedPools: OwnedPool[];
  lastUsedRole: string | null;
  lastUsedTenant: string | null;
  lastSelectedStudent: string | null;
  unifiedLogin: (identifier: string, password: string) => Promise<{ available_accounts: AccountEntry[] }>;
  completeTotpLogin: (totpSession: string, otpCode: string) => Promise<{ available_accounts: AccountEntry[] }>;
  adminLogin: (email: string, password: string) => Promise<void>;
  parentLogin: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshPool: () => Promise<void>;
  loadOwnedPools: () => Promise<void>;
  switchPool: (poolId: string) => Promise<void>;
  switchRole: (role: string) => Promise<void>;
  activateAccount: (entry: AccountEntry) => Promise<void>;
  setLastUsedRole: (role: string) => Promise<void>;
  setLastUsedTenant: (tenantId: string) => Promise<void>;
  setLastSelectedStudent: (studentId: string) => Promise<void>;
  updateParentNickname: (nickname: string) => void;
  checkRolePermission: (roleKey: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<SessionKind | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [parentAccount, setParentAccount] = useState<ParentAccount | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allAccounts, setAllAccounts] = useState<AccountEntry[]>([]);
  const [ownedPools, setOwnedPools] = useState<OwnedPool[]>([]);
  const [lastUsedRole, setLastUsedRoleState] = useState<string | null>(null);
  const [lastUsedTenant, setLastUsedTenantState] = useState<string | null>(null);
  const [lastSelectedStudent, setLastSelectedStudentState] = useState<string | null>(null);

  useEffect(() => { loadStored(); }, []);

  async function loadStored() {
    try {
      const [
        storedToken, storedKind, storedAdmin, storedParent,
        storedAccounts, storedLastRole, storedLastTenant, storedLastStudent,
      ] = await Promise.all([
        AsyncStorage.getItem("auth_token"),
        AsyncStorage.getItem("auth_kind"),
        AsyncStorage.getItem("auth_admin"),
        AsyncStorage.getItem("auth_parent"),
        AsyncStorage.getItem("auth_all_accounts"),
        AsyncStorage.getItem("last_used_role"),
        AsyncStorage.getItem("last_used_tenant"),
        AsyncStorage.getItem("last_selected_student"),
      ]);

      if (storedLastRole) setLastUsedRoleState(storedLastRole);
      if (storedLastTenant) setLastUsedTenantState(storedLastTenant);
      if (storedLastStudent) setLastSelectedStudentState(storedLastStudent);

      if (storedAccounts) {
        try {
          const accounts: AccountEntry[] = JSON.parse(storedAccounts);
          setAllAccounts(accounts);
        } catch {}
      }

      if (!storedToken || !storedKind) return;
      setToken(storedToken);
      if (storedKind === "admin" && storedAdmin) {
        const user: AdminUser = JSON.parse(storedAdmin);
        if (!user.roles || user.roles.length === 0) user.roles = [user.role];
        setAdminUser(user);
        setKind("admin");
        if (user.swimming_pool_id) await fetchPool(storedToken);
      } else if (storedKind === "parent" && storedParent) {
        const pa: ParentAccount = JSON.parse(storedParent);
        setParentAccount(pa);
        setKind("parent");
      }
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  }

  async function fetchPool(authToken: string) {
    try {
      const res = await fetch(`${API_BASE}/pools/my`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setPool(await safeJson(res));
    } catch (err) { console.error(err); }
  }

  async function refreshPool() { if (token && kind === "admin") await fetchPool(token); }

  async function loadOwnedPools() {
    if (!token || kind !== "admin") return;
    try {
      const res = await fetch(`${API_BASE}/pools/my-pools`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await safeJson(res);
        if (Array.isArray(data)) setOwnedPools(data);
      }
    } catch (err) { console.error(err); }
  }

  async function switchPool(poolId: string) {
    if (!token) return;
    const res = await fetch(`${API_BASE}/pools/switch/${poolId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error("수영장 전환에 실패했습니다.");
    const data = await safeJson(res);
    const newToken: string = data.token;
    const newPool: PoolInfo = data.pool;
    const updatedUser: AdminUser = data.user;
    if (!newToken) throw new Error("토큰 발급 실패");
    setToken(newToken);
    setPool(newPool);
    if (updatedUser) {
      if (!updatedUser.roles || updatedUser.roles.length === 0) updatedUser.roles = [updatedUser.role];
      setAdminUser(updatedUser);
      await AsyncStorage.setItem("auth_admin", JSON.stringify(updatedUser));
    }
    await AsyncStorage.setItem("auth_token", newToken);
    await loadOwnedPools();
  }

  async function setLastUsedRole(role: string) {
    setLastUsedRoleState(role);
    await AsyncStorage.setItem("last_used_role", role);
  }

  async function setLastUsedTenant(tenantId: string) {
    setLastUsedTenantState(tenantId);
    await AsyncStorage.setItem("last_used_tenant", tenantId);
  }

  async function setLastSelectedStudent(studentId: string) {
    setLastSelectedStudentState(studentId);
    await AsyncStorage.setItem("last_selected_student", studentId);
  }

  function updateParentNickname(nickname: string) {
    setParentAccount(prev => prev ? { ...prev, nickname } : prev);
  }

  // 역할 권한 유효성 검증 (서버 확인)
  async function checkRolePermission(roleKey: string): Promise<boolean> {
    if (!token) return false;
    try {
      if (roleKey === "teacher") {
        // teacher: teacher_invites에서 approved 상태 확인
        const res = await fetch(`${API_BASE}/auth/check-role-permission`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ role: roleKey }),
        });
        if (!res.ok) return false;
        const data = await safeJson(res);
        return data.valid === true;
      }
      if (roleKey === "parent") {
        // parent: 항상 유효 (계정 존재 = 유효)
        return !!parentAccount;
      }
      // admin/pool_admin/super_admin: token 유효하면 OK
      return true;
    } catch {
      return true; // 네트워크 오류 시 허용 (오프라인)
    }
  }

  // 특정 계정(AccountEntry)을 활성 세션으로 설정
  async function activateAccount(entry: AccountEntry) {
    const { kind: k, token: t, user, parent } = entry;
    await AsyncStorage.setItem("auth_token", t);
    await AsyncStorage.setItem("auth_kind", k);
    setToken(t);
    setKind(k);
    if (k === "admin" && user) {
      const u = { ...user, roles: user.roles?.length ? user.roles : [user.role] };
      await AsyncStorage.setItem("auth_admin", JSON.stringify(u));
      setAdminUser(u);
      if (u.swimming_pool_id) await fetchPool(t);
    } else if (k === "parent" && parent) {
      await AsyncStorage.setItem("auth_parent", JSON.stringify(parent));
      setParentAccount(parent);
    }
  }

  async function switchRole(role: string) {
    if (!token || !adminUser) return;
    const res = await fetch(`${API_BASE}/auth/switch-role`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || "역할 전환에 실패했습니다.");
    const newToken: string = data.token;
    const updatedUser: AdminUser = { ...adminUser, role: role as AdminUser["role"] };
    await AsyncStorage.multiSet([
      ["auth_token", newToken],
      ["auth_admin", JSON.stringify(updatedUser)],
    ]);
    setToken(newToken);
    setAdminUser(updatedUser);
    if (updatedUser.swimming_pool_id) await fetchPool(newToken);
  }

  async function unifiedLogin(identifier: string, password: string): Promise<{ available_accounts: AccountEntry[] }> {
    const res = await fetch(`${API_BASE}/auth/unified-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      if (data.needs_activation || data.error_code === "needs_activation") {
        throw Object.assign(new Error(data.error || "계정 활성화가 필요합니다."), {
          needs_activation: true, error_code: "needs_activation", teacher_id: data.teacher_id,
        });
      }
      throw Object.assign(new Error(data.error || "로그인에 실패했습니다."), {
        error_code: data.error_code || "unknown",
      });
    }

    // TOTP 2단계 인증 필요
    if (data.totp_required) {
      throw Object.assign(new Error("OTP 인증이 필요합니다."), {
        totp_required: true, totp_session: data.totp_session,
      });
    }

    const accounts: AccountEntry[] = data.available_accounts || [];

    // 전체 계정 목록 저장
    await AsyncStorage.setItem("auth_all_accounts", JSON.stringify(accounts));
    setAllAccounts(accounts);

    // 단일 계정이거나 하위 호환 처리 — 우선 첫 번째 계정으로 활성화
    if (accounts.length > 0) {
      await activateAccount(accounts[0]);
    } else {
      // 구형 응답 호환
      if (data.kind === "admin" && data.user) {
        const entry: AccountEntry = { kind: "admin", token: data.token, user: { ...data.user, roles: data.user.roles || [data.user.role] } };
        await activateAccount(entry);
        accounts.push(entry);
      } else if (data.kind === "parent" && data.parent) {
        const entry: AccountEntry = { kind: "parent", token: data.token, parent: data.parent };
        await activateAccount(entry);
        accounts.push(entry);
      }
    }

    return { available_accounts: accounts };
  }

  async function completeTotpLogin(totpSession: string, otpCode: string): Promise<{ available_accounts: AccountEntry[] }> {
    const res = await fetch(`${API_BASE}/auth/totp/verify-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totp_session: totpSession, otp_code: otpCode }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "OTP 인증에 실패했습니다.");

    const accounts: AccountEntry[] = data.available_accounts || [];
    await AsyncStorage.setItem("auth_all_accounts", JSON.stringify(accounts));
    setAllAccounts(accounts);
    if (accounts.length > 0) await activateAccount(accounts[0]);
    return { available_accounts: accounts };
  }

  async function adminLogin(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "로그인에 실패했습니다.");
    const user: AdminUser = { ...data.user, roles: Array.isArray(data.user.roles) && data.user.roles.length > 0 ? data.user.roles : [data.user.role] };
    await AsyncStorage.multiSet([
      ["auth_token", data.token], ["auth_kind", "admin"], ["auth_admin", JSON.stringify(user)],
    ]);
    setToken(data.token);
    setAdminUser(user);
    setKind("admin");
    if (user.swimming_pool_id) await fetchPool(data.token);
  }

  async function parentLogin(identifier: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/parent-login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw Object.assign(new Error(data.error || "로그인에 실패했습니다."), { error_code: data.error_code || "unknown" });
    await AsyncStorage.multiSet([
      ["auth_token", data.token], ["auth_kind", "parent"], ["auth_parent", JSON.stringify(data.parent)],
    ]);
    setToken(data.token);
    setParentAccount(data.parent);
    setKind("parent");
  }

  async function logout() {
    await AsyncStorage.multiRemove([
      "auth_token", "auth_kind", "auth_admin", "auth_parent",
      "auth_all_accounts", "last_used_role", "last_used_tenant", "last_selected_student",
      "parent_selected_student_id", "brand_data",
    ]);
    setToken(null);
    setKind(null);
    setAdminUser(null);
    setParentAccount(null);
    setPool(null);
    setAllAccounts([]);
    setOwnedPools([]);
    setLastUsedRoleState(null);
    setLastUsedTenantState(null);
    setLastSelectedStudentState(null);
  }

  return (
    <AuthContext.Provider value={{
      kind, adminUser, parentAccount, token, pool, isLoading,
      allAccounts, ownedPools, lastUsedRole, lastUsedTenant, lastSelectedStudent,
      unifiedLogin, completeTotpLogin, adminLogin, parentLogin, logout, refreshPool, loadOwnedPools, switchPool, switchRole,
      activateAccount, setLastUsedRole, setLastUsedTenant, setLastSelectedStudent,
      updateParentNickname, checkRolePermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function apiRequest(token: string | null, path: string, options: RequestInit = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}
