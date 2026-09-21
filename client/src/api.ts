import type {
  AuditEvent,
  AuditStats,
  PaymentMethodInfo,
  PaymentRecord,
  Plan,
  Project,
  ProjectDetail,
  SessionInfo,
  User,
  AssistantPlanResponse,
  AssistantAction,
  AssistantPlan,
  ProjectRevision,
  ProjectShareLink,
  Design,
  SharedProject,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CadProviderStatus {
  providerName: string;
  licenseStatus: "licensed" | "unlicensed" | "unknown";
  endpointConfigured: boolean;
  sdkCapability: boolean;
  supportedFormats: string[];
  available: boolean;
  message: string;
}

export interface CadExchangeStatusResponse {
  providers: CadProviderStatus[];
  openFallbacks: string[];
  message: string;
}

export function getCadExchangeStatus(): Promise<CadExchangeStatusResponse> {
  return request<CadExchangeStatusResponse>("/api/cad-exchange/status");
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

export interface AssistantPlanRequest {
  message: string;
  context: unknown;
}

export function requestAssistantPlan(input: AssistantPlanRequest): Promise<AssistantPlanResponse> {
  return request<AssistantPlanResponse>("/api/assistant/plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface AssistantPlanPreview {
  plan: AssistantPlan;
  actionCount: number;
  requiresProfessionalReview: boolean;
}

export function createAssistantPlanPreview(plan: AssistantPlan): AssistantPlanPreview {
  return { plan, actionCount: plan.actions.length, requiresProfessionalReview: true };
}

/* The editor supplies the apply callback after user review; this never calls the persistence API. */
export function applyAssistantPlanPreview(preview: AssistantPlanPreview, apply: (actions: AssistantAction[]) => void): void {
  apply([...preview.plan.actions]);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { skipCsrf?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) || {}),
  };
  if (!(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const needsCsrf = !opts.skipCsrf && !["GET", "HEAD", "OPTIONS"].includes((init.method || "GET").toUpperCase());
  if (needsCsrf && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* no json body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/* ---------------------------------- Auth ---------------------------------- */

export interface MeResponse {
  user: User & { plan?: string; plan_expires_at?: number | null };
  csrfToken: string;
}

export async function bootstrap(): Promise<{ csrfToken: string }> {
  const res = await request<{ csrfToken: string }>("/api/auth/bootstrap", { method: "GET" });
  setCsrfToken(res.csrfToken);
  return res;
}

export async function getMe(): Promise<MeResponse | null> {
  try {
    const res = await request<MeResponse>("/api/auth/me", { method: "GET" });
    setCsrfToken(res.csrfToken);
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export interface SignupExtras {
  username?: string;
  country?: string;
  phone?: string;
  accountType?: "individual" | "business";
  gstin?: string;
}

export interface SignupResult {
  needsEmailVerification?: boolean;
  message?: string;
  emailDelivered?: boolean;
  devOtp?: string;
  user?: User;
  csrfToken?: string;
}

export async function signup(email: string, password: string, confirmPassword: string, extras: SignupExtras = {}) {
  const res = await request<SignupResult>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, confirmPassword, ...extras }),
  });
  if (res.csrfToken) setCsrfToken(res.csrfToken);
  return res;
}

export interface VerifyEmailResult {
  user?: User;
  csrfToken?: string;
  alreadyVerified?: boolean;
  error?: string;
}

export async function verifyEmail(email: string, code: string): Promise<VerifyEmailResult> {
  const res = await request<VerifyEmailResult>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  if (res.csrfToken) setCsrfToken(res.csrfToken);
  return res;
}

export function resendOtp(email: string) {
  return request<{ ok: boolean; message?: string; delivered?: boolean; devOtp?: string }>("/api/auth/resend-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function login(email: string, password: string) {
  const res = await request<{ user?: User; csrfToken?: string; needsTwoFactor?: boolean }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
  if (res.csrfToken) setCsrfToken(res.csrfToken);
  return res;
}

export interface OtpLoginRequestResult {
  ok?: boolean;
  message?: string;
  delivered?: boolean;
  mailError?: string;
  devOtp?: string;
}

export function requestOtpLogin(email: string): Promise<OtpLoginRequestResult> {
  return request<OtpLoginRequestResult>("/api/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export interface OtpLoginResult {
  user?: User;
  csrfToken?: string;
  needsTwoFactor?: boolean;
}

export async function loginWithOtp(email: string, code: string): Promise<OtpLoginResult> {
  const res = await request<OtpLoginResult>("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  if (res.csrfToken) setCsrfToken(res.csrfToken);
  return res;
}

export function verifyTwoFactor(code: string) {
  return request<{ user: User; csrfToken: string }>("/api/auth/verify-2fa", {
    method: "POST",
    body: JSON.stringify({ code }),
  }).then((r) => {
    setCsrfToken(r.csrfToken);
    return r;
  });
}

export function logout() {
  return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await request<{ sessions: SessionInfo[] }>("/api/auth/sessions", { method: "GET" });
  return res.sessions;
}

export function revokeSession(id: string) {
  return request<{ ok: boolean }>(`/api/auth/sessions/${id}`, { method: "DELETE" });
}

export function revokeOthers() {
  return request<{ ok: boolean; revoked: number }>("/api/auth/revoke-others", { method: "POST", body: "{}" });
}

export function changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
  return request<{ ok: boolean }>("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
  });
}

export interface ProfilePatch {
  username?: string;
  country?: string;
  phone?: string;
  accountType?: "individual" | "business";
  gstin?: string;
}

export async function updateProfile(patch: ProfilePatch): Promise<User> {
  const res = await request<{ user: User }>("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return res.user;
}

export interface CountryOption {
  iso2: string;
  name: string;
  currency: string;
  symbol: string;
}

export async function getCountries(): Promise<CountryOption[]> {
  const res = await request<{ countries: CountryOption[] }>("/api/countries", { method: "GET" });
  return res.countries;
}

export async function twoFactorSetup() {
  return request<{ secret: string; otpauthUrl: string; qrDataUrl: string }>("/api/auth/2fa/setup", {
    method: "GET",
  });
}

export function twoFactorEnable(code: string) {
  return request<{ ok: boolean }>("/api/auth/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function twoFactorDisable(code: string) {
  return request<{ ok: boolean }>("/api/auth/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/* -------------------------------- Projects -------------------------------- */

export async function listProjects(): Promise<Project[]> {
  const res = await request<{ projects: Project[] }>("/api/projects", { method: "GET" });
  return res.projects;
}

export function createProject(name: string, projectType: string = "house") {
  return request<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, projectType }),
  });
}

export async function getProject(id: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/api/projects/${id}`, { method: "GET" });
}

export function patchProject(
  id: string,
  patch: { name?: string; projectType?: string; widthMm?: number; depthMm?: number; designData?: string },
) {
  return request<{ ok: boolean }>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function uploadProjectPhoto(id: string, file: File) {
  const fd = new FormData();
  fd.append("photo", file);
  const res = await request<{ ok: boolean }>(`/api/projects/${id}/photo`, {
    method: "POST",
    body: fd,
  });
  return res;
}

export function deleteProject(id: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" });
}

export function recordExport(id: string, format: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/export`, {
    method: "POST",
    body: JSON.stringify({ format }),
  });
}

/* ---------------------------- History / sharing --------------------------- */

export async function listProjectRevisions(id: string): Promise<ProjectRevision[]> {
  return (await request<{ revisions: ProjectRevision[] }>(`/api/projects/${id}/revisions`, { method: "GET" })).revisions;
}

export function createProjectRevision(id: string, name: string, designData?: string) {
  return request<ProjectRevision>(`/api/projects/${id}/revisions`, { method: "POST", body: JSON.stringify({ name, designData }) });
}

export function restoreProjectRevision(id: string, revisionId: string) {
  return request<{ ok: boolean; name: string; projectType: string; widthMm: number; depthMm: number; design: Design | null }>(
    `/api/projects/${id}/revisions/${revisionId}/restore`, { method: "POST", body: "{}" },
  );
}

export async function listProjectShareLinks(id: string): Promise<ProjectShareLink[]> {
  return (await request<{ links: ProjectShareLink[] }>(`/api/projects/${id}/share-links`, { method: "GET" })).links;
}

export function createProjectShareLink(id: string, expiresInHours = 24 * 7) {
  return request<{ id: string; token: string; expiresAt: number; url: string }>(`/api/projects/${id}/share-links`, {
    method: "POST", body: JSON.stringify({ expiresInHours }),
  });
}

export function revokeProjectShareLink(id: string, linkId: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/share-links/${linkId}`, { method: "DELETE" });
}

export function getSharedProject(token: string): Promise<SharedProject> {
  return request<SharedProject>(`/api/share/${encodeURIComponent(token)}`, { method: "GET" }, { skipCsrf: true });
}

/* ---------------------------------- Audit --------------------------------- */

export async function getAuditLog(limit = 100): Promise<AuditEvent[]> {
  const res = await request<{ events: AuditEvent[] }>(`/api/audit?limit=${limit}`, { method: "GET" });
  return res.events;
}

export async function getAuditStats(): Promise<AuditStats> {
  return request<AuditStats>("/api/audit/stats", { method: "GET" });
}

/* -------------------------------- Payments -------------------------------- */

export interface PlansResponse {
  plans: Plan[];
  free: Plan;
  isDemo: boolean;
  methods: PaymentMethodInfo[];
  country: { iso2: string; name: string; currency: string; symbol: string; digits: number };
}

export function getPlans(): Promise<PlansResponse> {
  return request<PlansResponse>("/api/payments/plans", { method: "GET" });
}

export function listPayments(): Promise<PaymentRecord[]> {
  return request<{ payments: PaymentRecord[] }>("/api/payments", { method: "GET" }).then(
    (r) => r.payments,
  );
}

export interface CreatePaymentResult {
  paymentId: string;
  provider: string;
  demo: boolean;
  checkoutUrl: string | null;
  method: string;
  providerOrderId: string;
}

export function createPayment(planId: string, method: string) {
  return request<CreatePaymentResult>("/api/payments/create", {
    method: "POST",
    body: JSON.stringify({ planId, method }),
  });
}

export function confirmDemoPayment(paymentId: string) {
  return request<{ ok: boolean }>("/api/payments/confirm-demo", {
    method: "POST",
    body: JSON.stringify({ paymentId }),
  });
}

export function getPayment(id: string): Promise<{ payment: PaymentRecord }> {
  return request<{ payment: PaymentRecord }>(`/api/payments/${id}`, { method: "GET" });
}
