/**
 * SUT: `SessionAgent`'s startup (`src/agent/host/session-agent.ts`, `onStart` and `bindSession`), built by the
 * official Wrangler dry-run and run in workerd through `StartupProbe`. When a startup fails after `onStart`
 * returned, the Agents SDK reruns `onStart` on the same instance, so a second start must keep the domain the
 * first one bound, and attach that one; and a domain is bound once, so binding a second one must throw.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";
import type { StartupReport } from "./session-startup.worker.ts";

async function startupWorker(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "session-startup-"));
  const outfile = join(directory, "worker.mjs");
  await bundleLikeWrangler(new URL("./session-startup.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime(),
    durableObjects: { SESSION: { className: "StartupProbe", useSQLite: true } } });
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  return worker;
}

void test("a second start of a started session agent runs no second domain startup and keeps the first domain", async (context) => {
  const worker = await startupWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/restart");
  assert.equal(response.status, 200, await response.clone().text());
  const expected: StartupReport = { startups: 1, attachedTo: 1 };
  assert.deepEqual(await response.json(), expected);
});

void test("binding a second domain to a started session agent throws", async (context) => {
  const worker = await startupWorker(context);
  const response = await worker.dispatchFetch("https://probe.test/bind-again");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await response.text(), "The session domain is already bound");
});
