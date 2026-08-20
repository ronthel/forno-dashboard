import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api-client";
import { setStoredToken, registerForceLogout } from "./auth-token";

export type Role = "viewer" | "operator" | "admin";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
const TOKEN_STORAGE_KEY = "wtecc_historian_token";
const ROLE_STORAGE_KEY = "wtecc_historian_role";

interface AuthState {
  role: Role | null;
  isLoading: boolean;
  login: (role: Role, password: string) => Promise<void>;
  logout: () => void;
  /** Verdadeiro se o papel atual tem pelo menos o nível informado (viewer < operator < admin). */
  hasRole: (minimum: Role) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = () => {
    setStoredToken(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(ROLE_STORAGE_KEY);
    }
    setRole(null);
  };

  useEffect(() => {
    // localStorage só existe no navegador — SSR passa direto
    if (typeof window === "undefined") {
      setIsLoading(false);
      return;
    }
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY) as Role | null;
    if (storedToken && storedRole) {
      setStoredToken(storedToken);
      setRole(storedRole);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    registerForceLogout(logout);
    return () => registerForceLogout(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (selectedRole: Role, password: string) => {
    const res = await api.login(selectedRole, password);
    setStoredToken(res.token);
    window.localStorage.setItem(TOKEN_STORAGE_KEY, res.token);
    window.localStorage.setItem(ROLE_STORAGE_KEY, res.role);
    setRole(res.role);
  };

  const hasRole = (minimum: Role) => role !== null && ROLE_RANK[role] >= ROLE_RANK[minimum];

  return (
    <AuthContext.Provider value={{ role, isLoading, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
