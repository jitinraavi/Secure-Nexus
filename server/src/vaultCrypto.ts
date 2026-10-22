import { decryptAesGcm, encryptAesGcm, type EncryptedPayload } from "./crypto.js";

/** Rotation uses only keys supplied by configuration; authentication must pass before resealing. */
export function decryptWithKeyRotation(payload: EncryptedPayload, currentKey: Buffer, previousKey: Buffer | null, aad: string): {
  plaintext: string;
  resealed?: EncryptedPayload;
} {
  try {
    return { plaintext: decryptAesGcm(payload, currentKey, aad) };
  } catch (error) {
    if (!previousKey) throw error;
    const plaintext = decryptAesGcm(payload, previousKey, aad);
    return { plaintext, resealed: encryptAesGcm(plaintext, currentKey, aad) };
  }
}
