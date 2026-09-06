/**
 * The pi-ai `.lazy` subpath is unusable in a Worker bundle (issue #1246):
 * esbuild's chunk initialisation order leaves the lazily-loaded api module
 * undefined at call time, which only shows up when the built artifact is
 * EXECUTED — `bundle-smoke/pi-kernel.test.ts` is that execution, and this file
 * is the cheap tripwire covering every other source the bundle can reach.
 *
 * It carries the three runtime facts that `bundle-smoke-lane.test.ts` asserted
 * alongside its lane-shape claims; #1359 deleted the lane half (the pipeline
 * no longer describes itself) and kept these, which are about the artifact.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

/** Every TypeScript file under one repo-relative directory. */
function typescriptSources(directory: string): string[] {
  return readdirSync(`${ROOT}${directory}`, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => `${directory}/${entry}`);
}

const BUNDLED_SOURCES = [
  ...typescriptSources("workers/edge/src"),
  ...typescriptSources("workers/edge/bundle-smoke"),
];
// Quoted module specifiers only — these files discuss `.lazy` in prose on purpose.
const LAZY_SUBPATH = /["']@earendil-works\/pi-ai\/[^"']*\.lazy["']/;
const SMOKE_ENTRY = read("workers/edge/bundle-smoke/pi-kernel.worker.ts");

interface EdgePackageManifest {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}
const EDGE_PACKAGE = JSON.parse(read("workers/edge/package.json")) as EdgePackageManifest;

/** W1-3 (#1252) put the pi kernel in `src/`, so it ships: a devDependency here
 * would be a Worker that fails to bundle its own agent loop. */
void test("the pi kernel is a runtime dependency of the deployed Worker", () => {
  assert.equal(typeof EDGE_PACKAGE.dependencies["@earendil-works/pi-ai"], "string");
  assert.equal(typeof EDGE_PACKAGE.dependencies["@earendil-works/pi-agent-core"], "string");
  assert.equal(EDGE_PACKAGE.devDependencies["@earendil-works/pi-ai"], undefined);
});

void test("the smoke entrypoint keeps the eager pi-ai import workaround", () => {
  assert.match(SMOKE_ENTRY, /from "@earendil-works\/pi-ai\/api\/openai-completions"/);
  assert.doesNotMatch(SMOKE_ENTRY, LAZY_SUBPATH);
});

void test("no edge source that reaches a bundle imports a pi-ai .lazy subpath", () => {
  assert.ok(BUNDLED_SOURCES.length > 0, "found no edge sources to scan");
  const offenders = BUNDLED_SOURCES.filter((path) => LAZY_SUBPATH.test(read(path)));
  assert.deepEqual(offenders, [], "use the eager api module — see the upstream report");
});
