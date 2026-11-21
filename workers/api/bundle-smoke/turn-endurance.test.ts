import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";
import type { EnduranceReport } from "./turn-endurance.worker.ts";

async function enduranceWorker(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "turn-endurance-"));
  const outfile = join(directory, "worker.mjs");
  await bundleLikeWrangler(new URL("./turn-endurance.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime(),
    durableObjects: { SESSION: { className: "EnduranceProbe", useSQLite: true } } });
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  return worker;
}

/** One fixture signal: the request settles only when the Durable Object answers it. */
async function deliver(worker: Miniflare, path: string) {
  const response = await worker.dispatchFetch(`https://probe.test${path}`);
  assert.equal(response.status, 200, await response.clone().text());
  return response.text();
}

/**
 * The client disconnects while the drive waits on its first provider round, and never returns.
 * Every wait below is the fixture's own event; the turn's duration is host-clock, not elapsed here.
 */
void test("a client that disconnects mid-flight does not abort a three-tool turn spanning 135 host-clock seconds", { timeout: 120_000 }, async (context) => {
  const worker = await enduranceWorker(context);
  const drive = worker.dispatchFetch("https://probe.test/endurance");
  assert.equal(await deliver(worker, "/entered"), "entered");
  assert.equal(await deliver(worker, "/disconnect"), "disconnected");
  assert.equal(await deliver(worker, "/release"), "released");
  const response = await drive;
  assert.equal(response.status, 200, await response.clone().text());
  const report = await response.json() as EnduranceReport;
  context.diagnostic(JSON.stringify(report));
  assert.equal(report.disconnected, true, "the client signal must be aborted while the drive is still in flight");
  assert.equal(report.status, "completed", "a stream disconnect must not abort admitted work");
  assert.equal(report.toolInvocations.length, 3, "each of the three tool calls must execute exactly once");
  assert.deepEqual(report.toolEffects, { search_bangumi: 1, search_nearby: 1 }, "a disconnected safe tool must not execute twice");
  assert.equal(report.modelCalls, 3, "the disconnect must not add another model round");
  assert.equal(report.admissions, 1, "the disconnect must not admit the same turn again");
  assert.equal(report.keepAliveEntries, 1, "the disconnected drive must run under the SDK keepalive");
  assert.ok(report.elapsedMs >= 130_000, `the turn spanned ${String(report.elapsedMs)} ms of the host clock`);
});
