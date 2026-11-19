/**
 * The entry-export check: no wrangler main under workers/* or apps/* may
 * `export *`, because workerd treats named entry exports as handlers and a
 * star-export lifts non-handler values. The check is pure: it reads a
 * `WorkerTree`, which `check-worker-entry-exports.ts` builds from disk with each
 * config's main read by `wrangler-main.ts`. A config whose main is missing, or
 * is not a string, is reported rather than scanned.
 */

export type TextTree = Readonly<Record<string, string>>;

/** What a walk of workers/* and apps/* found: the main each wrangler config
 * declares, as the config holds it (undefined when it declares none), keyed by
 * the config's path, and the source of every entry the walk could load, keyed by
 * the entry's path. */
export interface WorkerTree {
  readonly mains: Readonly<Record<string, unknown>>;
  readonly sources: TextTree;
}

const CONFIG_PATH = /^(workers|apps)\/[^/]+\/wrangler\.(toml|jsonc|json)$/;
const STAR_EXPORT = /^\s*export\s+\*/;
const WRANGLER_FILE = /\/wrangler\.(toml|jsonc|json)$/;

export function wranglerConfigPaths(tree: WorkerTree): string[] {
  return Object.keys(tree.mains).filter((path) => CONFIG_PATH.test(path));
}

function starExportLines(source: string): string[] {
  return source.split("\n").filter((line) => STAR_EXPORT.test(line));
}

function pushSegment(out: string[], part: string): void {
  if (part === "" || part === ".") return;
  if (part === "..") out.pop();
  else out.push(part);
}

function posixJoin(left: string, right: string): string {
  const out: string[] = [];
  for (const part of `${left}/${right}`.split("/")) pushSegment(out, part);
  return out.join("/");
}

export function entryPath(configPath: string, main: string): string {
  return posixJoin(configPath.replace(WRANGLER_FILE, ""), main);
}

function entryViolations(configPath: string, tree: WorkerTree): string[] {
  const main = tree.mains[configPath];
  if (main === undefined) return [`${configPath}: missing wrangler main`];
  if (typeof main !== "string") return [`${configPath}: wrangler main is not a string`];
  const entry = entryPath(configPath, main);
  const source = tree.sources[entry];
  if (source === undefined) return [];
  return starExportLines(source).map((line) => `${entry}: ${line.trim()}`);
}

export function starExportViolations(tree: WorkerTree): string[] {
  return wranglerConfigPaths(tree).flatMap((configPath) => entryViolations(configPath, tree));
}

export function discoveryFailures(tree: WorkerTree): string[] {
  if (wranglerConfigPaths(tree).length > 0) return [];
  return ["no wrangler configs under workers/* or apps/*"];
}

export function workerEntryFailures(tree: WorkerTree): string[] {
  return [...discoveryFailures(tree), ...starExportViolations(tree)];
}
