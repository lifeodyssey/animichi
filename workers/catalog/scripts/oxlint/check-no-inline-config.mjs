import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const EXCLUDED = new Set([".git", ".wrangler", "coverage", "dist", "node_modules"]);
const PREFIXES = ["eslint", "oxlint"].join("|");
const DIRECTIVE = new RegExp(`(?:\\/\\/|\\/\\*)\\s*(?:${PREFIXES})-(?:disable|enable)(?:-next-line|-line)?\\b`, "gu");
const LEGACY_FILE = "test/catalog-api.spike.test.ts";
const LEGACY_LINE = ["// eslint", "disable-next-line @typescript-eslint/no-non-null-assertion -- test data known to exist"].join("-");

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

/** @param {string} text @param {number} index */
function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

/** @param {string} file @returns {string[]} */
function inlineConfigFailures(file) {
  const text = readFileSync(file, "utf8");
  const name = relative(ROOT, file).replaceAll("\\", "/");
  let legacyAllowed = false;
  return [...text.matchAll(DIRECTIVE)].flatMap((match) => {
    if (!legacyAllowed && name === LEGACY_FILE && lineAt(text, match.index) === LEGACY_LINE) {
      legacyAllowed = true;
      return [];
    }
    const line = text.slice(0, match.index).split("\n").length;
    return [`${name}:${String(line)}: inline lint configuration is forbidden`];
  });
}

const failures = sourceFiles(ROOT).flatMap(inlineConfigFailures);
for (const failure of failures) process.stderr.write(`${failure}\n`);
if (failures.length > 0) process.exitCode = 1;
