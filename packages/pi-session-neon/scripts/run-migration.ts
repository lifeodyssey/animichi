/**
 * Regenerates one native migration's `migration.json` and `ops.json` from its rendered
 * `migration.ts`, then restores the final newline Prisma's emitter omits. The working
 * tree is hook-clean afterwards, so the `end-of-file-fixer` pre-commit hook has nothing
 * left to fix.
 *
 * Usage: pnpm run migration:emit -- migrations/app/<directory> [migration.ts flags]
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { normalizeGeneratedArtifacts, packageRoot } from "./generated-artifacts.ts";

function refuse(message: string): never {
  process.stderr.write(message);
  process.exit(2);
}

const args = process.argv.slice(2);
const [directory, ...forwarded] = args[0] === "--" ? args.slice(1) : args;
if (directory === undefined) {
  refuse("usage: pnpm run migration:emit -- <migrations/app/directory> [migration.ts flags]\n");
}
const migration = join(packageRoot, directory, "migration.ts");
const result = spawnSync(process.execPath, [migration, ...forwarded], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const changed = await normalizeGeneratedArtifacts(packageRoot);
process.stdout.write(`normalized ${String(changed.length)} generated artifact(s)\n`);
