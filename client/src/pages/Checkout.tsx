import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { confirmDemoPayment, getPayment } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatDate, formatMoney } from "../lib/format";

const UPI_APPS = ["Google Pay", "PhonePe", "Paytm", "BHIM"];

export function Checkout() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();

  const [payment, setPayment] = useState<{ plan: string; amount: number; currency: string; method: string; status: string; created_at: number } | null>(null);
  const [step, setStep] = useState<"details" | "review" | "done">("details");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [vpa, setVpa] = useState("");
  const [card, setCard] = useState({ number: "", name: "", expiry: "", cvv: "" });

  const load = useCallback(async () => {
    try {
      const res = await getPayment(paymentId!);
      setPayment(res.payment as typeof payment);
      if (res.payment.status === "paid") setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment not found");
    }
  }, [paymentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = async () => {
    setPaying(true);
    try {
      await confirmDemoPayment(paymentId!);
      await refresh();
      setStep("done");
      toast.push({ title: "Payment successful", description: "Your plan is now active.", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  if (error && !payment) {
    return (
      <div className="mx-auto max-w-md py-16">
        <Card className="p-8 text-center">
          <h1 className="text-lg font-bold text-slate-100">Checkout unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <Link to="/billing" className="mt-5 inline-block">
            <Button variant="secondary">Back to billing</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="flex h-64 items-center justify-center"><Spinner className="h-7 w-7 text-emerald-400" /></div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-50">Checkout</h1>
        <p className="mt-1 text-sm text-slate-400">
          Simulated payment (demo mode) · <Link to="/billing" className="text-emerald-400 hover:text-emerald-300">Cancel</Link>
        </p>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <p className="text-sm text-slate-400">SecureNexus <span className="capitalize text-slate-200">{payment.plan}</span> plan</p>
            <p className="mt-0.5 text-xs text-slate-500">Created {formatDate(payment.created_at)}</p>
          </div>
          <p className="text-2xl font-extrabold text-slate-50">
            {formatMoney(payment.amount, payment.currency)}
          </p>
        </div>

        {step === "details" && (
          <div className="pt-4">
            <p className="mb-3 text-sm font-semibold text-slate-200">
              Paying with <span className="uppercase text-emerald-400">{payment.method}</span>
            </p>
            {payment.method === "upi" && (
              <div className="space-y-2">
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
                  placeholder="yourname@upi"
                  value={vpa}
                  onChange={(e) => setVpa(e.target.value)}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  {UPI_APPS.map((a) => (
                    <span key={a} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400">{a}</span>
                  ))}
                </div>
              </div>
            )}
            {payment.method === "card" && (
              <div className="space-y-3">
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm tracking-wider text-slate-100 outline-none focus:border-emerald-500"
                  inputMode="numeric"
                  placeholder="4444 4444 4444 4444"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: e.target.value })}
                />
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
                  placeholder="Name on card"
                  value={card.name}
                  onChange={(e) => setCard({ ...card, name: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    placeholder="MM/YY"
                    value={card.expiry}
                    onChange={(e) => setCard({ ...card, expiry: e.target.value })}
                  />
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    inputMode="numeric"
                    type="password"
                    placeholder="CVV"
                    maxLength={4}
                    value={card.cvv}
                    onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                  />
                </div>
              </div>
            )}
            {payment.method === "paypal" && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-950 p-4">
                <span className="text-lg font-bold italic text-cyan-300">Pay<span className="text-cyan-500">Pal</span></span>
                <span className="text-xs text-slate-400">You will be redirected to PayPal to approve the payment.</span>
              </div>
            )}
            <Button className="mt-5 w-full" onClick={() => setStep("review")}>
              Continue to review
            </Button>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Payments are protected with TLS + CSP.
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4 pt-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm">
              <div className="flex justify-between py-1"><span className="text-slate-400">Plan</span><span className="capitalize text-slate-200">{payment.plan}</span></div>
              <div className="flex justify-between py-1"><span className="text-slate-400">Payment method</span><span className="uppercase text-slate-200">{payment.method}</span></div>
              <div className="flex justify-between border-t border-slate-800 py-1 pt-2">
                <span className="text-slate-400">Total</span>
                <span className="font-bold text-slate-50">{formatMoney(payment.amount, payment.currency)}</span>
              </div>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("details")}>Back</Button>
              <Button className="flex-1" loading={paying} onClick={() => void pay()}>
                Pay {formatMoney(payment.amount, payment.currency)}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="pt-4 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-50">Payment complete</h2>
            <p className="mt-1 text-sm text-slate-400">
              Your <span className="capitalize text-slate-200">{payment.plan}</span> plan is now active.
            </p>
            <Button className="mt-5" onClick={() => navigate("/dashboard")}>Go to dashboard</Button>
          </div>
        )}
      </Card>
    </div>
  );
}