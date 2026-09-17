import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bootstrap, getMe, logout as apiLogout, setCsrfToken } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      await bootstrap();
      const me = await getMe();
      if (me) {
        setUser({
          ...me.user,
          username: me.user.username ?? null,
          emailVerified: me.user.emailVerified ?? true,
          plan: me.user.plan ?? "free",
          planExpiresAt: me.user.plan_expires_at ?? null,
          country: me.user.country ?? "IN",
          phone: me.user.phone ?? null,
          accountType: me.user.accountType ?? "individual",
          gstin: me.user.gstin ?? null,
        });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* ignore */
    }
    setCsrfToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}