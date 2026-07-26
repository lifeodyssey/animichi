import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
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
}

function readWranglerConfig(): WranglerConfig {
  return parse(readFileSync(wranglerConfigPath, "utf8")) as WranglerConfig;
}

function bundleWorkerToTempDir(): string {
  const outdir = mkdtempSync(join(tmpdir(), "animichi-web-bundle-"));
  execFileSync("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--outdir", outdir], {
    cwd: packageRoot,
    stdio: "pipe",
    timeout: 120_000,
  });
  return outdir;
}

function readBundledWorker(outdir: string): string {
  const entry = readdirSync(outdir).find((name) => name.endsWith(".js"));
  if (!entry) throw new Error(`no bundled worker emitted in ${outdir}`);
  return readFileSync(join(outdir, entry), "utf8");
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

  it("dry-runs the web Worker deployment", () => {
    execFileSync("pnpm", ["exec", "wrangler", "deploy", "--dry-run"], {
      cwd: packageRoot,
      stdio: "pipe",
      timeout: 120_000,
    });
  });

  // Regression: esbuild `keepNames` wraps functions in `__name(...)`, and seroval serialises its
  // stream helpers with Function.prototype.toString() into the inline `$tsr-stream-barrier` script,
  // where `__name` is undefined — that ReferenceError blanked every SSR route (issue #426).
  it("bundles the Worker without esbuild keepNames wrappers", () => {
    const bundle = readBundledWorker(bundleWorkerToTempDir());

    expect(bundle).not.toContain("__name(");
  });

  it("dry-runs the staging web Worker deployment", () => {
    execFileSync("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--env", "staging"], {
      cwd: packageRoot,
      stdio: "pipe",
      timeout: 120_000,
    });
  });

  it("dry-runs the production web Worker deployment", () => {
    execFileSync("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--env", "production"], {
      cwd: packageRoot,
      stdio: "pipe",
      timeout: 120_000,
    });
  });
});
