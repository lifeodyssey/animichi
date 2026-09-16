import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";
import type { Boundary, InterruptedCommit } from "./tool-replay-boundary-loss.ts";
import type { ReplayReport } from "./tool-replay-recovery.worker.ts";

interface Expectation {
  readonly boundary: Boundary;
  readonly tool: string;
  readonly path: string;
  readonly effectsAtCrash: number;
  readonly interruptedCommit: InterruptedCommit;
  readonly effects: number;
  readonly reservations: number;
  readonly uniqueInvocations: number;
  readonly interrupted: boolean;
}

/**
 * `intent`: the intent commit landed, the effect never ran — recovery must run the tool exactly once.
 * `effect`: the effect ran, the outcome never landed — a safe tool may run again, but under one
 * invocation identity, so the business effect stays single.
 * `outcome`/`never`: the outcome landed; `never` also refuses a replayed never tool.
 */
const BOUNDARIES: readonly Expectation[] = [
  { boundary: "intent", tool: "search_bangumi", path: "/catalog/points-by-bangumi-id", effectsAtCrash: 0, interruptedCommit: { committed: true, toolResults: 0, staged: 0, args: 1 }, effects: 1, reservations: 1, uniqueInvocations: 1, interrupted: false },
  { boundary: "effect", tool: "search_bangumi", path: "/catalog/points-by-bangumi-id", effectsAtCrash: 1, interruptedCommit: { committed: false, toolResults: 0, staged: 1, args: 0 }, effects: 2, reservations: 2, uniqueInvocations: 1, interrupted: false },
  { boundary: "outcome", tool: "search_bangumi", path: "/catalog/points-by-bangumi-id", effectsAtCrash: 1, interruptedCommit: { committed: true, toolResults: 1, staged: 0, args: 0 }, effects: 1, reservations: 1, uniqueInvocations: 1, interrupted: false },
  { boundary: "never", tool: "translate_anime_title", path: "/catalog/resolve", effectsAtCrash: 1, interruptedCommit: { committed: false, toolResults: 0, staged: 1, args: 0 }, effects: 1, reservations: 1, uniqueInvocations: 1, interrupted: true },
];

async function replayWorker(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "tool-replay-recovery-"));
  const outfile = join(directory, "worker.mjs");
  await bundleLikeWrangler(new URL("./tool-replay-recovery.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime(),
    durableObjects: { SESSION: { className: "ReplayProbe", useSQLite: true } } });
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  return worker;
}

async function probe(worker: Miniflare, path: string) {
  const response = await worker.dispatchFetch(`https://replay.test${path}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body) as ReplayReport;
}

void test("each durable tool boundary recovers through the SDK schedule without a second effect", { timeout: 120_000 }, async (context) => {
  const worker = await replayWorker(context);
  for (const expected of BOUNDARIES) {
    const crashed = await probe(worker, `/${expected.boundary}/run`);
    context.diagnostic(JSON.stringify(crashed));
    assert.equal(crashed.crashed, true, `${expected.boundary}: the drive must reach its injected boundary`);
    assert.equal(crashed.effectsAtCrash, expected.effectsAtCrash, `${expected.boundary}: effects before recovery`);
    assert.deepEqual(crashed.interruptedCommit, expected.interruptedCommit, `${expected.boundary}: the interrupted commit, and whether the repository accepted it`);
    await probe(worker, `/${expected.boundary}/recover`);
    assert.deepEqual(await probe(worker, `/${expected.boundary}/settled`), { recovered: true }, `${expected.boundary}: the scheduled callback settled`);
    const report = await probe(worker, `/${expected.boundary}/report`);
    context.diagnostic(JSON.stringify(report));
    assert.deepEqual(Object.entries(report.effects), [[expected.path, expected.effects]], `${expected.boundary}: external effects`);
    assert.equal(report.reservations.length, expected.reservations, `${expected.boundary}: reservations`);
    assert.equal(new Set(report.reservations).size, expected.uniqueInvocations, `${expected.boundary}: invocation identities`);
    assert.deepEqual(report.results, [{ tool: expected.tool, isError: expected.interrupted }], `${expected.boundary}: committed results`);
    assert.equal(report.tool, expected.tool, `${expected.boundary}: the scripted tool`);
    assert.equal(report.path, expected.path, `${expected.boundary}: the counted catalog path`);
    assert.equal(report.status, "completed", `${expected.boundary}: the recovered operation result`);
    assert.deepEqual(report.drives, ["replay", "replay"], `${expected.boundary}: one drive per attachment, same operation`);
    assert.equal(report.attaches, 2, `${expected.boundary}: the crashed drive and the scheduled cold attach`);
    assert.equal(report.callbacks, 1, `${expected.boundary}: the durable schedule delivered its callback once`);
    assert.equal(report.intervals, 1, `${expected.boundary}: the recurring scan remains the recovery trigger`);
    assert.equal(report.modelCalls, 2, `${expected.boundary}: no restarted turn issues another model request`);
  }
});
