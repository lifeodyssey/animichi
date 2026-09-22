import { describe, expect, it } from "vitest";

/**
 * The dependency rule of `docs/specs/2026-08-06-catalog-clean-architecture-design.md`
 * §3, as a gate instead of a paragraph (§12 "domain 无框架 import").
 *
 * Domain may not reach outward at all; application may depend only on ports it
 * declares itself, never on an adapter, a handler, a data-platform stage, or a
 * framework. Without this test each card lands in whichever layer is nearest —
 * which is how `application/resolve-bangumi.ts` came to import `enrich/parse`.
 *
 * `?raw` inlines every source file at transform time, so by the time this runs
 * inside workerd the tree is string constants and the sandboxed filesystem is
 * never touched (the technique `worker-entry-exports.worker.test.ts` uses).
 *
 * `src/types.ts` is deliberately absent from both lists: it is the type-only,
 * import-free mirror of the contract, erased at compile time. The last test
 * here holds it to that, so the exemption stays a fact rather than a habit.
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

const LAYER_RULES: readonly LayerRule[] = [
  {
    layer: "src/domain/",
    directories: ["adapters", "api", "enrich", "ingest", "publish", "db", "lib"],
    packages: ["hono", "@orpc", "@prisma", "@animichi/prisma-geography", "cloudflare:"],
  },
  {
    layer: "src/application/",
    directories: ["adapters", "api", "enrich", "ingest", "publish", "db"],
    packages: ["hono", "@prisma", "@animichi/prisma-geography"],
  },
];

/**
 * The quote is CAPTURED and back-referenced rather than spelled, so both quote
 * styles are read and a mismatched pair (`from "x'`) still is not an import.
 * The repository pins no quote style, so a single-quoted specifier is reachable
 * and used to walk past all three of these untouched. The specifier is group 2.
 */
const FROM_CLAUSE = /\bfrom\s+(["'])([^"'\n]+)\1/g;
const SIDE_EFFECT = /^\s*import\s+(["'])([^"'\n]+)\1/gm;
const DYNAMIC = /\bimport\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/** A commented-out line carries no import, whatever it quotes. */
function insideComment(source: string, index: number): boolean {
  const before = source.slice(source.lastIndexOf("\n", index) + 1, index).trimStart();
  return before.startsWith("//") || before.startsWith("*");
}

function matchesOf(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)]
    .filter((match) => !insideComment(source, match.index))
    .map((match) => match[2] ?? "");
}

/** Every module specifier a source file imports, static or dynamic. */
export function importSpecifiers(source: string): string[] {
  return [
    ...matchesOf(source, FROM_CLAUSE),
    ...matchesOf(source, SIDE_EFFECT),
    ...matchesOf(source, DYNAMIC),
  ];
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

const catalogSrc = import.meta.glob<string>("../src/**/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

function catalogTree(): TextTree {
  const tree: Record<string, string> = {};
  for (const [key, text] of Object.entries(catalogSrc)) {
    tree[key.replace(/^\.\.\//, "")] = text;
  }
  return tree;
}

describe("dependency rule detection", () => {
  it("flags a domain file reaching into an outward src directory", () => {
    expect(dependencyRuleViolations({
      "src/domain/itinerary/plan.ts": 'import { x } from "../../lib/transit/constants";\n',
    })).toEqual(["src/domain/itinerary/plan.ts: ../../lib/transit/constants"]);
  });

  it("flags a domain file importing a framework, including a multi-line clause", () => {
    expect(dependencyRuleViolations({
      "src/domain/plan.ts": 'import type {\n  SqlOrmPlan,\n} from "@prisma/orm-postgres/relational-core/types";\n',
      "src/domain/client.ts": 'import postgresServerless from "@prisma/orm-postgres/serverless";\n',
      "src/domain/point.ts": 'import { geographyPoint } from "@animichi/prisma-geography";\n',
      "src/domain/http.ts": 'import { Hono } from "hono";\n',
    })).toEqual([
      "src/domain/plan.ts: @prisma/orm-postgres/relational-core/types",
      "src/domain/client.ts: @prisma/orm-postgres/serverless",
      "src/domain/point.ts: @animichi/prisma-geography",
      "src/domain/http.ts: hono",
    ]);
  });

  it("flags an application file importing an adapter, side-effect or dynamic", () => {
    expect(dependencyRuleViolations({
      "src/application/a.ts": 'import "../adapters/outbound/overview-points";\n',
      "src/application/b.ts": 'const m = await import("../db/prisma");\n',
    })).toEqual([
      "src/application/a.ts: ../adapters/outbound/overview-points",
      "src/application/b.ts: ../db/prisma",
    ]);
  });

  it("allows the inward directions the design grants each layer", () => {
    expect(dependencyRuleViolations({
      "src/domain/itinerary/plan.ts": 'import { haversine } from "../geo";\nimport type { Pacing } from "../../types";\n',
      "src/application/plan-itinerary.ts": 'import { optional } from "../lib/optional";\nimport { MAX } from "@animichi/contract/constants";\n',
      "src/adapters/outbound/route-points.ts": 'import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";\n',
    })).toEqual([]);
  });
});

describe("import spelling", () => {
  /**
   * Separate from the rule above on purpose: these say which spellings the
   * extractor READS, not which directions the layering forbids. Each case here
   * would pass identically under the other quote style — that is the point.
   */
  it("flags a single-quoted specifier in all three import forms", () => {
    expect(dependencyRuleViolations({
      "src/domain/probe.ts": "import { overview } from '../adapters/outbound/overview-points';\n",
      "src/application/a.ts": "import '../adapters/outbound/route-points';\n",
      "src/application/b.ts": "const m = await import('../adapters/outbound/nearby-points');\n",
    })).toEqual([
      "src/domain/probe.ts: ../adapters/outbound/overview-points",
      "src/application/a.ts: ../adapters/outbound/route-points",
      "src/application/b.ts: ../adapters/outbound/nearby-points",
    ]);
  });

  it("reads neither a commented-out import nor a mismatched quote as one", () => {
    expect(dependencyRuleViolations({
      "src/domain/note.ts":
        "// import { overview } from '../adapters/outbound/overview-points';\n"
        + "/**\n * import '../adapters/outbound/route-points';\n */\n"
        + "const unterminated = `from \"../adapters/outbound/nearby-points';\n"
        + "const apostrophe = \"the adapter's own layer owns that import\";\n",
    })).toEqual([]);
  });
});

describe("catalog source tree", () => {
  it("loads every src module as text", () => {
    expect(Object.keys(catalogTree())).toContain("src/domain/itinerary/plan.ts");
  });

  it("keeps domain and application inside the dependency rule", () => {
    expect(dependencyRuleViolations(catalogTree())).toEqual([]);
  });

  it("goes red when a one-time copy of a domain file imports an adapter", () => {
    const copy = {
      ...catalogTree(),
      "src/domain/probe.ts": 'import { probe } from "../adapters/outbound/overview-points";\n',
    };
    expect(dependencyRuleViolations(copy)).toEqual([
      "src/domain/probe.ts: ../adapters/outbound/overview-points",
    ]);
  });

  it("keeps src/types.ts an import-free leaf — the reason domain may mirror wire shapes", () => {
    expect(importSpecifiers(catalogTree()["src/types.ts"] ?? "missing")).toEqual([]);
  });
});
