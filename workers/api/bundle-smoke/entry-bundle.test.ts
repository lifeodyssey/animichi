/**
 * Native hard cut authorized on 2026-09-10: verify execution and graph boundaries, not validator brand names.
 * This file reads the graph of a Wrangler build of `src/entry.ts`; `sealed-bundle.test.ts` starts the release build.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { bundleLikeWrangler } from "./wrangler-bundle.ts";

const directory = mkdtempSync(join(tmpdir(), "api-entry-bundle-"));
after(() => { rmSync(directory, { recursive: true, force: true }); });
const outfile = join(directory, "entry.js");
const bundle = await bundleLikeWrangler(fileURLToPath(new URL("../src/entry.ts", import.meta.url)), outfile);

void test("the deployed entry includes the shared native agent tools and direct Prisma storage", () => {
  const inputs = Object.keys(bundle.metafile.inputs).join("\n");
  assert.match(inputs, /packages\/agent\/src\/harness.ts/);
  assert.match(inputs, /packages\/pi-session-neon\/src\/repo.ts/);
});

void test("bundlers, eval and conformance implementations stay outside the Worker", () => {
  const inputs = Object.keys(bundle.metafile.inputs).join("\n");
  assert.doesNotMatch(inputs, /node_modules\/esbuild\/|packages\/eval\/|packages\/test-postgres\/|harness\/session\/testing|api\/api-test\//);
  assert.doesNotMatch(bundle.code, /esbuild\/lib\/main\.js|esbuild version/);
});

// #1605 AC3: the deployed entry's MODULE GRAPH carries no container SDK and
// exports no container class — the assertion #1589 specified for the migrator
// (`workers/migrator/test/deployment-contract.test.ts`), on the exact artifact
// the official Wrangler CLI builds at the top of this file. A source grep
// cannot see this: the graph is post-resolution, so a transitive import, a
// re-export from another module or a dependency that pulls the SDK in all show
// up here and nowhere in `src/`.
void test("the deployed entry's module graph carries no container SDK", () => {
  const inputs = Object.keys(bundle.metafile.inputs);
  assert.equal(
    inputs.some((path) => path.includes("@cloudflare/containers")),
    false,
    "@cloudflare/containers must not be in the deployed entry's module graph",
  );
});

void test("the deployed entry exports no retired container class", () => {
  const exported = Object.values(bundle.metafile.outputs).flatMap((output) => output.exports);
  assert.equal(exported.includes("RuntimeContainer"), false, "RuntimeContainer must not be an export of the deployed entry");
  assert.equal(exported.includes("ContainerProxy"), false, "ContainerProxy must not be an export of the deployed entry");
  assert.deepEqual(
    exported.filter((name) => name === "AgentSession" || name === "EdgeGuard").sort(),
    ["AgentSession", "EdgeGuard"],
    "the two surviving Durable Object classes must still be exported",
  );
});
