import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuthorityConfiguration } from "./topology.js";

// Fail before importing config.ts (which initializes storage/master keys),
// SQLite, routes or workers. Secondary hosts have a separate entry point.
requireAuthorityConfiguration();
const authority = await import("./authorityServer.js");

export const app = authority.app;
export const startAuthorityServer = authority.startAuthorityServer;

const isDirectRun = Boolean(
  process.argv[1] && (
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("index.js")
  )
);

if (isDirectRun) {
  startAuthorityServer();
}

export default app;
