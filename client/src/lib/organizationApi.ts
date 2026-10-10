import { ApiError, getCsrfToken } from "../api";

export type OrganizationRole = "owner" | "admin" | "editor" | "viewer";
export interface Organization { id: string; name: string; seatLimit: number; seatsUsed: number; auditRetentionDays: number; role: OrganizationRole }
export interface OrganizationMember { userId: string; email: string; username: string | null; role: OrganizationRole }
export interface OrganizationProject { id: string; name: string; projectType: string; revision: number }
export interface OrganizationDetail { organization: Organization; members: OrganizationMember[]; projects: OrganizationProject[]; seatEntitlement: number; entitlement?: OrganizationEntitlement }
export interface OrganizationEntitlement {
  organizationId: string;
  plan: string;
  status: "active" | "past_due" | "canceled" | "unpaid" | "trialing";
  baseSeats: number;
  paidSeats: number;
  effectivePaidSeats: number;
  totalSeats: number;
  seatLimit: number;
  seatsUsed: number;
  seatsAvailable: number;
  canAddMember: boolean;
  isDelinquent: boolean;
  expired: boolean;
  overCapacity: boolean;
  hasVerifiedPayment: boolean;
  validEntitlement: boolean;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}
export interface BillingTransition {
  id: string;
  idempotencyKey: string;
  action: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  details: Record<string, unknown>;
  createdAt: number;
}
export interface OrganizationBillingInfo {
  entitlement: OrganizationEntitlement;
  subscription: {
    plan: string;
    status: string;
    baseSeats: number;
    paidSeats: number;
    totalSeats: number;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
    entitlementRevision: number;
    verifiedOrderId: string | null;
  };
  configuration: { configured: boolean; reason: string | null; provider: "razorpay"; currency: "INR"; unitPrice: number | null;
    termDays: number | null; maximumAmount: number; termPolicy: "replace_from_verification"; automaticRenewal: false };
  orders: TenantBillingOrder[];
  transitions: BillingTransition[];
}
export interface TenantBillingOrder { id: string; organizationId: string; targetPaidSeats: number; amount: number; currency: "INR"; termDays: number;
  status: "creating" | "pending" | "creation_unknown" | "failed" | "verified" | "requires_review" | "expired";
  checkoutUrl: string | null; createdAt: number; expiresAt: number; completedAt: number | null; reviewReason: string | null }
export interface OrganizationAuditPage { events: { id: number; actorId: string | null; action: string; detail: unknown; createdAt: number }[]; nextBeforeId: number | null }
export interface SsoConfiguration { issuer: string; clientId: string; redirectUri: string; enabled: boolean; hasSecret: boolean }
export async function organizationRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getCsrfToken();
  if (method !== "GET" && token) headers["x-csrf-token"] = token;
  const response = await fetch(path, { method, headers, credentials: "same-origin", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const result = await response.json() as { error?: string }; message = result.error || message; } catch { /* preserve HTTP error */ }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}
const orgPath = (id: string) => `/api/organizations/${encodeURIComponent(id)}`;
export const listOrganizations = () => organizationRequest<{ organizations: Organization[]; seatEntitlement: number }>("/api/organizations");
export const createOrganization = (name: string) => organizationRequest<{ id: string }>("/api/organizations", "POST", { name });
export const listPersonalOrganizationProjects = () => organizationRequest<{ projects: { id: string; name: string }[] }>("/api/organizations/personal-projects");
export const getOrganization = (id: string) => organizationRequest<OrganizationDetail>(orgPath(id));
export const updateOrganization = (id: string, settings: { name: string; seatLimit: number; auditRetentionDays: number }) => organizationRequest<{ ok: boolean }>(orgPath(id), "PATCH", settings);
export const addOrganizationMember = (id: string, identifier: string, role: Exclude<OrganizationRole, "owner">) => organizationRequest<{ ok: boolean }>(`${orgPath(id)}/members`, "POST", { identifier, role });
export const updateOrganizationMember = (id: string, userId: string, role: Exclude<OrganizationRole, "owner">) => organizationRequest<{ ok: boolean }>(`${orgPath(id)}/members/${encodeURIComponent(userId)}`, "PATCH", { role });
export const removeOrganizationMember = (id: string, userId: string) => organizationRequest<{ ok: boolean }>(`${orgPath(id)}/members/${encodeURIComponent(userId)}`, "DELETE");
export const transferOrganizationOwner = (id: string, userId: string) => organizationRequest<{ ok: boolean }>(`${orgPath(id)}/transfer-owner`, "POST", { userId });
export const bindOrganizationProject = (id: string, projectId: string) => organizationRequest<{ ok: boolean }>(`${orgPath(id)}/projects`, "POST", { projectId });
export const getOrganizationAudit = (id: string, beforeId?: number) => organizationRequest<OrganizationAuditPage>(`${orgPath(id)}/audit${beforeId ? `?beforeId=${beforeId}` : ""}`);
export const getOrganizationSso = (id: string) => organizationRequest<{ configuration: SsoConfiguration | null; nativeSaml: false; samlGateway: string; configuredAllowedHosts: boolean }>(`/api/sso/${encodeURIComponent(id)}/config`);
export const configureOrganizationSso = (id: string, configuration: { issuer: string; clientId: string; clientSecret?: string; enabled: boolean }) => organizationRequest<{ ok: boolean; redirectUri: string }>(`/api/sso/${encodeURIComponent(id)}/config`, "PUT", configuration);
export const unlinkOrganizationIdentity = (id: string) => organizationRequest<{ ok: boolean }>(`/api/sso/${encodeURIComponent(id)}/identity`, "DELETE");
export const getOrganizationBilling = (id: string) => organizationRequest<OrganizationBillingInfo>(`${orgPath(id)}/billing`);
export const updateOrganizationSeats = (id: string, params: { idempotencyKey: string; targetPaidSeats: number; acceptTermReplacement: true }) => organizationRequest<{ duplicate: boolean; order: TenantBillingOrder }>(`${orgPath(id)}/billing/seats`, "POST", params);
export const subscribeOrganization = (id: string, params: { idempotencyKey: string; plan: "standard" | "enterprise"; periodDays?: number }) => organizationRequest<{ duplicate: boolean; entitlement: OrganizationEntitlement }>(`${orgPath(id)}/billing/subscribe`, "POST", params);
export const cancelOrganizationSubscription = (id: string, idempotencyKey: string) => organizationRequest<{ duplicate: boolean; entitlement: OrganizationEntitlement }>(`${orgPath(id)}/billing/cancel`, "POST", { idempotencyKey });
export const reactivateOrganizationSubscription = (id: string, idempotencyKey: string) => organizationRequest<{ duplicate: boolean; entitlement: OrganizationEntitlement }>(`${orgPath(id)}/billing/reactivate`, "POST", { idempotencyKey });
