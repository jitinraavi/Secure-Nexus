import { randomId } from "./crypto.js";
import { db, now, withTransaction } from "./db.js";

export type OrganizationRole = "owner" | "admin" | "editor" | "viewer";

export interface OrganizationSubscription {
  organizationId: string;
  plan: string;
  status: "active" | "past_due" | "canceled" | "unpaid" | "trialing";
  baseSeats: number;
  paidSeats: number;
  totalSeats: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  provider: string;
  providerSubscriptionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OrganizationEntitlement {
  organizationId: string;
  plan: string;
  status: "active" | "past_due" | "canceled" | "unpaid" | "trialing";
  baseSeats: number;
  paidSeats: number;
  totalSeats: number;
  seatsUsed: number;
  seatsAvailable: number;
  canAddMember: boolean;
  isDelinquent: boolean;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

export type BillingTransitionAction =
  | "subscribe"
  | "seat_change"
  | "renew"
  | "cancel"
  | "reactivate"
  | "expire"
  | "payment_failed";

export function organizationRole(organizationId: string, userId: string): OrganizationRole | null {
  const row = db.prepare("SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ?")
    .get(organizationId, userId) as { role: OrganizationRole } | undefined;
  return row?.role ?? null;
}

export function organizationAdmin(organizationId: string, userId: string): boolean {
  return ["owner", "admin"].includes(organizationRole(organizationId, userId) ?? "");
}

export function organizationAudit(organizationId: string, actorId: string | null, action: string, detail: unknown): void {
  db.prepare("INSERT INTO organization_audit (organization_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?)")
    .run(organizationId, actorId, action, JSON.stringify(detail), now());
  const policy = db.prepare("SELECT audit_retention_days FROM organizations WHERE id = ?").get(organizationId) as { audit_retention_days: number } | undefined;
  if (policy) db.prepare("DELETE FROM organization_audit WHERE organization_id = ? AND created_at < ?")
    .run(organizationId, now() - policy.audit_retention_days * 86400);
}

export function getOrganizationSubscription(organizationId: string): OrganizationSubscription {
  const row = db.prepare(`SELECT * FROM organization_subscriptions WHERE organization_id = ?`).get(organizationId) as
    | {
        organization_id: string;
        plan: string;
        status: "active" | "past_due" | "canceled" | "unpaid" | "trialing";
        base_seats: number;
        paid_seats: number;
        total_seats: number;
        current_period_start: number;
        current_period_end: number;
        cancel_at_period_end: number;
        provider: string;
        provider_subscription_id: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (row) {
    return {
      organizationId: row.organization_id,
      plan: row.plan,
      status: row.status,
      baseSeats: Number(row.base_seats),
      paidSeats: Number(row.paid_seats),
      totalSeats: Number(row.total_seats),
      currentPeriodStart: Number(row.current_period_start),
      currentPeriodEnd: Number(row.current_period_end),
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      provider: row.provider,
      providerSubscriptionId: row.provider_subscription_id,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // Auto-initialize standard subscription for organization
  const t = now();
  const baseSeats = 5;
  const periodEnd = t + 365 * 86400;
  db.prepare(`
    INSERT OR IGNORE INTO organization_subscriptions
      (organization_id, plan, status, base_seats, paid_seats, total_seats, current_period_start, current_period_end, cancel_at_period_end, provider, created_at, updated_at)
    VALUES (?, 'standard', 'active', ?, 0, ?, ?, ?, 0, 'demo', ?, ?)
  `).run(organizationId, baseSeats, baseSeats, t, periodEnd, t, t);

  return {
    organizationId,
    plan: "standard",
    status: "active",
    baseSeats,
    paidSeats: 0,
    totalSeats: baseSeats,
    currentPeriodStart: t,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    provider: "demo",
    providerSubscriptionId: null,
    createdAt: t,
    updatedAt: t,
  };
}

export function getOrganizationEntitlement(organizationId: string): OrganizationEntitlement {
  const sub = getOrganizationSubscription(organizationId);
  const seatsUsed = Number(
    (
      db.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = ?").get(organizationId) as {
        count: number;
      }
    ).count,
  );

  const t = now();
  let status = sub.status;
  // If period ended and marked to cancel, transition status
  if (t > sub.currentPeriodEnd && sub.cancelAtPeriodEnd && status === "active") {
    status = "canceled";
  }

  const isDelinquent = status === "past_due" || status === "unpaid" || status === "canceled";
  const effectiveTotalSeats = isDelinquent ? sub.baseSeats : sub.totalSeats;
  const canAddMember = !isDelinquent && seatsUsed < effectiveTotalSeats;
  const seatsAvailable = Math.max(0, effectiveTotalSeats - seatsUsed);

  return {
    organizationId,
    plan: sub.plan,
    status,
    baseSeats: sub.baseSeats,
    paidSeats: sub.paidSeats,
    totalSeats: effectiveTotalSeats,
    seatsUsed,
    seatsAvailable,
    canAddMember,
    isDelinquent,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

export function applyBillingTransition(params: {
  idempotencyKey: string;
  organizationId: string;
  userId?: string;
  paymentId?: string;
  action: BillingTransitionAction;
  paidSeatsDelta?: number;
  targetPaidSeats?: number;
  newPlan?: string;
  status?: "active" | "past_due" | "canceled" | "unpaid" | "trialing";
  periodDays?: number;
  details?: Record<string, unknown>;
}): { duplicate: boolean; entitlement: OrganizationEntitlement } {
  // Check for duplicate request with same idempotency key
  const existing = db
    .prepare("SELECT * FROM billing_transitions WHERE idempotency_key = ?")
    .get(params.idempotencyKey) as { id: string } | undefined;
  if (existing) {
    return {
      duplicate: true,
      entitlement: getOrganizationEntitlement(params.organizationId),
    };
  }

  return withTransaction(() => {
    // Re-check idempotency within transaction lock
    const locked = db
      .prepare("SELECT * FROM billing_transitions WHERE idempotency_key = ?")
      .get(params.idempotencyKey);
    if (locked) {
      return {
        duplicate: true,
        entitlement: getOrganizationEntitlement(params.organizationId),
      };
    }

    const currentSub = getOrganizationSubscription(params.organizationId);
    const seatsUsed = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = ?")
          .get(params.organizationId) as { count: number }
      ).count,
    );

    let nextPaidSeats = currentSub.paidSeats;
    if (params.targetPaidSeats !== undefined) {
      nextPaidSeats = Math.max(0, params.targetPaidSeats);
    } else if (params.paidSeatsDelta !== undefined) {
      nextPaidSeats = Math.max(0, currentSub.paidSeats + params.paidSeatsDelta);
    }

    const nextTotalSeats = currentSub.baseSeats + nextPaidSeats;

    // Enforce seat reduction barrier: cannot reduce below currently used seats
    if (
      params.action === "seat_change" &&
      nextTotalSeats < seatsUsed
    ) {
      throw new Error(`Cannot reduce seats to ${nextTotalSeats}; ${seatsUsed} members currently in organization`);
    }

    let nextStatus = params.status ?? currentSub.status;
    let nextCancelAtPeriodEnd = currentSub.cancelAtPeriodEnd;
    let nextPeriodEnd = currentSub.currentPeriodEnd;
    const t = now();

    if (params.action === "cancel") {
      nextCancelAtPeriodEnd = true;
    } else if (params.action === "reactivate") {
      nextCancelAtPeriodEnd = false;
      if (nextStatus === "canceled") nextStatus = "active";
    } else if (params.action === "renew" || params.action === "subscribe") {
      nextCancelAtPeriodEnd = false;
      nextStatus = "active";
      const addDays = params.periodDays ?? 30;
      nextPeriodEnd = Math.max(t, currentSub.currentPeriodEnd) + addDays * 86400;
    } else if (params.action === "payment_failed") {
      nextStatus = "past_due";
    } else if (params.action === "expire") {
      nextStatus = "canceled";
    }

    const nextPlan = params.newPlan ?? currentSub.plan;

    // Update organization_subscriptions
    db.prepare(`
      UPDATE organization_subscriptions
      SET plan = ?, status = ?, paid_seats = ?, total_seats = ?,
          current_period_end = ?, cancel_at_period_end = ?, updated_at = ?
      WHERE organization_id = ?
    `).run(
      nextPlan,
      nextStatus,
      nextPaidSeats,
      nextTotalSeats,
      nextPeriodEnd,
      nextCancelAtPeriodEnd ? 1 : 0,
      t,
      params.organizationId,
    );

    // Sync organization's seat_limit with entitled total_seats
    db.prepare("UPDATE organizations SET seat_limit = ?, updated_at = ? WHERE id = ?").run(
      nextTotalSeats,
      t,
      params.organizationId,
    );

    const transitionId = randomId();
    db.prepare(`
      INSERT INTO billing_transitions
        (id, idempotency_key, organization_id, user_id, payment_id, action, previous_state, new_state, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transitionId,
      params.idempotencyKey,
      params.organizationId,
      params.userId ?? null,
      params.paymentId ?? null,
      params.action,
      JSON.stringify({ status: currentSub.status, paidSeats: currentSub.paidSeats, totalSeats: currentSub.totalSeats, plan: currentSub.plan }),
      JSON.stringify({ status: nextStatus, paidSeats: nextPaidSeats, totalSeats: nextTotalSeats, plan: nextPlan }),
      JSON.stringify(params.details ?? {}),
      t,
    );

    organizationAudit(params.organizationId, params.userId ?? null, `billing.${params.action}`, {
      transitionId,
      action: params.action,
      previousSeats: currentSub.totalSeats,
      newSeats: nextTotalSeats,
      status: nextStatus,
      plan: nextPlan,
      details: params.details,
    });

    return {
      duplicate: false,
      entitlement: getOrganizationEntitlement(params.organizationId),
    };
  });
}
