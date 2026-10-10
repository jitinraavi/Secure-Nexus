import { Router } from "express";
import { createHash, createPublicKey, timingSafeEqual, verify, constants, type JsonWebKey } from "node:crypto";
import { z } from "zod";
import { MASTER_KEY, PREVIOUS_MASTER_KEY, IS_PROD } from "../config.js";
import { decryptAesGcm, deriveVaultKey, encryptAesGcm, randomToken, sha256Hex } from "../crypto.js";
import { db, now, withTransaction } from "../db.js";
import { organizationAdmin, organizationAudit, organizationRole } from "../organization.js";
import { asyncHandler, createSession, requireSession, resolveSession, strictLimiter, type AuthedRequest } from "../security.js";

const router = Router();
const key = deriveVaultKey(MASTER_KEY);
const previousKey = PREVIOUS_MASTER_KEY ? deriveVaultKey(PREVIOUS_MASTER_KEY) : null;
const allowedHosts = new Set((process.env.SSO_ALLOWED_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
const publicOrigin = process.env.PUBLIC_APP_ORIGIN || "";
interface SsoRow { issuer: string; client_id: string; secret_encrypted: string | null; redirect_uri: string; enabled: number; configuration_revision: number }
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; authMethods: string[] }
function trustedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error("SSO URL host must be approved in SSO_ALLOWED_HOSTS and use HTTPS");
  return url;
}
function callbackUri(organizationId: string) {
  const origin = new URL(publicOrigin);
  const localDevelopment = !IS_PROD && origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !localDevelopment) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("PUBLIC_APP_ORIGIN must be a fixed application origin");
  return `${origin.origin}/api/sso/${encodeURIComponent(organizationId)}/callback`;
}
function seal(value: string, organizationId: string) { return JSON.stringify(encryptAesGcm(value, key, `groundwork:sso:${organizationId}`)); }
function open(value: string, organizationId: string) {
  const payload = JSON.parse(value) as { iv: string; tag: string; data: string };
  try { return decryptAesGcm(payload, key, `groundwork:sso:${organizationId}`); }
  catch (error) { if (!previousKey) throw error; return decryptAesGcm(payload, previousKey, `groundwork:sso:${organizationId}`); }
}
async function boundedJson(url: URL, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Identity provider request failed");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Identity provider response is empty");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 256000) { await reader.cancel(); throw new Error("Identity provider response exceeds limit"); } chunks.push(part.value); }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Identity provider response is invalid");
  return data as Record<string, unknown>;
}
async function discovery(issuer: string): Promise<Discovery> {
  const issuerUrl = trustedUrl(issuer);
  if (issuerUrl.search) throw new Error("SSO issuer must not contain a query");
  const metadata = await boundedJson(trustedUrl(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`));
  if (metadata.issuer !== issuer || !Array.isArray(metadata.response_types_supported) || !metadata.response_types_supported.includes("code")) throw new Error("Identity provider issuer or authorization-code support is invalid");
  const authorization = String(metadata.authorization_endpoint || ""), token = String(metadata.token_endpoint || ""), jwks = String(metadata.jwks_uri || "");
  trustedUrl(authorization); trustedUrl(token); trustedUrl(jwks);
  const authMethods = Array.isArray(metadata.token_endpoint_auth_methods_supported) ? metadata.token_endpoint_auth_methods_supported.filter((method): method is string => typeof method === "string") : ["client_secret_basic"];
  return { issuer, authorization_endpoint: authorization, token_endpoint: token, jwks_uri: jwks, authMethods };
}
const configSchema = z.object({ issuer: z.string().min(8).max(500), clientId: z.string().min(1).max(200), clientSecret: z.string().max(2000).optional(), enabled: z.boolean() }).strict();
router.get("/:organizationId/config", requireSession, (req: AuthedRequest, res) => {
  if (!organizationAdmin(req.params.organizationId, req.user!.id)) { res.status(403).json({ error: "Organization administrator access required" }); return; }
  const row = db.prepare("SELECT issuer,client_id,redirect_uri,enabled,secret_encrypted FROM organization_sso WHERE organization_id=?").get(req.params.organizationId) as SsoRow | undefined;
  res.json({ configuration: row ? { issuer: row.issuer, clientId: row.client_id, redirectUri: row.redirect_uri, enabled: Boolean(row.enabled), hasSecret: Boolean(row.secret_encrypted) } : null, nativeSaml: false, samlGateway: "Configure a SAML-to-OIDC identity broker as the OIDC issuer", configuredAllowedHosts: allowedHosts.size > 0 });
});
router.put("/:organizationId/config", requireSession, asyncHandler(async (req: AuthedRequest, res) => {
  if (organizationRole(req.params.organizationId, req.user!.id) !== "owner") { res.status(403).json({ error: "Organization owner access required" }); return; }
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid SSO configuration" }); return; }
  let redirect: string;
  try { redirect = callbackUri(req.params.organizationId); if (parsed.data.enabled) await discovery(parsed.data.issuer); else trustedUrl(parsed.data.issuer); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid SSO provider" }); return; }
  const old = db.prepare("SELECT issuer,client_id,secret_encrypted FROM organization_sso WHERE organization_id=?").get(req.params.organizationId) as SsoRow | undefined;
  // Do not carry a credential or old identity bindings across a provider change.
  const changedProvider = old && (old.issuer !== parsed.data.issuer || old.client_id !== parsed.data.clientId);
  const secret = parsed.data.clientSecret === undefined ? (changedProvider ? null : old?.secret_encrypted ?? null) : parsed.data.clientSecret ? seal(parsed.data.clientSecret, req.params.organizationId) : null;
  const saved = withTransaction(() => {
    if (organizationRole(req.params.organizationId, req.user!.id) !== "owner" || resolveSession(req)?.status !== "active") return false;
    db.prepare(`INSERT INTO organization_sso (organization_id,issuer,client_id,secret_encrypted,redirect_uri,enabled,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(organization_id) DO UPDATE SET issuer=excluded.issuer,client_id=excluded.client_id,secret_encrypted=excluded.secret_encrypted,redirect_uri=excluded.redirect_uri,enabled=excluded.enabled,configuration_revision=organization_sso.configuration_revision+1,updated_at=excluded.updated_at`)
      .run(req.params.organizationId, parsed.data.issuer, parsed.data.clientId, secret, redirect, Number(parsed.data.enabled), now());
    db.prepare("DELETE FROM organization_sso_flows WHERE organization_id=?").run(req.params.organizationId);
    if (changedProvider) db.prepare("DELETE FROM organization_sso_identities WHERE organization_id=?").run(req.params.organizationId);
    organizationAudit(req.params.organizationId, req.user!.id, "sso.configured", { issuer: parsed.data.issuer, enabled: parsed.data.enabled });
    return true;
  });
  if (!saved) { res.status(403).json({ error: "Organization owner access changed" }); return; }
  res.json({ ok: true, redirectUri: redirect });
}));
router.delete("/:organizationId/identity", requireSession, asyncHandler((req: AuthedRequest, res) => {
  if (!organizationRole(req.params.organizationId, req.user!.id)) { res.status(404).json({ error: "Organization not found" }); return; }
  db.prepare("DELETE FROM organization_sso_identities WHERE organization_id=? AND user_id=?").run(req.params.organizationId, req.user!.id);
  organizationAudit(req.params.organizationId, req.user!.id, "sso.identity_unlinked", {});
  res.json({ ok: true });
}));
router.get("/:organizationId/start", strictLimiter, asyncHandler(async (req, res) => {
  const organizationId = req.params.organizationId;
  const config = db.prepare("SELECT * FROM organization_sso WHERE organization_id=? AND enabled=1").get(organizationId) as SsoRow | undefined;
  if (!config) { res.status(404).json({ error: "Organization SSO is unavailable" }); return; }
  const session = resolveSession(req);
  const linkingUser = req.query.link === "1" ? session?.status === "active" ? session.user_id : null : null;
  if (req.query.link === "1" && (!linkingUser || !organizationRole(organizationId, linkingUser))) { res.status(403).json({ error: "Sign in locally as an organization member before linking SSO" }); return; }
  const metadata = await discovery(config.issuer);
  const state = randomToken(32), nonce = randomToken(32), browser = randomToken(32), verifier = randomToken(48);
  db.prepare("DELETE FROM organization_sso_flows WHERE expires_at<=?").run(now());
  const count = db.prepare("SELECT COUNT(*) AS count FROM organization_sso_flows WHERE organization_id=?").get(organizationId) as { count: number };
  if (count.count >= 100) { res.status(429).json({ error: "Too many pending organization sign-ins" }); return; }
  db.prepare("INSERT INTO organization_sso_flows (state_hash,organization_id,browser_hash,verifier_encrypted,nonce_hash,linking_user_id,expires_at) VALUES (?,?,?,?,?,?,?)")
    .run(sha256Hex(state), organizationId, sha256Hex(browser), seal(verifier, organizationId), sha256Hex(nonce), linkingUser, now() + 300);
  res.cookie("sso_flow", browser, { httpOnly: true, secure: IS_PROD, sameSite: "lax", path: "/api/sso", maxAge: 300000 });
  const authorization = trustedUrl(metadata.authorization_endpoint);
  authorization.searchParams.set("client_id", config.client_id); authorization.searchParams.set("redirect_uri", config.redirect_uri);
  authorization.searchParams.set("response_type", "code"); authorization.searchParams.set("scope", "openid"); authorization.searchParams.set("state", state); authorization.searchParams.set("nonce", nonce);
  authorization.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url")); authorization.searchParams.set("code_challenge_method", "S256");
  res.set("Cache-Control", "no-store"); res.redirect(authorization.toString());
}));
async function verifyIdToken(token: string, metadata: Discovery, config: SsoRow, nonceHash: string): Promise<{ sub: string }> {
  if (token.length > 128000) throw new Error("ID token too large");
  const parts = token.split("."); if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Invalid ID token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; kid?: string; crit?: unknown };
  if (!["RS256", "PS256", "ES256"].includes(header.alg || "") || typeof header.kid !== "string" || header.crit !== undefined) throw new Error("Unsupported token signature");
  const jwks = await boundedJson(trustedUrl(metadata.jwks_uri));
  if (!Array.isArray(jwks.keys) || jwks.keys.length > 100) throw new Error("Invalid signing-key set");
  const matching = (jwks.keys as (JsonWebKey & { kid?: string; alg?: string; use?: string; key_ops?: string[] })[]).filter((item) => item.kid === header.kid && (!item.use || item.use === "sig") && (!item.alg || item.alg === header.alg) && (!item.key_ops || item.key_ops.includes("verify")));
  if (matching.length !== 1) throw new Error("Token signing key is ambiguous or absent");
  const jwk = matching[0];
  if (header.alg === "ES256" ? jwk.kty !== "EC" || jwk.crv !== "P-256" : jwk.kty !== "RSA") throw new Error("Token signing key type mismatch");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  if (jwk.kty === "RSA" && (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Token signing key is too small");
  const verified = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, ...(header.alg === "PS256" ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : {}), ...(header.alg === "ES256" ? { dsaEncoding: "ieee-p1363" as const } : {}) }, Buffer.from(parts[2], "base64url"));
  if (!verified) throw new Error("ID token signature verification failed");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { iss?: string; sub?: string; aud?: string | string[]; azp?: string; exp?: number; iat?: number; nbf?: number; nonce?: string };
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (claims.iss !== config.issuer || !Array.isArray(audiences) || !audiences.every((audience) => typeof audience === "string" && audience.length > 0) || !audiences.includes(config.client_id) || (audiences.length > 1 && claims.azp !== config.client_id) || (claims.azp !== undefined && claims.azp !== config.client_id)) throw new Error("ID token issuer or audience mismatch");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now() - 30 || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now() + 30 || claims.iat < now() - 600 || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now() + 30))) throw new Error("ID token time validation failed");
  if (typeof claims.nonce !== "string" || !timingSafeEqual(Buffer.from(sha256Hex(claims.nonce), "hex"), Buffer.from(nonceHash, "hex"))) throw new Error("ID token nonce mismatch");
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255) throw new Error("Invalid provider subject");
  return { sub: claims.sub };
}
router.get("/:organizationId/callback", strictLimiter, asyncHandler(async (req, res) => {
  const organizationId = req.params.organizationId;
  const parsed = z.object({ state: z.string().min(16).max(200), code: z.string().min(1).max(2000) }).safeParse(req.query);
  const browser = (req.cookies as Record<string, string> | undefined)?.sso_flow;
  res.clearCookie("sso_flow", { path: "/api/sso" });
  if (!parsed.success || !browser) { res.status(400).json({ error: "Invalid or expired SSO flow" }); return; }
  const flow = withTransaction(() => {
    const row = db.prepare("SELECT * FROM organization_sso_flows WHERE state_hash=? AND organization_id=? AND expires_at>?")
      .get(sha256Hex(parsed.data.state), organizationId, now()) as { browser_hash: string; verifier_encrypted: string; nonce_hash: string; linking_user_id: string | null } | undefined;
    if (!row || !timingSafeEqual(Buffer.from(row.browser_hash, "hex"), Buffer.from(sha256Hex(browser), "hex"))) return undefined;
    db.prepare("DELETE FROM organization_sso_flows WHERE state_hash=?").run(sha256Hex(parsed.data.state));
    return row;
  });
  const config = db.prepare("SELECT * FROM organization_sso WHERE organization_id=? AND enabled=1").get(organizationId) as SsoRow | undefined;
  if (!flow || !config) { res.status(400).json({ error: "Invalid or expired SSO flow" }); return; }
  try {
    const metadata = await discovery(config.issuer);
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: config.client_id, redirect_uri: config.redirect_uri, code: parsed.data.code, code_verifier: open(flow.verifier_encrypted, organizationId) });
    const tokenHeaders: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (config.secret_encrypted) {
      const secret = open(config.secret_encrypted, organizationId);
      if (metadata.authMethods.includes("client_secret_basic")) {
        const encoded = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
        tokenHeaders.Authorization = `Basic ${Buffer.from(`${encoded(config.client_id)}:${encoded(secret)}`).toString("base64")}`;
        form.delete("client_id");
      } else if (metadata.authMethods.includes("client_secret_post")) form.set("client_secret", secret);
      else throw new Error("Provider does not support configured client-secret authentication");
    } else if (!metadata.authMethods.includes("none")) throw new Error("This provider requires a configured client secret");
    const tokens = await boundedJson(trustedUrl(metadata.token_endpoint), { method: "POST", headers: tokenHeaders, body: form.toString() });
    if (typeof tokens.id_token !== "string") throw new Error("Provider did not return an ID token");
    const identity = await verifyIdToken(tokens.id_token, metadata, config, flow.nonce_hash);
    const currentConfiguration = () => {
      const current = db.prepare("SELECT * FROM organization_sso WHERE organization_id=? AND enabled=1").get(organizationId) as SsoRow | undefined;
      if (!current || current.configuration_revision !== config.configuration_revision || current.issuer !== config.issuer || current.client_id !== config.client_id || current.redirect_uri !== config.redirect_uri || current.secret_encrypted !== config.secret_encrypted) throw new Error("Provider configuration changed during sign-in");
    };
    currentConfiguration();
    if (flow.linking_user_id) {
      const session = resolveSession(req);
      const account = db.prepare("SELECT email_verified FROM users WHERE id=?").get(flow.linking_user_id) as { email_verified: number } | undefined;
      if (session?.status !== "active" || session.user_id !== flow.linking_user_id || !account?.email_verified || !organizationRole(organizationId, flow.linking_user_id)) throw new Error("The original local linking session is no longer authorized");
      // Linking requires proof of both the existing local session and provider
      // identity. An organization owner can never map their identity to another
      // member's global account or auto-link a matching email address.
      withTransaction(() => {
        currentConfiguration();
        const linkingSession = resolveSession(req);
        if (linkingSession?.status !== "active" || linkingSession.user_id !== flow.linking_user_id || !organizationRole(organizationId, flow.linking_user_id!)) throw new Error("Local linking authorization changed");
        db.prepare("DELETE FROM organization_sso_identities WHERE organization_id=? AND user_id=?").run(organizationId, flow.linking_user_id);
        db.prepare("INSERT INTO organization_sso_identities (organization_id,issuer,subject,user_id) VALUES (?,?,?,?)").run(organizationId, config.issuer, identity.sub, flow.linking_user_id);
        organizationAudit(organizationId, flow.linking_user_id, "sso.identity_linked", { issuer: config.issuer });
      });
      res.set("Cache-Control", "no-store"); res.redirect("/organizations"); return;
    }
    const user = withTransaction(() => {
      currentConfiguration();
      const eligible = db.prepare(`SELECT u.id,u.totp_enabled,u.email_verified,u.locked_until FROM organization_sso_identities i JOIN users u ON u.id=i.user_id
      JOIN organization_members m ON m.user_id=u.id AND m.organization_id=i.organization_id WHERE i.organization_id=? AND i.issuer=? AND i.subject=?`)
      .get(organizationId, config.issuer, identity.sub) as { id: string; totp_enabled: number; email_verified: number; locked_until: number | null } | undefined;
      if (!eligible || !eligible.email_verified || (eligible.locked_until !== null && eligible.locked_until > now())) throw new Error("SSO identity is not bound to an eligible organization member");
      createSession(res, eligible.id, { isPending: Boolean(eligible.totp_enabled) });
      organizationAudit(organizationId, eligible.id, "sso.authenticated", { issuer: config.issuer, pendingTwoFactor: Boolean(eligible.totp_enabled) });
      return eligible;
    });
    res.set("Cache-Control", "no-store"); res.redirect(user.totp_enabled ? "/verify-2fa" : "/auth/complete");
  } catch {
    organizationAudit(organizationId, null, "sso.rejected", {});
    res.status(401).json({ error: "SSO sign-in could not be verified. Ask the organization owner to check the provider configuration and subject binding." });
  }
}));
export default router;
