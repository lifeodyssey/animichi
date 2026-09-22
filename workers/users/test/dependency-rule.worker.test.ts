import { describe, expect, it } from "vitest";

/**
 * The users worker's dependency rule, as a gate instead of a paragraph.
 *
 * This service has had `domain/`, `application/` and `adapters/` since it was
 * written, and no test holding them apart — the gap `docs/specs/2026-09-12-
 * prisma8-database-layer-spec.md` §4.10 names. It closes here because #1633
 * rewrote the layer the rule is mostly about: the moment the adapters change is
 * the cheapest moment to pin which direction they may be reached from.
 *
 * Domain may not reach outward at all; application may depend only on the ports
 * it declares itself, never on an adapter, the database seam, or a framework.
 * Both directions are asserted: a rule that flagged the legitimate shape as well
 * as the violation would not be a guard, it would be an obstacle.
 *
 * `?raw` inlines every source file at transform time, so by the time this runs
 * inside workerd the tree is string constants and the sandboxed filesystem is
 * never touched — the technique `workers/catalog`'s own dependency-rule test
 * uses, and the reason this is a worker test rather than a Node one.
 *
 * The rule ENGINE below mirrors that catalog test rather than sharing with it:
 * the two are separate pnpm packages with their own vitest pools, and neither
 * can import the other's test tree. Extracting it would be a workspace package
 * of its own, which this card did not open.
 */

type TextTree = Readonly<Record<string, string>>;

interface LayerRule {
  /** Path prefix of the layer the rule governs. */
  layer: string;
  /** `src/` directories the layer may not import from. */
  directories: readonly string[];
  /** Bare module specifiers (prefix match) the layer may not import. */
  packages: readonly string[];
}

/**
 * `@animichi/contract` is deliberately absent from both lists: it is the shared
 * wire contract, the one outward name a domain type may be stated in, and every
 * module in both layers already names it.
 */
const LAYER_RULES: readonly LayerRule[] = [
  {
    layer: "src/domain/",
    directories: ["adapters", "application", "db", "lib"],
    packages: ["hono", "@orpc", "@prisma", "@animichi/prisma-geography", "pg", "jose", "cloudflare:"],
  },
  {
    layer: "src/application/",
    directories: ["adapters", "db"],
    packages: ["hono", "@orpc", "@prisma", "@animichi/prisma-geography", "pg", "jose"],
  },
];

const FROM_CLAUSE = /\bfrom\s+"([^"]+)"/g;
const SIDE_EFFECT = /^\s*import\s+"([^"]+)"/gm;
const DYNAMIC = /\bimport\(\s*"([^"]+)"\s*\)/g;

/** Every module specifier a source file imports, static or dynamic. */
export function importSpecifiers(source: string): string[] {
  return [FROM_CLAUSE, SIDE_EFFECT, DYNAMIC].flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

/** Resolve a relative specifier against the importing file's directory. */
function resolveSpecifier(importer: string, specifier: string): string {
  const parts = importer.split("/").slice(0, -1).concat(specifier.split("/"));
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function breaksRule(rule: LayerRule, importer: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return rule.packages.some((name) => specifier.startsWith(name));
  }
  const target = resolveSpecifier(importer, specifier);
  return rule.directories.some((dir) => target.startsWith(`src/${dir}/`));
}

function fileViolations(rule: LayerRule, path: string, source: string): string[] {
  return importSpecifiers(source)
    .filter((specifier) => breaksRule(rule, path, specifier))
    .map((specifier) => `${path}: ${specifier}`);
}

/** Every import in `tree` that breaks the dependency rule, as `path: specifier`. */
export function dependencyRuleViolations(tree: TextTree): string[] {
  return LAYER_RULES.flatMap((rule) =>
    Object.entries(tree)
      .filter(([path]) => path.startsWith(rule.layer))
      .flatMap(([path, source]) => fileViolations(rule, path, source)),
  );
}

const usersSrc = import.meta.glob<string>("../src/**/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

function usersTree(): TextTree {
  const tree: Record<string, string> = {};
  for (const [key, text] of Object.entries(usersSrc)) {
    tree[key.replace(/^\.\.\//, "")] = text;
  }
  return tree;
}

describe("dependency rule detection", () => {
  it("flags a domain file reaching into an outward src directory", () => {
    expect(dependencyRuleViolations({
      "src/domain/ownership.ts": 'import { readOwner } from "../adapters/neon-saved-route-repo";\n',
    })).toEqual(["src/domain/ownership.ts: ../adapters/neon-saved-route-repo"]);
  });

  it("flags a domain file importing a data-access package, including a multi-line clause", () => {
    expect(dependencyRuleViolations({
      "src/domain/plan.ts": 'import type {\n  SqlOrmPlan,\n} from "@prisma/orm-postgres/relational-core/types";\n',
      "src/domain/client.ts": 'import postgresServerless from "@prisma/orm-postgres/serverless";\n',
      "src/domain/point.ts": 'import { geographyPoint } from "@animichi/prisma-geography";\n',
      "src/domain/pool.ts": 'import pg from "pg";\n',
    })).toEqual([
      "src/domain/plan.ts: @prisma/orm-postgres/relational-core/types",
      "src/domain/client.ts: @prisma/orm-postgres/serverless",
      "src/domain/point.ts: @animichi/prisma-geography",
      "src/domain/pool.ts: pg",
    ]);
  });

  it("flags an application file importing the seam, side-effect or dynamic", () => {
    expect(dependencyRuleViolations({
      "src/application/a.ts": 'import "../adapters/neon-idempotency-store";\n',
      "src/application/b.ts": 'const m = await import("../db/prisma");\n',
    })).toEqual([
      "src/application/a.ts: ../adapters/neon-idempotency-store",
      "src/application/b.ts: ../db/prisma",
    ]);
  });

  it("allows the inward directions the layering grants each layer", () => {
    expect(dependencyRuleViolations({
      "src/domain/saved-route-status.ts": 'import type { SavedRouteStatus } from "@animichi/contract";\n',
      "src/application/save-saved-route.ts":
        'import type { SavedRoute } from "@animichi/contract";\n'
        + 'import { isSavedRouteStatus } from "../domain/saved-route-status";\n'
        + 'import { conflict } from "../lib/errors";\n',
      "src/adapters/neon-saved-route-repo.ts": 'import type { UsersPrisma } from "../db/prisma";\n',
    })).toEqual([]);
  });
});

describe("users source tree", () => {
  it("loads every src module as text", () => {
    expect(Object.keys(usersTree())).toContain("src/domain/ownership.ts");
    expect(Object.keys(usersTree())).toContain("src/application/save-saved-route.ts");
  });

  it("keeps domain and application inside the dependency rule", () => {
    expect(dependencyRuleViolations(usersTree())).toEqual([]);
  });

  it("goes red when a one-time copy of a domain module imports an adapter", () => {
    const copy = {
      ...usersTree(),
      "src/domain/probe.ts": 'import { probe } from "../adapters/neon-saved-route-repo";\n',
    };
    expect(dependencyRuleViolations(copy)).toEqual([
      "src/domain/probe.ts: ../adapters/neon-saved-route-repo",
    ]);
  });
});
