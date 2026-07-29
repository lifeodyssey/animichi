import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bans inline lint configuration anywhere in workers/catalog (issue #302).
 *
 * No file is exempt and no directive is grandfathered: if a rule fires, the code
 * gets fixed. Runs ahead of oxlint in `pnpm run lint:oxlint`.
 */

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "../..");
const EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const EXCLUDED = new Set([".git", ".wrangler", "coverage", "dist", "node_modules"]);
const PREFIXES = ["eslint", "oxlint"].join("|");
const DIRECTIVE = new RegExp(`(?:\\/\\/|\\/\\*)\\s*(?:${PREFIXES})-(?:disable|enable)(?:-next-line|-line)?\\b`, "gu");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (EXCLUDED.has(entry.name)) return [];
    if (entry.isDirectory()) return sourceFiles(path);
    return EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

function inlineConfigFailures(file: string, root: string): string[] {
  const text = readFileSync(file, "utf8");
  const name = relative(root, file).replaceAll("\\", "/");
  return [...text.matchAll(DIRECTIVE)].map((match) => {
    const line = text.slice(0, match.index).split("\n").length;
    return `${name}:${String(line)}: inline lint configuration is forbidden`;
  });
}

/** Every inline lint directive under `root`; an empty list is the only passing state. */
export function inlineConfigViolations(root: string): string[] {
  return sourceFiles(root).flatMap((file) => inlineConfigFailures(file, root));
}

function main(): void {
  const failures = inlineConfigViolations(ROOT);
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === SELF) main();
