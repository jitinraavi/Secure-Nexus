import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import {
  COOKIE_CSRF,
  COOKIE_SESSION,
  IS_PROD,
  PENDING_2FA_TTL_SECONDS,
  SESSION_TTL_SECONDS,
} from "./config.js";
import { db, now } from "./db.js";
import { randomToken, sha256Hex } from "./crypto.js";

export interface AuthedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
  session?: {
    id: string;
    user_id: string;
    csrf_token: string;
    status: string;
  };
  csrfToken?: string;
}

/* ----------------------------- Rate limiting ----------------------------- */

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes." },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

/* ------------------------------- Cookies --------------------------------- */

function baseCookie(name: string, value: string, maxAgeSeconds: number, httpOnly: boolean) {
  return {
    name,
    value,
    options: {
      httpOnly,
      secure: IS_PROD,
      sameSite: name === COOKIE_SESSION ? ("lax" as const) : ("strict" as const),
      path: "/",
      maxAge: maxAgeSeconds * 1000,
    },
  };
}

export function setSessionCookie(res: Response, rawToken: string, ttlSeconds: number) {
  const { name, value, options } = baseCookie(COOKIE_SESSION, rawToken, ttlSeconds, true);
  res.cookie(name, value, options);
}

export function setCsrfCookie(res: Response, token: string) {
  const { name, value, options } = baseCookie(COOKIE_CSRF, token, 60 * 60, false);
  res.cookie(name, value, options);
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_SESSION, { path: "/" });
  res.clearCookie(COOKIE_CSRF, { path: "/" });
}

/* -------------------------------- Session -------------------------------- */

export function createSession(
  res: Response,
  userId: string,
  opts: { pending2fa?: boolean; isPending?: boolean } = {},
) {
  const raw = randomToken(32);
  const dbCsrf = randomToken(24);
  const ttl = opts.isPending ? PENDING_2FA_TTL_SECONDS : SESSION_TTL_SECONDS;
  const sessionId = randomToken(16);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, status, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    userId,
    sha256Hex(raw),
    dbCsrf,
    opts.isPending ? "pending_2fa" : "active",
    null,
    null,
    now(),
    now(),
    now() + ttl,
  );
  setSessionCookie(res, raw, ttl);
  setCsrfCookie(res, dbCsrf);
  return { sessionId, csrfToken: dbCsrf, ttl };
}

/* ------------------------------- Middleware ------------------------------ */

export function bootstrap(req: Request, res: Response) {
  const csrf = randomToken(24);
  setCsrfCookie(res, csrf);
  return { csrfToken: csrf };
}

type SessionRow = {
  id: string;
  user_id: string;
  csrf_token: string;
  status: string;
  expires_at: number;
};

export function resolveSession(req: Request): SessionRow | null {
  const raw = (req.cookies as Record<string, string> | undefined)?.[COOKIE_SESSION];
  if (!raw) return null;
  const row = db
    .prepare("SELECT id, user_id, csrf_token, status, expires_at FROM sessions WHERE token_hash = ?")
    .get(sha256Hex(raw)) as SessionRow | undefined;
  if (!row) return null;
  if (row.status === "revoked") return null;
  if (row.expires_at <= now()) return null;
  return row;
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = resolveSession(req);
  if (!session || session.status !== "active") {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = db
    .prepare("SELECT id, email FROM users WHERE id = ?")
    .get(session.user_id) as { id: string; email: string } | undefined;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const authed = req as AuthedRequest;
  authed.user = user;
  authed.session = session;
  authed.csrfToken = session.csrf_token;
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now(), session.id);
  next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  // Anonymous auth endpoints create a session from nothing - no token can
  // exist yet. Protected by SameSite=Lax on the session cookie instead.
  if (req.path === "/auth/signup" || req.path === "/auth/login") {
    next();
    return;
  }
  // Payment provider webhooks carry their own cryptographically-verified
  // signature (HMAC) and never have a browser session or CSRF cookie.
  if (req.path === "/payments/webhook") {
    next();
    return;
  }
  const headerToken = req.get("x-csrf-token");
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[COOKIE_CSRF];
  const session = resolveSession(req);
  const sessionToken = session?.csrf_token ?? null;

  const matches =
    headerToken &&
    cookieToken &&
    (headerToken === cookieToken || (sessionToken !== null && headerToken === sessionToken));

  if (!matches) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }
  next();
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void> | void,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}