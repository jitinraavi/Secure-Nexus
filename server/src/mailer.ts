import nodemailer from "nodemailer";
import { IS_PROD, MAIL } from "./config.js";

type SmtpTransport = ReturnType<typeof nodemailer.createTransport>;

export interface MailResult {
  delivered: boolean;
  via: string;
  /** Present only when dev OTP leak is allowed, so local flows remain testable. */
  devCode?: string;
}

function pickTransport():
  | { type: "resend" }
  | { type: "smtp"; transport: SmtpTransport }
  | { type: "console" } {
  const provider = MAIL.provider || (MAIL.resendKey ? "resend" : MAIL.host ? "smtp" : "console");
  if (provider === "resend" && MAIL.resendKey) return { type: "resend" };
  if (provider === "smtp" && MAIL.host) {
    return {
      type: "smtp",
      transport: nodemailer.createTransport({
        host: MAIL.host,
        port: MAIL.port,
        secure: MAIL.secure,
        auth: MAIL.user ? { user: MAIL.user, pass: MAIL.pass } : undefined,
      }),
    };
  }
  return { type: "console" };
}

async function sendResend(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MAIL.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: MAIL.from, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="color:#0f172a;margin:0 0 8px">SecureNexus</h2>
<p style="color:#334155;font-size:15px;line-height:1.6">${text.replace(/\n/g, "<br/>")}</p>
</div>`;

  const t = pickTransport();
  switch (t.type) {
    case "resend":
      await sendResend(to, subject, html);
      return { delivered: true, via: "resend" };
    case "smtp":
      await t.transport.sendMail({ from: MAIL.from, to, subject, html });
      return { delivered: true, via: "smtp" };
    case "console":
    default:
      /* No provider configured: print to server log so the flow is usable while
         developing. Never surfaces in production unless SECURE_NEXUS_DEV_OTP=1. */
      console.log(`[secure-nexus] Email (${to}): ${subject}\n${text}`);
      return { delivered: false, via: "console", devCode: !IS_PROD && MAIL.devOtp ? text.match(/\d{6}/)?.[0] : undefined };
  }
}

export function sendOtpEmail(to: string, code: string): Promise<MailResult> {
  return sendMail(
    to,
    "Your SecureNexus verification code",
    `Hi there,\n\nYour SecureNexus email verification code is ${code}.\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`,
  );
}