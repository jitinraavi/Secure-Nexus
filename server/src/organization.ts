import { createHash } from "node:crypto";
import { randomId } from "./crypto.js";
import { db, now, withTransaction } from "./db.js";

export type OrganizationRole = "owner" | "admin" | "editor" | "viewer";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "unpaid" | "trialing";
export interface OrganizationSubscription {
  organizationId: string; plan: string; status: SubscriptionStatus;
  baseSeats: number; paidSeats: number; totalSeats: number;
  currentPeriodStart: number; currentPeriodEnd: number; cancelAtPeriodEnd: boolean;
  provider: string; providerSubscriptionId: string | null;
  entitlementRevision: number; verifiedOrderId: string | null;
  createdAt: number; updatedAt: number;
}
export interface OrganizationEntitlement {
  organizationId: string; plan: string; status: SubscriptionStatus;
  baseSeats: number; paidSeats: number; effectivePaidSeats: number; totalSeats: number;
  seatLimit: number; seatsUsed: number; seatsAvailable: number; canAddMember: boolean;
  isDelinquent: boolean; expired: boolean; overCapacity: boolean;
  hasVerifiedPayment: boolean; validEntitlement: boolean;
  currentPeriodEnd: number; cancelAtPeriodEnd: boolean;
}
export type BillingTransitionAction = "subscribe" | "seat_change" | "renew" | "cancel" | "reactivate" | "expire" | "payment_failed";
export class BillingError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code = "billing_conflict") { super(message); }
}
export const billingDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function organizationBaseSeats(): number {
  const value = Number(process.env.ORGANIZATION_MAX_SEATS || "5");
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(5, value) : 5;
}
export function organizationRole(organizationId: string, userId: string): OrganizationRole | null {
  const row = db.prepare("SELECT role FROM organization_members WHERE organization_id=? AND user_id=?").get(organizationId, userId) as { role: OrganizationRole } | undefined;
  return row?.role ?? null;
}
export function organizationAdmin(organizationId: string, userId: string): boolean {
  return ["owner", "admin"].includes(organizationRole(organizationId, userId) ?? "");
}
/** Call inside the same transaction as a browser-originated mutation. */
export function assertOrganizationOwnerSession(organizationId: string, userId: string, sessionId: string): void {
  const active = db.prepare("SELECT id FROM sessions WHERE id=? AND user_id=? AND status='active' AND expires_at>?").get(sessionId, userId, now());
  if (!active) throw new BillingError("Your session changed. Sign in again.", 401, "session_changed");
  if (organizationRole(organizationId, userId) !== "owner") throw new BillingError("Organization owner access required", 403, "owner_required");
}
export function organizationAudit(organizationId: string, actorId: string | null, action: string, detail: unknown): void {
  db.prepare("INSERT INTO organization_audit (organization_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?)").run(organizationId, actorId, action, JSON.stringify(detail), now());
  const policy = db.prepare("SELECT audit_retention_days FROM organizations WHERE id=?").get(organizationId) as { audit_retention_days: number } | undefined;
  if (policy) db.prepare("DELETE FROM organization_audit WHERE organization_id=? AND created_at<?").run(organizationId, now() - policy.audit_retention_days * 86400);
}
type SubscriptionRow = {
  organization_id: string; plan: string; status: SubscriptionStatus; base_seats: number; paid_seats: number; total_seats: number;
  current_period_start: number; current_period_end: number; cancel_at_period_end: number; provider: string;
  provider_subscription_id: string | null; entitlement_revision: number; verified_order_id: string | null; created_at: number; updated_at: number;
};
export function getOrganizationSubscription(organizationId: string): OrganizationSubscription {
  let row = db.prepare("SELECT * FROM organization_subscriptions WHERE organization_id=?").get(organizationId) as SubscriptionRow | undefined;
  if (!row) {
    const t = now(), base = organizationBaseSeats();
    db.prepare(`INSERT OR IGNORE INTO organization_subscriptions
      (organization_id,plan,status,base_seats,paid_seats,total_seats,current_period_start,current_period_end,cancel_at_period_end,provider,created_at,updated_at)
      VALUES (?,'standard','active',?,0,?,?,?,0,'none',?,?)`).run(organizationId, base, base, t, t, t, t);
    row = db.prepare("SELECT * FROM organization_subscriptions WHERE organization_id=?").get(organizationId) as SubscriptionRow;
  }
  return {
    organizationId: row.organization_id, plan: row.plan, status: row.status,
    baseSeats: row.base_seats, paidSeats: row.paid_seats, totalSeats: row.total_seats,
    currentPeriodStart: row.current_period_start, currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), provider: row.provider, providerSubscriptionId: row.provider_subscription_id,
    entitlementRevision: row.entitlement_revision, verifiedOrderId: row.verified_order_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export function getOrganizationEntitlement(organizationId: string): OrganizationEntitlement {
  const sub = getOrganizationSubscription(organizationId);
  const organization = db.prepare("SELECT seat_limit FROM organizations WHERE id=?").get(organizationId) as { seat_limit: number } | undefined;
  const seatsUsed = (db.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id=?").get(organizationId) as { count: number }).count;
  const proof = sub.verifiedOrderId ? db.prepare(`SELECT o.target_paid_seats,o.base_seats,o.term_days,o.completed_at
    FROM tenant_billing_orders o JOIN payment_receipts r ON r.payment_id=o.id AND r.provider=o.provider
    WHERE o.id=? AND o.organization_id=? AND o.status='verified' AND r.disposition='applied'`).get(sub.verifiedOrderId, organizationId) as
    { target_paid_seats: number; base_seats: number; term_days: number; completed_at: number } | undefined : undefined;
  const validNumbers = Number.isSafeInteger(sub.baseSeats) && sub.baseSeats >= 1 && sub.baseSeats <= 5 &&
    Number.isSafeInteger(sub.paidSeats) && sub.paidSeats >= 0 && sub.baseSeats + sub.paidSeats <= 10000 &&
    sub.totalSeats === sub.baseSeats + sub.paidSeats && Number.isSafeInteger(sub.entitlementRevision) && sub.entitlementRevision >= 0 &&
    Number.isSafeInteger(sub.currentPeriodStart) && Number.isSafeInteger(sub.currentPeriodEnd) && sub.currentPeriodEnd >= sub.currentPeriodStart;
  const hasVerifiedPayment = Boolean(validNumbers && proof && sub.provider === "razorpay" &&
    proof.target_paid_seats === sub.paidSeats && proof.base_seats === sub.baseSeats &&
    proof.completed_at === sub.currentPeriodStart && proof.completed_at + proof.term_days * 86400 === sub.currentPeriodEnd);
  const baseSeats = validNumbers ? Math.min(sub.baseSeats, organizationBaseSeats()) : 0;
  const expired = hasVerifiedPayment && now() >= sub.currentPeriodEnd;
  const isDelinquent = hasVerifiedPayment && (expired || sub.status !== "active");
  const effectivePaidSeats = hasVerifiedPayment && !isDelinquent ? sub.paidSeats : 0;
  const totalSeats = baseSeats + effectivePaidSeats;
  const seatLimit = organization?.seat_limit ?? 0;
  const validEntitlement = validNumbers && Boolean(organization) && Number.isSafeInteger(seatLimit) && seatLimit >= 1 && seatLimit <= 10000;
  const availableLimit = Math.min(totalSeats, seatLimit);
  const overCapacity = !validEntitlement || seatsUsed > availableLimit;
  return {
    organizationId, plan: hasVerifiedPayment && !isDelinquent ? sub.plan : "standard",
    status: expired ? (sub.cancelAtPeriodEnd ? "canceled" : "unpaid") : sub.status,
    baseSeats, paidSeats: sub.paidSeats, effectivePaidSeats, totalSeats, seatLimit, seatsUsed,
    seatsAvailable: Math.max(0, availableLimit - seatsUsed), canAddMember: validEntitlement && !overCapacity && seatsUsed < availableLimit,
    isDelinquent, expired, overCapacity, hasVerifiedPayment, validEntitlement,
    currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}
/** Expiry never removes members or projects. Over-capacity tenants keep reads and administrative cleanup. */
export function organizationCanWrite(organizationId: string): boolean {
  const entitlement = getOrganizationEntitlement(organizationId);
  return entitlement.validEntitlement && !entitlement.overCapacity;
}
export function recordBillingTransition(organizationId: string, actorId: string, action: BillingTransitionAction, key: string,
  previous: unknown, next: unknown, details: Record<string, unknown>, paymentId: string | null = null): void {
  const id = randomId();
  db.prepare(`INSERT INTO billing_transitions (id,idempotency_key,organization_id,user_id,payment_id,action,previous_state,new_state,details,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, key, organizationId, actorId, paymentId, action, JSON.stringify(previous), JSON.stringify(next), JSON.stringify(details), now());
  organizationAudit(organizationId, actorId, `billing.${action}`, { transitionId: id, ...details });
}
/** Compatibility entry point: only non-commercial flags are client mutable. */
export function applyBillingTransition(params: {
  idempotencyKey: string; organizationId: string; userId?: string; sessionId?: string; paymentId?: string;
  action: BillingTransitionAction; paidSeatsDelta?: number; targetPaidSeats?: number; newPlan?: string; status?: SubscriptionStatus;
  periodDays?: number; details?: Record<string, unknown>;
}): { duplicate: boolean; entitlement: OrganizationEntitlement } {
  return withTransaction(() => {
    assertOrganizationOwnerSession(params.organizationId, params.userId ?? "", params.sessionId ?? "");
    if (!["cancel", "reactivate"].includes(params.action) || params.paidSeatsDelta !== undefined || params.targetPaidSeats !== undefined ||
      params.newPlan !== undefined || params.status !== undefined || params.periodDays !== undefined || params.paymentId !== undefined) {
      throw new BillingError("Paid capacity and subscription terms require a verified configured checkout.", 409, "payment_required");
    }
    const key = `owner:${billingDigest([params.organizationId, params.action, params.idempotencyKey])}`;
    const digest = billingDigest([params.organizationId, params.userId, params.action]);
    const prior = db.prepare("SELECT organization_id,user_id,action,details FROM billing_transitions WHERE idempotency_key=?").get(key) as
      { organization_id: string; user_id: string; action: string; details: string } | undefined;
    if (prior) {
      const detail = JSON.parse(prior.details) as { requestDigest?: string };
      if (prior.organization_id !== params.organizationId || prior.user_id !== params.userId || prior.action !== params.action || detail.requestDigest !== digest) {
        throw new BillingError("This idempotency key belongs to a different billing request.", 409, "idempotency_conflict");
      }
      return { duplicate: true, entitlement: getOrganizationEntitlement(params.organizationId) };
    }
    const current = getOrganizationSubscription(params.organizationId), entitlement = getOrganizationEntitlement(params.organizationId);
    if (!entitlement.hasVerifiedPayment || entitlement.expired || current.status !== "active") {
      throw new BillingError("Only an unexpired verified paid term can be canceled or resumed; expiry requires a new payment.", 409, "verified_term_required");
    }
    const cancel = params.action === "cancel";
    db.prepare("UPDATE organization_subscriptions SET cancel_at_period_end=?,entitlement_revision=entitlement_revision+1,updated_at=? WHERE organization_id=?").run(cancel ? 1 : 0, now(), params.organizationId);
    recordBillingTransition(params.organizationId, params.userId!, params.action, key, current, getOrganizationSubscription(params.organizationId), { requestDigest: digest });
    return { duplicate: false, entitlement: getOrganizationEntitlement(params.organizationId) };
  });
}
