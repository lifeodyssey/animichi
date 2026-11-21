import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";
import type { AlarmWrite } from "./native-keepalive-state.ts";

export interface Observation {
  deadlineId: string | null; deadlineTime: number; alarm: number | null;
  callbackCount: number; callbackDuringDrive: boolean; driveActive: boolean; completedStatus: string;
  physicalNow: number; firedAt: number | null; alarmAtCallbackEntry: number | null;
  /** Every physical-alarm write the probe's wrapper saw, in order. */
  writes: AlarmWrite[];
}

/** The delivered alarm callback's own witness: the wait has no other bound. */
export interface Delivery {
  /** The deadline's callback count as the observer arrived: 0 proves the delivery had not started. */
  undeliveredAtArrival: number;
  /** The same count, read only after the delivered event settled, so no race can produce it. */
  deliveredAtWait: number;
  observation: Observation;
}

async function workspace(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "native-keepalive-"));
  const resources: { worker?: Miniflare } = {};
  context.after(async () => { try { await resources.worker?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } });
  return { directory, resources };
}

export async function nativeWorker(context: TestContext) {
  const { directory, resources } = await workspace(context);
  const outfile = join(directory, "worker.mjs");
  await bundleLikeWrangler(new URL("./native-keepalive.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }],
    ...deployedRuntime(), durableObjects: { SESSION: { className: "KeepaliveProbe", useSQLite: true } } });
  resources.worker = worker;
  return worker;
}

/** Start consuming each returned body immediately, including the independently pending drive response. */
export async function request(worker: Miniflare, path: string) {
  const response = await worker.dispatchFetch(`https://probe.test${path}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return body;
}

export async function inspect(worker: Miniflare, path = "/inspect") {
  return JSON.parse(await request(worker, path)) as Observation;
}

/**
 * Make the deadline due and wait for its callback to reach the observer's boundary, then read that boundary.
 *
 * `diagnosticMs` only names a stalled delivery; it is never an assertion input, and the callback parks
 * until the matching `deliverDeadlineAlarm`, so a healthy run is bounded by the alarm event alone.
 */
export async function fireDeadlineAlarm(worker: Miniflare, diagnosticMs: number) {
  await request(worker, "/fire");
  await request(worker, `/alarm-entered?diagnosticMs=${String(diagnosticMs)}`);
  return inspect(worker);
}

/** Release the parked callback and await its delivered event, the only witness of the one delivery. */
export async function deliverDeadlineAlarm(worker: Miniflare, diagnosticMs: number) {
  return JSON.parse(await request(worker, `/callback?diagnosticMs=${String(diagnosticMs)}`)) as Delivery;
}

export async function releaseAndRestore(worker: Miniflare, drive: Promise<string>) {
  try { await request(worker, "/release"); await drive; }
  finally { await request(worker, "/restore"); }
}
