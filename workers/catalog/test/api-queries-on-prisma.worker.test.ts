import { describe, expect, it } from "vitest";

/**
 * The `src/api` batch reads through the Prisma plane (#1631, spec §4.2).
 *
 * The query layer moved a batch at a time, so what has to hold is a property of
 * the API layer's own tree rather than of any one behaviour: a handler that kept
 * a Drizzle statement behind its plan would still pass every wire test that
 * hands it rows, and the failure would only show as a second query path in
 * production. The tree is therefore read as text — the `?raw` glob technique
 * `dependency-rule.worker.test.ts` and `prisma-connection.worker.test.ts` use,
 * so the assertions hold inside workerd's sandboxed filesystem.
 *
 * What this rule does NOT forbid: `import type { CatalogDb } from "../db/client"`
 * in `src/api/search.ts`, `src/api/work-points.ts` and `src/router.ts`. That is
 * the Drizzle SEAM's type — erased at compile time, naming the ingest dependency
 * these factories hand on (#1630 converts it), never a statement. The query
 * builder is the thing this batch stopped reaching for.
 */
const QUERY_BUILDER = "drizzle-orm";

/** The batch this card owns: the read handlers and the router that wires them. */
const BATCH = ["src/api/", "src/router.ts"];

type TextTree = Readonly<Record<string, string>>;

const FROM_CLAUSE = /\bfrom\s+"([^"]+)"/g;
const SIDE_EFFECT = /^\s*import\s+"([^"]+)"/gm;
const DYNAMIC = /\bimport\(\s*"([^"]+)"\s*\)/g;

const catalogSrc = import.meta.glob<string>("../src/**/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

/** The `src/…` tree, with the glob's `../` prefix stripped. */
function catalogTree(): TextTree {
  const tree: Record<string, string> = {};
  for (const [key, text] of Object.entries(catalogSrc)) {
    tree[key.replace(/^\.\.\//, "")] = text;
  }
  return tree;
}

/** Every module specifier a source file imports, static or dynamic. */
function importSpecifiers(source: string): string[] {
  return [FROM_CLAUSE, SIDE_EFFECT, DYNAMIC].flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function inBatch(path: string): boolean {
  return BATCH.some((prefix) => path.startsWith(prefix));
}

/** The batch modules in `tree` that import the Drizzle query builder. */
export function queryBuilderImporters(tree: TextTree): string[] {
  return Object.entries(tree)
    .filter(([path, source]) =>
      inBatch(path) && importSpecifiers(source).some((specifier) => specifier.startsWith(QUERY_BUILDER)))
    .map(([path]) => path)
    .sort();
}

describe("the src/api batch imports no Drizzle query builder (#1631)", () => {
  it("reaches for the Prisma plane and nothing else", () => {
    expect(queryBuilderImporters(catalogTree())).toEqual([]);
  });

  it("reads the batch's own tree, not an empty one", () => {
    expect(Object.keys(catalogTree())).toContain("src/api/search.ts");
    expect(Object.keys(catalogTree())).toContain("src/router.ts");
  });

  it("goes red when a batch module imports the query builder, however it is spelled", () => {
    expect(queryBuilderImporters({
      ...catalogTree(),
      "src/api/probe.ts": 'import { sql } from "drizzle-orm";\n',
      "src/api/lazy-probe.ts": 'const m = await import("drizzle-orm/neon-http");\n',
      "src/adapters/outbound/kept.ts": 'import { eq } from "drizzle-orm";\n',
    })).toEqual(["src/api/lazy-probe.ts", "src/api/probe.ts"]);
  });
});
