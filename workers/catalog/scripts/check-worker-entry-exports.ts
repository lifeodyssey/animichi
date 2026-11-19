/**
 * The entry-export check's walk and command (`lint:oxlint` runs it): for each
 * directory under workers/* and apps/*, the first of wrangler.toml,
 * wrangler.jsonc and wrangler.json, the main it declares (`wrangler-main.ts`),
 * and that entry's source when it is on disk. `worker-entry-exports.ts` judges
 * the result; any failure is printed and fails the command.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { entryPath, workerEntryFailures, type WorkerTree } from "./worker-entry-exports";
import { wranglerMain } from "./wrangler-main";

const SELF = fileURLToPath(import.meta.url);
const REPO = join(dirname(SELF), "../../..");
const WRANGLER_NAMES = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"] as const;

/** The tree a walk fills in before handing it to the check. */
interface WalkedTree {
  mains: Record<string, string | undefined>;
  sources: Record<string, string>;
}

function dirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

function packageDirs(repo: string): string[] {
  return [...dirs(join(repo, "workers")), ...dirs(join(repo, "apps"))];
}

function wranglerFile(pkg: string): string | undefined {
  return WRANGLER_NAMES.map((name) => join(pkg, name)).find((path) => existsSync(path));
}

function rel(repo: string, path: string): string {
  return relative(repo, path).replaceAll("\\", "/");
}

function addEntry(tree: WalkedTree, repo: string, pkg: string, config: string): void {
  const configPath = rel(repo, config);
  const main = wranglerMain(config);
  tree.mains[configPath] = main;
  if (main === undefined) return;
  const entry = join(pkg, main);
  if (!existsSync(entry)) return;
  tree.sources[entryPath(configPath, main)] = readFileSync(entry, "utf8");
}

function loadPackage(tree: WalkedTree, repo: string, pkg: string): void {
  const config = wranglerFile(pkg);
  if (config === undefined) return;
  addEntry(tree, repo, pkg, config);
}

export function repoWorkerTree(repo: string): WorkerTree {
  const tree: WalkedTree = { mains: {}, sources: {} };
  for (const pkg of packageDirs(repo)) loadPackage(tree, repo, pkg);
  return tree;
}

function main(): void {
  const failures = workerEntryFailures(repoWorkerTree(REPO));
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === SELF) main();
