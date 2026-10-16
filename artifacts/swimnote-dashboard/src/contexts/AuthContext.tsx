import { createContext, useContext, useState, useEffect, useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { DesktopSessionController } from "../desktop/session-controller";
import { readAuthSession } from "@/lib/auth-session";
import type { AuthUser } from "@/lib/auth-session";
import { getToken, setToken, clearToken } from "@/lib/token";
import { queryClient } from "@/lib/query-client";

export type { AuthUser, XMode } from "@/lib/auth-session";

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

export function AuthProvider({ children, desktopSession }: {
  children: ReactNode; desktopSession?: DesktopSessionController;
}) {
  return desktopSession
    ? <DesktopAuthProvider controller={desktopSession}>{children}</DesktopAuthProvider>
    : <WebAuthProvider>{children}</WebAuthProvider>;
}

function DesktopAuthProvider({ controller, children }: {
  controller: DesktopSessionController; children: ReactNode;
}) {
  const source = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const state: AuthState = source.status === "authenticated"
    ? { status: "authenticated", user: source.user }
    : source.status === "login" ? { status: "unauthenticated" } : { status: "loading" };
  return <AuthContext.Provider value={{
    state, login: token => controller.accept(token, false), logout: () => { void controller.logout(); },
  }}>{children}</AuthContext.Provider>;
}

function WebAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const loadUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const user = await readAuthSession();
      setState({ status: "authenticated", user });
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
