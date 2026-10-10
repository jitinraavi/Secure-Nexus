import JSZip from "jszip";

export const MAX_BCF_COMPRESSED_BYTES = 10 * 1024 * 1024;
export const MAX_BCF_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_BCF_ENTRIES = 8000;
export const MAX_BCF_XML_BYTES = 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export interface BcfArchiveEntry { name: string; bytes: Uint8Array; }
export class BcfImportLimitError extends Error {
  constructor(readonly entryBytes: number, readonly totalBytes: number) {
    super("BCF text or expanded data exceeds the import limit.");
    this.name = "BcfImportLimitError";
  }
}

/** Headers are an early rejection only; streamed output is independently bounded. */
export function inspectBcfArchive(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_BCF_COMPRESSED_BYTES) throw new Error("BCF import supports archives up to 10 MB.");
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (data.getUint32(offset, true) === 0x06054b50 && offset + 22 + data.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error("The BCF ZIP directory is missing or malformed.");
  const count = data.getUint16(end + 10, true), size = data.getUint32(end + 12, true), start = data.getUint32(end + 16, true);
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true) || data.getUint16(end + 8, true) !== count || count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Error("Multi-volume and ZIP64 BCF archives are unsupported.");
  if (count > MAX_BCF_ENTRIES || start + size > end) throw new Error("The BCF archive exceeds entry limits or has an invalid directory.");
  let cursor = start, unpacked = 0;
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > start + size || data.getUint32(cursor, true) !== 0x02014b50) throw new Error("The BCF archive contains a malformed entry.");
    const flags = data.getUint16(cursor + 8, true), method = data.getUint16(cursor + 10, true), compressed = data.getUint32(cursor + 20, true), expanded = data.getUint32(cursor + 24, true);
    const nameLength = data.getUint16(cursor + 28, true), extraLength = data.getUint16(cursor + 30, true), commentLength = data.getUint16(cursor + 32, true), local = data.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if ((flags & 1) || ![0, 8].includes(method) || next > start + size || compressed > bytes.length || expanded > MAX_ENTRY_BYTES || local >= start || !nameLength || nameLength > 512) throw new Error("The BCF archive has an encrypted, unsupported, oversized or invalid entry.");
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..") || names.has(name)) throw new Error("The BCF archive has unsafe or duplicate paths.");
    names.add(name); unpacked += expanded;
    if (unpacked > MAX_BCF_EXPANDED_BYTES) throw new Error("The BCF archive expands beyond the 64 MB limit.");
    cursor = next;
  }
  if (cursor !== start + size) throw new Error("The BCF ZIP directory size is inconsistent.");
}

type StreamingEntry = JSZip.JSZipObject & { internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>; };
function streamEntry(entry: JSZip.JSZipObject, maximum: number, budget: { used: number; maximum: number }, signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const stream = (entry as StreamingEntry).internalStream("uint8array");
    let settled = false, used = 0;
    let chunks: Uint8Array[] = [];
    const stop = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause(); // Stops upstream input; never accumulate the oversized output.
      chunks = [];
      signal?.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => stop(new DOMException("BCF import cancelled.", "AbortError"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => {
      if (settled) return;
      if (signal?.aborted) { abort(); return; }
      const next = used + chunk.byteLength, total = budget.used + chunk.byteLength;
      if (next > maximum || total > budget.maximum) { stop(new BcfImportLimitError(next, total)); return; }
      used = next; budget.used = total; chunks.push(chunk);
    }).on("error", stop).on("end", () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      const output = new Uint8Array(used);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
      chunks = [];
      resolve(output);
    }).resume();
  });
}

/** Called in a dedicated worker. Limits use actual output, including ignored attachments. */
export async function inflateBcfArchive(bytes: Uint8Array, signal?: AbortSignal, maximumTotal = MAX_BCF_EXPANDED_BYTES): Promise<BcfArchiveEntry[]> {
  if (!Number.isSafeInteger(maximumTotal) || maximumTotal < 1 || maximumTotal > MAX_BCF_EXPANDED_BYTES) throw new Error("Invalid BCF expansion budget.");
  if (signal?.aborted) throw new DOMException("BCF import cancelled.", "AbortError");
  inspectBcfArchive(bytes);
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length > MAX_BCF_ENTRIES) throw new Error("The BCF archive contains too many entries.");
  const budget = { used: 0, maximum: maximumTotal }, output: BcfArchiveEntry[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (signal?.aborted) throw new DOMException("BCF import cancelled.", "AbortError");
    if (entry.dir) continue;
    const maximum = name === "groundwork-issues.json" ? 4 * MAX_BCF_XML_BYTES : /(?:^|\/)markup\.bcf$|\.bcfv$/i.test(name) ? MAX_BCF_XML_BYTES : MAX_ENTRY_BYTES;
    output.push({ name, bytes: await streamEntry(entry, maximum, budget, signal) });
  }
  return output;
}
