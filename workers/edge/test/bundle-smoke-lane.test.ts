/**
 * W0-S3 lane contract (issue #1246). The bundler smoke gate is only worth
 * having if it is a DOOR: `gate_edge` in `scripts/local-gates/pre-push.sh` is
 * the single definition that both the local pre-push hook and CI's
 * `CI / affected (edge)` matrix leg run (`.github/scripts/pr-verification-gate.sh`
 * dispatches straight to `gate_<component>`), so pinning the invocation there
 * pins both surfaces at once.
 *
 * This file also pins the artifact side that the gate cannot assert about
 * itself: no source that reaches a Worker bundle may import a pi-ai `.lazy`
 * api subpath. The workaround is executable-verified by
 * `bundle-smoke/pi-kernel.test.ts` for the smoke entrypoint; this is the cheap
 * tripwire that covers every other edge source, including the production
 * kernel entrypoint that does not exist yet.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

const PRE_PUSH = read("scripts/local-gates/pre-push.sh");
const AFFECTED_GATE = read(".github/scripts/pr-verification-gate.sh");
const SMOKE_ENTRY = read("workers/edge/bundle-smoke/pi-kernel.worker.ts");

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

interface EdgePackageManifest {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}
const EDGE_PACKAGE = JSON.parse(read("workers/edge/package.json")) as EdgePackageManifest;

interface ComponentManifest {
  components: { name: string; ci_lanes: string[]; deploy_excludes: string[] }[];
}
const MANIFEST = JSON.parse(read(".github/ci/components.json")) as ComponentManifest;
const EDGE_COMPONENT = MANIFEST.components.find((component) => component.name === "edge");

/** The body of one `gate_<package>()` function in the pre-push orchestrator. */
function gateBody(name: string): string {
  const start = PRE_PUSH.indexOf(`gate_${name}() {`);
  assert.notEqual(start, -1, `pre-push.sh must define gate_${name}`);
  const end = PRE_PUSH.indexOf("\n}", start);
  return PRE_PUSH.slice(start, end);
}

void test("the edge gate runs the bundler smoke on the bundled artifact", () => {
  assert.match(gateBody("edge"), /gate workers\/edge pnpm run test:bundle-smoke/);
  assert.equal(EDGE_PACKAGE.scripts["test:bundle-smoke"], 'node --test "bundle-smoke/*.test.ts"');
});

void test("the affected (edge) CI leg dispatches to that same gate", () => {
  assert.match(AFFECTED_GATE, /"gate_\$PACKAGE"/);
  assert.match(AFFECTED_GATE, /^ALLOWED=.*\bedge\b/m);
  assert.deepEqual(EDGE_COMPONENT?.ci_lanes, ["lint", "unit", "bundle-smoke", "boundary", "build"]);
});

void test("the smoke entrypoint is test-only, not a deployed edge source", () => {
  assert.ok(EDGE_COMPONENT?.deploy_excludes.includes("workers/edge/bundle-smoke/**"));
  assert.equal(typeof EDGE_PACKAGE.devDependencies["@earendil-works/pi-ai"], "string");
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
