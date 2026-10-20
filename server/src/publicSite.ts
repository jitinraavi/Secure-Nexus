import path from "node:path";
import fs from "node:fs";
import express from "express";

/** Two independent browser documents share the same protected API origin. */
export function mountPublicSite(app: express.Express, clientDist: string): boolean {
  if (!fs.existsSync(path.join(clientDist, "index.html"))) return false;
  if (!fs.existsSync(path.join(clientDist, "studio.html"))) throw new Error("Client build is missing the studio entry; rebuild both browser documents");

  app.use(express.static(clientDist, {
    index: false,
    maxAge: 0,
    setHeaders(response, filename) {
      const relative = path.relative(clientDist, filename).replaceAll(path.sep, "/");
      const hashed = relative.startsWith("assets/") && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(relative)
        && !relative.endsWith(".html") && !relative.endsWith(".map");
      response.setHeader("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate");
      if (relative.endsWith(".html") || relative === "sw.js" || relative === "offline-shell.json") {
        response.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
      }
    },
  }));
  app.get(/^(?!\/api(?:\/|$)).*/, (request, response, next) => {
    const pathname = request.path;
    const studio = pathname === "/" || pathname === "/studio.html";
    const asset = /^\/(?:assets|studio-assets)(?:\/|$)/i.test(pathname)
      || (Boolean(path.posix.extname(pathname)) && pathname !== "/index.html"
        && !/^\/(?:editor|share)\/[^/]+\/?$/.test(pathname));
    if (!studio && asset) { next(); return; }
    response.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
    response.sendFile(path.join(clientDist, studio ? "studio.html" : "index.html"), { cacheControl: false });
  });
  return true;
}
