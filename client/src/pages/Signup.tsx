import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { getCountries, signup, type CountryOption } from "../api";
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [country, setCountry] = useState("IN");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState<"individual" | "business">("individual");
  const [gstin, setGstin] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCountries()
      .then(setCountries)
      .catch(() => setCountries([]));
  }, []);

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
      await signup(email.trim(), password, confirm, {
        country,
        phone: phone.trim() || undefined,
        accountType,
        gstin: accountType === "business" ? gstin.trim().toUpperCase() : undefined,
      });
      await refresh();
      navigate("/dashboard", { replace: true });
      toast.push({ title: "Account created", description: "Welcome to SecureNexus Interior Studio.", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link to="/"><Logo /></Link>
        </div>
        <Card className="p-8">
          <h1 className="text-2xl font-bold text-slate-100">Create your studio</h1>
          <p className="mt-1 text-sm text-slate-400">Start turning room photos into CAD-ready designs.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
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