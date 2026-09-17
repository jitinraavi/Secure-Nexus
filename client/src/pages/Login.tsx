import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { login, loginWithOtp, requestOtpLogin } from "../api";
import { Button, Card, Input } from "../components/ui";
import { Logo } from "../components/Logo";
import { useToast } from "../components/Toast";

type LoginMode = "password" | "otp";

export function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  const finishLogin = async (needsTwoFactor?: boolean) => {
    if (needsTwoFactor) {
      navigate("/verify-2fa", { replace: true });
      return;
    }
    await refresh();
    navigate("/dashboard", { replace: true });
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      await finishLogin(res.needsTwoFactor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      toast.push({ title: "Sign in failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    if (!email.trim()) {
      setError("Enter your email first");
      return;
    }
    setError("");
    setSendingCode(true);
    try {
      const res = await requestOtpLogin(email.trim());
      setOtpRequested(true);
      setCode("");
      const failed = res.delivered === false && !res.devOtp;
      toast.push({
        title: failed ? "Couldn't send the code" : "Code sent",
        description: res.devOtp
          ? `Development code: ${res.devOtp} (also written to the server log)`
          : res.message || "Check your inbox for a 6-digit login code.",
        tone: res.devOtp ? "info" : failed ? "error" : "success",
      });
      if (!res.devOtp) {
        setTimeout(() => toast.push({ title: "Still haven't got it?", description: "Check your spam folder — or use your password to sign in.", tone: "info" }), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setSendingCode(false);
    }
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await loginWithOtp(email.trim(), code.trim().replace(/\D/g, ""));
      await finishLogin(res.needsTwoFactor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      toast.push({ title: "Sign in failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  const resetOtp = () => {
    setOtpRequested(false);
    setCode("");
    setError("");
  };

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError("");
    if (next === "otp") resetOtp();
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link to="/"><Logo /></Link>
        </div>
        <Card className="p-8">
          <h1 className="text-2xl font-bold text-slate-100">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your design studio workspace.</p>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-800/60 p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => switchMode("password")}
              className={`rounded-md px-3 py-2 transition ${
                mode === "password" ? "bg-slate-700 text-slate-100 shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => switchMode("otp")}
              className={`rounded-md px-3 py-2 transition ${
                mode === "otp" ? "bg-slate-700 text-slate-100 shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Email code
            </button>
          </div>

          {mode === "password" && (
            <form onSubmit={submitPassword} className="mt-6 space-y-4">
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@studio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                Sign in
              </Button>
            </form>
          )}

          {mode === "otp" && !otpRequested && (
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void sendCode();
              }}
            >
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@studio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <Button type="submit" loading={sendingCode} className="w-full" size="lg">
                Send me a code
              </Button>
              <p className="text-center text-xs text-slate-500">
                No password needed — we'll email you a one-time login code.
              </p>
            </form>
          )}

          {mode === "otp" && otpRequested && (
            <form onSubmit={submitOtp} className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="max-w-xs"
                />
                <button
                  type="button"
                  onClick={resetOtp}
                  className="mt-6 text-sm font-medium text-slate-400 hover:text-slate-200"
                >
                  Change
                </button>
              </div>
              <Input
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                Sign in with code
              </Button>
              <div className="text-center text-sm text-slate-400">
                Didn't get it?{" "}
                <button type="button" onClick={() => void sendCode()} disabled={sendingCode} className="font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                  Resend code
                </button>
              </div>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-slate-400">
            No account yet?{" "}
            <Link to="/signup" className="font-semibold text-emerald-400 hover:text-emerald-300">
              Create one
            </Link>
          </p>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-600">
          Protected by scrypt hashing, rate limiting and account lockout.
        </p>
      </div>
    </div>
  );
}