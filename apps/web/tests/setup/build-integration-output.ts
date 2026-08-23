import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

export function setup(): void {
  execFileSync("pnpm", ["run", "build"], {
    cwd: packageRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "pipe",
    timeout: 180_000,
  });
}
