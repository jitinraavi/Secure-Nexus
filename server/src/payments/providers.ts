import { countryInfo, localPriceMinor } from "./pricing.js";

export interface Plan {
  id: string;
  name: string;
  /** base price in INR paise (all countries convert from this) */
  price: number;
  currency: string;
  periodDays: number;
  tagline: string;
}

export const PLANS: Record<string, Plan> = {
  free: { id: "free", name: "Free", price: 0, currency: "INR", periodDays: 0, tagline: "1 active project" },
  pro: { id: "pro", name: "Pro", price: 200000, currency: "INR", periodDays: 30, tagline: "Unlimited projects + exports + 2FA" },
  studio: { id: "studio", name: "Studio", price: 400000, currency: "INR", periodDays: 30, tagline: "All Pro features + CAD connectors + priority support" },
};

export const PLAN_LIST: Plan[] = [PLANS.pro, PLANS.studio];

export function planForId(id: string): Plan | undefined {
  return PLANS[id];
}

export type PaymentMethod = "card" | "upi" | "paypal";

export interface CreatePaymentParams {
  orderId: string;
  userId: string;
  email: string;
  plan: Plan;
  method: PaymentMethod;
  /** ISO-2 country the price is denominated in */
  country: string;
}

export interface CreatedPayment {
  provider: string;
  providerOrderId: string;
  checkoutUrl: string | null;
  /** demo mode: the frontend shows its own checkout and confirms via confirm-demo */
  demo: boolean;
  method: PaymentMethod;
}

export interface Provider {
  id: string;
  supports: PaymentMethod[];
  createPayment(p: CreatePaymentParams): Promise<CreatedPayment>;
}

/* ----------------------------- Demo provider ----------------------------- */
/* Simulates the full payment flow locally / without merchant credentials.  */

const demoProvider: Provider = {
  id: "demo",
  supports: ["card", "upi", "paypal"],
  async createPayment(p) {
    return {
      provider: "demo",
      providerOrderId: `demo_${p.orderId}`,
      checkoutUrl: null,
      demo: true,
      method: p.method,
    };
  },
};

/* ------------------------- Razorpay (UPI + cards) ------------------------ */
/* INR only. Uses the Payment Links API via native fetch — no SDK dependency. */

const RAZORPAY_BASE = "https://api.razorpay.com/v1";
const RAZORPAY_BASE64 = (() => {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  return key && secret ? Buffer.from(`${key}:${secret}`).toString("base64") : null;
})();

const razorpayProvider: Provider = {
  id: "razorpay",
  supports: ["card", "upi"],
  async createPayment(p) {
    if (!RAZORPAY_BASE64) throw new Error("Razorpay keys are not configured");
    const amount = localPriceMinor(p.country, p.plan.id);
    const resp = await fetch(`${RAZORPAY_BASE}/payment_links`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${RAZORPAY_BASE64}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        accept_partial: false,
        description: `Groundwork ${p.plan.name} plan`,
        customer: { email: p.email, contact: "" },
        notes: { order_id: p.orderId, user_id: p.userId },
        callback_url: "", // frontend polls the order status
        callback_method: "get",
      }),
    });
    const body = (await resp.json()) as { id?: string; short_url?: string; error?: { description?: string } };
    if (!resp.ok || !body.id) {
      throw new Error(body.error?.description || "Razorpay order creation failed");
    }
    return {
      provider: "razorpay",
      providerOrderId: body.id,
      checkoutUrl: body.short_url ?? null,
      demo: false,
      method: p.method,
    };
  },
};

/* ------------------------------ PayPal ----------------------------------- */
/* Orders v2 via REST API. Sandbox mode when PAYPAL_MODE=sandbox.            */

const PAYPAL_BASE = process.env.PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const paypalProvider: Provider = {
  id: "paypal",
  supports: ["paypal", "card"],
  async createPayment(p) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("PayPal credentials are not configured");

    const authRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const auth = (await authRes.json()) as { access_token?: string };
    if (!auth.access_token) throw new Error("PayPal authentication failed");

    const info = countryInfo(p.country);
    const amountMinor = localPriceMinor(p.country, p.plan.id);
    const value = (amountMinor / Math.pow(10, info.digits)).toFixed(info.digits);

    const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: p.orderId,
            custom_id: p.userId,
            amount: { currency_code: info.currency, value },
description: `Groundwork ${p.plan.name} plan`,
          },
        ],
        application_context: {
          brand_name: "Groundwork",
          user_action: "PAY_NOW",
        },
      }),
    });
    const order = (await res.json()) as { id?: string; links?: { rel: string; href: string }[] };
    if (!res.ok || !order.id) {
      throw new Error("PayPal order creation failed");
    }
    const approveLink = order.links?.find((l) => l.rel === "approve")?.href ?? null;
    return {
      provider: "paypal",
      providerOrderId: order.id,
      checkoutUrl: approveLink,
      demo: false,
      method: p.method,
    };
  },
};

/* ------------------------------ Selection -------------------------------- */

function paymentMode(): "demo" | "live" {
  return process.env.PAYMENTS_MODE === "live" ? "live" : "demo";
}

export function isDemoMode(): boolean {
  return paymentMode() === "demo";
}

export function isInrCountry(country: string | undefined | null): boolean {
  return countryInfo(country).currency === "INR";
}

export interface MethodOption {
  method: PaymentMethod;
  label: string;
  provider: string;
}

export function availableMethods(country: string | undefined | null): MethodOption[] {
  const inr = isInrCountry(country);
  if (isDemoMode()) {
    const out: MethodOption[] = [];
    if (inr) out.push({ method: "upi", label: "UPI", provider: "demo" });
    out.push({ method: "card", label: "Credit / Debit Card", provider: "demo" });
    out.push({ method: "paypal", label: "PayPal", provider: "demo" });
    return out;
  }
  const out: MethodOption[] = [];
  const raz = RAZORPAY_BASE64;
  const pay = process.env.PAYPAL_CLIENT_ID;
  if (inr && raz) {
    out.push({ method: "upi", label: "UPI", provider: "razorpay" });
    out.push({ method: "card", label: "Credit / Debit Card", provider: "razorpay" });
  } else if (inr) {
    // INR but no Razorpay keys → PayPal fallback (handled by conversion below)
  }
  if (pay) out.push({ method: "paypal", label: "PayPal", provider: "paypal" });
  if (!inr && pay) out.push({ method: "card", label: "Credit / Debit Card", provider: "paypal" });
  if (out.length === 0) {
    // nothing configured → demo provider keeps the app usable
    return availableMethodsDemo(inr);
  }
  return out;
}

function availableMethodsDemo(inr: boolean): MethodOption[] {
  const out: MethodOption[] = [];
  if (inr) out.push({ method: "upi", label: "UPI", provider: "demo" });
  out.push({ method: "card", label: "Credit / Debit Card", provider: "demo" });
  out.push({ method: "paypal", label: "PayPal", provider: "demo" });
  return out;
}

export function providerFor(method: PaymentMethod, country: string | undefined | null): Provider {
  const inr = isInrCountry(country);
  if (isDemoMode()) return demoProvider;
  if (method === "paypal") return paypalProvider;
  if (method === "upi") {
    if (!inr) throw new Error("UPI is only available for India");
    if (!RAZORPAY_BASE64) throw new Error("Razorpay keys are not configured");
    return razorpayProvider;
  }
  // card
  if (inr && RAZORPAY_BASE64) return razorpayProvider;
  if (process.env.PAYPAL_CLIENT_ID) return paypalProvider;
  throw new Error("Card payments are not configured for this country");
}

export function supportsMethod(method: PaymentMethod, country: string | undefined | null): boolean {
  return availableMethods(country).some((m) => m.method === method);
}