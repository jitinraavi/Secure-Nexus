/** A concise label, without displaying the complete browser fingerprint as the primary name. */
export function sessionDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent?.trim()) return "Browser not identified";
  const browser = /Edg(?:A|iOS)?\//.test(userAgent) ? "Edge"
    : /(?:OPR|Opera)\//.test(userAgent) ? "Opera"
    : /(?:Firefox|FxiOS)\//.test(userAgent) ? "Firefox"
    : /(?:Chrome|CriOS)\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari" : "Unrecognized browser";
  const device = /iPhone/.test(userAgent) ? "iPhone"
    : /iPad/.test(userAgent) ? "iPad"
    : /Android/.test(userAgent) ? "Android"
    : /Windows/.test(userAgent) ? "Windows"
    : /Macintosh|Mac OS X/.test(userAgent) ? "Mac"
    : /Linux/.test(userAgent) ? "Linux" : null;
  return device ? `${browser} on ${device}` : browser;
}
