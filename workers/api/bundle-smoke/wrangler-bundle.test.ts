/**
 * SUT: `wrangler-bundle.ts`, the build step every bundle-smoke artifact goes through. Its dry-run bound is a
 * diagnostic for a stalled build and must never relabel a failed one (#1677 review), and the runtime it builds
 * and runs artifacts with (`deployedRuntime`, read from `../wrangler.toml`) is the one Wrangler itself resolves
 * for the production ring.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { process } from "../test-support/node-globals.ts";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";

const directory = mkdtempSync(join(tmpdir(), "edge-wrangler-bundle-"));
after(() => { rmSync(directory, { recursive: true, force: true }); });

void test("a failed dry-run build keeps the build's own error instead of the timeout diagnostic", async () => {
  const entry = join(directory, "does-not-compile.ts");
  writeFileSync(entry, 'export default { fetch() { return new Response("unterminated); } }\n');
  await assert.rejects(bundleLikeWrangler(entry, join(directory, "broken.js")), (error: unknown) => {
    const failure = error as Error & { killed?: boolean; signal?: string | null };
    assert.doesNotMatch(failure.message, /did not finish its dry-run build within \d+ seconds/);
    assert.match(failure.message, /does-not-compile\.ts/, "the compiler's own message must survive");
    assert.equal(failure.killed, false, "the child exited on its own; the timeout never killed it");
    assert.equal(failure.signal, null);
    return true;
  });
});

/** Wrangler's own resolution of the production ring's runtime, in `deployedRuntime`'s shape. One `node --eval`
 * child, as `test/deployment-contract.test.ts` reads rings, so Wrangler's module graph stays out of this one. */
const READ_PRODUCTION_RUNTIME = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const config = unstable_readConfig({ config: process.argv[1], env: "production" });
process.stdout.write(JSON.stringify({ compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags }));
`;

function productionRuntime(): unknown {
  const config = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
  const resolved: unknown = JSON.parse(execFileSync(process.execPath,
    ["--input-type=module", "--eval", READ_PRODUCTION_RUNTIME, config], { encoding: "utf8" }));
  return resolved;
}

void test("artifacts are built and run with the compatibility date and flags Wrangler resolves for production", () => {
  assert.deepEqual(deployedRuntime(), productionRuntime());
});
