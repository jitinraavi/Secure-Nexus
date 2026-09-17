import { Router } from "express";
import { randomInt } from "node:crypto";
import qrcode from "qrcode";
import { logAudit } from "../audit.js";
import {
  LOCK_SECONDS,
  MAX_FAILED_ATTEMPTS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from "../config.js";
import { hashPassword, randomId, randomToken, sha256Hex, verifyPassword } from "../crypto.js";
import { db, now } from "../db.js";
import { sendOtpEmail } from "../mailer.js";
import {
  asyncHandler,
  AuthedRequest,
  bootstrap,
  clearSessionCookie,
  createSession,
  resolveSession,
  setCsrfCookie,
} from "../security.js";
import { generateTotpSecret, totpIssuerUri, verifyTotp } from "../totp.js";
import {
  changePasswordSchema,
  loginSchema,
  otpLoginRequestSchema,
  otpLoginVerifySchema,
  profileSchema,
  resendOtpSchema,
  signupSchema,
  verifyEmailSchema,
  verifyTwoFactorSchema,
} from "../validate.js";

const router = Router();

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function issueOtp(userId: string, code: string, email: string): void {
  db.prepare(
    "UPDATE users SET otp_code_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = ? WHERE id = ?",
  ).run(sha256Hex(`${userId}:${code}`), now() + OTP_TTL_SECONDS, now(), userId);
}

function publicUser(user: {
  id: string;
  email: string;
  username?: string | null;
  email_verified?: number;
  totp_enabled: number;
  created_at: number;
  last_login_at: number | null;
  password_changed_at: number;
  totp_secret?: string | null;
  country?: string | null;
  phone?: string | null;
  account_type?: string | null;
  gstin?: string | null;
}) {
  const planRow = db
    .prepare("SELECT plan, plan_expires_at FROM users WHERE id = ?")
    .get(user.id) as { plan: string; plan_expires_at: number | null } | undefined;
  return {
    id: user.id,
    email: user.email,
    username: user.username ?? null,
    emailVerified: Boolean(user.email_verified ?? 1),
    totpEnabled: Boolean(user.totp_enabled),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    passwordChangedAt: user.password_changed_at,
    plan: planRow?.plan ?? "free",
    plan_expires_at: planRow?.plan_expires_at ?? null,
    country: user.country || "IN",
    phone: user.phone ?? null,
    accountType: user.account_type || "individual",
    gstin: user.gstin ?? null,
  };
}

/* GET /api/auth/bootstrap — sets CSRF cookie, returns the token */
router.get("/bootstrap", (_req, res) => {
  res.json(bootstrap(_req, res));
});

/* POST /api/auth/signup — creates the account and emails a verification code.
   The session is only created after POST /api/auth/verify-email succeeds. */
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email, username, password, country, phone, accountType, gstin } = parsed.data;

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
      | { id: string }
      | undefined;
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    if (username) {
      const taken = db
        .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
        .get(username) as { id: string } | undefined;
      if (taken) {
        res.status(409).json({ error: "That username is already taken" });
        return;
      }
    }

    const { salt, hash } = hashPassword(password);
    const id = randomId();
    const t = now();
    db.prepare(
      `INSERT INTO users (id, email, username, email_verified, password_salt, password_hash, country, phone, account_type, gstin, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      email,
      username || null,
      salt,
      hash,
      country || "IN",
      phone || null,
      accountType || "individual",
      gstin || null,
      t,
      t,
      t,
    );

    const code = generateOtp();
    issueOtp(id, code, email);
    const mail = await sendOtpEmail(email, code);
    logAudit(id, "auth.signup", "Account created, awaiting email verification", req);

    res.status(201).json({
      needsEmailVerification: true,
      message: "Account created. A 6-digit verification code was sent to your email.",
      devOtp: mail.via === "console" ? mail.devCode : undefined,
      ...(mail.via !== "console" ? {} : { devOtpNote: "No mail provider configured — code printed to server log." }),
    });
  }),
);

/* POST /api/auth/verify-email — checks the emailed code, verifies the account, opens a session */
router.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email, code } = parsed.data;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as
      | {
          id: string;
          email: string;
          email_verified: number;
          otp_code_hash: string | null;
          otp_expires_at: number | null;
          otp_attempts: number;
          totp_enabled: number;
          created_at: number;
          last_login_at: number | null;
          password_changed_at: number;
        }
      | undefined;

    if (!user) {
      res.status(401).json({ error: "No account found for that email" });
      return;
    }

    /* Already verified (e.g. double click): just sign in */
    if (user.email_verified) {
      const { csrfToken } = createSession(res, user.id);
      res.json({ user: publicUser(user), csrfToken, alreadyVerified: true });
      return;
    }

    if (!user.otp_code_hash || !user.otp_expires_at) {
      res.status(400).json({ error: "No verification code is active. Request a new one." });
      return;
    }
    if (user.otp_expires_at < now()) {
      res.status(400).json({ error: "That code has expired. Request a new one." });
      return;
    }
    if (user.otp_attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Request a new code." });
      return;
    }

    const expected = Buffer.from(user.otp_code_hash, "hex");
    const actual = Buffer.from(sha256Hex(`${user.id}:${code}`), "hex");
    const valid = expected.length > 0 && actual.length === expected.length && actual.equals(expected);
    if (!valid) {
      db.prepare("UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?").run(user.id);
      logAudit(user.id, "auth.otp_failed", "Invalid email verification code", req);
      res.status(401).json({ error: "That code is not correct. Try again." });
      return;
    }

    db.prepare(
      "UPDATE users SET email_verified = 1, otp_code_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, created_at = ?, updated_at = ? WHERE id = ?",
    ).run(now(), now(), user.id);
    logAudit(user.id, "auth.email_verified", "Email address verified via OTP", req);

    const { csrfToken } = createSession(res, user.id);
    const fresh = { ...user, email_verified: 1, otp_code_hash: null, otp_expires_at: null, otp_attempts: 0 };
    res.json({ user: publicUser(fresh), csrfToken });
    return;
  }),
);

/* POST /api/auth/resend-otp — re-issues a verification code (cooldown-limited)
   and, once verified, opens a session for convenience on re-login flows. */
router.post(
  "/resend-otp",
  asyncHandler(async (req, res) => {
    const parsed = resendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email } = parsed.data;
    const user = db
      .prepare("SELECT id, email, email_verified, otp_expires_at FROM users WHERE email = ?")
      .get(email) as
      | { id: string; email: string; email_verified: number; otp_expires_at: number | null }
      | undefined;
    if (!user) {
      res.status(404).json({ error: "No account found for that email" });
      return;
    }
    if (user.email_verified) {
      res.status(400).json({ error: "This email is already verified" });
      return;
    }
    if (user.otp_expires_at && now() - (user.otp_expires_at - OTP_TTL_SECONDS) < OTP_RESEND_COOLDOWN_SECONDS) {
      res.status(429).json({ error: "A code was just sent. Please wait 30 seconds before requesting another." });
      return;
    }
    const code = generateOtp();
    issueOtp(user.id, code, user.email);
    const mail = await sendOtpEmail(user.email, code);
    logAudit(user.id, "auth.otp_resent", "Verification code re-sent", req);
    res.json({
      ok: true,
      message: "A new 6-digit code was sent to your email.",
      devOtp: mail.via === "console" ? mail.devCode : undefined,
    });
  }),
);

/* POST /api/auth/otp/request — emails a passwordless login code to the account */
router.post(
  "/otp/request",
  asyncHandler(async (req, res) => {
    const parsed = otpLoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email } = parsed.data;
    const user = db
      .prepare("SELECT id, email, otp_expires_at FROM users WHERE email = ?")
      .get(email) as { id: string; email: string; otp_expires_at: number | null } | undefined;

    const blanket = {
      ok: true,
      message: "If that email has an account, a 6-digit login code is on its way.",
    };
    if (!user) {
      /* Respond identically whether or not the account exists (no probing) */
      res.json(blanket);
      return;
    }
    if (user.otp_expires_at && now() - (user.otp_expires_at - OTP_TTL_SECONDS) < OTP_RESEND_COOLDOWN_SECONDS) {
      res.status(429).json({ error: "A code was just sent. Please wait 30 seconds before requesting another." });
      return;
    }
    const code = generateOtp();
    issueOtp(user.id, code, user.email);
    const mail = await sendOtpEmail(user.email, code);
    logAudit(user.id, "auth.otp_login_requested", "Passwordless login code emailed", req);
    res.json({ ...blanket, devOtp: mail.via === "console" ? mail.devCode : undefined });
  }),
);

/* POST /api/auth/otp/verify — exchanges a login code for a session */
router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const parsed = otpLoginVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email, code } = parsed.data;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as
      | {
          id: string;
          email: string;
          email_verified: number;
          otp_code_hash: string | null;
          otp_expires_at: number | null;
          otp_attempts: number;
          totp_enabled: number;
          created_at: number;
          last_login_at: number | null;
          password_changed_at: number;
        }
      | undefined;

    if (!user) {
      res.status(401).json({ error: "No account found for that email" });
      return;
    }
    if (!user.otp_code_hash || !user.otp_expires_at) {
      res.status(400).json({ error: "No login code is active. Request a new one." });
      return;
    }
    if (user.otp_expires_at < now()) {
      res.status(400).json({ error: "That code has expired. Request a new one." });
      return;
    }
    if (user.otp_attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Request a new code." });
      return;
    }

    const expected = Buffer.from(user.otp_code_hash, "hex");
    const actual = Buffer.from(sha256Hex(`${user.id}:${code}`), "hex");
    const valid = expected.length > 0 && actual.length === expected.length && actual.equals(expected);
    if (!valid) {
      db.prepare("UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?").run(user.id);
      logAudit(user.id, "auth.otp_login_failed", "Invalid passwordless login code", req);
      res.status(401).json({ error: "That code is not correct. Try again." });
      return;
    }

    db.prepare(
      "UPDATE users SET failed_attempts = 0, locked_until = NULL, email_verified = 1, otp_code_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, last_login_at = ?, updated_at = ? WHERE id = ?",
    ).run(now(), now(), user.id);
    logAudit(user.id, "auth.login", "Passwordless OTP login succeeded", req);

    if (user.totp_enabled) {
      createSession(res, user.id, { isPending: true });
      res.json({ needsTwoFactor: true });
      return;
    }

    const { csrfToken } = createSession(res, user.id);
    res.json({
      user: publicUser({ ...user, email_verified: 1 } as never),
      csrfToken,
    });
  }),
);

/* POST /api/auth/login */
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { email, password } = parsed.data;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as
      | {
          id: string;
          email: string;
          username?: string | null;
          email_verified?: number;
          password_salt: string;
          password_hash: string;
          totp_secret: string | null;
          totp_enabled: number;
          failed_attempts: number;
          locked_until: number | null;
          last_login_at: number | null;
          password_changed_at: number;
          created_at: number;
        }
      | undefined;

    if (user && user.email_verified === 0) {
      res.status(403).json({
        error: "Verify your email address before signing in.",
        needsEmailVerification: true,
      });
      return;
    }

    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      let detail = `Failed login for ${email}`;
      if (user) {
        const failed = user.failed_attempts + 1;
        let lockedUntil: number | null = null;
        if (failed >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = now() + LOCK_SECONDS;
          detail = `Failed login for ${email} — account locked for ${LOCK_SECONDS / 60} min (${failed} attempts)`;
        }
        db.prepare(
          "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
        ).run(failed, lockedUntil, now(), user.id);
        logAudit(user.id, "auth.login_failed", detail, req);
      }
      res.status(401).json({
        error: user && user.locked_until && user.locked_until > now()
          ? "Account temporarily locked. Try again later."
          : "Invalid email or password",
      });
      return;
    }

    if (user.locked_until && user.locked_until > now()) {
      const mins = Math.ceil((user.locked_until - now()) / 60);
      res.status(423).json({ error: `Account temporarily locked. Try again in ${mins} minute(s).` });
      return;
    }

    /* Success: reset lockout counters */
    db.prepare(
      "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?",
    ).run(now(), now(), user.id);
    logAudit(user.id, "auth.login", "Login succeeded", req);

    if (user.totp_enabled) {
      createSession(res, user.id, { isPending: true });
      res.json({ needsTwoFactor: true });
      return;
    }

    const { csrfToken } = createSession(res, user.id);
    res.json({
      user: publicUser(user),
      csrfToken,
      needsTwoFactor: false,
    });
  }),
);

/* POST /api/auth/verify-2fa — upgrades a pending_2fa session */
router.post(
  "/verify-2fa",
  asyncHandler(async (req, res) => {
    const parsed = verifyTwoFactorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const session = resolveSession(req);
    if (!session || session.status !== "pending_2fa") {
      res.status(401).json({ error: "Two-factor verification required first" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
      | {
          id: string;
          email: string;
          totp_secret: string | null;
          totp_enabled: number;
          password_changed_at: number;
          created_at: number;
          last_login_at: number | null;
        }
      | undefined;

    if (!user?.totp_enabled || !user.totp_secret) {
      res.status(400).json({ error: "Two-factor authentication is not enabled" });
      return;
    }

    if (!verifyTotp(user.totp_secret, parsed.data.code)) {
      logAudit(user.id, "auth.2fa_failed", "Invalid TOTP code", req);
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    db.prepare(
      "UPDATE sessions SET status = 'active', expires_at = ?, updated_at = ? WHERE id = ?",
    ).run(now() + 60 * 60 * 24 * 7, now(), session.id);
    logAudit(user.id, "auth.2fa_verified", "Two-factor authentication passed", req);

    const csrf = randomToken(24);
    db.prepare("UPDATE sessions SET csrf_token = ? WHERE id = ?").run(csrf, session.id);
    setCsrfCookie(res, csrf);

    res.json({
      user: publicUser(user),
      csrfToken: csrf,
    });
  }),
);

/* POST /api/auth/logout */
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    if (session) {
      db.prepare("UPDATE sessions SET status = 'revoked', revoked_at = ? WHERE id = ?").run(
        now(),
        session.id,
      );
      logAudit(session.user_id, "auth.logout", "Session revoked", req);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

/* GET /api/auth/me */
router.get("/me", (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (session.status === "pending_2fa") {
    res.status(401).json({ error: "Two-factor verification required", needsTwoFactor: true });
    return;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
    | {
        id: string;
        email: string;
        username?: string | null;
        email_verified?: number;
        totp_enabled: number;
        created_at: number;
        last_login_at: number | null;
        password_changed_at: number;
      }
    | undefined;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: publicUser(user), csrfToken: session.csrf_token });
});

/* PATCH /api/auth/profile — update country / phone / account type / GSTIN */
router.patch(
  "/profile",
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { country, phone, accountType, gstin, username } = parsed.data;
    const current = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
      | {
          id: string;
          email: string;
          username?: string | null;
          totp_enabled: number;
          created_at: number;
          last_login_at: number | null;
          password_changed_at: number;
          account_type: string;
        }
      | undefined;
    if (!current) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (username) {
      const taken = db
        .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?")
        .get(username, session.user_id) as { id: string } | undefined;
      if (taken) {
        res.status(409).json({ error: "That username is already taken" });
        return;
      }
    }
    const nextType = accountType || current.account_type || "individual";
    if (nextType === "business" && !(gstin && gstin.length === 15)) {
      res.status(400).json({ error: "GSTIN is required for business accounts" });
      return;
    }
    db.prepare(
      `UPDATE users
         SET username = ?, country = ?, phone = ?, account_type = ?, gstin = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      username ?? current.username ?? null,
      country || current_country(session.user_id),
      phone ?? null,
      nextType,
      nextType === "business" ? gstin || null : null,
      now(),
      session.user_id,
    );
    logAudit(session.user_id, "auth.profile_updated", "Profile details updated", req);
    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
      | {
          id: string;
          email: string;
          username?: string | null;
          email_verified?: number;
          totp_enabled: number;
          created_at: number;
          last_login_at: number | null;
          password_changed_at: number;
        }
      | undefined;
    res.json({ user: updated ? publicUser(updated) : undefined });
  }),
);

function current_country(userId: string): string {
  const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as
    | { country?: string | null }
    | undefined;
  return row?.country || "IN";
}

/* GET /api/auth/sessions */
router.get("/sessions", (req: AuthedRequest, res) => {
  const session = resolveSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const rows = db
    .prepare(
      "SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND status = 'active' ORDER BY last_seen_at DESC",
    )
    .all(session.user_id) as {
    id: string;
    user_agent: string | null;
    ip: string | null;
    created_at: number;
    last_seen_at: number;
    expires_at: number;
  }[];
  res.json({
    sessions: rows.map((r) => ({ ...r, current: r.id === session.id })),
  });
});

/* DELETE /api/auth/sessions/:id */
router.delete(
  "/sessions/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const target = db
      .prepare("SELECT id FROM sessions WHERE id = ? AND user_id = ?")
      .get(req.params.id, session.user_id);
    if (!target) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    db.prepare("UPDATE sessions SET status = 'revoked', revoked_at = ? WHERE id = ?").run(
      now(),
      req.params.id,
    );
    logAudit(session.user_id, "auth.session_revoked", `Session ${req.params.id.substring(0, 8)}…`, req);
    res.json({ ok: true });
  }),
);

/* POST /api/auth/revoke-others */
router.post(
  "/revoke-others",
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const result = db
      .prepare(
        "UPDATE sessions SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND id != ? AND status = 'active'",
      )
      .run(now(), session.user_id, session.id);
    logAudit(session.user_id, "auth.sessions_revoked_others", `Revoked ${result.changes} other session(s)`, req);
    res.json({ ok: true, revoked: Number(result.changes) });
  }),
);

/* POST /api/auth/password */
router.post(
  "/password",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as
      | { id: string; password_salt: string; password_hash: string }
      | undefined;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;
    if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
      logAudit(user.id, "auth.password_change_failed", "Incorrect current password", req);
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    const { salt, hash } = hashPassword(newPassword);
    db.prepare(
      "UPDATE users SET password_salt = ?, password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?",
    ).run(salt, hash, now(), now(), user.id);
    db.prepare(
      "UPDATE sessions SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND id != ? AND status = 'active'",
    ).run(now(), user.id, session.id);
    logAudit(user.id, "auth.password_changed", "Password changed, other sessions revoked", req);
    res.json({ ok: true });
  }),
);

/* GET /api/auth/2fa/setup — generates a fresh TOTP secret (require re-auth = current session) */
router.get(
  "/2fa/setup",
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = db.prepare("SELECT email, totp_enabled FROM users WHERE id = ?").get(session.user_id) as
      | { email: string; totp_enabled: number }
      | undefined;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (user.totp_enabled) {
      res.status(400).json({ error: "Two-factor authentication is already enabled" });
      return;
    }
    const secret = generateTotpSecret();
    db.prepare("UPDATE users SET totp_secret = ?, updated_at = ? WHERE id = ?").run(secret, now(), session.user_id);
    const uri = totpIssuerUri("Groundwork", user.email, secret);
    const qrDataUrl = await qrcode.toDataURL(uri, { margin: 1, width: 240 });
    logAudit(session.user_id, "auth.2fa_setup_started", "New TOTP secret issued", req);
    res.json({ secret, otpauthUrl: uri, qrDataUrl });
  }),
);

/* POST /api/auth/2fa/enable */
router.post(
  "/2fa/enable",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = verifyTwoFactorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = db
      .prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?")
      .get(session.user_id) as { totp_secret: string | null; totp_enabled: number } | undefined;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (user.totp_enabled) {
      res.status(400).json({ error: "Two-factor authentication is already enabled" });
      return;
    }
    if (!user.totp_secret || !verifyTotp(user.totp_secret, parsed.data.code)) {
      logAudit(session.user_id, "auth.2fa_enable_failed", "Invalid verification code", req);
      res.status(400).json({ error: "Invalid code. Check the code and try again." });
      return;
    }
    db.prepare("UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?").run(now(), session.user_id);
    logAudit(session.user_id, "auth.2fa_enabled", "Two-factor authentication enabled", req);
    res.json({ ok: true });
  }),
);

/* POST /api/auth/2fa/disable */
router.post(
  "/2fa/disable",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = verifyTwoFactorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const session = resolveSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = db
      .prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?")
      .get(session.user_id) as { totp_secret: string | null; totp_enabled: number } | undefined;
    if (!user?.totp_enabled || !user.totp_secret) {
      res.status(400).json({ error: "Two-factor authentication is not enabled" });
      return;
    }
    if (!verifyTotp(user.totp_secret, parsed.data.code)) {
      logAudit(session.user_id, "auth.2fa_disable_failed", "Invalid code for disable", req);
      res.status(400).json({ error: "Invalid code." });
      return;
    }
    db.prepare(
      "UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = ? WHERE id = ?",
    ).run(now(), session.user_id);
    logAudit(session.user_id, "auth.2fa_disabled", "Two-factor authentication disabled", req);
    res.json({ ok: true });
  }),
);

export default router;