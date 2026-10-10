import nodemailer from "nodemailer";
import { IS_PROD, MAIL } from "./config.js";

type SmtpTransport = ReturnType<typeof nodemailer.createTransport>;

export interface MailResult {
  delivered: boolean;
  via: string;
  /** Present only when dev OTP leak is allowed, so local flows remain testable. */
  devCode?: string;
  /** Present when the provider failed to send (SMTP timeout, auth error, etc.). */
  error?: string;
}

function pickTransport():
  | { type: "resend" }
  | { type: "smtp"; transport: SmtpTransport }
  | { type: "console" }
  | { type: "unavailable" } {
  const hasSmtpCreds = Boolean(MAIL.host && MAIL.user && MAIL.pass);
  const provider = MAIL.provider || (MAIL.resendKey ? "resend" : hasSmtpCreds ? "smtp" : "console");
  if (provider === "resend" && MAIL.resendKey) return { type: "resend" };
  if (provider === "smtp") {
    if (hasSmtpCreds) {
      return {
        type: "smtp",
        transport: nodemailer.createTransport({
          host: MAIL.host,
          port: MAIL.port,
          secure: MAIL.secure,
          requireTLS: IS_PROD && !MAIL.secure,
          auth: { user: MAIL.user, pass: MAIL.pass },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        }),
      };
    }
  }
  if (!IS_PROD && MAIL.devOtp && (provider === "console" || !MAIL.provider)) return { type: "console" };
  return { type: "unavailable" };
}

async function sendResend(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MAIL.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: MAIL.from, to, subject, html }),
    signal: AbortSignal.timeout(20_000),
  });
  await res.body?.cancel();
  if (!res.ok) {
    throw new Error("Email provider rejected delivery");
  }
}

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="color:#0f172a;margin:0 0 8px">Groundwork</h2>
<p style="color:#334155;font-size:15px;line-height:1.6">${text.replace(/\n/g, "<br/>")}</p>
</div>`;

  const t = pickTransport();
  switch (t.type) {
    case "resend":
      try {
        await sendResend(to, subject, html);
        return { delivered: true, via: "resend" };
      } catch {
        console.error("[groundwork] Email provider delivery failed");
        return { delivered: false, via: "error", error: "Email delivery is unavailable. Please try again later." };
      }
    case "smtp":
      try {
        await t.transport.sendMail({ from: MAIL.from, to, subject, html });
        return { delivered: true, via: "smtp" };
      } catch {
        console.error("[groundwork] SMTP delivery failed");
        return { delivered: false, via: "error", error: "Email delivery is unavailable. Please try again later." };
      }
    case "console":
      return { delivered: false, via: "console", devCode: MAIL.devOtp ? text.match(/\d{6}/)?.[0] : undefined };
    case "unavailable":
    default:
      return { delivered: false, via: "error", error: "Email delivery is not configured. Contact the application administrator." };
  }
}

export function sendOtpEmail(to: string, code: string): Promise<MailResult> {
  return sendMail(
    to,
    "Your Groundwork verification code",
    `Hi there,\n\nYour Groundwork verification code is ${code}.\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`,
  );
}

export interface MailDiagnosticResult {
  ok: boolean;
  provider: "resend" | "smtp" | "console" | "unavailable";
  details: string;
  config: {
    host?: string;
    port?: number;
    secure?: boolean;
    from: string;
    hasAuth: boolean;
  };
  timestamp: number;
}

export async function testMailConnection(recipientEmail?: string): Promise<MailDiagnosticResult> {
  const t = pickTransport();
  const timestamp = Date.now();
  const baseConfig = {
    from: MAIL.from,
    hasAuth: Boolean(MAIL.user && MAIL.pass),
  };

  if (t.type === "smtp") {
    try {
      await t.transport.verify();
      if (recipientEmail) {
        await t.transport.sendMail({
          from: MAIL.from,
          to: recipientEmail,
          subject: "Groundwork SMTP Diagnostic Test",
          text: `This is an automated deliverability test from your Groundwork instance.\n\nTimestamp: ${new Date(timestamp).toISOString()}\nSMTP Host: ${MAIL.host}:${MAIL.port}\nStatus: Verified successfully.`,
        });
      }
      return {
        ok: true,
        provider: "smtp",
        details: recipientEmail
          ? `SMTP connection verified and test email sent to ${recipientEmail}`
          : `SMTP connection and authentication verified successfully with ${MAIL.host}:${MAIL.port}`,
        config: { ...baseConfig, host: MAIL.host, port: MAIL.port, secure: MAIL.secure },
        timestamp,
      };
    } catch {
      return {
        ok: false,
        provider: "smtp",
        details: "SMTP verification or test delivery failed. Check the server mail configuration.",
        config: { ...baseConfig, host: MAIL.host, port: MAIL.port, secure: MAIL.secure },
        timestamp,
      };
    }
  }

  if (t.type === "resend") {
    if (!MAIL.resendKey) {
      return {
        ok: false,
        provider: "resend",
        details: "Resend API key is not configured.",
        config: baseConfig,
        timestamp,
      };
    }
    try {
      if (recipientEmail) {
        await sendResend(
          recipientEmail,
          "Groundwork Resend Diagnostic Test",
          `<p>Automated deliverability test from Groundwork via Resend.<br/>Timestamp: ${new Date(timestamp).toISOString()}</p>`
        );
        return {
          ok: true,
          provider: "resend",
          details: `Resend test email dispatched successfully to ${recipientEmail}`,
          config: baseConfig,
          timestamp,
        };
      }
      return {
        ok: true,
        provider: "resend",
        details: "Resend API key configured and ready.",
        config: baseConfig,
        timestamp,
      };
    } catch {
      return {
        ok: false,
        provider: "resend",
        details: "Resend test delivery failed. Check the server mail configuration.",
        config: baseConfig,
        timestamp,
      };
    }
  }

  return {
    ok: t.type === "console",
    provider: t.type,
    details: t.type === "console"
      ? "Local development code delivery is enabled. No email was sent."
      : "Email delivery is not configured. Contact the application administrator.",
    config: baseConfig,
    timestamp,
  };
}


