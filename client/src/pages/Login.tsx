import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { login } from "../api";
import { Button, Card, Input } from "../components/ui";
import { Logo } from "../components/Logo";
import { useToast } from "../components/Toast";

export function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      if (res.needsTwoFactor) {
        navigate("/verify-2fa", { replace: true });
        return;
      }
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      toast.push({ title: "Sign in failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
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