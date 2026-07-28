/**
 * Source-level guards for the BYOK storage boundary (issue #284 Task 6,
 * AC1). Deliberately NOT jsdom: under jsdom, `import.meta.url` resolves
 * against the configured jsdom page URL rather than a real `file://` path
 * (vitest.config.ts's `environmentOptions.jsdom.url`), which breaks
 * `node:fs` reads. This file uses the default (node) environment instead.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BYOK_DIR = fileURLToPath(new URL("../../src/lib/byok/", import.meta.url));
const CHAT_COMPONENTS_DIR = fileURLToPath(new URL("../../src/features/chat/components/", import.meta.url));

/** File names (not full paths) under a directory, non-recursive — every
 * BYOK-adjacent source file lives flat in these two directories today. */
function fileNamesIn(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function readSource(dir: string, name: string): string {
  return readFileSync(`${dir}/${name}`, "utf8");
}

function sourceFilesUsingSessionStorage(dir: string): readonly string[] {
  return fileNamesIn(dir).filter((name) => readSource(dir, name).includes("sessionStorage"));
}

describe("no component calls sessionStorage directly for BYOK (AC1 lint-level grep)", () => {
  it("finds sessionStorage used only inside byokStorage.ts, not in any BYOK-lib sibling", () => {
    expect(sourceFilesUsingSessionStorage(BYOK_DIR)).toEqual(["byokStorage.ts"]);
  });

  it("finds no direct sessionStorage usage among the chat components directory", () => {
    // ByokSettings.tsx / ChatInput.tsx land here in the UI half of Task 6;
    // this guard holds today (the directory has no BYOK files yet) and must
    // keep holding once they land — a component reaching past byokStorage
    // straight into sessionStorage would fail this test immediately.
    expect(sourceFilesUsingSessionStorage(CHAT_COMPONENTS_DIR)).toEqual([]);
  });
});

describe("byokStorage.ts never accesses `window` at module (top) scope", () => {
  it("only references `window.` inside function bodies, never at column 0", () => {
    const source = readSource(BYOK_DIR, "byokStorage.ts");
    const topLevelLines = source.split("\n").filter((line) => !/^\s/.test(line) && !line.startsWith("}"));
    const windowAtTopLevel = topLevelLines.some((line) => line.includes("window."));
    expect(windowAtTopLevel).toBe(false);
  });
});
