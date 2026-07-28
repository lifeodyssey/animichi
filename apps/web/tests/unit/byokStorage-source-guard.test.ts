/**
 * Source-level guards for the BYOK storage boundary (issue #284 Task 6,
 * AC1). Deliberately NOT jsdom: under jsdom, `import.meta.url` resolves
 * against the configured jsdom page URL rather than a real `file://` path
 * (vitest.config.ts's `environmentOptions.jsdom.url`), which breaks
 * `node:fs` reads. This file uses the default (node) environment instead.
 *
 * P1 review follow-up: the grep now walks the **entire** `src/` tree instead
 * of two flat directories — the AC says "no component", not "no component in
 * these two folders", and a component anywhere else reaching past
 * `byokStorage.ts` into `sessionStorage` would previously have passed this
 * guard unnoticed. A full-tree recursive `readdirSync` costs single-digit
 * milliseconds on this codebase's `src/` (verified locally), so there is no
 * reason to keep the narrower scan.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const BYOK_STORAGE_RELATIVE = "lib/byok/byokStorage.ts";
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.endsWith(".gen.ts");
}

/** Relative (`dir/file.ts`) paths of every source file under `root`,
 * recursing into subdirectories — the whole `src/` tree, not a flat list. */
function walkSourceFiles(root: string, relativeDir = ""): readonly string[] {
  const absoluteDir = `${root}/${relativeDir}`;
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return walkSourceFiles(root, relativePath);
    return isSourceFile(entry.name) ? [relativePath] : [];
  });
}

function readSource(root: string, relativePath: string): string {
  return readFileSync(`${root}/${relativePath}`, "utf8");
}

function filesUsingSessionStorage(root: string): readonly string[] {
  return walkSourceFiles(root).filter((relativePath) => readSource(root, relativePath).includes("sessionStorage"));
}

describe("no component calls sessionStorage directly for BYOK (AC1 lint-level grep, full src/ tree)", () => {
  it("finds sessionStorage used only inside byokStorage.ts across the whole src/ tree", () => {
    expect(filesUsingSessionStorage(SRC_DIR)).toEqual([BYOK_STORAGE_RELATIVE]);
  });
});

describe("byokStorage.ts never accesses `window` at module (top) scope", () => {
  it("only references `window.` inside function bodies, never at column 0", () => {
    const source = readSource(SRC_DIR, BYOK_STORAGE_RELATIVE);
    const topLevelLines = source.split("\n").filter((line) => !/^\s/.test(line) && !line.startsWith("}"));
    const windowAtTopLevel = topLevelLines.some((line) => line.includes("window."));
    expect(windowAtTopLevel).toBe(false);
  });
});
