import { Router } from "express";
import crypto from "node:crypto";
import { logAudit } from "../audit.js";
import { db, now } from "../db.js";
import { asyncHandler, AuthedRequest, resolveSession } from "../security.js";
import {
  availableMethods,
  isDemoMode,
  planForId,
  PLANS,
  PLAN_LIST,
  providerFor,
  supportsMethod,
  type PaymentMethod,
  type Plan,
  type Provider,
} from "../payments/providers.js";
import { countryInfo, localPriceMinor } from "../payments/pricing.js";
import { randomId } from "../crypto.js";
import { z } from "zod";

const router = Router();

router.use((req: AuthedRequest, res, next) => {
  const session = resolveSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = { id: session.user_id, email: "" };
  req.session = session;
  next();
});

router.get("/plans", (req: AuthedRequest, res) => {
  const userRow = db.prepare("SELECT country FROM users WHERE id = ?").get(req.user!.id) as
    | { country?: string }
    | undefined;
  const country = userRow?.country ?? "IN";
  const info = countryInfo(country);
  const localized = (id: string) => ({
    price: localPriceMinor(country, id),
    currency: info.currency,
    symbol: info.symbol,
    digits: info.digits,
  });
  res.json({
    plans: PLAN_LIST.map((plan) => ({ ...plan, ...localized(plan.id) })),
    free: { ...PLANS.free, ...localized("free") },
    isDemo: isDemoMode(),
    methods: availableMethods(country),
    country: { iso2: country, name: info.name, currency: info.currency, symbol: info.symbol, digits: info.digits },
  });
});

router.get("/", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      "SELECT id, provider, method, plan, amount, currency, status, provider_order_id, completed_at, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(req.user!.id);
  res.json({ payments: rows });
});

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = db
      .prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!row) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    res.json({ payment: row });
  }),
);

const createSchema = z.object({
  planId: z.enum(["pro", "studio"]),
  method: z.enum(["upi", "card", "paypal"]),
});

router.post(
  "/create",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const plan: Plan | undefined = planForId(parsed.data.planId);
    if (!plan) {
      res.status(400).json({ error: "Unknown plan" });
      return;
    }
    const method = parsed.data.method as PaymentMethod;
    const user = db.prepare("SELECT email, country FROM users WHERE id = ?").get(req.user!.id) as {
      email: string;
      country?: string;
    };
    const country = user.country || "IN";
    if (!supportsMethod(method, country)) {
      res.status(400).json({ error: "This payment method is not available in your country" });
      return;
    }

    const orderId = randomId();
    const provider: Provider = providerFor(method, country);
    const info = countryInfo(country);
    const amount = localPriceMinor(country, plan.id);

    let created;
    try {
      created = await provider.createPayment({
        orderId,
        userId: req.user!.id,
        email: user.email,
        plan,
        method,
        country,
      });
    } catch (err) {
      logAudit(req.user!.id, "payment.create_failed", { method, message: String(err) }, req);
      res.status(502).json({ error: err instanceof Error ? err.message : "Payment provider error" });
      return;
    }

    db.prepare(
      `INSERT INTO payments (id, user_id, provider, method, plan, amount, currency, status, provider_order_id, provider_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orderId,
      req.user!.id,
      created.provider,
      method,
      plan.id,
      amount,
      info.currency,
      "pending",
      created.providerOrderId,
      created.checkoutUrl,
      now(),
    );

    logAudit(req.user!.id, "payment.created", { plan: plan.id, method, provider: created.provider }, req);

    res.status(201).json({
      paymentId: orderId,
      provider: created.provider,
      demo: created.demo,
      checkoutUrl: created.checkoutUrl,
      method,
      providerOrderId: created.providerOrderId,
    });
  }),
);

function markPaid(userId: string, paymentId: string) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?").get(
    paymentId,
    userId,
  ) as { plan: string; amount: number; currency: string } | undefined;
  if (!payment || payment.plan === "free") return;

  const plan = PLANS[payment.plan];
  const t = now();
  const expiry = t + plan.periodDays * 86400;

  db.prepare("UPDATE payments SET status = 'paid', completed_at = ? WHERE id = ?").run(t, paymentId);
  db.prepare("UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = ? WHERE id = ?").run(
    plan.id,
    expiry,
    t,
    userId,
  );
  logAudit(
    userId,
    "payment.completed",
    { plan: plan.id, amount: payment.amount / 100, currency: payment.currency },
    undefined,
  );
}

/* POST /api/payments/confirm-demo — ONLY reachable in demo mode */
router.post(
  "/confirm-demo",
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!isDemoMode()) {
      res.status(403).json({ error: "Demo confirmations are disabled in live mode" });
      return;
    }
    const parsed = z.object({ paymentId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const payment = db
      .prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?")
      .get(parsed.data.paymentId, req.user!.id) as
      | { id: string; status: string; plan: string }
      | undefined;
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (payment.status === "paid") {
      res.json({ ok: true });
      return;
    }
    markPaid(req.user!.id, payment.id);
    res.json({ ok: true });
  }),
);

/* POST /api/payments/paypal-capture — completes a PayPal order in live mode */
router.post(
  "/paypal-capture",
  asyncHandler(async (req: AuthedRequest, res) => {
    if (isDemoMode()) {
      res.status(403).json({ error: "Not available in demo mode" });
      return;
    }
    const parsed = z
      .object({ paymentId: z.string().min(1), providerOrderId: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const payment = db
      .prepare("SELECT * FROM payments WHERE id = ? AND user_id = ? AND provider = 'paypal'")
      .get(parsed.data.paymentId, req.user!.id) as
      | { id: string; status: string; provider_order_id: string }
      | undefined;
    if (!payment || payment.provider_order_id !== parsed.data.providerOrderId) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (payment.status === "paid") {
      res.json({ ok: true });
      return;
    }

    const base = process.env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const clientId = process.env.PAYPAL_CLIENT_ID!;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
    const authRes = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const auth = (await authRes.json()) as { access_token?: string };
    if (!auth.access_token) {
      res.status(502).json({ error: "PayPal authentication failed" });
      return;
    }
    const cap = await fetch(`${base}/v2/checkout/orders/${payment.provider_order_id}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        "Content-Type": "application/json",
      },
    });
    const captured = (await cap.json()) as { status?: string };
    if (!cap.ok || captured.status !== "COMPLETED") {
      logAudit(req.user!.id, "payment.capture_failed", { provider: "paypal", status: captured.status }, req);
      res.status(502).json({ error: "PayPal capture failed" });
      return;
    }
    markPaid(req.user!.id, payment.id);
    res.json({ ok: true });
  }),
);

/* POST /api/payments/webhook — Razorpay webhook (live mode) */
router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (isDemoMode()) {
      res.status(200).json({ ok: true });
      return;
    }
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.get("x-razorpay-signature");
    if (!secret || !signature) {
      res.status(400).json({ error: "Missing webhook signature" });
      return;
    }
    const raw = JSON.stringify(req.body);
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const sigOk =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!sigOk) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    const event = req.body as {
      event?: string;
      payload?: { payment_link?: { entity?: { notes?: { order_id?: string }; status?: string } } };
    };
    if (event.event === "payment_link.paid") {
      const orderId = event.payload?.payment_link?.entity?.notes?.order_id;
      if (orderId) {
        const payment = db.prepare("SELECT user_id FROM payments WHERE id = ?").get(orderId) as
          | { user_id: string }
          | undefined;
        if (payment) {
          markPaid(payment.user_id, orderId);
        }
      }
    }
    res.json({ ok: true });
  }),
);

export default router;