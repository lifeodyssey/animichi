import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverEntry = new URL("../../.output/server/index.mjs", import.meta.url);
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

function readBundledWorker(outdir: string): string {
  const entry = join(outdir, "index.js");
  if (!existsSync(entry)) throw new Error(`no bundled worker emitted in ${outdir}`);
  return readFileSync(entry, "utf8");
}

describe("build output", () => {
  it("emits the Cloudflare server entry and public assets", () => {
    execFileSync("pnpm", ["run", "build"], {
      // vitest sets NODE_ENV=test; a non-production NODE_ENV makes vite emit the dev JSX transform (jsxDEV) into the SSR bundle, which crashes on workerd.
      env: { ...process.env, NODE_ENV: "production" },
      cwd: packageRoot,
      stdio: "pipe",
      timeout: 180_000,
    });

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

  // Regression: esbuild `keepNames` wraps functions in `__name(...)`, and seroval serialises its
  // stream helpers with Function.prototype.toString() into the inline `$tsr-stream-barrier` script,
  // where `__name` is undefined — that ReferenceError blanked every SSR route (issue #426).
  // Per-env, because a `keep_names`/`build` override under one `env` block would otherwise ship
  // the crash while the top-level bundle stayed clean.
  it.each(buildTargets())("dry-runs %s without esbuild keepNames wrappers", (target) => {
    const bundle = readBundledWorker(bundleWorkerToTempDir(target));

    expect(bundle).not.toContain("__name(");
  });
});
