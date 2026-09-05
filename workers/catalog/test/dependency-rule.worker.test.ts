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
    packages: ["hono", "@orpc", "drizzle-orm", "@neondatabase", "cloudflare:"],
  },
  {
    layer: "src/application/",
    directories: ["adapters", "api", "enrich", "ingest", "publish", "db"],
    packages: ["hono", "drizzle-orm"],
  },
];

const FROM_CLAUSE = /\bfrom\s+"([^"]+)"/g;
const SIDE_EFFECT = /^\s*import\s+"([^"]+)"/gm;
const DYNAMIC = /\bimport\(\s*"([^"]+)"\s*\)/g;

function matchesOf(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
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
      "src/domain/geo.ts": 'import type {\n  SQL,\n} from "drizzle-orm";\n',
      "src/domain/neon.ts": 'import { neon } from "@neondatabase/serverless";\n',
    })).toEqual([
      "src/domain/geo.ts: drizzle-orm",
      "src/domain/neon.ts: @neondatabase/serverless",
    ]);
  });

  it("flags an application file importing an adapter, side-effect or dynamic", () => {
    expect(dependencyRuleViolations({
      "src/application/a.ts": 'import "../adapters/outbound/overview-points";\n',
      "src/application/b.ts": 'const m = await import("../db/client");\n',
    })).toEqual([
      "src/application/a.ts: ../adapters/outbound/overview-points",
      "src/application/b.ts: ../db/client",
    ]);
  });

  it("allows the inward directions the design grants each layer", () => {
    expect(dependencyRuleViolations({
      "src/domain/itinerary/plan.ts": 'import { haversine } from "../geo";\nimport type { Pacing } from "../../types";\n',
      "src/application/plan-itinerary.ts": 'import { optional } from "../lib/optional";\nimport { MAX } from "@animichi/contract/constants";\n',
      "src/adapters/outbound/route-points.ts": 'import { sql } from "drizzle-orm";\n',
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
