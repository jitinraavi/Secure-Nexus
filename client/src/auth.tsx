import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bootstrap, getMe, logout as apiLogout, setCsrfToken } from "./api";
import { captureAuthenticationFences, resumeAuthenticatedLocalAccount, subscribeLocalDataFence } from "./lib/localDataFence";
import { recoverLocalAccountAfterSignIn, signOutAccount, type LocalDataChoice } from "./lib/signOutAccount";
import type { User } from "./types";
import { verifySession, type AuthenticationStatus } from "./lib/sessionVerification";

interface AuthState {
  user: User | null;
  loading: boolean;
  status: AuthenticationStatus;
  authError: string | null;
  refresh: (options?: { afterSignIn?: boolean }) => Promise<void>;
  logout: (localData?: LocalDataChoice) => Promise<void>;
  logoutError: string | null;
  signingOut: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AuthenticationStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const generation = useRef(0);
  const activeUser = useRef(user); activeUser.current = user;
  const logoutRequest = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (options?: { afterSignIn?: boolean }) => {
    if (logoutRequest.current) {
      if (options?.afterSignIn) throw new Error("Sign-out is still finishing. Try signing in again when it completes.");
      return;
    }
    const fences = captureAuthenticationFences();
    const request = ++generation.current;
    setStatus("checking");
    setAuthError(null);
    let confirmedSignedOut = false;
    try {
      const verification = await verifySession(bootstrap, getMe);
      if (request !== generation.current) {
        if (options?.afterSignIn) throw new Error("Another account request started during sign-in. Please retry.");
        return;
      }
      if (verification.status === "unavailable") throw verification.error;
      const me = verification.account;
      if (me) {
        const resumed = options?.afterSignIn
          ? await recoverLocalAccountAfterSignIn(me.user.id, fences)
          : resumeAuthenticatedLocalAccount(me.user.id, fences);
        if (!resumed) throw new Error("Local account cleanup changed during sign-in. Please retry.");
        if (request !== generation.current) return;
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
        setStatus("authenticated");
      } else {
        confirmedSignedOut = true;
        setUser(null);
        setStatus("unauthenticated");
        setCsrfToken(null);
        if (options?.afterSignIn) throw new Error("Sign-in was not confirmed. Please sign in again.");
      }
    } catch (error) {
      // Keep the last account and local drafts, but block private interaction until retry succeeds.
      if (request === generation.current && !confirmedSignedOut) {
        setStatus("unavailable");
        setAuthError("We couldn't confirm your session. Check your connection and retry. Your local drafts have been kept.");
      }
      if (options?.afterSignIn) throw error;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);

  useEffect(() => subscribeLocalDataFence((userId, fence) => {
    if ((fence.signedOut || fence.localOnly) && activeUser.current?.id === userId) {
      generation.current++; setCsrfToken(null); setUser(null); setLogoutError(null);
      setStatus("unauthenticated"); setAuthError(null); setLoading(false);
    }
  }), []);

  const logout = useCallback((localData: LocalDataChoice = "preserve"): Promise<void> => {
    if (logoutRequest.current) return logoutRequest.current;
    const current = activeUser.current;
    if (!current) return Promise.resolve();
    generation.current++; setSigningOut(true); setLogoutError(null);
    const operation = (async () => {
      try {
        await signOutAccount(current.id, localData, apiLogout);
        setCsrfToken(null); setUser(null); setStatus("unauthenticated"); setAuthError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sign-out was not confirmed; you are still signed in. Try again when connected.";
        setStatus("authenticated"); setAuthError(null); setLogoutError(message); throw error;
      } finally { logoutRequest.current = null; setSigningOut(false); setLoading(false); }
    })();
    logoutRequest.current = operation;
    return operation;
  }, []);

  const value = useMemo(
    () => ({ user, loading, status, authError, refresh, logout, logoutError, signingOut }),
    [user, loading, status, authError, refresh, logout, logoutError, signingOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
