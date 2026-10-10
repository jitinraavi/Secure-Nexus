import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { offlineShellPlugin } from "./build/offlineShellPlugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), offlineShellPlugin()],
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
  },
});