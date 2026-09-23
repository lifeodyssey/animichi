import { describe, expect, it } from "vitest";

/**
 * The `src/api` batch opens no query path of its own (#1631, #1633).
 *
 * The query layer moved a batch at a time, so what has to hold is a property of
 * the API layer's own tree rather than of any one behaviour: a handler that kept
 * a query path behind its plan would still pass every wire test that hands it
 * rows, and the failure would only show as a second connection in production.
 * The tree is therefore read as text — the `?raw` glob technique
 * `dependency-rule.worker.test.ts` and `prisma-connection.worker.test.ts` use,
 * so the assertions hold inside workerd's sandboxed filesystem.
 *
 * Until #1633 this rule was stated as "no Drizzle query builder". That string
 * cannot appear anywhere now, so a rule about it would pass whatever the code
 * did. What it is really about survives the dependency swap: `src/db/prisma.ts`
 * is the ONE construction site (its own module docblock says so), and a batch
 * module that reached a driver directly would be a second one.
 *
 * What this rule does NOT forbid: `import type { SqlOrmPlan } from
 * "@prisma/orm-postgres/relational-core/types"`, which `src/api/search.ts` and
 * `src/api/spots.ts` carry. That is the plan's TYPE — erased at compile time,
 * naming what the seam hands back — never a client. Constructing one is the
 * thing this batch stopped reaching for.
 */

/**
 * The specifiers that OPEN a connection. Each is matched as a whole module or a
 * parent of one, never as a bare prefix: `@prisma/orm-postgres/serverless` must
 * not also catch `@prisma/orm-postgres/relational-core/types`, and `pg` must not
 * catch `pg-error-enum`.
 */
const DRIVER_ENTRIES = [
  "@prisma/orm-postgres/serverless",
  "@neondatabase/serverless",
  "pg",
];

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

/** Whether a specifier IS a driver entry, or lives beneath one. */
function isDriverEntry(specifier: string): boolean {
  return DRIVER_ENTRIES.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`));
}

/** The batch modules in `tree` that reach a database driver directly. */
export function driverImporters(tree: TextTree): string[] {
  return Object.entries(tree)
    .filter(([path, source]) => inBatch(path) && importSpecifiers(source).some(isDriverEntry))
    .map(([path]) => path)
    .sort();
}

describe("the src/api batch constructs no database client (#1631, #1633)", () => {
  it("reaches the plane through the seam and nothing else", () => {
    expect(driverImporters(catalogTree())).toEqual([]);
  });

  it("reads the batch's own tree, not an empty one", () => {
    expect(Object.keys(catalogTree())).toContain("src/api/search.ts");
    expect(Object.keys(catalogTree())).toContain("src/router.ts");
  });

  it("goes red when a batch module reaches a driver, however it is spelled", () => {
    expect(driverImporters({
      ...catalogTree(),
      "src/api/probe.ts": 'import postgresServerless from "@prisma/orm-postgres/serverless";\n',
      "src/api/lazy-probe.ts": 'const m = await import("pg");\n',
      "src/api/neon-probe.ts": 'import { neon } from "@neondatabase/serverless";\n',
      "src/adapters/outbound/kept.ts": 'import pg from "pg";\n',
    })).toEqual(["src/api/lazy-probe.ts", "src/api/neon-probe.ts", "src/api/probe.ts"]);
  });

  it("allows the plan TYPE the handlers actually import", () => {
    expect(driverImporters({
      "src/api/search.ts": 'import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";\n',
      "src/api/spots.ts": 'import type { CatalogPrisma } from "../db/prisma";\n',
    })).toEqual([]);
  });
});
