import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverEntry = new URL("../../.output/server/index.mjs", import.meta.url);
const publicDir = new URL("../../.output/public", import.meta.url);
const wranglerConfigPath = new URL("../../wrangler.jsonc", import.meta.url);

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
    const wranglerConfig = JSON.parse(
      readFileSync(wranglerConfigPath, "utf8"),
    ) as { main: string; assets: { directory: string; binding: string } };

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
