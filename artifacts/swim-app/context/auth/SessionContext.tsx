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

const APP_VERSION = "1.2.0-106-b2";

export async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: `Unexpected response (HTTP ${res.status})` }; }
}

// safeJson 타임아웃 버전: res.text() 행 방지 (바디 수신 지연 시 무한 대기 방지)
export async function safeJsonT(res: Response, ms = 6000): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const textPromise = res.text();
  const timeoutPromise = new Promise<string>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`safeJsonT timeout ${ms}ms`)), ms);
  });
  try {
    const text = await Promise.race([textPromise, timeoutPromise]);
    try { return JSON.parse(text as string); }
    catch { return { error: `Unexpected response (HTTP ${res.status})` }; }
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export type SessionKind = "admin" | "parent";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  role: "super_admin" | "pool_admin" | "teacher" | "sub_admin" | "platform_admin" | "super_manager";
  swimming_pool_id?: string | null;
  roles: string[];
  is_activated?: boolean;
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
  storage_mb?: number;
  display_storage?: string;
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
  parentPoolName: string | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  allAccounts: AccountEntry[];
  ownedPools: OwnedPool[];
  parentJoinStatus: string | null;
  parentJoinRequestId: string | null;
  unifiedLogin: (identifier: string, password: string) => Promise<{ available_accounts: AccountEntry[] }>;
  completeTotpLogin: (totpSession: string, otpCode: string) => Promise<{ available_accounts: AccountEntry[] }>;
  adminLogin: (email: string, password: string) => Promise<void>;
  parentLogin: (identifier: string, password: string) => Promise<void>;
  kakaoSocialLogin: (accessToken: string) => Promise<"admin" | "parent">;
  appleSocialLogin: (identityToken: string, fullName?: string | null, traceId?: string) => Promise<"admin" | "parent">;
  setParentSession: (token: string, parent: ParentAccount) => Promise<void>;
  setAdminSession: (token: string, user: AdminUser) => Promise<void>;
  logout: () => Promise<void>;
  refreshPool: () => Promise<void>;
  loadOwnedPools: () => Promise<void>;
  switchPool: (poolId: string) => Promise<void>;
  activateAccount: (entry: AccountEntry) => Promise<void>;
  updateParentNickname: (nickname: string) => void;
  updateParentProfile: (fields: Partial<ParentAccount>) => void;
  updateAdminProfile: (fields: Partial<AdminUser>) => void;
  checkRolePermission: (roleKey: string) => Promise<boolean>;
  applyRoleSwitch: (newToken: string, updatedUser: AdminUser) => Promise<void>;
  finishLogin: (k: "admin" | "parent", user: AdminUser | null, parent?: ParentAccount | null) => void;
  pendingRoute: string | null;
  clearPendingRoute: () => void;
}

export const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  // [AUTH COMPLETE] 공통 완료 체인 계측을 위해 setState 래퍼 사용
  // 모든 로그인 경로(Apple/Kakao/일반/구글)에서 호출되는 공통 setter를 단일 지점에서 추적
  const [kind, _setKind] = useState<SessionKind | null>(null);
  const [adminUser, _setAdminUser] = useState<AdminUser | null>(null);
  const [parentAccount, _setParentAccount] = useState<ParentAccount | null>(null);
  const [token, _setToken] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [isLoading, _setIsLoading] = useState(true);
  const [isAuthenticating, _setIsAuthenticating] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  function setToken(t: string | null) {
    console.log(`[AUTH COMPLETE][4] setToken QUEUED → ${t ? "has_token" : "null"}`);
    _setToken(t);
    console.log(`[AUTH COMPLETE][5] setToken DONE (state update scheduled)`);
  }
  function setAdminUser(u: AdminUser | null | ((prev: AdminUser | null) => AdminUser | null)) {
    if (typeof u !== "function") console.log(`[AUTH COMPLETE][6] setAdminUser QUEUED → role=${(u as AdminUser | null)?.role ?? "null"}`);
    _setAdminUser(u as any);
    if (typeof u !== "function") console.log(`[AUTH COMPLETE][7] setAdminUser DONE`);
  }
  function setParentAccount(p: ParentAccount | null | ((prev: ParentAccount | null) => ParentAccount | null)) {
    if (typeof p !== "function") console.log(`[AUTH COMPLETE][6] setParentAccount QUEUED → id=${(p as ParentAccount | null)?.id?.substring(0,8) ?? "null"}`);
    _setParentAccount(p as any);
    if (typeof p !== "function") console.log(`[AUTH COMPLETE][7] setParentAccount DONE`);
  }
  function setKind(k: SessionKind | null) {
    console.log(`[AUTH COMPLETE][8] setKind START → ${k}`);
    _setKind(k);
    console.log(`[AUTH COMPLETE][9] setKind DONE (next render will have kind=${k})`);
  }
  function setIsLoading(v: boolean | ((prev: boolean) => boolean)) {
    if (typeof v === "boolean") console.log(`[AUTH COMPLETE][14a] setIsLoading → ${v}`);
    _setIsLoading(v);
  }
  function setIsAuthenticating(v: boolean) {
    console.log(`[AUTH COMPLETE][14b] setIsAuthenticating → ${v}`);
    _setIsAuthenticating(v);
  }
  const [allAccounts, setAllAccounts] = useState<AccountEntry[]>([]);
  const [ownedPools, setOwnedPools] = useState<OwnedPool[]>([]);
  const [parentJoinStatus, setParentJoinStatus] = useState<string | null>(null);
  const [parentJoinRequestId, setParentJoinRequestId] = useState<string | null>(null);
  const [parentPoolName, setParentPoolName] = useState<string | null>(null);

  useEffect(() => {
    // 안전 타임아웃: 12초 이상 isLoading이 유지되면 강제 해제 (흰 화면 방지)
    const t = setTimeout(() => {
      setIsLoading(prev => {
        if (prev) {
          console.warn("[SESSION] isLoading timeout → force false");
          return false;
        }
        return prev;
      });
    }, 12000);
    loadStored().finally(() => clearTimeout(t));
  }, []);

  async function loadStored() {
    try {
      // 앱 버전 변경 시 세션 강제 초기화 (업데이트 시 자동로그인 방지)
      const storedAppVersion = await AsyncStorage.getItem("app_version");
      if (storedAppVersion !== APP_VERSION) {
        await AsyncStorage.multiRemove([
          "auth_token", "auth_kind", "auth_admin", "auth_parent",
          "auth_all_accounts", "last_used_role", "last_used_tenant", "last_selected_student",
          "parent_selected_student_id", "brand_data",
          "parent_join_status", "parent_join_request_id", "parent_pool_name",
        ]);
        await AsyncStorage.setItem("app_version", APP_VERSION);
        return;
      }

      const [
        storedToken, storedKind, storedAdmin, storedParent, storedAccounts,
        storedJoinStatus, storedJoinRequestId, storedPoolName,
      ] = await Promise.all([
        AsyncStorage.getItem("auth_token"),
        AsyncStorage.getItem("auth_kind"),
        AsyncStorage.getItem("auth_admin"),
        AsyncStorage.getItem("auth_parent"),
        AsyncStorage.getItem("auth_all_accounts"),
        AsyncStorage.getItem("parent_join_status"),
        AsyncStorage.getItem("parent_join_request_id"),
        AsyncStorage.getItem("parent_pool_name"),
      ]);

      if (storedAccounts) {
        try {
          const accounts: AccountEntry[] = JSON.parse(storedAccounts);
          setAllAccounts(accounts);
        } catch {}
      }

      if (!storedToken || !storedKind) return;

      // 서버에서 토큰 유효성 검증 — 구 토큰 / 서버 오류 시 세션 초기화
      try {
        const meRes = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
          cache: "no-store",
        });
        // 401: 토큰 만료/버전 불일치, 5xx: 서버 오류 → 모두 세션 초기화 (자동로그인 방지)
        if (meRes.status === 401 || meRes.status >= 500) {
          await AsyncStorage.multiRemove([
            "auth_token", "auth_kind", "auth_admin", "auth_parent",
            "auth_all_accounts", "last_used_role", "last_used_tenant", "last_selected_student",
            "parent_selected_student_id", "brand_data",
            "parent_join_status", "parent_join_request_id", "parent_pool_name",
          ]);
          return;
        }
      } catch {
        // 네트워크 오류(오프라인/DNS 실패) → 세션 초기화 (서버 불안정 시 자동로그인 방지)
        await AsyncStorage.multiRemove([
          "auth_token", "auth_kind", "auth_admin", "auth_parent",
          "auth_all_accounts", "last_used_role", "last_used_tenant", "last_selected_student",
          "parent_selected_student_id", "brand_data",
          "parent_join_status", "parent_join_request_id", "parent_pool_name",
        ]);
        return;
      }

      setToken(storedToken);
      if (storedKind === "admin" && storedAdmin) {
        const user: AdminUser = JSON.parse(storedAdmin);
        if (!user.roles || user.roles.length === 0) user.roles = [user.role];
        setAdminUser(user);
        setKind("admin");
        if (user.swimming_pool_id) fetchPool(storedToken).catch(e => console.warn("[AUTH COMPLETE][POOL FETCH FAIL] loadStored admin fetchPool 실패:", e?.message));
        // 앱 복원 라우팅 — 로그인 완료와 동일한 finishLogin 경로로 통합
        finishLogin("admin", user);
      } else if (storedKind === "parent" && storedParent) {
        const pa: ParentAccount = JSON.parse(storedParent);
        setParentAccount(pa);
        setKind("parent");
        setParentJoinStatus(storedJoinStatus || null);
        setParentJoinRequestId(storedJoinRequestId || null);
        const restoredPoolName = storedPoolName || (pa as any).pool_name || null;
        if (restoredPoolName) setParentPoolName(restoredPoolName);
        fetchPool(storedToken).catch(e => console.warn("[AUTH COMPLETE][POOL FETCH FAIL] loadStored parent fetchPool 실패:", e?.message));
        // 앱 복원 라우팅 — 로그인 완료와 동일한 finishLogin 경로로 통합
        finishLogin("parent", null, pa);
      }
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  }

  async function fetchPool(authToken: string) {
    try {
      const res = await fetch(`${API_BASE}/pools/my`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const poolData = await safeJson(res);
        setPool(poolData);
        if (poolData?.name) {
          setParentPoolName(poolData.name);
          AsyncStorage.setItem("parent_pool_name", poolData.name).catch(() => {});
        }
        return;
      }
    } catch (err) { console.error(err); }
    // parent 토큰은 /parent/pool-info 로 fallback (JWT poolId 기반)
    try {
      const res2 = await fetch(`${API_BASE}/parent/pool-info`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res2.ok) {
        const info = await safeJson(res2);
        if (info?.pool_name) {
          setPool({ id: info.pool_id || "", name: info.pool_name, address: info.address || "", phone: info.phone || "" } as any);
          setParentPoolName(info.pool_name);
          AsyncStorage.setItem("parent_pool_name", info.pool_name).catch(() => {});
        }
      }
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

  // ─── 로그인/회원가입 완료 파이프라인 ───────────────────────────────────────
  // computeLoginDest: kind + role → 목적지 경로를 동기 계산 (API 호출 없음)
  function computeLoginDest(k: "admin" | "parent", user: AdminUser | null): string {
    if (k === "parent") return "/(parent)/home";
    if (k === "admin" && user) {
      const { role, swimming_pool_id } = user;
      if (role === "super_admin" || role === "platform_admin" || role === "super_manager") return "/(super)/dashboard";
      if (role === "teacher") return "/(teacher)/today-schedule";
      if (role === "pool_admin" || role === "sub_admin") return swimming_pool_id ? "/(admin)/dashboard" : "/pool-apply";
    }
    return "/";
  }

  // finishLogin: 세션 완료 후 즉시 목적지로 라우팅
  // setState는 이미 호출된 상태에서 호출하세요.
  // pendingRoute를 RootNav가 감지 → router.replace() 실행
  function finishLogin(k: "admin" | "parent", user: AdminUser | null, _parent?: ParentAccount | null): void {
    const dest = computeLoginDest(k, user ?? null);
    console.log(`[AUTH COMPLETE][FINISH_LOGIN] kind=${k} role=${user?.role ?? "parent"} → ${dest}`);
    setPendingRoute(dest);
  }

  function clearPendingRoute() {
    setPendingRoute(null);
  }
  // ─────────────────────────────────────────────────────────────────────────

  async function activateAccount(entry: AccountEntry) {
    const { kind: k, token: t, user, parent, join_status, join_request_id } = entry;
    console.log(`[AUTH COMPLETE][1] API success → activateAccount 시작 kind=${k} role=${user?.role ?? "parent"}`);
    console.log(`[AUTH COMPLETE][2] token save start`);
    await Promise.race([
      AsyncStorage.setItem("auth_token", t),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage token timeout")), 3000)),
    ]).catch(e => console.warn("[AUTH COMPLETE][2 ERR] token save 실패", e));
    await Promise.race([
      AsyncStorage.setItem("auth_kind", k),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage kind timeout")), 3000)),
    ]).catch(e => console.warn("[AUTH COMPLETE][2 ERR] kind save 실패", e));
    console.log(`[AUTH COMPLETE][3] token save done → setState 시작`);
    setToken(t);
    setKind(k);
    if (k === "admin" && user) {
      const u = { ...user, roles: user.roles?.length ? user.roles : [user.role] };
      await Promise.race([
        AsyncStorage.setItem("auth_admin", JSON.stringify(u)),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage admin timeout")), 3000)),
      ]).catch(e => console.warn("[AUTH COMPLETE][3 ERR] admin save 실패", e));
      setAdminUser(u);
      if (u.swimming_pool_id) fetchPool(t).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] activateAccount fetchPool 실패: ${e?.message}`));
    } else if (k === "parent" && parent) {
      await Promise.race([
        AsyncStorage.setItem("auth_parent", JSON.stringify(parent)),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage parent timeout")), 3000)),
      ]).catch(e => console.warn("[AUTH COMPLETE][3 ERR] parent save 실패", e));
      setParentAccount(parent);
      const js = join_status ?? "approved";
      const jri = join_request_id ?? null;
      await AsyncStorage.setItem("parent_join_status", js).catch(() => {});
      if (jri) await AsyncStorage.setItem("parent_join_request_id", jri).catch(() => {});
      else await AsyncStorage.removeItem("parent_join_request_id").catch(() => {});
      setParentJoinStatus(js);
      setParentJoinRequestId(jri);
      if ((parent as any).pool_name) {
        setParentPoolName((parent as any).pool_name);
        AsyncStorage.setItem("parent_pool_name", (parent as any).pool_name).catch(() => {});
      }
      fetchPool(t).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] activateAccount fetchPool 실패: ${e?.message}`));
    }
    AsyncStorage.setItem("app_version", APP_VERSION).catch(() => {}); // 비동기 — await 제거
    console.log(`[AUTH COMPLETE][3b] activateAccount 완료 — kind=${k} 세팅됨`);
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
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃
      try {
        res = await fetch(`${API_BASE}/auth/unified-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, password }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (fetchErr: any) {
      const isTimeout = fetchErr?.name === "AbortError";
      throw Object.assign(
        new Error(isTimeout
          ? "서버 응답이 너무 늦습니다. 잠시 후 다시 시도해주세요."
          : "서버에 연결할 수 없습니다.\n잠시 후 다시 시도해주세요."
        ),
        { error_code: "network_error" }
      );
    }
    const data = await safeJson(res);
    if (!res.ok) {
      if (data.needs_activation || data.error_code === "needs_activation") {
        throw Object.assign(new Error(data.error || "계정 활성화가 필요합니다."), {
          needs_activation: true, error_code: "needs_activation", teacher_id: data.teacher_id,
        });
      }
      throw Object.assign(new Error(data.message || data.error || "로그인에 실패했습니다."), {
        error_code:            data.error_code || "unknown",
        days_until_deletion:   data.days_until_deletion ?? null,
        deletion_scheduled_at: data.deletion_scheduled_at ?? null,
        deactivated_at:        data.deactivated_at ?? null,
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
      finishLogin(accounts[0].kind, accounts[0].user ?? null, accounts[0].parent ?? null);
    } else {
      if (data.kind === "admin" && data.user) {
        const entry: AccountEntry = { kind: "admin", token: data.token, user: { ...data.user, roles: data.user.roles || [data.user.role] } };
        await activateAccount(entry);
        accounts.push(entry);
        finishLogin("admin", entry.user ?? null);
      } else if (data.kind === "parent" && data.parent) {
        const entry: AccountEntry = { kind: "parent", token: data.token, parent: data.parent };
        await activateAccount(entry);
        accounts.push(entry);
        finishLogin("parent", null, entry.parent ?? null);
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
    if (accounts.length > 0) {
      await activateAccount(accounts[0]);
      finishLogin(accounts[0].kind, accounts[0].user ?? null, accounts[0].parent ?? null);
    }
    return { available_accounts: accounts };
  }

  async function adminLogin(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      throw Object.assign(
        new Error(data.message || data.error || "로그인에 실패했습니다."),
        {
          error_code:            data.error_code || data.error || "unknown",
          days_until_deletion:   data.days_until_deletion ?? null,
          deletion_scheduled_at: data.deletion_scheduled_at ?? null,
          deactivated_at:        data.deactivated_at ?? null,
        },
      );
    }
    const user: AdminUser = { ...data.user, roles: Array.isArray(data.user.roles) && data.user.roles.length > 0 ? data.user.roles : [data.user.role] };
    await AsyncStorage.multiSet([
      ["auth_token", data.token], ["auth_kind", "admin"], ["auth_admin", JSON.stringify(user)],
      ["app_version", APP_VERSION],
    ]);
    setToken(data.token);
    setAdminUser(user);
    setKind("admin");
    if (user.swimming_pool_id) fetchPool(data.token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
    finishLogin("admin", user);
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
      ["app_version", APP_VERSION],
    ]);
    setToken(data.token);
    setParentAccount(data.parent);
    setKind("parent");
    if (data.parent?.pool_name) {
      setParentPoolName(data.parent.pool_name);
      AsyncStorage.setItem("parent_pool_name", data.parent.pool_name).catch(() => {});
    }
    fetchPool(data.token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
    finishLogin("parent", null, data.parent);
  }

  async function kakaoSocialLogin(accessToken: string): Promise<"admin" | "parent"> {
    const tid = "KL-" + Date.now().toString(36).toUpperCase();
    console.log(`[KakaoLogin][STEP1] traceId=${tid} fetch 시작 tokenLen=${accessToken?.length ?? 0}`);
    setIsAuthenticating(true);
    let resultKind: "admin" | "parent" = "parent";
    try {
      // STEP2: 10초 AbortController 타임아웃
      const controller = new AbortController();
      const abortTimer = setTimeout(() => {
        console.warn(`[KakaoLogin][ABORT] traceId=${tid} 10s 타임아웃 → abort`);
        controller.abort();
      }, 10000);
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/auth/kakao-social-login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        const isTimeout = fetchErr?.name === "AbortError";
        console.error(`[KakaoLogin][STEP2 FAIL] traceId=${tid} timeout=${isTimeout} err=${fetchErr?.message}`);
        throw Object.assign(
          new Error(isTimeout ? "서버 응답이 너무 늦습니다." : "서버에 연결할 수 없습니다."),
          { error_code: "network_error" }
        );
      } finally {
        clearTimeout(abortTimer);
      }
      console.log(`[KakaoLogin][STEP2] traceId=${tid} HTTP=${res.status}`);

      // STEP3: json 파싱 (6s 타임아웃)
      console.log(`[KakaoLogin][STEP3] traceId=${tid} json parse 시작`);
      const data = await safeJsonT(res, 6000);
      console.log(`[KakaoLogin][STEP4] traceId=${tid} json parse 완료 errCode=${data?.error_code ?? "없음"} kind=${data?.kind ?? "없음"}`);

      if (!res.ok) {
        throw Object.assign(new Error(data.message || "카카오 로그인에 실패했습니다."), {
          error_code: data.error_code || "unknown",
          kakao_info: data.kakao_info || null,
          needs_activation: data.needs_activation || false,
          teacher_id: data.teacher_id || null,
        });
      }

      // STEP5: 세션 저장
      if (data.kind === "admin" && data.user) {
        console.log(`[KakaoLogin][STEP5] traceId=${tid} admin 세션 저장 시작 role=${data.user.role}`);
        const u = { ...data.user, roles: data.user.roles?.length ? data.user.roles : [data.user.role] };
        await Promise.race([
          AsyncStorage.multiSet([
            ["auth_token", data.token], ["auth_kind", "admin"], ["auth_admin", JSON.stringify(u)],
            ["app_version", APP_VERSION],
          ]),
          new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage timeout")), 4000)),
        ]).catch(e => console.warn(`[KakaoLogin][STEP5 STORAGE ERR] traceId=${tid}`, e));
        console.log(`[KakaoLogin][STEP6] traceId=${tid} setState 시작`);
        setToken(data.token);
        setAdminUser(u);
        setKind("admin");
        resultKind = "admin";
        console.log(`[KakaoLogin][STEP7] traceId=${tid} setKind=admin 완료`);
        if (u.swimming_pool_id) fetchPool(data.token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
        finishLogin("admin", u);
      } else {
        console.log(`[KakaoLogin][STEP5] traceId=${tid} parent 세션 저장 시작`);
        await Promise.race([
          AsyncStorage.multiSet([
            ["auth_token", data.token], ["auth_kind", "parent"], ["auth_parent", JSON.stringify(data.parent)],
            ["parent_join_status", "approved"], ["app_version", APP_VERSION],
          ]),
          new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage timeout")), 4000)),
        ]).catch(e => console.warn(`[KakaoLogin][STEP5 STORAGE ERR] traceId=${tid}`, e));
        console.log(`[KakaoLogin][STEP6] traceId=${tid} setState 시작`);
        setToken(data.token);
        setParentAccount(data.parent);
        setKind("parent");
        setParentJoinStatus("approved");
        resultKind = "parent";
        if (data.parent?.pool_name) {
          setParentPoolName(data.parent.pool_name);
          AsyncStorage.setItem("parent_pool_name", data.parent.pool_name).catch(() => {});
        }
        console.log(`[KakaoLogin][STEP7] traceId=${tid} setKind=parent 완료`);
        fetchPool(data.token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
        finishLogin("parent", null, data.parent);
      }
    } finally {
      setIsAuthenticating(false);
      console.log(`[KakaoLogin][FINALLY] traceId=${tid} isAuthenticating=false`);
    }
    return resultKind;
  }

  async function appleSocialLogin(identityToken: string, fullName?: string | null, traceId?: string): Promise<"admin" | "parent"> {
    setIsAuthenticating(true);
    const tid = traceId ?? ("AL-" + Date.now().toString(36).toUpperCase());
    const url = `${API_BASE}/auth/apple-social-login`;
    let resultKind: "admin" | "parent" = "parent";
    console.log(`[AppleLogin][STEP1] traceId=${tid} appleSocialLogin 시작`);
    try {
      console.log(`[AppleLogin][STEP2 FETCH] traceId=${tid} url=${url} tokenLen=${identityToken?.length ?? 0}`);
      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.log(`[AppleLogin][STEP3 ABORT] traceId=${tid} 20s 타임아웃 → abort`);
        controller.abort();
      }, 20000);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityToken, fullName }),
          signal: controller.signal,
        });
        console.log(`[AppleLogin][STEP4 OK] traceId=${tid} HTTP=${res.status}`);
      } catch (fetchErr: any) {
        const isTimeout = fetchErr?.name === "AbortError";
        console.error(`[AppleLogin][STEP4 FAIL] traceId=${tid} timeout=${isTimeout} err=${fetchErr?.message}`);
        throw Object.assign(
          new Error(isTimeout
            ? "서버 응답이 너무 늦습니다. 잠시 후 다시 시도해주세요."
            : "서버에 연결할 수 없습니다. 네트워크를 확인해주세요."
          ),
          { error_code: "network_error" }
        );
      } finally {
        clearTimeout(timer);
      }
      // STEP4 BODY: safeJsonT로 res.text() 타임아웃 방지 (6s)
      console.log(`[AppleLogin][STEP3 JSON] traceId=${tid} json parse 시작`);
      const data = await safeJsonT(res, 6000);
      console.log(`[AppleLogin][STEP4 BODY] traceId=${tid} errCode=${data?.error_code ?? "없음"} type=${data?.user ? "admin" : data?.parent ? "parent" : "unknown"}`);
      if (!res.ok) {
        console.log(`[AppleLogin][STEP4 ERR] traceId=${tid} status=${res.status} code=${data?.error_code}`);
        throw Object.assign(new Error(data.message || data.error || "Apple 로그인에 실패했습니다."), {
          error_code: data.error_code || "unknown",
          apple_info: data.apple_info || null,
        });
      }

      // 관리자·선생님 계정 (users 테이블) → data.user 반환
      if (data.user) {
        console.log(`[AppleLogin][STEP5 ADMIN] traceId=${tid} role=${data.user.role} → setAdminSession`);
        await setAdminSession(data.token, data.user);
        console.log(`[AppleLogin][STEP6] traceId=${tid} setAdminSession 완료`);
        resultKind = "admin";
        finishLogin("admin", data.user);
        console.log(`[AppleLogin][STEP7] traceId=${tid} kind=admin — finally에서 isAuthenticating=false 처리`);
        return "admin";
      }

      // 학부모 계정 (parent_accounts 테이블) → data.parent 반환
      console.log(`[AppleLogin][STEP5 PARENT] traceId=${tid} parentId=${data.parent?.id?.substring(0,8)}*** → AsyncStorage 저장`);
      await Promise.race([
        AsyncStorage.multiSet([
          ["auth_token", data.token], ["auth_kind", "parent"], ["auth_parent", JSON.stringify(data.parent)],
          ["parent_join_status", "approved"], ["app_version", APP_VERSION],
        ]),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error("AsyncStorage timeout")), 4000)),
      ]).catch(e => console.warn(`[AppleLogin][STEP5 STORAGE ERR] traceId=${tid}`, e));
      console.log(`[AppleLogin][STEP6] traceId=${tid} AsyncStorage 완료 → setState`);
      setToken(data.token);
      setParentAccount(data.parent);
      setKind("parent");
      setParentJoinStatus("approved");
      if (data.parent?.pool_name) {
        setParentPoolName(data.parent.pool_name);
        AsyncStorage.setItem("parent_pool_name", data.parent.pool_name).catch(() => {});
      }
      fetchPool(data.token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
      resultKind = "parent";
      finishLogin("parent", null, data.parent);
      console.log(`[AppleLogin][STEP7] traceId=${tid} kind=parent — finally에서 isAuthenticating=false 처리`);
      return "parent";
    } finally {
      // 성공/실패/예외 어느 경로든 반드시 isAuthenticating 해제
      setIsAuthenticating(false);
      console.log(`[AppleLogin][FINALLY] traceId=${tid} isAuthenticating=false resultKind=${resultKind}`);
    }
  }

  async function setParentSession(token: string, parent: ParentAccount) {
    const pname = (parent as any).pool_name || null;
    const multiSetItems: [string, string][] = [
      ["auth_token", token], ["auth_kind", "parent"], ["auth_parent", JSON.stringify(parent)],
      ["parent_join_status", "approved"],
    ];
    if (pname) multiSetItems.push(["parent_pool_name", pname]);
    multiSetItems.push(["app_version", APP_VERSION]);
    await AsyncStorage.multiSet(multiSetItems);
    setToken(token);
    setParentAccount(parent);
    setKind("parent");
    setParentJoinStatus("approved");
    if (pname) setParentPoolName(pname);
    fetchPool(token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
  }

  async function setAdminSession(token: string, user: AdminUser) {
    const userWithRoles = { ...user, roles: Array.isArray((user as any).roles) ? (user as any).roles : [user.role] };
    console.log(`[setAdminSession] AsyncStorage 저장 시작 role=${user.role}`);
    await Promise.race([
      AsyncStorage.multiSet([
        ["auth_token", token], ["auth_kind", "admin"], ["auth_admin", JSON.stringify(userWithRoles)],
        ["app_version", APP_VERSION],
      ]),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error("setAdminSession AsyncStorage timeout")), 4000)),
    ]).catch(e => console.warn("[setAdminSession] AsyncStorage 실패 → 계속 진행", e));
    console.log(`[setAdminSession] setState 시작`);
    setToken(token);
    setAdminUser(userWithRoles);
    setKind("admin");
    console.log(`[setAdminSession] setKind=admin 완료`);
    if (user.swimming_pool_id) fetchPool(token).catch(e => console.warn(`[AUTH COMPLETE][POOL FETCH FAIL] fetchPool 실패: ${e?.message}`));
  }

  async function logout() {
    await AsyncStorage.multiRemove([
      "auth_token", "auth_kind", "auth_admin", "auth_parent",
      "auth_all_accounts", "last_used_role", "last_used_tenant", "last_selected_student",
      "parent_selected_student_id", "brand_data",
      "parent_join_status", "parent_join_request_id", "parent_pool_name",
      "app_version",
    ]);
    setToken(null);
    setKind(null);
    setAdminUser(null);
    setParentAccount(null);
    setPool(null);
    setParentPoolName(null);
    setAllAccounts([]);
    setOwnedPools([]);
    setParentJoinStatus(null);
    setParentJoinRequestId(null);
  }

  function updateParentNickname(nickname: string) {
    setParentAccount(prev => prev ? { ...prev, nickname } : prev);
  }

  function updateParentProfile(fields: Partial<ParentAccount>) {
    setParentAccount(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...fields };
      AsyncStorage.setItem("auth_parent", JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }

  function updateAdminProfile(fields: Partial<AdminUser>) {
    setAdminUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...fields };
      AsyncStorage.setItem("auth_admin", JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }

  async function checkRolePermission(roleKey: string): Promise<boolean> {
    if (!token) return false;
    try {
      if (roleKey === "parent" || roleKey === "parent_account") return !!parentAccount;
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
      kind, adminUser, parentAccount, token, pool, parentPoolName, isLoading, isAuthenticating,
      allAccounts, ownedPools, parentJoinStatus, parentJoinRequestId,
      unifiedLogin, completeTotpLogin, adminLogin, parentLogin, kakaoSocialLogin, appleSocialLogin, setParentSession, setAdminSession,
      logout, refreshPool, loadOwnedPools, switchPool,
      activateAccount, updateParentNickname, updateParentProfile, updateAdminProfile, checkRolePermission, applyRoleSwitch,
      finishLogin, pendingRoute, clearPendingRoute,
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
