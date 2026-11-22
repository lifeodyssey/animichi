/**
 * The `[alias]` table of this Worker's `wrangler.toml`, as Wrangler reads it, with each path made
 * absolute: the module substitution every build of the Worker applies. The release build gets it
 * from Wrangler; the fixtures that bundle with esbuild directly pass it to esbuild, so the runtime
 * they boot carries the deployed module graph (`src/fdir-unavailable.ts` in place of `fdir`).
 *
 * Read in a child process, as `deployment-contract.test.ts` reads the rings, so Wrangler's config
 * reader runs as it does on the command line.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_ROOT = fileURLToPath(new URL("../", import.meta.url).href);
const READ_ALIAS = `
const { experimental_readRawConfig } = await import("wrangler");
process.stdout.write(JSON.stringify(experimental_readRawConfig({ config: process.argv[1] }).rawConfig.alias ?? {}));
`;

function readAlias(): Record<string, string> {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", READ_ALIAS, `${WORKER_ROOT}wrangler.toml`], {
    cwd: WORKER_ROOT, encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
  });
  return JSON.parse(output) as Record<string, string>;
}

export const WORKER_ALIAS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(readAlias()).map(([name, path]) => [name, resolve(WORKER_ROOT, path)]),
);
