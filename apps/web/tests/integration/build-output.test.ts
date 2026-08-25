import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverEntry = new URL("../../.output/server/index.mjs", import.meta.url);
const serverDir = new URL("../../.output/server/", import.meta.url);
const publicDir = new URL("../../.output/public", import.meta.url);
const wranglerConfigPath = new URL("../../wrangler.jsonc", import.meta.url);

interface WranglerConfig {
  main: string;
  assets: { directory: string; binding: string };
  env?: Record<string, unknown>;
}

const DEFAULT_TARGET = "top-level";

function readWranglerConfig(): WranglerConfig {
  return parse(readFileSync(wranglerConfigPath, "utf8")) as WranglerConfig;
}

/** Every named env ships through the staging/production deployment workflow. */
function buildTargets(): string[] {
  return [DEFAULT_TARGET, ...Object.keys(readWranglerConfig().env ?? {})];
}

function envArgs(target: string): string[] {
  return target === DEFAULT_TARGET ? [] : ["--env", target];
}

function bundleWorkerToTempDir(target: string): string {
  const outdir = mkdtempSync(join(tmpdir(), "animichi-web-bundle-"));
  execFileSync("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--outdir", outdir, ...envArgs(target)], {
    cwd: packageRoot,
    stdio: "pipe",
    timeout: 120_000,
  });
  return outdir;
}

function promotePrebuiltWorkerToTempDir(): string {
  const outdir = mkdtempSync(join(tmpdir(), "animichi-web-promote-"));
  const entry = fileURLToPath(serverEntry);
  const args = ["exec", "wrangler", "deploy", entry, "--no-bundle", "--dry-run", "--outdir", outdir, "--env", "staging"];
  execFileSync("pnpm", args, { cwd: packageRoot, stdio: "pipe", timeout: 120_000 });
  return outdir;
}

function sourcesOf(mapPath: string): string[] {
  return (JSON.parse(readFileSync(mapPath, "utf8")) as { sources?: string[] }).sources ?? [];
}

/** Every module Rollup actually placed in a server chunk, named by its sourcemap. */
function serverGraphModules(): string[] {
  const root = fileURLToPath(serverDir);
  const maps = readdirSync(root, { recursive: true, encoding: "utf8" });
  return maps.filter((file) => file.endsWith(".map")).flatMap((file) => sourcesOf(join(root, file)));
}

function readBundledWorker(outdir: string): string {
  const entry = join(outdir, "index.js");
  if (!existsSync(entry)) throw new Error(`no bundled worker emitted in ${outdir}`);
  return readFileSync(entry, "utf8");
}

describe("build output", () => {
  it("emits the Cloudflare server entry and public assets", () => {
    expect(existsSync(serverEntry)).toBe(true);
    expect(existsSync(publicDir)).toBe(true);
  });

  it("validates Wrangler output mapping", () => {
    const wranglerConfig = readWranglerConfig();

    expect(wranglerConfig.main).toBe(".output/server/index.mjs");
    expect(wranglerConfig.assets.directory).toBe(".output/public");
    expect(wranglerConfig.assets.binding).toBe("ASSETS");
  });

  it("covers every wrangler env that ships", () => {
    expect(buildTargets()).toEqual([DEFAULT_TARGET, "staging", "production"]);
  });

  it("promotes every Nitro module from the prebuilt Worker", () => {
    const outdir = promotePrebuiltWorkerToTempDir();

    expect(existsSync(join(outdir, "chunks/nitro/nitro.mjs"))).toBe(true);
  });

  // Regression: esbuild `keepNames` wraps functions in `__name(...)`, and seroval serialises its
  // stream helpers with Function.prototype.toString() into the inline `$tsr-stream-barrier` script,
  // where `__name` is undefined — that ReferenceError blanked every SSR route (issue #426).
  // Per-env, because a `keep_names`/`build` override under one `env` block would otherwise ship
  // the crash while the top-level bundle stayed clean.
  it.each(buildTargets())("dry-runs %s without esbuild keepNames wrappers", (target) => {
    const bundle = readBundledWorker(bundleWorkerToTempDir(target));

    expect(bundle).not.toContain("__name(");
  });

  // Regression: `@neondatabase/auth` runs browser-only side effects at module scope —
  // a BroadcastChannel tab id via `crypto.randomUUID()`. workerd evaluates every module
  // top level outside an I/O context, even when the module is dynamically imported from
  // inside a request handler, so that call throws and Nitro answers 500 to every request
  // including static assets. Wrangler's esbuild pass used to hide it by inlining the
  // dynamic import into a lazy initialiser; main CD promotes Nitro's prebuilt chunks with
  // `--no-bundle`, which does not. Auth is a browser concern in this app (every consumer
  // is a hook or an event handler, and the server has no cookie jar to read a session
  // from), so the SDK must never reach the server graph.
  it("keeps the browser-only Neon Auth SDK out of the server graph", () => {
    const graph = serverGraphModules();

    expect(graph.length).toBeGreaterThan(0);
    expect(graph.filter((module) => module.includes("@neondatabase/auth/dist/"))).toEqual([]);
  });
});
