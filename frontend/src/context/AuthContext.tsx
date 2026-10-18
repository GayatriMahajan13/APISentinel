import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAuthSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  type AuthUser,
  setCsrfToken,
} from "../api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    full_name: string;
    email: string;
    password: string;
    confirm_password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const session = await getAuthSession();
      setUser(session.user);
      setError(null);
    } catch (cause) {
      setUser(null);
      setCsrfToken(null);
      setError(cause instanceof Error ? cause.message : "Could not restore your session.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    const handleUnauthorized = () => {
      setUser(null);
      void refreshSession();
    };
    window.addEventListener("apisentinel:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("apisentinel:unauthorized", handleUnauthorized);
  }, [refreshSession]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginAccount({ email, password });
    if (!session.user) throw new Error("The server did not return an authenticated user.");
    setUser(session.user);
    setError(null);
  }, []);

  const register = useCallback<AuthContextValue["register"]>(async (data) => {
    const session = await registerAccount(data);
    if (!session.user) throw new Error("The server did not return an authenticated user.");
    setUser(session.user);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    await logoutAccount();
    setUser(null);
    setCsrfToken(null);
    await refreshSession();
  }, [refreshSession]);

  const value = useMemo(
    () => ({ user, loading, error, refreshSession, login, register, logout }),
    [user, loading, error, refreshSession, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
