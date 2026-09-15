import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import { getToken, setToken, clearToken } from "@/lib/token";
import { queryClient } from "@/lib/query-client";

export type XMode =
  | "x"
  | "x_trial"
  | "x_pending"
  | "normal"
  | "subscription_required"
  | "unknown";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  swimming_pool_id: string | null;
  poolName?: string;
  xMode: XMode;
  hasX: boolean; // true when mode is "x" or "x_trial"
};

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };

type AuthContextType = {
  state: AuthState;
  login: (token: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const loadUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const user = await api.get<AuthUser & { swimming_pool_id?: string | null }>("/auth/me");

      if (user.role !== "pool_admin" && user.role !== "super_admin") {
        clearToken();
        setState({ status: "unauthenticated" });
        return;
      }

      // super_admin: no pool context, skip pool/X queries
      if (user.role === "super_admin") {
        setState({
          status: "authenticated",
          user: { ...user, poolName: "슈퍼관리자", xMode: "x" as XMode, hasX: true },
        });
        return;
      }

      // Fetch pool name + X entitlement in parallel
      const [poolsResult, xModeResult] = await Promise.allSettled([
        api.get<Array<{ name: string }>>("/pools/my-pools"),
        api.get<{ mode?: string; xmode_entitlement?: boolean }>("/pools/x-mode"),
      ]);

      const poolName =
        poolsResult.status === "fulfilled" ? poolsResult.value[0]?.name : undefined;

      const rawMode =
        xModeResult.status === "fulfilled"
          ? (xModeResult.value?.mode as XMode | undefined) ?? "unknown"
          : "unknown";

      const hasX = rawMode === "x" || rawMode === "x_trial";

      setState({
        status: "authenticated",
        user: { ...user, poolName, xMode: rawMode, hasX },
      });
    } catch {
      clearToken();
      setState({ status: "unauthenticated" });
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = useCallback(
    async (token: string) => {
      setToken(token);
      await loadUser();
    },
    [loadUser]
  );

  const logout = useCallback(() => {
    clearToken();
    queryClient.clear();
    setState({ status: "unauthenticated" });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useRequireAuth() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return null;
  return state.user;
}
