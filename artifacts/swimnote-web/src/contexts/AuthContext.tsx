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

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<User>;
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

  const login = async (email: string, password: string): Promise<User> => {
    const res = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
    localStorage.setItem("sw_token", res.token);
    setState({ user: res.user, token: res.token, loading: false });
    return res.user;
  };

  const logout = () => {
    localStorage.removeItem("sw_token");
    setState({ user: null, token: null, loading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
