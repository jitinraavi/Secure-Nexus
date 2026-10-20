import nodemailer from "nodemailer";
import { MAIL } from "./config.js";

type SmtpTransport = ReturnType<typeof nodemailer.createTransport>;
export type MailErrorCode = "auth" | "config" | "connect" | "timeout" | "recipient" | "sender" | "service";

export interface MailResult {
  /** The provider accepted this recipient; this does not prove inbox placement. */
  delivered: boolean;
  via: "smtp" | "resend" | "console" | "error";
  /** Present only for explicitly enabled, loopback-only development delivery. */
  devCode?: string;
  error?: string;
  errorCode?: MailErrorCode;
}

const failureMessage = "Email delivery is unavailable. Please try again later or contact support.";
let smtpTransport: SmtpTransport | undefined;

function pickTransport():
  | { type: "resend" }
  | { type: "smtp"; transport: SmtpTransport }
  | { type: "console" }
  | { type: "unavailable" } {
  if (MAIL.configError) return { type: "unavailable" };
  if (MAIL.provider === "resend") return MAIL.resendKey ? { type: "resend" } : { type: "unavailable" };
  if (MAIL.provider === "smtp") {
    if (!MAIL.host || !MAIL.user || !MAIL.pass) return { type: "unavailable" };
    smtpTransport ??= nodemailer.createTransport({
      host: MAIL.host, port: MAIL.port, secure: MAIL.secure, requireTLS: MAIL.requireTLS,
      auth: { user: MAIL.user, pass: MAIL.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    return { type: "smtp", transport: smtpTransport };
  }
  return MAIL.provider === "console" && MAIL.devOtp ? { type: "console" } : { type: "unavailable" };
}

function errorCode(error: unknown): MailErrorCode {
  const info = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (info.mailErrorCode && ["auth", "config", "connect", "timeout", "recipient", "sender", "service"].includes(String(info.mailErrorCode))) {
    return info.mailErrorCode as MailErrorCode;
  }
  if (info.code === "EAUTH") return "auth";
  if (["ETIMEDOUT", "ETIMEOUT"].includes(String(info.code)) || ["AbortError", "TimeoutError"].includes(String(info.name))) return "timeout";
  if (["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "EDNS", "ENOTFOUND", "EHOSTUNREACH", "ESOCKET", "ETLS"].includes(String(info.code))) return "connect";
  if (info.code === "EENVELOPE") return info.command === "MAIL FROM" ? "sender" : "recipient";
  return "service";
}

function failure(error: unknown, provider: "smtp" | "resend"): MailResult {
  const code = errorCode(error);
  // Only an allowlisted category is logged: no recipient, provider response, OTP or credentials.
  console.error(`[groundwork] ${provider} mail failure (${code})`);
  return { delivered: false, via: "error", error: failureMessage, errorCode: code };
}

function ensureAccepted(info: unknown, recipient: string): void {
  const receipt = info && typeof info === "object" ? info as Record<string, unknown> : {};
  const address = recipient.trim().toLowerCase();
  const containsRecipient = (values: unknown) => Array.isArray(values) && values.some((value) => {
    const entry = typeof value === "string" ? value : value && typeof value === "object" ? (value as { address?: unknown }).address : "";
    return typeof entry === "string" && entry.trim().toLowerCase() === address;
  });
  if (!containsRecipient(receipt.accepted) || containsRecipient(receipt.rejected) || containsRecipient(receipt.pending)) {
    throw { mailErrorCode: "recipient" };
  }
}

function escapedHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!).replace(/\r?\n/g, "<br/>");
}

async function sendResend(to: string, subject: string, text: string, html: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${MAIL.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL.from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw { mailErrorCode: response.status === 401 ? "auth" : response.status === 403 ? "sender" : "service" };
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || typeof (result as { id?: unknown }).id !== "string" || !(result as { id: string }).id) {
    throw { mailErrorCode: "service" };
  }
}

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to) || /[\r\n]/.test(subject)) {
    return { delivered: false, via: "error", error: failureMessage, errorCode: "recipient" };
  }
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#0f172a;margin:0 0 8px">Groundwork</h2><p style="color:#334155;font-size:15px;line-height:1.6">${escapedHtml(text)}</p></div>`;
  const transport = pickTransport();
  if (transport.type === "console") return { delivered: false, via: "console", devCode: text.match(/\b\d{6}\b/)?.[0] };
  if (transport.type === "unavailable") return {
    delivered: false, via: "error", error: "Email delivery is not configured. Contact the application administrator.", errorCode: "config",
  };
  try {
    if (transport.type === "smtp") {
      const receipt = await transport.transport.sendMail({ from: MAIL.from, to, subject, text, html });
      ensureAccepted(receipt, to);
    } else await sendResend(to, subject, text, html);
    return { delivered: true, via: transport.type };
  } catch (error) { return failure(error, transport.type); }
}

export function sendOtpEmail(to: string, code: string): Promise<MailResult> {
  return sendMail(to, "Your Groundwork verification code",
    `Hi there,\n\nYour Groundwork verification code is ${code}.\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`);
}

export interface MailDiagnosticResult {
  ok: boolean;
  delivered: boolean;
  provider: "resend" | "smtp" | "console" | "unavailable";
  details: string;
  errorCode?: MailErrorCode;
  config: { host?: string; port?: number; secure?: boolean; from: string; hasAuth: boolean };
  timestamp: number;
}

export async function testMailConnection(recipientEmail?: string): Promise<MailDiagnosticResult> {
  const transport = pickTransport();
  const base = {
    timestamp: Date.now(), delivered: false,
    provider: transport.type,
    config: {
      from: MAIL.from, hasAuth: MAIL.provider === "resend" ? Boolean(MAIL.resendKey) : Boolean(MAIL.user && MAIL.pass),
      ...(MAIL.provider === "smtp" ? { host: MAIL.host, port: MAIL.port, secure: MAIL.secure } : {}),
    },
  };
  if (transport.type === "unavailable") return {
    ...base, ok: false, details: MAIL.configError || "Email delivery is not configured.", errorCode: "config",
  };
  if (transport.type === "console") return { ...base, ok: true, details: "Local development code display is enabled. No email was sent." };
  if (transport.type === "smtp") {
    try { await transport.transport.verify(); }
    catch (error) {
      const result = failure(error, "smtp");
      return { ...base, ok: false, details: "SMTP connection or authentication failed. Check the server mail configuration.", errorCode: result.errorCode };
    }
  }
  if (!recipientEmail) return {
    ...base, ok: true,
    details: transport.type === "smtp"
      ? "SMTP connection and authentication verified. Sender acceptance and inbox delivery have not been tested."
      : "Resend API key is configured. Provider authentication and delivery have not been tested.",
  };
  const result = await sendMail(recipientEmail, "Groundwork email diagnostic", "This is an automated Groundwork email delivery test.");
  return {
    ...base, ok: result.delivered, delivered: result.delivered, errorCode: result.errorCode,
    details: result.delivered
      ? "The email provider accepted the diagnostic message. Check the inbox and spam folder; inbox placement is not confirmed."
      : "The email provider did not accept the diagnostic message. Check the server mail configuration.",
  };
}


