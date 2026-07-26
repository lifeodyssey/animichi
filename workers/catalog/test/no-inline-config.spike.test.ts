import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inlineConfigViolations } from "../scripts/oxlint/check-no-inline-config";

/**
 * Guards the zero-suppression rule itself (issue #302).
 *
 * `check-no-inline-config` used to carve out one grandfathered
 * `no-non-null-assertion` suppression in `catalog-api.spike.test.ts`. That
 * carve-out is gone, and these tests lock it out: the previously exempt line is
 * now a violation like any other, so a suppression cannot re-enter the worker.
 *
 * Directive text is assembled at runtime — a literal would make this very file
 * trip the guard it tests. Pure filesystem work, hence the Node spike pool.
 */

const DISABLE_NEXT_LINE = ["// eslint", "disable-next-line"].join("-");
const LEGACY_SUPPRESSION = `${DISABLE_NEXT_LINE} @typescript-eslint/no-non-null-assertion -- test data known to exist`;
const BLOCK_DISABLE = ["/* oxlint", "disable */"].join("-");

let root: string;

function write(relativePath: string, contents: string): void {
  const target = join(root, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "no-inline-config-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("inlineConfigViolations", () => {
  it("reports the formerly grandfathered suppression in catalog-api.spike.test.ts", () => {
    write("test/catalog-api.spike.test.ts", `const a = 1;\n${LEGACY_SUPPRESSION}\nexport { a };\n`);
    expect(inlineConfigViolations(root)).toEqual(["test/catalog-api.spike.test.ts:2: inline lint configuration is forbidden"]);
  });

  it("reports that same suppression once per occurrence, with no first-use exemption", () => {
    write("test/catalog-api.spike.test.ts", `${LEGACY_SUPPRESSION}\n${LEGACY_SUPPRESSION}\n`);
    expect(inlineConfigViolations(root)).toHaveLength(2);
  });

  it("passes on a tree with no inline directives", () => {
    write("src/lib/route.ts", "export const total = (n: number): number => n + 1;\n");
    expect(inlineConfigViolations(root)).toEqual([]);
  });

  it("reports block-comment and oxlint-prefixed directives", () => {
    write("src/index.ts", `${BLOCK_DISABLE}\nexport const x = 1;\n`);
    expect(inlineConfigViolations(root)).toEqual(["src/index.ts:1: inline lint configuration is forbidden"]);
  });

  it("reports directives in any source file, not only the legacy path", () => {
    write("src/lib/clustering.ts", `const a = 1;\n\n${LEGACY_SUPPRESSION}\nexport { a };\n`);
    expect(inlineConfigViolations(root)).toEqual(["src/lib/clustering.ts:3: inline lint configuration is forbidden"]);
  });

  it("ignores vendored and non-source files", () => {
    write("node_modules/pkg/index.ts", `${LEGACY_SUPPRESSION}\n`);
    write("docs/notes.md", `${LEGACY_SUPPRESSION}\n`);
    expect(inlineConfigViolations(root)).toEqual([]);
  });
});
