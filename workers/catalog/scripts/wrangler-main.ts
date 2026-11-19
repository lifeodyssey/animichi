/**
 * The `main` a wrangler config file declares, for the entry-export check
 * (`check-worker-entry-exports.ts`). Reads the file's lines and takes the first
 * `main` key on a line that is not a whole-line comment.
 */
import { readFileSync } from "node:fs";

const MAIN_TOML = /^main\s*=\s*"([^"]+)"/;
const MAIN_JSON = /"main"\s*:\s*"([^"]+)"/;

function isCommentLine(line: string): boolean {
  return line.startsWith("#") || line.startsWith("//") || (line.startsWith("/*") && line.endsWith("*/"));
}

function mainFromRawLine(raw: string): string | undefined {
  const line = raw.trim();
  if (isCommentLine(line)) return undefined;
  return (MAIN_TOML.exec(line) ?? MAIN_JSON.exec(line))?.[1];
}

/** The `main` the wrangler config at `configFile` declares, if it declares one. */
export function wranglerMain(configFile: string): string | undefined {
  return readFileSync(configFile, "utf8").split("\n").map(mainFromRawLine).find((main) => main !== undefined);
}
