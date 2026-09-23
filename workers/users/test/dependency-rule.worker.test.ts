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
 * registers `"/v1/users/*"`, and reading that as an opener costs this package
 * its own `export type { UsersRouter } from "./router"` — measured, on this tree.
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
  return [FROM_CLAUSE, SIDE_EFFECT, DYNAMIC].flatMap((pattern) =>
    [...source.matchAll(pattern)]
      .filter((match) => !insideComment(source, match.index, blocks))
      .map((match) => match[2] ?? ""));
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

describe("import spelling", () => {
  /**
   * Separate from the rule above on purpose: these say which spellings the
   * extractor READS, not which directions the layering forbids. Each case here
   * would pass identically under the other quote style — that is the point.
   */
  it("flags a single-quoted specifier in all three import forms", () => {
    expect(dependencyRuleViolations({
      "src/domain/ownership.ts": "import { usersPrisma } from '../db/prisma';\n",
      "src/application/a.ts": "import '../adapters/neon-idempotency-store';\n",
      "src/application/b.ts": "const m = await import('../db/prisma');\n",
    })).toEqual([
      "src/domain/ownership.ts: ../db/prisma",
      "src/application/a.ts: ../adapters/neon-idempotency-store",
      "src/application/b.ts: ../db/prisma",
    ]);
  });

  it("reads neither a commented-out import nor a mismatched quote as one", () => {
    expect(dependencyRuleViolations({
      "src/domain/note.ts":
        "// import { usersPrisma } from '../db/prisma';\n"
        + "/**\n * import '../adapters/neon-idempotency-store';\n */\n"
        + "const unterminated = `from \"../db/prisma';\n"
        + "const apostrophe = \"the adapter's own layer owns that import\";\n",
    })).toEqual([]);
  });

  it("reads a bare line inside a block comment as comment, not import", () => {
    expect(dependencyRuleViolations({
      "src/domain/note.ts": "/*\nimport { usersPrisma } from '../db/prisma';\n*/\n",
    })).toEqual([]);
  });

  /**
   * `src/index.ts` registers the route glob `"/v1/users/*"`, whose last two
   * characters spell a block-comment opener. Read as one it opens a comment
   * nothing closes, and `index.ts`'s own
   * `export type { UsersRouter } from "./router"` stops being read — measured.
   * An opener therefore counts only at the start of a line; this case holds it.
   */
  it("reads an import that follows a route glob ending in a comment opener", () => {
    expect(dependencyRuleViolations({
      "src/application/list.ts":
        'app.use("/v1/users/*", usersV1Guard);\n'
        + 'import { usersPrisma } from "../db/prisma";\n',
    })).toEqual(["src/application/list.ts: ../db/prisma"]);
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
