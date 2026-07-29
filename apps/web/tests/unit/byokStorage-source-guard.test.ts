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
 *
 * #463 rebase follow-up: a bare substring match false-positived on
 * `deferredSave.ts`, whose doc comment *describes* `sessionStorage`
 * (explaining why the P5 deferred-save feature deliberately does NOT use it)
 * without ever touching the API. Comments are stripped before matching so
 * only real usage counts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const BYOK_STORAGE_RELATIVE = "lib/byok/byokStorage.ts";
/**
 * #282 rebase follow-up: the rule the AC states is "no *component* calls
 * `sessionStorage` directly" — the boundary, not the single file. The D12
 * composer draft is a second, non-secret tab-local value, so it gets its own
 * storage module under the same discipline rather than a component reaching
 * for the API. Adding a module here is a deliberate review decision; adding a
 * *component* to this list would gut the guard.
 */
const CHAT_DRAFT_STORAGE_RELATIVE = "lib/chat/draftStorage.ts";
const STORAGE_MODULES = [BYOK_STORAGE_RELATIVE, CHAT_DRAFT_STORAGE_RELATIVE];
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

/** Strips `/** ... *\/` block comments and `//` line comments — a doc
 * comment merely *mentioning* `sessionStorage` (e.g. to explain why a
 * feature avoids it) must not count as usage. Naive w.r.t. `//` inside a
 * string literal, an acceptable trade-off for this narrow guard. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

function filesUsingSessionStorage(root: string): readonly string[] {
  return walkSourceFiles(root).filter((relativePath) =>
    withoutComments(readSource(root, relativePath)).includes("sessionStorage"),
  );
}

describe("no component calls sessionStorage directly (AC1 lint-level grep, full src/ tree)", () => {
  it("finds sessionStorage only inside the dedicated storage modules", () => {
    expect([...filesUsingSessionStorage(SRC_DIR)].sort()).toEqual([...STORAGE_MODULES].sort());
  });

  it("keeps every allowed file in lib/, so no component can be added to the list", () => {
    for (const module of STORAGE_MODULES) expect(module.startsWith("lib/")).toBe(true);
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
