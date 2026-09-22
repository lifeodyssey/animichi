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

interface CommentSpan {
  /** Index of the block's opener. */
  readonly start: number;
  /** Index just past its closer, or end of file when nothing closes it. */
  readonly end: number;
}

/** The text between the start of `index`'s own line and `index` itself. */
function linePrefix(source: string, index: number): string {
  return source.slice(source.lastIndexOf("\n", index) + 1, index);
}

/** The block an opener at `open` spans; an unterminated one runs to end of file, as tsc reads it. */
function blockCommentFrom(source: string, open: number): CommentSpan {
  const close = source.indexOf("*/", open + 2);
  return { start: open, end: close === -1 ? source.length : close + 2 };
}

/**
 * Where every block comment runs. An opener counts only at the start of its own
 * line, because a route glob ends in the same two characters: `src/index.ts`
 * registers `"/catalog/public/*"` and `"/catalog/*"`, and reading one as an
 * opener with no closer after it costs every import below. `workers/users` was
 * measured losing its own `export type { UsersRouter }` exactly that way.
 */
function blockCommentSpans(source: string): readonly CommentSpan[] {
  const spans: CommentSpan[] = [];
  let open = source.indexOf("/*");
  while (open !== -1) {
    const atLineStart = linePrefix(source, open).trim() === "";
    const block = atLineStart ? blockCommentFrom(source, open) : undefined;
    if (block) spans.push(block);
    open = source.indexOf("/*", block?.end ?? open + 2);
  }
  return spans;
}

/**
 * Whether `index` sits in a comment: inside a block, on a `//` line, or on a
 * block's `*` continuation line. A well-formed block subsumes the last one, but
 * it stays — a string literal carrying a closer ends a block early, and the
 * continuation lines below it must still not be read as code. That keeps this a
 * superset of the line-only filter it replaces, never a swap for it.
 */
function insideComment(source: string, index: number, blocks: readonly CommentSpan[]): boolean {
  if (blocks.some((block) => index >= block.start && index < block.end)) return true;
  const before = linePrefix(source, index).trimStart();
  return before.startsWith("//") || before.startsWith("*");
}

function matchesOf(source: string, pattern: RegExp, blocks: readonly CommentSpan[]): string[] {
  return [...source.matchAll(pattern)]
    .filter((match) => !insideComment(source, match.index, blocks))
    .map((match) => match[2] ?? "");
}

/**
 * Every module specifier a source file imports, static or dynamic.
 *
 * A regex over text, not a parser, so three shapes are read wrong — and all
 * three err toward reporting an import that is not there, never toward missing
 * one, which is the only direction that would weaken the gate: a string literal
 * shaped like an import counts (`const s = "from '../db/prisma'"`); a block
 * comment opened mid-line is not read as a comment at all; and a string carrying
 * a closer ends its block early, so the rest of that block is read as code.
 */
export function importSpecifiers(source: string): string[] {
  const blocks = blockCommentSpans(source);
  return [
    ...matchesOf(source, FROM_CLAUSE, blocks),
    ...matchesOf(source, SIDE_EFFECT, blocks),
    ...matchesOf(source, DYNAMIC, blocks),
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

  it("reads a bare line inside a block comment as comment, not import", () => {
    expect(dependencyRuleViolations({
      "src/domain/note.ts":
        "/*\nimport { overview } from '../adapters/outbound/overview-points';\n*/\n",
    })).toEqual([]);
  });

  /**
   * `src/index.ts` registers two route globs whose last two characters spell a
   * block-comment opener — `"/catalog/public/*"` and `"/catalog/*"`. Read as
   * one, an opener with no closer after it stops every import below from being
   * read; `workers/users/src/index.ts` loses one that way. An opener therefore
   * counts only at the start of a line; this case is what holds it there.
   */
  it("reads an import that follows a route glob ending in a comment opener", () => {
    expect(dependencyRuleViolations({
      "src/application/plan.ts":
        'app.use("/catalog/public/*", cacheHeaders);\n'
        + 'import { prisma } from "../db/prisma";\n',
    })).toEqual(["src/application/plan.ts: ../db/prisma"]);
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
