/**
 * The generated artifacts Prisma's two entrypoints rewrite, and the final-newline
 * convention the repository's `end-of-file-fixer` pre-commit hook enforces.
 *
 * Prisma's emitters write `contract.json`, `migration.json` and `ops.json` without a
 * trailing newline (only `contract.d.ts` already has one). Every repository entrypoint
 * that regenerates them therefore finishes with `normalizeGeneratedArtifacts`, so a
 * regenerated tree is hook-clean and a second regeneration changes nothing.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const CONTRACT_ARTIFACTS = ["contract.json", "contract.d.ts"] as const;
const MIGRATION_ARTIFACTS = ["migration.json", "ops.json"] as const;

async function directories(path: string): Promise<readonly string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function nestedArtifacts(parent: string, names: readonly string[]): Promise<readonly string[]> {
  const children = await directories(parent);
  return children.flatMap((child) => names.map((name) => join(parent, child, name)));
}

/** Every artifact `contract:emit` and a rendered `migration.ts` run rewrite. */
export async function generatedArtifacts(root: string): Promise<readonly string[]> {
  const contract = CONTRACT_ARTIFACTS.map((name) => join(root, "src", name));
  const snapshots = await nestedArtifacts(join(root, "migrations/snapshots"), CONTRACT_ARTIFACTS);
  const migrations = await nestedArtifacts(join(root, "migrations/app"), MIGRATION_ARTIFACTS);
  return [...contract, ...snapshots, ...migrations];
}

async function ensureFinalNewline(path: string): Promise<boolean> {
  const content = await readFile(path, "utf8");
  if (content.endsWith("\n")) return false;
  await writeFile(path, `${content}\n`);
  return true;
}

/** Restores the missing final newline and returns the artifacts it rewrote. Idempotent. */
export async function normalizeGeneratedArtifacts(root: string): Promise<readonly string[]> {
  const changed: string[] = [];
  for (const path of await generatedArtifacts(root)) {
    if (await ensureFinalNewline(path)) changed.push(path);
  }
  return changed;
}
