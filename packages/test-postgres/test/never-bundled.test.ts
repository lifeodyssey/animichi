/**
 * This package is test-only, and "test-only" has to be provable (#1326).
 *
 * It pulls in `testcontainers` and `pg`, neither of which can run on workerd,
 * so one value import from a deployed source would break the bundle — the same
 * failure class `packages/contract/test/import-free-modules.test.ts` guards for
 * zod. A `bundle-smoke`-style gate would prove nothing here: the package is
 * never in a bundle to smoke. The proof is the absence, on the line that would
 * cause it.
 *
 * The scan covers all four shapes a module can be loaded by, not just
 * `… from "…"`: a side-effect `import "x";` carries no `from` clause, and
 * `import("x")` / `require("x")` are calls. `import type` is allowed — the
 * compiler erases it, so it reaches no bundle.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const PACKAGE_NAME = "@animichi/test-postgres";

/** A package that depends on it: where its sources live and the test
 * directory that actually does the loading. */
interface Consumer {
  readonly directory: string;
  readonly testOnlyPath: string;
}

const CONSUMERS: Consumer[] = [
  { directory: "workers/catalog", testOnlyPath: "workers/catalog/test/" },
  { directory: "workers/edge", testOnlyPath: "workers/edge/agent-db-test/" },
];

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function manifestOf(consumer: Consumer): PackageManifest {
  return JSON.parse(read(`${consumer.directory}/package.json`)) as PackageManifest;
}

/** The directory a Worker's bundle is built from: everything `main` reaches.
 * `.github/ci/components.json` used to carry a `deploy_excludes` list; #1359
 * retired the manifest, and the Worker's own `main` is the real boundary. */
function bundleRootOf(consumer: Consumer): string {
  const wrangler = read(`${consumer.directory}/wrangler.toml`);
  const main = /^main\s*=\s*"([^"]+)"/m.exec(wrangler)?.[1] ?? "";
  const [entryDirectory] = main.split("/");
  assert.ok(entryDirectory, `${consumer.directory}/wrangler.toml declares no main`);
  return `${consumer.directory}/${entryDirectory}/`;
}

/** The workspace globs that make this package a project rather than a
 * published dependency, so `workspace:*` can resolve it. */
function workspaceGlobs(): string[] {
  return read("pnpm-workspace.yaml")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- "))
    .map((line) => line.trim().slice(2).replaceAll('"', ""));
}

/** `import … from "x"` and `export … from "x"`, `type` forms excluded. */
const FROM_LOAD = /^[ \t]*(?:import|export)\s+(?!type[\s{*])[^;]*?\bfrom\s*["']([^"']+)["']/gm;
/** `import "x";` — the side-effect form, which has no `from` clause. */
const SIDE_EFFECT_LOAD = /^[ \t]*import\s*["']([^"']+)["']/gm;
/** `import("x")` and `require("x")` — the call forms, at any depth. */
const CALL_LOAD = /\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;

/** Every module this source loads when it is evaluated. */
function runtimeImports(source: string): string[] {
  return [FROM_LOAD, SIDE_EFFECT_LOAD, CALL_LOAD].flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ""),
  );
}

function typescriptSources(directory: string): string[] {
  return readdirSync(new URL(`${directory}/`, ROOT), { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => `${directory}/${entry}`);
}

function bundledLoadersIn(consumer: Consumer): string[] {
  return typescriptSources(`${consumer.directory}/src`).filter((source) =>
    runtimeImports(read(source)).some((loaded) => loaded.startsWith(PACKAGE_NAME)),
  );
}

void test("both consumers declare it as a devDependency, never a dependency", () => {
  for (const consumer of CONSUMERS) {
    const manifest = manifestOf(consumer);
    assert.ok(manifest.devDependencies?.[PACKAGE_NAME], consumer.directory);
    assert.equal(manifest.dependencies?.[PACKAGE_NAME], undefined, consumer.directory);
  }
});

/** The emptiness only means something once the scan is known to have read
 * something: a broken directory walk would report the same green. */
void test("no deployed source loads it", () => {
  for (const consumer of CONSUMERS) {
    assert.ok(typescriptSources(`${consumer.directory}/src`).length > 0, consumer.directory);
    assert.deepEqual(bundledLoadersIn(consumer), [], consumer.directory);
  }
});

void test("the directories that do load it are outside every Worker bundle", () => {
  for (const consumer of CONSUMERS) {
    assert.ok(!consumer.testOnlyPath.startsWith(bundleRootOf(consumer)), consumer.directory);
  }
});

/** The `workspace:*` devDependency above only means "test-only" while the
 * package is a workspace project; published, it would be an ordinary dep. */
void test("it is a workspace project, not a published dependency", () => {
  assert.ok(workspaceGlobs().includes("packages/*"));
  const manifest = JSON.parse(read("packages/test-postgres/package.json")) as { private?: boolean };
  assert.equal(manifest.private, true);
});
