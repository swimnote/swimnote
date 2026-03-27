/**
 * SessionContext — JWT 토큰, 사용자 데이터, 풀 정보, 로그인/로그아웃 관리
 * 역할: 인증(1단계) — 토큰 발급, 세션 유지, 계정 전환
 */
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const _DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE =
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
  is_readonly?: boolean;
  upload_blocked?: boolean;
  readonly_reason?: string | null;
  payment_failed_at?: string | null;
  subscription_tier?: string;
  member_count?: number;
  member_limit?: number;
  used_storage_bytes?: number;
  base_storage_gb?: number;
  extra_storage_gb?: number;
  storage_used_pct?: number;
  days_until_deletion?: number | null;
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
  join_status?: string;
  join_request_id?: string | null;
}

interface SessionContextType {
  kind: SessionKind | null;
  adminUser: AdminUser | null;
  parentAccount: ParentAccount | null;
  token: string | null;
  pool: PoolInfo | null;
  isLoading: boolean;
  allAccounts: AccountEntry[];
  ownedPools: OwnedPool[];
  parentJoinStatus: string | null;
  parentJoinRequestId: string | null;
  unifiedLogin: (identifier: string, password: string) => Promise<{ available_accounts: AccountEntry[] }>;
  completeTotpLogin: (totpSession: string, otpCode: string) => Promise<{ available_accounts: AccountEntry[] }>;
  adminLogin: (email: string, password: string) => Promise<void>;
  parentLogin: (identifier: string, password: string) => Promise<void>;
  setParentSession: (token: string, parent: ParentAccount) => Promise<void>;
  logout: () => Promise<void>;
  refreshPool: () => Promise<void>;
  loadOwnedPools: () => Promise<void>;
  switchPool: (poolId: string) => Promise<void>;
  activateAccount: (entry: AccountEntry) => Promise<void>;
  updateParentNickname: (nickname: string) => void;
  checkRolePermission: (roleKey: string) => Promise<boolean>;
  applyRoleSwitch: (newToken: string, updatedUser: AdminUser) => Promise<void>;
}

export const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<SessionKind | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [parentAccount, setParentAccount] = useState<ParentAccount | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allAccounts, setAllAccounts] = useState<AccountEntry[]>([]);
  const [ownedPools, setOwnedPools] = useState<OwnedPool[]>([]);
  const [parentJoinStatus, setParentJoinStatus] = useState<string | null>(null);
  const [parentJoinRequestId, setParentJoinRequestId] = useState<string | null>(null);

  useEffect(() => { loadStored(); }, []);

  async function loadStored() {
    try {
      const [
        storedToken, storedKind, storedAdmin, storedParent, storedAccounts,
        storedJoinStatus, storedJoinRequestId,
      ] = await Promise.all([
        AsyncStorage.getItem("auth_token"),
        AsyncStorage.getItem("auth_kind"),
        AsyncStorage.getItem("auth_admin"),
        AsyncStorage.getItem("auth_parent"),
        AsyncStorage.getItem("auth_all_accounts"),
        AsyncStorage.getItem("parent_join_status"),
        AsyncStorage.getItem("parent_join_request_id"),
      ]);

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
        setParentJoinStatus(storedJoinStatus || null);
        setParentJoinRequestId(storedJoinRequestId || null);
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

  async function activateAccount(entry: AccountEntry) {
    const { kind: k, token: t, user, parent, join_status, join_request_id } = entry;
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
      const js = join_status ?? "approved";
      const jri = join_request_id ?? null;
      await AsyncStorage.setItem("parent_join_status", js);
      if (jri) await AsyncStorage.setItem("parent_join_request_id", jri);
      else await AsyncStorage.removeItem("parent_join_request_id");
      setParentJoinStatus(js);
      setParentJoinRequestId(jri);
    }
  }

  async function applyRoleSwitch(newToken: string, updatedUser: AdminUser) {
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
    if (data.totp_required) {
      throw Object.assign(new Error("OTP 인증이 필요합니다."), {
        totp_required: true, totp_session: data.totp_session,
      });
    }
    const accounts: AccountEntry[] = data.available_accounts || [];
    await AsyncStorage.setItem("auth_all_accounts", JSON.stringify(accounts));
    setAllAccounts(accounts);
    if (accounts.length > 0) {
      await activateAccount(accounts[0]);
    } else {
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

  async function setParentSession(token: string, parent: ParentAccount) {
    await AsyncStorage.multiSet([
      ["auth_token", token], ["auth_kind", "parent"], ["auth_parent", JSON.stringify(parent)],
    ]);
    setToken(token);
    setParentAccount(parent);
    setKind("parent");
  }

  async function logout() {
    await AsyncStorage.multiRemove([
      "auth_token", "auth_kind", "auth_admin", "auth_parent",
      "auth_all_accounts", "last_used_role", "last_used_tenant", "last_selected_student",
      "parent_selected_student_id", "brand_data",
      "parent_join_status", "parent_join_request_id",
    ]);
    setToken(null);
    setKind(null);
    setAdminUser(null);
    setParentAccount(null);
    setPool(null);
    setAllAccounts([]);
    setOwnedPools([]);
    setParentJoinStatus(null);
    setParentJoinRequestId(null);
  }

  function updateParentNickname(nickname: string) {
    setParentAccount(prev => prev ? { ...prev, nickname } : prev);
  }

  async function checkRolePermission(roleKey: string): Promise<boolean> {
    if (!token) return false;
    try {
      if (roleKey === "parent") return !!parentAccount;
      // 서버에서 현재 JWT 역할이 DB roles에 존재하는지 검증 (클라이언트 조작 방지)
      const res = await fetch(`${API_BASE}/auth/check-role-permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: roleKey }),
      });
      if (!res.ok) return false;
      const data = await safeJson(res);
      return data.valid === true;
    } catch {
      // 네트워크 오류 시 기존 세션 유지 (오프라인 허용)
      return true;
    }
  }

  return (
    <SessionContext.Provider value={{
      kind, adminUser, parentAccount, token, pool, isLoading,
      allAccounts, ownedPools, parentJoinStatus, parentJoinRequestId,
      unifiedLogin, completeTotpLogin, adminLogin, parentLogin, setParentSession,
      logout, refreshPool, loadOwnedPools, switchPool,
      activateAccount, updateParentNickname, checkRolePermission, applyRoleSwitch,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
