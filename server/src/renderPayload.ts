import { hkdfSync } from "node:crypto";
import { decryptAesGcm, encryptAesGcm, type EncryptedPayload } from "./crypto.js";

const PREFIX = "groundwork-render:v1:";
export type RenderInputField = "prompt" | "negative_prompt" | "parameters_json" | "style_preset";
export interface RenderPayloadContext { projectId: string; jobId: string; field: RenderInputField }
export interface OpenedRenderPayload { plaintext: string; needsRewrite: boolean }
export function createRenderPayloadCodec(masterKey: Buffer, previousMasterKey?: Buffer | null) {
  const derive = (master: Buffer) => Buffer.from(hkdfSync("sha256", master, Buffer.from("groundwork-render-job"), Buffer.from("render-input-v1"), 32));
  const current = derive(masterKey), previous = previousMasterKey ? derive(previousMasterKey) : null;
  const aad = (context: RenderPayloadContext) => JSON.stringify(["groundwork-render", 1, context.projectId, context.jobId, context.field]);
  const seal = (plaintext: string, context: RenderPayloadContext) => PREFIX + JSON.stringify(encryptAesGcm(plaintext, current, aad(context)));
  const open = (stored: string, context: RenderPayloadContext): OpenedRenderPayload => {
    if (stored.startsWith("groundwork-render:") && !stored.startsWith(PREFIX)) throw new Error("Unsupported stored render input version");
    if (!stored.startsWith(PREFIX)) return { plaintext: stored, needsRewrite: true };
    try {
      const payload = JSON.parse(stored.slice(PREFIX.length)) as EncryptedPayload;
      if (!payload || typeof payload.iv !== "string" || typeof payload.tag !== "string" || typeof payload.data !== "string") throw new Error("Invalid encrypted render input");
      try { return { plaintext: decryptAesGcm(payload, current, aad(context)), needsRewrite: false }; }
      catch { if (!previous) throw new Error("Render input cannot be decrypted"); return { plaintext: decryptAesGcm(payload, previous, aad(context)), needsRewrite: true }; }
    } catch { throw new Error("Stored render input could not be authenticated"); }
  };
  return { seal, open };
}
