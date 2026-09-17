import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { getCountries, signup, verifyEmail, resendOtp, type CountryOption } from "../api";
import { Button, Card, Input, Select } from "../components/ui";
import { Logo } from "../components/Logo";
import { useToast } from "../components/Toast";
import { cn } from "../lib/cn";

const PASSWORD_RULES = [
  { ok: false, label: "At least 8 characters" },
  { ok: false, label: "Contains a letter" },
  { ok: false, label: "Contains a number" },
];

export function Signup() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [country, setCountry] = useState("IN");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState<"individual" | "business">("individual");
  const [gstin, setGstin] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* OTP stage */
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [code, setCode] = useState("");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const emailRef = useRef("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    getCountries()
      .then(setCountries)
      .catch(() => setCountries([]));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(30);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const rules = PASSWORD_RULES.map((r, i) => ({
    ...r,
    ok:
      i === 0
        ? password.length >= 8
        : i === 1
          ? /[a-zA-Z]/.test(password)
          : /[0-9]/.test(password),
  }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      setError("Username must be 3–20 letters, numbers or underscores");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (accountType === "business") {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin.trim().toUpperCase())) {
        setError("Enter a valid GSTIN for business accounts");
        return;
      }
    }
    setLoading(true);
    try {
      const res = await signup(email.trim(), password, confirm, {
        username: username.trim(),
        country,
        phone: phone.trim() || undefined,
        accountType,
        gstin: accountType === "business" ? gstin.trim().toUpperCase() : undefined,
      });
      if (res.needsEmailVerification) {
        emailRef.current = email.trim();
        setDevHint(res.devOtp ?? null);
        setVerifyOpen(true);
        setCode("");
        setVerifyError("");
        startCountdown();
        toast.push({
          title: "Check your email",
          description: res.message ?? "A 6-digit verification code was sent.",
          tone: "info",
        });
        return;
      }
      await refresh();
      navigate("/dashboard", { replace: true });
      toast.push({ title: "Account created", description: "Welcome to SecureNexus.", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setVerifyBusy(true);
    setVerifyError("");
    try {
      const res = await verifyEmail(emailRef.current, code.trim());
      await refresh();
      navigate("/dashboard", { replace: true });
      toast.push({
        title: "Email verified",
        description: res.alreadyVerified ? "Account already verified." : "Welcome to SecureNexus.",
        tone: "success",
      });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyBusy(false);
    }
  };

  const resend = async () => {
    if (countdown > 0) return;
    setResendBusy(true);
    setVerifyError("");
    try {
      const res = await resendOtp(emailRef.current);
      setDevHint(res.devOtp ?? null);
      startCountdown();
      toast.push({ title: "Code sent", description: res.message, tone: "info" });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Could not resend");
    } finally {
      setResendBusy(false);
    }
  };

  if (verifyOpen) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Link to="/"><Logo /></Link>
          </div>
          <Card className="p-8">
            <h1 className="text-2xl font-bold text-slate-100">Verify your email</h1>
            <p className="mt-1 text-sm text-slate-400">
              We sent a 6-digit code to <span className="text-emerald-300">{emailRef.current}</span>.
            </p>
            <div className="mt-6 space-y-4">
              <Input
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
              />
              {devHint && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  No mail provider configured — dev code: <span className="font-mono font-bold">{devHint}</span>
                </p>
              )}
              {verifyError && <p className="text-sm text-rose-400">{verifyError}</p>}
              <Button onClick={verify} loading={verifyBusy} className="w-full" size="lg" disabled={code.length < 6}>
                Verify & continue
              </Button>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Didn't get it?</span>
                <button
                  onClick={resend}
                  disabled={resendBusy || countdown > 0}
                  className="font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-600"
                >
                  {countdown > 0 ? `Resend in ${countdown}s` : resendBusy ? "Sending…" : "Resend code"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link to="/"><Logo /></Link>
        </div>
        <Card className="p-8">
          <h1 className="text-2xl font-bold text-slate-100">Create your studio</h1>
          <p className="mt-1 text-sm text-slate-400">Pick a handle, then verify your email to get started.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Username"
                placeholder="e.g. architect_jane"
                value={username}
                maxLength={20}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                required
              />
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@studio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-3">
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <ul className="grid grid-cols-1 gap-1">
                {rules.map((r) => (
                  <li key={r.label} className={`text-xs ${r.ok ? "text-emerald-400" : "text-slate-500"}`}>
                    {r.ok ? "✓" : "○"} {r.label}
                  </li>
                ))}
              </ul>
            </div>
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />

            <div>
              <span className="text-sm font-medium text-slate-300">Account type</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["individual", "business"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAccountType(t)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                      accountType === t
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-slate-600",
                    )}
                  >
                    {t === "individual" ? "Individual" : "Business"}
                  </button>
                ))}
              </div>
            </div>

            <Select label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
              {countries.length === 0 && <option value="IN">India</option>}
              {countries.map((c) => (
                <option key={c.iso2} value={c.iso2}>
                  {c.name} ({c.symbol} {c.currency})
                </option>
              ))}
            </Select>

            <Input
              label="Phone (optional)"
              type="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

            {accountType === "business" && (
              <Input
                label="GSTIN"
                placeholder="22AAAAA0000A1Z5"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                maxLength={15}
              />
            )}

            {error && <p className="text-sm text-rose-400">{error}</p>}
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Create account
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already registered?{" "}
            <Link to="/login" className="font-semibold text-emerald-400 hover:text-emerald-300">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}