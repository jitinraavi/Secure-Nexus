import { db, now, withTransaction } from "../db.js";
import { randomId } from "../crypto.js";
import {
  assertOrganizationOwnerSession, billingDigest, BillingError, getOrganizationEntitlement,
  getOrganizationSubscription, organizationAudit, organizationBaseSeats, organizationRole, recordBillingTransition,
} from "../organization.js";
import { createTenantSeatLink } from "./providers.js";

export interface TenantBillingConfiguration {
  configured: boolean; reason: string | null; provider: "razorpay"; currency: "INR";
  unitPrice: number | null; termDays: number | null; maximumAmount: number;
  termPolicy: "replace_from_verification"; automaticRenewal: false;
}
export function tenantBillingConfiguration(): TenantBillingConfiguration {
  const price = Number(process.env.ORGANIZATION_SEAT_PRICE_INR_MINOR);
  const days = Number(process.env.ORGANIZATION_SEAT_TERM_DAYS);
  const configured = process.env.PAYMENTS_MODE === "live" && Boolean(process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") &&
    process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET && /^acc_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_ACCOUNT_ID ?? "")) &&
    Number.isSafeInteger(price) && price >= 100 && price <= 100000000 && Number.isSafeInteger(days) && days >= 1 && days <= 365;
  return { configured, reason: configured ? null : "Tenant checkout requires live Razorpay credentials, merchant account, webhook verification and explicit INR seat price/term configuration.",
    provider: "razorpay", currency: "INR", unitPrice: configured ? price : null, termDays: configured ? days : null,
    maximumAmount: 100000000, termPolicy: "replace_from_verification", automaticRenewal: false };
}
export type TenantOrderStatus = "creating" | "pending" | "creation_unknown" | "failed" | "verified" | "requires_review" | "expired";
export interface TenantBillingOrder {
  id: string; organizationId: string; targetPaidSeats: number; amount: number; currency: "INR"; termDays: number;
  status: TenantOrderStatus; checkoutUrl: string | null; createdAt: number; expiresAt: number; completedAt: number | null;
  reviewReason: string | null;
}
interface OrderRow {
  id: string; organization_id: string; owner_id: string; session_id: string; idempotency_key: string; request_digest: string;
  target_paid_seats: number; base_seats: number; unit_price: number; amount: number; currency: "INR"; term_days: number;
  base_subscription_revision: number; merchant_account_id: string; provider: string;
  provider_link_id: string | null; checkout_url: string | null; status: TenantOrderStatus;
  review_reason: string | null; created_at: number; expires_at: number; completed_at: number | null;
}
const orderRow = (id: string) => db.prepare("SELECT * FROM tenant_billing_orders WHERE id=?").get(id) as unknown as OrderRow | undefined;
const publicOrder = (o: OrderRow): TenantBillingOrder => ({
  id: o.id, organizationId: o.organization_id, targetPaidSeats: o.target_paid_seats, amount: o.amount, currency: o.currency,
  termDays: o.term_days, status: ["creating", "pending", "creation_unknown"].includes(o.status) && o.expires_at <= now() ? "expired" : o.status,
  checkoutUrl: o.status === "pending" && o.expires_at > now() ? o.checkout_url : null,
  createdAt: o.created_at, expiresAt: o.expires_at, completedAt: o.completed_at, reviewReason: o.review_reason,
});
export function listTenantBillingOrders(organizationId: string): TenantBillingOrder[] {
  return (db.prepare("SELECT * FROM tenant_billing_orders WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT 50").all(organizationId) as unknown as OrderRow[]).map(publicOrder);
}
export async function createTenantSeatCheckout(params: { organizationId: string; userId: string; sessionId: string; idempotencyKey: string; targetPaidSeats: number }) {
  const digest = billingDigest([params.organizationId, params.userId, params.targetPaidSeats, "replace_from_verification"]);
  const prepared = withTransaction(() => {
    assertOrganizationOwnerSession(params.organizationId, params.userId, params.sessionId);
    const previous = db.prepare("SELECT * FROM tenant_billing_orders WHERE organization_id=? AND idempotency_key=?")
      .get(params.organizationId, params.idempotencyKey) as unknown as OrderRow | undefined;
    if (previous) {
      if (previous.request_digest !== digest || previous.owner_id !== params.userId) throw new BillingError("This idempotency key belongs to a different seat checkout.", 409, "idempotency_conflict");
      return { row: previous, duplicate: true };
    }
    const config = tenantBillingConfiguration();
    if (!config.configured) throw new BillingError(config.reason!, 503, "billing_unconfigured");
    const sub = getOrganizationSubscription(params.organizationId), base = organizationBaseSeats();
    const seatsUsed = getOrganizationEntitlement(params.organizationId).seatsUsed;
    if (!Number.isSafeInteger(params.targetPaidSeats) || params.targetPaidSeats < 1 || params.targetPaidSeats + base > 10000 ||
      params.targetPaidSeats + base < seatsUsed) throw new BillingError("Purchased capacity must cover current members and remain at most 10,000 total seats.", 400, "invalid_capacity");
    const amount = params.targetPaidSeats * config.unitPrice!;
    if (!Number.isSafeInteger(amount) || amount > config.maximumAmount) throw new BillingError("The configured seat product exceeds the checkout amount limit.", 400, "amount_limit");
    db.prepare("UPDATE tenant_billing_orders SET status='expired' WHERE organization_id=? AND status IN ('creating','pending','creation_unknown') AND expires_at<=?").run(params.organizationId, now());
    const open = db.prepare("SELECT id FROM tenant_billing_orders WHERE organization_id=? AND status IN ('creating','pending','creation_unknown')").get(params.organizationId);
    if (open) throw new BillingError("A seat checkout is already pending. Refresh billing and use its existing link; uncertain provider requests require reconciliation.", 409, "checkout_pending");
    const count = db.prepare("SELECT COUNT(*) AS count FROM tenant_billing_orders WHERE organization_id=?").get(params.organizationId) as { count: number };
    if (count.count >= 500) throw new BillingError("Billing history capacity reached. Ask the deployment operator to reconcile retained orders.", 409, "billing_capacity");
    const id = randomId(), t = now();
    db.prepare(`INSERT INTO tenant_billing_orders
      (id,organization_id,owner_id,session_id,idempotency_key,request_digest,plan,target_paid_seats,base_seats,unit_price,amount,currency,term_days,
       base_subscription_revision,merchant_account_id,provider,status,created_at,expires_at)
      VALUES (?,?,?,?,?,?,'standard',?,?,?,?,'INR',?,?,?,'razorpay','creating',?,?)`).run(
      id, params.organizationId, params.userId, params.sessionId, params.idempotencyKey, digest, params.targetPaidSeats, base,
      config.unitPrice!, amount, config.termDays!, sub.entitlementRevision, process.env.RAZORPAY_ACCOUNT_ID!, t, t + 7200);
    organizationAudit(params.organizationId, params.userId, "billing.checkout_created", { orderId: id, amount, currency: "INR", targetPaidSeats: params.targetPaidSeats, termDays: config.termDays });
    return { row: orderRow(id)!, duplicate: false };
  });
  if (prepared.duplicate) return { duplicate: true, order: publicOrder(prepared.row) };
  const email = (db.prepare("SELECT email FROM users WHERE id=?").get(params.userId) as { email: string }).email;
  try {
    const created = await createTenantSeatLink({ orderId: prepared.row.id, userId: params.userId, organizationId: params.organizationId,
      email, amount: prepared.row.amount, expireBy: prepared.row.expires_at });
    const completed = withTransaction(() => {
      const current = orderRow(prepared.row.id)!;
      // Store a known provider identity even if browser authority changed while awaiting it.
      let reason: string | null = null;
      try { assertOrganizationOwnerSession(params.organizationId, params.userId, params.sessionId); }
      catch { reason = "Browser authority changed during checkout creation; operator reconciliation required."; }
      if (current.status !== "creating" || now() >= current.expires_at) reason = "Checkout creation completed after its intent expired.";
      db.prepare("UPDATE tenant_billing_orders SET provider_link_id=?,checkout_url=?,status=?,review_reason=? WHERE id=?")
        .run(created.providerOrderId, created.checkoutUrl, reason ? "requires_review" : "pending", reason, current.id);
      if (reason) organizationAudit(params.organizationId, params.userId, "billing.checkout_requires_review", { orderId: current.id, reason });
      return orderRow(current.id)!;
    });
    return { duplicate: false, order: publicOrder(completed) };
  } catch (error) {
    withTransaction(() => {
      db.prepare("UPDATE tenant_billing_orders SET status='creation_unknown',review_reason=? WHERE id=? AND status='creating'")
        .run("Provider creation response was unavailable. Do not retry with a new key until reconciled.", prepared.row.id);
      organizationAudit(params.organizationId, params.userId, "billing.checkout_uncertain", { orderId: prepared.row.id });
    });
    // Return the retained identity so browser retries cannot accidentally lose
    // its idempotency key or strand the user after a lost provider response.
    return { duplicate: false, order: publicOrder(orderRow(prepared.row.id)!) };
  }
}
export interface VerifiedRazorpayReceipt {
  receiptId: string; linkId: string; orderId: string; referenceId: string; merchantAccountId: string;
  amount: number; currency: string; linkAmount: number; linkAmountPaid: number;
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Only call after HMAC validation over the exact raw body. */
export function parseRazorpayPaidReceipt(value: unknown): VerifiedRazorpayReceipt | null {
  const event = object(value);
  if (event?.event !== "payment_link.paid") return null;
  const payload = object(event.payload), link = object(object(payload?.payment_link)?.entity), payment = object(object(payload?.payment)?.entity);
  const order = object(object(payload?.order)?.entity), notes = object(link?.notes);
  const reference = typeof link?.reference_id === "string" && link.reference_id ? link.reference_id : notes?.order_id;
  const amount = payment?.amount;
  if (!link || !payment || !order || typeof event.account_id !== "string" ||
    typeof link.id !== "string" || !/^plink_[A-Za-z0-9]+$/.test(link.id) ||
    typeof payment.id !== "string" || !/^pay_[A-Za-z0-9]+$/.test(payment.id) ||
    typeof payment.order_id !== "string" || payment.order_id !== link.order_id ||
    (order.id !== payment.order_id && `order_${String(order.id)}` !== payment.order_id) ||
    typeof reference !== "string" || reference.length < 1 || reference.length > 128 ||
    link.accept_partial !== false || link.status !== "paid" || payment.status !== "captured" || payment.captured !== true ||
    payment.amount_refunded !== 0 || order.status !== "paid" || order.amount_due !== 0 ||
    !Number.isSafeInteger(amount) || typeof amount !== "number" || amount <= 0 || amount > 100000000 ||
    link.amount !== amount || link.amount_paid !== amount || order.amount !== amount || order.amount_paid !== amount ||
    typeof payment.currency !== "string" || link.currency !== payment.currency || order.currency !== payment.currency) {
    throw new BillingError("Razorpay paid receipt is incomplete or inconsistent.", 400, "invalid_receipt");
  }
  return { receiptId: payment.id, linkId: link.id, orderId: payment.order_id, referenceId: reference, merchantAccountId: event.account_id,
    amount, currency: payment.currency, linkAmount: amount, linkAmountPaid: amount };
}
export function applyTenantReceipt(receipt: VerifiedRazorpayReceipt): { handled: boolean; duplicate?: boolean; requiresReview?: boolean } {
  return withTransaction(() => {
    const order = orderRow(receipt.referenceId);
    if (!order) return { handled: false };
    const prior = db.prepare("SELECT * FROM payment_receipts WHERE (provider='razorpay' AND receipt_id=?) OR payment_id=?")
      .get(receipt.receiptId, order.id) as { payment_id: string; receipt_id: string; provider_order_id: string; amount: number; currency: string; merchant_account_id: string; disposition: string } | undefined;
    if (prior) {
      if (prior.payment_id !== order.id || prior.receipt_id !== receipt.receiptId || prior.provider_order_id !== receipt.linkId ||
        prior.amount !== receipt.amount || prior.currency !== receipt.currency || prior.merchant_account_id !== receipt.merchantAccountId) {
        throw new BillingError("Provider receipt is already bound to a different payment.", 409, "receipt_conflict");
      }
      return { handled: true, duplicate: true, requiresReview: prior.disposition === "requires_review" };
    }
    const sub = getOrganizationSubscription(order.organization_id);
    const seatsUsed = getOrganizationEntitlement(order.organization_id).seatsUsed;
    let reason: string | null = null;
    if (order.provider_link_id !== receipt.linkId || receipt.amount !== order.amount || receipt.currency !== order.currency ||
      receipt.merchantAccountId !== order.merchant_account_id) reason = "Receipt does not match the immutable provider identity, amount, currency or merchant.";
    else if (order.status !== "pending" || now() >= order.expires_at) reason = "Paid receipt arrived for an expired or uncertain checkout.";
    else if (organizationRole(order.organization_id, order.owner_id) !== "owner") reason = "Organization owner changed after checkout creation.";
    else if (sub.entitlementRevision !== order.base_subscription_revision) reason = "Subscription changed after checkout creation.";
    else if (order.base_seats !== organizationBaseSeats() || order.base_seats + order.target_paid_seats < seatsUsed) reason = "Deployment allowance or member capacity changed after checkout creation.";
    const t = now();
    db.prepare(`INSERT INTO payment_receipts (provider,receipt_id,payment_id,provider_order_id,merchant_account_id,amount,currency,disposition,reason,received_at)
      VALUES ('razorpay',?,?,?,?,?,?,?,?,?)`).run(receipt.receiptId, order.id, receipt.linkId, receipt.merchantAccountId, receipt.amount, receipt.currency,
      reason ? "requires_review" : "applied", reason, t);
    db.prepare("UPDATE tenant_billing_orders SET status=?,review_reason=?,completed_at=? WHERE id=?").run(reason ? "requires_review" : "verified", reason, t, order.id);
    if (reason) {
      organizationAudit(order.organization_id, order.owner_id, "billing.receipt_requires_review", { orderId: order.id, receiptId: receipt.receiptId, reason });
      return { handled: true, requiresReview: true };
    }
    db.prepare(`UPDATE organization_subscriptions SET plan='standard',status='active',base_seats=?,paid_seats=?,total_seats=?,
      current_period_start=?,current_period_end=?,cancel_at_period_end=0,provider='razorpay',provider_subscription_id=?,
      verified_order_id=?,entitlement_revision=entitlement_revision+1,updated_at=? WHERE organization_id=?`).run(
      order.base_seats, order.target_paid_seats, order.base_seats + order.target_paid_seats, t, t + order.term_days * 86400,
      receipt.linkId, order.id, t, order.organization_id);
    // Administrative admission limit is retained; owners explicitly raise it in settings after a purchase.
    recordBillingTransition(order.organization_id, order.owner_id, "seat_change", `receipt:${billingDigest(["razorpay", receipt.receiptId])}`,
      sub, getOrganizationSubscription(order.organization_id), { orderId: order.id, receiptId: receipt.receiptId, amount: receipt.amount,
        currency: receipt.currency, targetPaidSeats: order.target_paid_seats, termDays: order.term_days, termPolicy: "replace_from_verification" });
    return { handled: true };
  });
}

