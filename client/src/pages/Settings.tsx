import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import {
  changePassword,
  getCountries,
  listSessions,
  revokeOthers,
  revokeSession,
  twoFactorDisable,
  twoFactorEnable,
  twoFactorSetup,
  updateProfile,
  type CountryOption,
} from "../api";
import type { SessionInfo } from "../types";
import { Badge, Button, Card, Input, Select, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { cn } from "../lib/cn";

export function Settings() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [profile, setProfile] = useState({ country: "IN", phone: "", accountType: "individual" as "individual" | "business", gstin: "" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");

  const loadSessions = useCallback(async () => {
    setSessionLoading(true);
    try {
      setSessions(await listSessions());
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    getCountries()
      .then(setCountries)
      .catch(() => setCountries([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfile({
      country: user.country || "IN",
      phone: user.phone || "",
      accountType: user.accountType || "individual",
      gstin: user.gstin || "",
    });
  }, [user]);

  const submitProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError("");
    if (profile.accountType === "business") {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(profile.gstin.trim().toUpperCase())) {
        setProfileError("Enter a valid GSTIN for business accounts");
        return;
      }
    }
    setProfileBusy(true);
    try {
      await updateProfile({
        country: profile.country,
        phone: profile.phone.trim() || undefined,
        accountType: profile.accountType,
        gstin: profile.accountType === "business" ? profile.gstin.trim().toUpperCase() : undefined,
      });
      await refresh();
      toast.push({ title: "Profile updated", description: "Your billing and contact details were saved.", tone: "success" });
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setProfileBusy(false);
    }
  };

  const startSetup = async () => {
    setTwoFaBusy(true);
    try {
      const s = await twoFactorSetup();
      setSetup({ secret: s.secret, qrDataUrl: s.qrDataUrl });
      toast.push({ title: "Scan to enable 2FA", description: "Use your authenticator app, then enter a code.", tone: "info" });
    } catch (err) {
      toast.push({ title: "Setup failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setTwoFaBusy(false);
    }
  };

  const enable = async () => {
    setTwoFaBusy(true);
    try {
      await twoFactorEnable(verifyCode.trim());
      await refresh();
      setSetup(null);
      setVerifyCode("");
      toast.push({ title: "Two-factor authentication enabled", tone: "success" });
    } catch (err) {
      toast.push({ title: "Could not enable 2FA", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setTwoFaBusy(false);
    }
  };

  const disable = async () => {
    setTwoFaBusy(true);
    try {
      await twoFactorDisable(disableCode.trim());
      await refresh();
      setDisableCode("");
      toast.push({ title: "Two-factor authentication disabled", tone: "info" });
    } catch (err) {
      toast.push({ title: "Could not disable 2FA", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setTwoFaBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    setPwBusy(true);
    try {
      await changePassword(pw.current, pw.next, pw.confirm);
      setPw({ current: "", next: "", confirm: "" });
      toast.push({ title: "Password changed", description: "All other sessions were signed out.", tone: "success" });
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-50">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Security, sessions and preferences for your account.</p>
      </div>

      {/* Profile & billing details */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-100">Profile &amp; billing details</h2>
            <p className="mt-1 text-sm text-slate-400">Country, phone and account type — used for localised pricing and invoices.</p>
          </div>
          <Badge tone={user?.accountType === "business" ? "cyan" : "slate"}>
            {user?.accountType === "business" ? "Business" : "Individual"}
          </Badge>
        </div>
        <form onSubmit={submitProfile} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Select label="Country" value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })}>
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
            placeholder="+91 98765 43210"
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
          <div className="sm:col-span-2">
            <span className="text-sm font-medium text-slate-300">Account type</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["individual", "business"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setProfile({ ...profile, accountType: t })}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                    profile.accountType === t
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-slate-600",
                  )}
                >
                  {t === "individual" ? "Individual" : "Business"}
                </button>
              ))}
            </div>
          </div>
          {profile.accountType === "business" && (
            <Input
              label="GSTIN"
              placeholder="22AAAAA0000A1Z5"
              value={profile.gstin}
              maxLength={15}
              onChange={(e) => setProfile({ ...profile, gstin: e.target.value })}
            />
          )}
          {profileError && <p className="text-sm text-rose-400 sm:col-span-2">{profileError}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" loading={profileBusy}>Save profile</Button>
          </div>
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Two-factor */}
        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-100">Two-factor authentication</h2>
              <p className="mt-1 text-sm text-slate-400">Add a TOTP authenticator app as a second factor.</p>
            </div>
            <Badge tone={user?.totpEnabled ? "emerald" : "slate"}>{user?.totpEnabled ? "Enabled" : "Off"}</Badge>
          </div>

          {!user?.totpEnabled && !setup && (
            <div className="mt-5">
              <Button variant="secondary" onClick={() => void startSetup()} loading={twoFaBusy}>
                Set up 2FA
              </Button>
            </div>
          )}

          {setup && (
            <div className="mt-5 space-y-4">
              <div className="flex items-start gap-4">
                <img src={setup.qrDataUrl} alt="TOTP QR code" className="h-32 w-32 rounded-lg border border-slate-700 bg-white" />
                <div className="text-sm text-slate-300">
                  <p>Scan the QR with Google Authenticator, Authy, or any TOTP app.</p>
                  <p className="mt-1 text-xs text-slate-500">Manual key:</p>
                  <code className="mt-1 block font-mono text-xs text-emerald-300 break-all">{setup.secret}</code>
                </div>
              </div>
              <Input
                label="Enter the 6-digit code"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/[^\d]/g, ""))}
              />
              <div className="flex gap-2">
                <Button onClick={() => void enable()} loading={twoFaBusy}>Enable 2FA</Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {user?.totpEnabled && (
            <div className="mt-5 space-y-3">
              <Input
                label="Code to disable 2FA"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/[^\d]/g, ""))}
              />
              <Button variant="danger" onClick={() => void disable()} loading={twoFaBusy} disabled={disableCode.length !== 6}>
                Disable 2FA
              </Button>
            </div>
          )}

          <div className="mt-5 border-t border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-slate-200">Tips</h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              <li>• 2FA is strongly recommended — logins require a code after password.</li>
              <li>• Lost your device? Contact support to reset 2FA.</li>
            </ul>
          </div>
        </Card>

        {/* Password */}
        <Card className="p-6">
          <h2 className="font-semibold text-slate-100">Change password</h2>
          <p className="mt-1 text-sm text-slate-400">
            Changing your password signs out every other session.
          </p>
          <form onSubmit={submitPassword} className="mt-5 space-y-4">
            <Input
              label="Current password"
              type="password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              required
            />
            <Input
              label="New password"
              type="password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              required
            />
            {pwError && <p className="text-sm text-rose-400">{pwError}</p>}
            <Button type="submit" loading={pwBusy}>Update password</Button>
          </form>
        </Card>
      </div>

      {/* Sessions */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-100">Active sessions</h2>
            <p className="mt-1 text-sm text-slate-400">Devices currently signed in to your account.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void revokeOthers().then(loadSessions)}>
            Sign out all other devices
          </Button>
        </div>
        {sessionLoading ? (
          <div className="mt-4 flex items-center justify-center py-8"><Spinner className="h-5 w-5 text-emerald-400" /></div>
        ) : (
          <div className="mt-4 divide-y divide-slate-800/70">
            {sessions?.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-200">{s.user_agent || "Unknown device"}</p>
                    {s.current && <Badge tone="emerald">This device</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {s.ip ?? "local"} · signed in {formatDate(s.last_seen_at)} · expires {formatDate(s.expires_at)}
                  </p>
                </div>
                {!s.current && (
                  <button
                    onClick={() => void revokeSession(s.id).then(loadSessions)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/10"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
            {sessions?.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No active sessions.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}