import path from "node:path";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Plugin, ResolvedConfig } from "vite";

const MAX_FILES = 256;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const PUBLIC_FILES = ["logo.svg", "logo.png", "manifest.webmanifest"];
const TEMPLATE_TOKEN = "/*__GROUNDWORK_SHELL_INVENTORY__*/null";
interface ShellAsset { url: string; bytes: number; sha256: string }

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function assetName(value: string): boolean {
  return /^[A-Za-z0-9_.\/-]+$/.test(value) && !value.startsWith("/") && value.split("/").every((part) => part && part !== "." && part !== "..") && !/^api(?:\/|$)/i.test(value);
}

/** Generates only deployment assets; this plugin is never used by the dev server. */
export function offlineShellPlugin(): Plugin {
  let configuration: ResolvedConfig;
  return {
    name: "groundwork-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      configuration = config;
      if (config.base !== "/" || config.build.ssr || config.build.write === false || config.build.watch) throw new Error("Offline shell requires one written production browser build at the root origin");
    },
    writeBundle: {
      order: "post",
      sequential: true,
      async handler(options, bundle) {
        const expectedRoot = path.resolve(configuration.root, configuration.build.outDir);
        const outputRoot = path.resolve(options.dir || expectedRoot);
        if (outputRoot !== expectedRoot || options.file) throw new Error("Offline shell requires the configured single output directory");
        const resolvedRoot = await realpath(outputRoot);
        const emitted = Object.keys(bundle);
        if (!emitted.includes("index.html") || !emitted.some((name) => bundle[name].type === "chunk")) throw new Error("Offline shell requires emitted HTML and application chunks");
        if (emitted.some((name) => !assetName(name) || name === "sw.js" || name === "offline-shell.json")) throw new Error("Offline shell encountered an unsupported or reserved asset name");
        const emittedNames = new Set(emitted);
        for (const item of Object.values(bundle)) {
          if (item.type === "chunk" && [...item.imports, ...item.dynamicImports].some((name) => !emittedNames.has(name))) throw new Error("Offline shell cannot certify external bundled imports");
        }
        const names = [...new Set([...emitted, ...PUBLIC_FILES])].sort();
        if (names.length > MAX_FILES) throw new Error("Offline shell exceeds its file budget");
        const assets: ShellAsset[] = [];
        let totalBytes = 0;
        for (const name of names) {
          const filename = path.resolve(outputRoot, name);
          if (!inside(outputRoot, filename) || !inside(resolvedRoot, await realpath(filename))) throw new Error("Offline shell asset is outside its output directory");
          const info = await lstat(filename);
          if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE_BYTES) throw new Error(`Offline shell asset exceeds its supported file scope: ${name}`);
          const hash = createHash("sha256");
          const stream = createReadStream(filename, { highWaterMark: 64 * 1024 });
          let bytes = 0;
          for await (const chunk of stream) {
            bytes += chunk.length;
            if (bytes > MAX_FILE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) { stream.destroy(); throw new Error("Offline shell exceeds its byte budget"); }
            hash.update(chunk);
          }
          if (bytes !== info.size) throw new Error("Offline shell asset changed while inventorying");
          totalBytes += bytes;
          assets.push({ url: `/${name}`, bytes, sha256: hash.digest("hex") });
        }
        const templateFile = path.resolve(configuration.publicDir, "sw.js");
        const templateInfo = await lstat(templateFile);
        if (!templateInfo.isFile() || templateInfo.size > 256 * 1024) throw new Error("Offline shell worker template is unsupported");
        const template = await readFile(templateFile, "utf8");
        if (template.split(TEMPLATE_TOKEN).length !== 2) throw new Error("Offline shell template requires exactly one inventory token");
        const version = createHash("sha256").update(JSON.stringify({ schema: 1, assets, workerSha256: createHash("sha256").update(template).digest("hex") })).digest("hex");
        const inventory = { schema: 1, version, totalBytes, assets };
        const worker = template.replace(TEMPLATE_TOKEN, JSON.stringify(inventory));
        // The worker is published last, only after the complete emitted graph and
        // explicit public files have been bounded and fingerprinted successfully.
        await writeFile(path.join(outputRoot, "offline-shell.json"), JSON.stringify(inventory), "utf8");
        const temporaryWorker = path.join(outputRoot, ".groundwork-sw.tmp");
        await writeFile(temporaryWorker, worker, "utf8");
        await rename(temporaryWorker, path.join(outputRoot, "sw.js"));
      },
    },
  };
}
