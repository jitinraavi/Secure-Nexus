import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { verifyTwoFactor } from "../api";
import { Button, Card, Input } from "../components/ui";
import { Logo } from "../components/Logo";

export function VerifyTwoFactor() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await verifyTwoFactor(code.trim());
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-8">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Two-factor authentication</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter the 6-digit code from your authenticator app to complete sign in.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Input
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
              required
              className="text-center text-xl tracking-[0.5em]"
            />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Verify & continue
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}