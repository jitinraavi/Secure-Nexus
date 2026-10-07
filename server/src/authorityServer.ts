import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import multer from "multer";
import { IS_PROD, PORT } from "./config.js";
import { db } from "./db.js";
import { apiLimiter, csrfProtection } from "./security.js";
import { COUNTRIES } from "./payments/pricing.js";
import authRoutes from "./routes/auth.js";
import secretRoutes from "./routes/secrets.js";
import auditRoutes from "./routes/audit.js";
import projectRoutes from "./routes/projects.js";
import workspaceRoutes from "./routes/workspaces.js";
import nativeJobRoutes from "./routes/nativeJobs.js";
import { startNativeJobWorker } from "./nativeJobWorker.js";
import paymentRoutes from "./routes/payments.js";
import assistantRoutes from "./routes/assistant.js";
import shareRoutes from "./routes/share.js";
import cadExchangeRoutes from "./routes/cadExchange.js";
import collaborationRoutes from "./routes/collaboration.js";
import organizationRoutes from "./routes/organizations.js";
import ssoRoutes from "./routes/sso.js";
import { authorityGatewayMiddleware, normalizeIp, requireAuthorityConfiguration } from "./topology.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

export const app = express();
const topology = requireAuthorityConfiguration();

// Required gateway mode has one authenticated forwarding hop. Direct mode only
// trusts explicit proxy addresses; unauthenticated clients cannot invent IPs.
app.set("trust proxy", topology.gatewayRequired ? 1 : (address: string) => topology.trustedProxyIps.includes(normalizeIp(address)));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: IS_PROD ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use("/api", authorityGatewayMiddleware(topology));
app.use(cookieParser());
app.use(express.json({
  limit: "8mb",
  verify: (req, _res, buffer) => {
    if ((req.url ?? "").split("?")[0] === "/api/payments/webhook") {
      if (buffer.length > 256 * 1024) throw Object.assign(new Error("Webhook body too large"), { status: 413 });
      (req as express.Request & { paymentWebhookBody?: Buffer }).paymentWebhookBody = Buffer.from(buffer);
    }
  },
}));

app.use("/api", apiLimiter);
app.use("/api", csrfProtection);

app.get("/api/health", (_req, res) => {
  const ok = (db.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
  res.json({ ok, uptime: process.uptime() });
});

app.get("/api/countries", (_req, res) => {
  res.json({
    countries: COUNTRIES.map((c) => ({ iso2: c.iso2, name: c.name, currency: c.currency, symbol: c.symbol })),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/secrets", secretRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/projects/:projectId/workspaces", workspaceRoutes);
app.use("/api/projects/:projectId/jobs", nativeJobRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/share", shareRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/cad-exchange", cadExchangeRoutes);
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/sso", ssoRoutes);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

/* Upload limit + JSON parse errors -> readable JSON */
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Photo too large. Max 25 MB." });
        return;
      }
      res.status(400).json({ error: `Upload error: ${err.code}` });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    if (err && typeof err === "object" && "status" in err && err.status === 413) {
      res.status(413).json({ error: "Request is too large for this endpoint" });
      return;
    }
    next(err);
  },
);

/* Serve the built SPA in production (deployed on Render) */
if (fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api).*/, (req, res) => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[groundwork] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

export function startAuthorityServer() {
  const server = app.listen(PORT, () => {
    console.log(`[groundwork] API listening on http://localhost:${PORT}`);
    console.log(`[groundwork] Environment: ${IS_PROD ? "production" : "development"}`);
    if (fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
      console.log(`[groundwork] Serving static client from ${CLIENT_DIST}`);
    }
  });

  const nativeWorker = startNativeJobWorker();
  let stopping = false;
  async function stopServer(): Promise<void> {
    if (stopping) return;
    stopping = true;
    server.close();
    await nativeWorker.stop();
    process.exit(0);
  }
  process.once("SIGTERM", () => { void stopServer(); });
  process.once("SIGINT", () => { void stopServer(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startAuthorityServer();
}

export default app;

