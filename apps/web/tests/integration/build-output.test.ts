import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverEntry = new URL("../../.output/server/index.mjs", import.meta.url);
const publicDir = new URL("../../.output/public", import.meta.url);

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
});
