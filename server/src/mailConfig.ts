export interface MailConfiguration {
  provider: string;
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
  from: string;
  resendKey: string;
  devOtp: boolean;
  isGmail: boolean;
  /** Safe configuration guidance; never contains environment values. */
  configError?: string;
}

/** Pure configuration parsing, shared by the runtime and isolated mail tests. */
export function readMailConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  options: { isProd: boolean; allowDevOtp: boolean },
): MailConfiguration {
  const host = (env.MAIL_HOST || "").trim().toLowerCase();
  const user = (env.MAIL_USER || "").trim();
  const isGmail = host === "smtp.gmail.com";
  let pass = env.MAIL_PASS || "";
  // Google displays app passwords in four groups. Never alter other SMTP passwords.
  const compactPass = pass.replace(/\s/g, "");
  if (isGmail && /^[A-Za-z0-9]{16}$/.test(compactPass)) pass = compactPass;
  const resendKey = (env.RESEND_API_KEY || "").trim();
  const explicitProvider = (env.MAIL_PROVIDER || "").trim().toLowerCase();
  const provider = explicitProvider || (resendKey ? "resend" : host || user || pass ? "smtp" : "console");
  const portInput = (env.MAIL_PORT || "").trim();
  const port = portInput ? Number(portInput) : 587;
  const secureInput = (env.MAIL_SECURE || "").trim().toLowerCase();
  const secure = secureInput ? secureInput === "true" : port === 465;
  const explicitFrom = (env.MAIL_FROM || "").trim();
  const from = explicitFrom || (isGmail && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(user)
    ? `Groundwork <${user}>`
    : "Groundwork <noreply@groundwork.design>");
  let configError: string | undefined;
  if (!["smtp", "resend", "console"].includes(provider)) {
    configError = "MAIL_PROVIDER must select smtp, resend, or local console delivery.";
  } else if (provider === "smtp") {
    if (!host || !user || !pass) configError = "SMTP delivery requires MAIL_HOST, MAIL_USER and MAIL_PASS.";
    else if (/\s/.test(host) || /[\r\n]/.test(user)) configError = "SMTP host or user configuration is invalid.";
    else if (!/^\d+$/.test(portInput || "587") || !Number.isInteger(port) || port < 1 || port > 65535) {
      configError = "MAIL_PORT must be a valid TCP port.";
    } else if (secureInput && !["true", "false"].includes(secureInput)) {
      configError = "MAIL_SECURE must be true, false, or empty for automatic port selection.";
    } else if ((port === 465 && !secure) || (port === 587 && secure)) {
      configError = "SMTP port 465 requires MAIL_SECURE=true; port 587 requires MAIL_SECURE=false for STARTTLS.";
    }
  } else if (provider === "resend" && !resendKey) configError = "Resend delivery requires RESEND_API_KEY.";
  if (!configError && ["smtp", "resend"].includes(provider)
    && (/[\r\n]/.test(from) || !/^[^<>]*<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$|^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from))) {
    configError = "MAIL_FROM must contain one valid sender email address.";
  }
  if (!configError && provider === "console" && (!options.allowDevOtp || options.isProd)) {
    configError = "Email delivery is not configured. Configure SMTP or Resend before sending codes.";
  }
  return {
    provider, host, port, secure, requireTLS: !secure && (options.isProd || isGmail),
    user, pass, from, resendKey, devOtp: !options.isProd && options.allowDevOtp, isGmail, configError,
  };
}
