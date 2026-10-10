import type { Request, RequestHandler } from "express";
import { Transform, type Writable } from "node:stream";
import multer from "multer";

interface UploadOptions {
  fileSize: number;
  fields: number;
  fieldSize: number;
  parts: number;
  fieldNameSize?: number;
  maxBytes?: number;
  allowedFields?: string[];
  sizeCode?: string;
  deadlineMs?: number;
}

const activeByUser = new Map<string, number>();
let activeUploads = 0;
const MAX_ACTIVE_UPLOADS = 8;
const MAX_USER_UPLOADS = 2;

/** Bound the entire wire body as well as the parts retained by Multer. */
export function boundedUpload(fieldName: string, options: UploadOptions): RequestHandler {
  const maximumBytes = options.maxBytes ?? options.fileSize + options.fields * options.fieldSize + 64 * 1024;
  return (req, res, next) => {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) { res.status(401).json({ error: "Not authenticated", code: "SESSION_EXPIRED" }); return; }
    if (!req.is("multipart/form-data")) { res.status(400).json({ error: "Expected a multipart upload", code: "INVALID_MULTIPART" }); return; }
    const length = req.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
      res.set("Connection", "close");
      res.once("finish", () => req.destroy());
      res.status(413).json({ error: "Upload body is too large", code: options.sizeCode ?? "UPLOAD_SIZE" }); return;
    }
    if (activeUploads >= MAX_ACTIVE_UPLOADS || (activeByUser.get(userId) ?? 0) >= MAX_USER_UPLOADS) {
      res.set("Retry-After", "5");
      res.status(429).json({ error: "Too many concurrent uploads. Try again shortly.", code: "UPLOAD_BUSY" }); return;
    }
    activeUploads++;
    activeByUser.set(userId, (activeByUser.get(userId) ?? 0) + 1);
    let released = false, stopped = false;
    let parserStream: Writable | undefined, bodyStream: Transform | undefined;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(deadline);
      activeUploads--;
      const remaining = (activeByUser.get(userId) ?? 1) - 1;
      if (remaining) activeByUser.set(userId, remaining); else activeByUser.delete(userId);
      req.off("data", countWireBytes);
    };
    const stop = (status: number, code: string, error: string) => {
      if (stopped || res.headersSent) return;
      stopped = true;
      // Reply before closing a chunked/slow request; never drain unlimited input.
      res.set("Connection", "close");
      res.once("finish", () => req.destroy());
      res.status(status).json({ error, code });
      if (bodyStream) { req.unpipe(bodyStream); bodyStream.unpipe(); bodyStream.destroy(); }
      parserStream?.destroy(new Error("Upload interrupted"));
    };
    const deadline = setTimeout(() => stop(408, "UPLOAD_TIMEOUT", "Upload took too long"), options.deadlineMs ?? 90_000);
    deadline.unref();
    res.once("finish", release);
    res.once("close", release);
    // Multer drains a malformed request before returning its parse error.
    // Keep counting that drain, including bytes after the parser has closed.
    let wireBytes = 0;
    const countWireBytes = (chunk: Buffer) => {
      wireBytes += chunk.length;
      if (wireBytes > maximumBytes) stop(413, options.sizeCode ?? "UPLOAD_SIZE", "Upload body is too large");
    };
    req.on("data", countWireBytes);
    const parserOptions: multer.Options & { streamHandler: (request: Request, parser: Writable) => void } = {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: options.fileSize, files: 1, fields: options.fields,
        fieldSize: options.fieldSize, fieldNameSize: options.fieldNameSize ?? 64,
        parts: options.parts, headerPairs: 50, fieldNestingDepth: 0, fieldArrayIndexLimit: 0,
      },
      streamHandler(request, parser) {
        parserStream = parser;
        let bytes = 0;
        bodyStream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > maximumBytes) {
            stop(413, options.sizeCode ?? "UPLOAD_SIZE", "Upload body is too large");
            callback();
          } else callback(null, chunk);
        } });
        request.pipe(bodyStream).pipe(parser);
        parser.once("close", () => { if (bodyStream) { request.unpipe(bodyStream); bodyStream.destroy(); } });
      },
    };
    multer(parserOptions).single(fieldName)(req, res, (error: unknown) => {
      if (stopped || res.destroyed) return;
      if (error) {
        const sizeError = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
        res.status(sizeError ? 413 : 400).json({
          error: sizeError ? "Uploaded file is too large" : "Invalid multipart upload",
          code: sizeError ? options.sizeCode ?? "UPLOAD_SIZE" : "INVALID_MULTIPART",
        });
        return;
      }
      const allowed = new Set(options.allowedFields ?? []);
      if (Object.entries(req.body ?? {}).some(([key, value]) => !allowed.has(key) || typeof value !== "string")) {
        res.status(400).json({ error: "Unexpected or duplicate upload field", code: "INVALID_MULTIPART" }); return;
      }
      next();
    });
  };
}
