/** workerd treats named entry exports as handlers; star-exports lift non-handler values. */

export type TextTree = Readonly<Record<string, string>>;

const CONFIG_PATH = /^(workers|apps)\/[^/]+\/wrangler\.(toml|jsonc|json)$/;
const STAR_EXPORT = /^\s*export\s+\*/;
const MAIN_TOML = /^main\s*=\s*"([^"]+)"/;
const MAIN_JSON = /"main"\s*:\s*"([^"]+)"/;
const WRANGLER_FILE = /\/wrangler\.(toml|jsonc|json)$/;

function isCommentLine(line: string): boolean {
  return line.startsWith("#") || line.startsWith("//") || (line.startsWith("/*") && line.endsWith("*/"));
}

function mainFromRawLine(raw: string): string | undefined {
  const line = raw.trim();
  if (isCommentLine(line)) return undefined;
  return (MAIN_TOML.exec(line) ?? MAIN_JSON.exec(line))?.[1];
}

export function wranglerMain(text: string): string | undefined {
  return text.split("\n").map(mainFromRawLine).find((main) => main !== undefined);
}

export function wranglerConfigPaths(tree: TextTree): string[] {
  return Object.keys(tree).filter((path) => CONFIG_PATH.test(path));
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

function entryViolations(configPath: string, tree: TextTree): string[] {
  const main = wranglerMain(tree[configPath] ?? "");
  if (main === undefined) return [`${configPath}: missing wrangler main`];
  const entry = entryPath(configPath, main);
  const source = tree[entry];
  if (source === undefined) return [];
  return starExportLines(source).map((line) => `${entry}: ${line.trim()}`);
}

export function starExportViolations(tree: TextTree): string[] {
  return wranglerConfigPaths(tree).flatMap((configPath) => entryViolations(configPath, tree));
}

export function discoveryFailures(tree: TextTree): string[] {
  if (wranglerConfigPaths(tree).length > 0) return [];
  return ["no wrangler configs under workers/* or apps/*"];
}

export function workerEntryFailures(tree: TextTree): string[] {
  return [...discoveryFailures(tree), ...starExportViolations(tree)];
}
