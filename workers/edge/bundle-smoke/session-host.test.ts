import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";
import { TURN_DEADLINE_MS } from "../src/agent/host/turn-deadline.ts";
import { Miniflare } from "miniflare";

async function nativeWorker(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "session-host-"));
  const outfile = join(directory, "worker.mjs");
  await bundleLikeWrangler(new URL("./session-host.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime(), durableObjects: { SESSION: { className: "HostProbe", useSQLite: true } } });
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  return worker;
}

void test("native SessionAgent serializes requests and scheduled work across awaits", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/concurrency");
  assert.equal(response.status, 200, await response.clone().text());
  const result: unknown = await response.json();
  assert.deepEqual(result, { writers: 1, operations: ["first", "second"], completed: ["first", "second"], scanCount: 1 });
});

void test("an accepted commit response loss survives failed first reopen and continues without cancellation", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/lost-accept");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { failed: true, reopenFailed: true, current: null, result: "completed", opens: 2 });
});

void test("a terminal commit response loss is reconciled from the immutable native result", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/lost-terminal");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { failed: true, reopenFailed: true, current: null, result: "completed", opens: 2 });
});

void test("a native retry returns waiting and retains the recurring scan plus a rounded one-shot wake", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/retry");
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as { kind: string; wakeAt: number; notBefore: number; scanCount: number };
  assert.equal(result.kind, "waiting");
  assert.equal(result.scanCount, 1);
  assert.equal(result.wakeAt, Math.ceil(result.notBefore / 1000));
  assert.equal(result.notBefore % 1000, 250);
});

void test("client cancellation leaves native work alive and conversation data out of every DO storage surface", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/persistence");
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as { status: string; persisted: string };
  assert.equal(result.status, "completed");
  assert.match(result.persisted, /wakeSession/);
  assert.doesNotMatch(result.persisted, /host-payload-sentinel-943/);
});

void test("a provider call that outruns the turn budget stops the run before the next model request", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/deadline-between-requests");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { kind: "settled", status: "aborted", budget: TURN_DEADLINE_MS, requests: 1 });
});

void test("a wake that arrives after the turn budget settles the run without any model request", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/deadline-before-drive");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { kind: "settled", status: "aborted", budget: null, requests: 0 });
});

void test("a spent turn whose deadline refusal cannot persist still aborts before the next model request", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/deadline-refused");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { kind: "settled", status: "aborted", budget: TURN_DEADLINE_MS, requests: 1, refusals: 1 });
});

void test("acknowledgment retains one operation wake alongside the independent recurring scan", async (context) => {
  const worker = await nativeWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/ack-wake");
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as { accepted: string; schedules: { type: string; payload: unknown }[] };
  assert.equal(result.accepted, "ack");
  assert.equal(result.schedules.filter((schedule) => schedule.type === "interval").length, 1);
  assert.deepEqual(result.schedules.filter((schedule) => schedule.type === "scheduled").map((schedule) => schedule.payload), [{ operationId: "ack", notBefore: 2_000_000_000_000 }]);
});
