/**
 * The host lane bundles each worker entry once per process (#1782). Bindings are Miniflare options,
 * not bundle input, so a shared bundle must still run every worker with the bindings its test asked
 * for — and a bundle belongs to its entry, never to whichever entry was bundled first.
 *
 * test-type: unit (the build is a counting double; Miniflare runs the bundled code it returns).
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { BundledEntries } from "../bundle-smoke/bundled-entries.ts";

/** A build double that records every entry it is asked for and bundles a worker naming it. */
function countingBuild() {
  const built: string[] = [];
  const build = (entry: string) => {
    built.push(entry);
    return Promise.resolve(`export default { fetch(_request, env) { return Response.json({ entry: ${JSON.stringify(entry)}, lane: env.LANE }); } };`);
  };
  return { built, build };
}

async function laneWorker(context: TestContext, entries: BundledEntries, entry: string, lane: string) {
  const worker = new Miniflare({ ...await entries.modules(entry), bindings: { LANE: lane } });
  context.after(() => worker.dispose());
  return (await worker.dispatchFetch("https://lane.test/")).json();
}

void test("two workers on one entry share its single bundle and each runs with the bindings it asked for", async (context) => {
  const { built, build } = countingBuild();
  const entries = new BundledEntries(build);
  assert.deepEqual(await laneWorker(context, entries, "/host/business.worker.ts", "first"), { entry: "/host/business.worker.ts", lane: "first" });
  assert.deepEqual(await laneWorker(context, entries, "/host/business.worker.ts", "second"), { entry: "/host/business.worker.ts", lane: "second" });
  assert.deepEqual(built, ["/host/business.worker.ts"]);
});

void test("each entry is bundled from itself, not served another entry's bundle", async () => {
  const { built, build } = countingBuild();
  const entries = new BundledEntries(build);
  assert.match(await entries.code("/host/business.worker.ts"), /"\/host\/business\.worker\.ts"/);
  assert.match(await entries.code("/host/default.worker.ts"), /"\/host\/default\.worker\.ts"/);
  assert.deepEqual(built, ["/host/business.worker.ts", "/host/default.worker.ts"]);
});
