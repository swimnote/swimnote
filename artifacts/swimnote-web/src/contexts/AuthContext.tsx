import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "pool_admin" | "parent";
  swimming_pool_id?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

export interface LoginResult {
  totp_required: true;
  totp_session: string;
}

export interface WebPinRequired {
  web_pin_required: true;
  web_session: string;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<User | LoginResult | WebPinRequired>;
  completeTotpLogin: (totpSession: string, otpCode: string) => Promise<User>;
  completeWebPinLogin: (webSession: string, webPin: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    loading: true,
  });

  useEffect(() => {
    const token = localStorage.getItem("sw_token");
    if (!token) {
      setState({ user: null, token: null, loading: false });
      return;
    }
    api.get<User>("/auth/me")
      .then((user) => setState({ user, token, loading: false }))
      .catch(() => {
        localStorage.removeItem("sw_token");
        setState({ user: null, token: null, loading: false });
      });
  }, []);

  const login = async (email: string, password: string): Promise<User | LoginResult | WebPinRequired> => {
    const res = await api.post<any>("/auth/login", { email, password, web_login: true });
    if (res.totp_required) {
      return { totp_required: true, totp_session: res.totp_session } as LoginResult;
    }
    if (res.web_pin_required) {
      return { web_pin_required: true, web_session: res.web_session } as WebPinRequired;
    }
    localStorage.setItem("sw_token", res.token);
    setState({ user: res.user, token: res.token, loading: false });
    return res.user as User;
  };

  const completeTotpLogin = async (totpSession: string, otpCode: string): Promise<User> => {
    const res = await api.post<any>("/auth/totp/verify-login", {
      totp_session: totpSession,
      otp_code: otpCode,
    });
    localStorage.setItem("sw_token", res.token);
    setState({ user: res.user, token: res.token, loading: false });
    return res.user as User;
  };

  const completeWebPinLogin = async (webSession: string, webPin: string): Promise<User> => {
    const res = await api.post<any>("/auth/web-pin/verify", { web_session: webSession, web_pin: webPin });
    localStorage.setItem("sw_token", res.token);
    setState({ user: res.user, token: res.token, loading: false });
    return res.user as User;
  };

  const logout = () => {
    localStorage.removeItem("sw_token");
    setState({ user: null, token: null, loading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, completeTotpLogin, completeWebPinLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
