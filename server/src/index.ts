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
import paymentRoutes from "./routes/payments.js";
import assistantRoutes from "./routes/assistant.js";
import shareRoutes from "./routes/share.js";
import cadExchangeRoutes from "./routes/cadExchange.js";
import collaborationRoutes from "./routes/collaboration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();

app.set("trust proxy", 1);

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

app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));

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
app.use("/api/projects", projectRoutes);
app.use("/api/share", shareRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/cad-exchange", cadExchangeRoutes);
app.use("/api/collaboration", collaborationRoutes);

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

app.listen(PORT, () => {
  console.log(`[groundwork] API listening on http://localhost:${PORT}`);
  console.log(`[groundwork] Environment: ${IS_PROD ? "production" : "development"}`);
  if (fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
    console.log(`[groundwork] Serving static client from ${CLIENT_DIST}`);
  }
});
