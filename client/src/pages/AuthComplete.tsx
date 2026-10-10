import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Card, Spinner } from "../components/ui";
import { AuthShell } from "./AuthShell";

/** The successful organization callback lands here after the server has verified its identity. */
export function AuthComplete() {
  const { refresh, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setBusy(true); setError("");
    void refresh({ afterSignIn: true }).then(() => {
      if (active) navigate("/organizations", { replace: true });
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Sign-in could not be completed. Please retry.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [authLoading, attempt, refresh, navigate]);
  return <AuthShell stage="verify"><Card className="auth-card">
    <h1 className="text-2xl font-bold text-slate-100">Completing sign in</h1>
    <p className="mt-2 text-sm leading-relaxed text-slate-400">Checking your session and preparing this browser’s workspace.</p>
    {busy ? <div role="status" className="mt-6 flex items-center gap-3 text-sm text-slate-300"><Spinner />Opening your workspace…</div> : <>
      {error && <p role="alert" className="mt-5 text-sm text-rose-400">{error}</p>}
      <Button type="button" className="mt-5 w-full" onClick={() => setAttempt(value => value + 1)}>Retry sign-in completion</Button>
      <Link to="/login" className="mt-4 block text-center text-sm text-emerald-300">Back to sign in</Link>
    </>}
  </Card></AuthShell>;
}
