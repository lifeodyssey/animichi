import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));

export function prisma(args: string[], cwd = packageRoot) {
  return promisify(execFile)("pnpm", ["exec", "prisma", ...args, "--json"], {
    cwd, env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
}

/** The CLI writes its divergence report across both streams, so every rejection
 * assertion reads them as one string instead of unpacking `stdout`/`stderr` itself. */
export function prismaCliOutput(failure: unknown): string {
  assert(failure !== null && typeof failure === "object");
  const stdout = "stdout" in failure ? String(failure.stdout) : "";
  const stderr = "stderr" in failure ? String(failure.stderr) : "";
  return `${stdout}\n${stderr}`;
}

export function migrate(dsn: string, cwd = packageRoot, target?: string) {
  const selection = target === undefined ? [] : ["--to", target];
  return prisma(["db", "migrate", "--db", dsn, ...selection], cwd);
}
