import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { entryPath, workerEntryFailures, wranglerMain, type TextTree } from "./worker-entry-exports";

const SELF = fileURLToPath(import.meta.url);
const REPO = join(dirname(SELF), "../../..");
const WRANGLER_NAMES = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"] as const;

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

function addEntry(tree: Record<string, string>, repo: string, pkg: string, config: string): void {
  const text = readFileSync(config, "utf8");
  tree[rel(repo, config)] = text;
  const main = wranglerMain(text);
  if (main === undefined) return;
  const entry = join(pkg, main);
  if (!existsSync(entry)) return;
  tree[entryPath(rel(repo, config), main)] = readFileSync(entry, "utf8");
}

function loadPackage(tree: Record<string, string>, repo: string, pkg: string): void {
  const config = wranglerFile(pkg);
  if (config === undefined) return;
  addEntry(tree, repo, pkg, config);
}

export function repoWorkerTree(repo: string): TextTree {
  const tree: Record<string, string> = {};
  for (const pkg of packageDirs(repo)) loadPackage(tree, repo, pkg);
  return tree;
}

function main(): void {
  const failures = workerEntryFailures(repoWorkerTree(REPO));
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === SELF) main();
