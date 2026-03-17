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
  role: "super_admin" | "pool_admin" | "teacher";
  swimming_pool_id?: string | null;
}

export interface ParentAccount {
  id: string;
  name: string;
  phone: string;
  swimming_pool_id: string;
  pool_name?: string | null;
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
  subscription_status: "trial" | "active" | "expired" | "suspended" | "cancelled";
  subscription_start_at?: string | null;
  subscription_end_at?: string | null;
  /** 브랜딩 — 앱 내부 테마 색상 */
  theme_color?: string | null;
  /** 브랜딩 — 로고 이미지 URL */
  logo_url?: string | null;
  /** 브랜딩 — 로고 이모지 (로고 없을 때 대체) */
  logo_emoji?: string | null;
}

interface AuthContextType {
  kind: SessionKind | null;
  adminUser: AdminUser | null;
  parentAccount: ParentAccount | null;
  token: string | null;
  pool: PoolInfo | null;
  isLoading: boolean;
  unifiedLogin: (identifier: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  parentLogin: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshPool: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<SessionKind | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [parentAccount, setParentAccount] = useState<ParentAccount | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { loadStored(); }, []);

  async function loadStored() {
    try {
      const [storedToken, storedKind, storedAdmin, storedParent] = await Promise.all([
        AsyncStorage.getItem("auth_token"),
        AsyncStorage.getItem("auth_kind"),
        AsyncStorage.getItem("auth_admin"),
        AsyncStorage.getItem("auth_parent"),
      ]);
      if (!storedToken || !storedKind) return;
      setToken(storedToken);
      if (storedKind === "admin" && storedAdmin) {
        const user: AdminUser = JSON.parse(storedAdmin);
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

  async function unifiedLogin(identifier: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/unified-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      if (data.needs_activation || data.error_code === "needs_activation") {
        throw Object.assign(new Error(data.error || "계정 활성화가 필요합니다."), {
          needs_activation: true,
          error_code: "needs_activation",
          teacher_id: data.teacher_id,
        });
      }
      throw Object.assign(new Error(data.error || "로그인에 실패했습니다."), {
        error_code: data.error_code || "unknown",
      });
    }
    await AsyncStorage.setItem("auth_token", data.token);
    setToken(data.token);
    if (data.kind === "admin") {
      await AsyncStorage.multiSet([
        ["auth_kind", "admin"],
        ["auth_admin", JSON.stringify(data.user)],
      ]);
      setAdminUser(data.user);
      setKind("admin");
      if (data.user.swimming_pool_id) await fetchPool(data.token);
    } else if (data.kind === "parent") {
      await AsyncStorage.multiSet([
        ["auth_kind", "parent"],
        ["auth_parent", JSON.stringify(data.parent)],
      ]);
      setParentAccount(data.parent);
      setKind("parent");
    }
  }

  async function adminLogin(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "로그인에 실패했습니다.");
    await AsyncStorage.multiSet([
      ["auth_token", data.token],
      ["auth_kind", "admin"],
      ["auth_admin", JSON.stringify(data.user)],
    ]);
    setToken(data.token);
    setAdminUser(data.user);
    setKind("admin");
    if (data.user.swimming_pool_id) await fetchPool(data.token);
  }

  async function parentLogin(identifier: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/parent-login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw Object.assign(new Error(data.error || "로그인에 실패했습니다."), {
      error_code: data.error_code || "unknown",
    });
    await AsyncStorage.multiSet([
      ["auth_token", data.token],
      ["auth_kind", "parent"],
      ["auth_parent", JSON.stringify(data.parent)],
    ]);
    setToken(data.token);
    setParentAccount(data.parent);
    setKind("parent");
  }

  async function logout() {
    await AsyncStorage.multiRemove([
      "auth_token",
      "auth_kind",
      "auth_admin",
      "auth_parent",
      "parent_selected_student_id",
      "brand_data",
    ]);
    setToken(null);
    setKind(null);
    setAdminUser(null);
    setParentAccount(null);
    setPool(null);
  }

  return (
    <AuthContext.Provider value={{ kind, adminUser, parentAccount, token, pool, isLoading, unifiedLogin, adminLogin, parentLogin, logout, refreshPool }}>
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
