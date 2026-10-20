import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { offlineShellPlugin } from "./build/offlineShellPlugin.ts";

const clientRoot = fileURLToPath(new URL(".", import.meta.url));

/** Keep the studio and workspace in separate documents, including during development. */
function studioEntries(): Plugin {
  const rewrite = (request: { url?: string; method?: string }, _response: unknown, next: () => void) => {
    if (!["GET", "HEAD"].includes(request.method || "GET")) { next(); return; }
    const url = new URL(request.url || "/", "http://groundwork.local");
    const pathname = url.pathname;
    if (pathname === "/") request.url = `/studio.html${url.search}`;
    else if (!/^\/(?:api(?:\/|$)|assets(?:\/|$)|studio-assets(?:\/|$)|@|src(?:\/|$)|studio(?:\/|$)|node_modules(?:\/|$))/.test(pathname)
      && (!path.posix.extname(pathname) || /^\/(?:editor|share)\/[^/]+\/?$/.test(pathname))) {
      request.url = `/index.html${url.search}`;
    }
    next();
  };
  return {
    name: "groundwork-studio-entries",
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  appType: "mpa",
  plugins: [studioEntries(), react(), tailwindcss(), offlineShellPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.GROUNDWORK_API_TARGET || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rolldownOptions: {
      input: {
        workspace: path.resolve(clientRoot, "index.html"),
        studio: path.resolve(clientRoot, "studio.html"),
      },
    },
  },
});
