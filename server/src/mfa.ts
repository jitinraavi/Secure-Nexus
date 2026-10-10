import { hkdfSync } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { MASTER_KEY, PREVIOUS_MASTER_KEY } from "./config.js";
import { decryptAesGcm, encryptAesGcm, type EncryptedPayload } from "./crypto.js";

const PREFIX = "mfa:v1:";
const deriveKey = (master: Buffer) => Buffer.from(hkdfSync("sha256", master, Buffer.from("groundwork-mfa"), Buffer.from("totp-seed-v1"), 32));
const key = deriveKey(MASTER_KEY);
const previousKey = PREVIOUS_MASTER_KEY ? deriveKey(PREVIOUS_MASTER_KEY) : null;
const aad = (userId: string) => `groundwork:mfa:v1:${userId}`;

function validSecret(secret: string): boolean {
  return /^[A-Z2-7]{16,128}$/.test(secret);
}

export function sealTotpSecret(secret: string, userId: string): string {
  if (!validSecret(secret) || !userId) throw new Error("Invalid authenticator seed");
  return PREFIX + JSON.stringify(encryptAesGcm(secret, key, aad(userId)));
}

export function openTotpSecret(value: string, userId: string): { secret: string; needsReseal: boolean } {
  if (!value.startsWith(PREFIX)) {
    // Only the original generated base32 representation is eligible for migration.
    // Corrupt or unfamiliar values must never silently disable MFA.
    if (!validSecret(value)) throw new Error("Authenticator seed is unavailable");
    return { secret: value, needsReseal: true };
  }
  let payload: EncryptedPayload;
  try {
    const parsed: unknown = JSON.parse(value.slice(PREFIX.length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const candidate = parsed as Partial<EncryptedPayload>;
    if (typeof candidate.iv !== "string" || typeof candidate.tag !== "string" || typeof candidate.data !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.iv) || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.tag) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.data) || Buffer.from(candidate.iv, "base64").length !== 12 ||
      Buffer.from(candidate.tag, "base64").length !== 16 || Buffer.from(candidate.data, "base64").length > 128) throw new Error();
    payload = candidate as EncryptedPayload;
  } catch { throw new Error("Authenticator seed is unavailable"); }
  let secret: string;
  let needsReseal = false;
  try { secret = decryptAesGcm(payload, key, aad(userId)); }
  catch {
    if (!previousKey) throw new Error("Authenticator seed is unavailable");
    try { secret = decryptAesGcm(payload, previousKey, aad(userId)); needsReseal = true; }
    catch { throw new Error("Authenticator seed is unavailable"); }
  }
  if (!validSecret(secret)) throw new Error("Authenticator seed is unavailable");
  return { secret, needsReseal };
}

/** The caller owns the transaction, so migration either preserves every seed or rolls back. */
export function migrateTotpSeeds(database: DatabaseSync): void {
  const rows = database.prepare("SELECT id,totp_secret FROM users WHERE totp_secret IS NOT NULL").all() as { id: string; totp_secret: string }[];
  for (const row of rows) {
    const opened = openTotpSecret(row.totp_secret, row.id);
    if (opened.needsReseal) database.prepare("UPDATE users SET totp_secret=? WHERE id=?").run(sealTotpSecret(opened.secret, row.id), row.id);
  }
}
