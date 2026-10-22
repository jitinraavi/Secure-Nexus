import type { Response } from "express";

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_BUFFER_BYTES = 128 * 1024;
/** Close slow streams; the durable event cursor makes reconnection replay safe. */
export function writeSse(response: Pick<Response, "destroyed" | "writableEnded" | "writableLength" | "write" | "end">, event: string, data?: unknown, id?: number): boolean {
  if (response.destroyed || response.writableEnded) return false;
  try {
    if (!/^[a-z][a-z-]{0,63}$/.test(event)) throw new Error("Invalid event type");
    const frame = data === undefined ? `: ${event}\n\n` : `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (Buffer.byteLength(frame) > MAX_EVENT_BYTES || response.writableLength > MAX_BUFFER_BYTES) { response.end(); return false; }
    if (!response.write(frame)) { response.end(); return false; }
    return true;
  } catch { response.end(); return false; }
}
