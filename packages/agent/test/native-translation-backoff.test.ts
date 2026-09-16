import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/pi-agent-core/harness/context";
import { translateAnimeTitle } from "@animichi/agent/tools";
import { fixture } from "./native-tool-fixture.ts";
import { catalogClock, GUARDED_TEST_TIMEOUT_MS, pendingCatalog, scavenge, settledWithin } from "./catalog-clock.ts";

void test("translation observes caller cancellation while the official catalog retry is waiting", { timeout: GUARDED_TEST_TIMEOUT_MS }, async (context) => {
  catalogClock(context);
  const catalog = pendingCatalog(1);
  const { repo, toolContext } = await fixture(catalog.fetch);
  context.after(async () => { context.mock.timers.runAll(); await repo.close(BACKGROUND_CONTEXT); });
  const caller = withCancel(BACKGROUND_CONTEXT);
  const invocation = { invocationId: "translation", operationId: "operation", turnId: "turn",
    getMemo: () => Promise.resolve(undefined), setMemo: () => Promise.resolve() };
  const executed = translateAnimeTitle.execute("call", { title: "Title", target_language: "zh" }, () => undefined,
    toolContext, invocation, caller.context);
  const first = await catalog.received(0);
  first.respond(new Response("Unavailable", { status: 503 }));
  await setImmediate();
  // The composed deadline chain is only weakly reachable, so scavenge here, exactly where a busy host does.
  // A cancellation that survives this line reaches the signal of the attempt already delivered.
  scavenge();
  caller.cancel(new DOMException("Translation cancelled", "AbortError"));
  // The cancellation reaches every derived signal synchronously, so the in-flight request is already
  // aborted here. Stating that as state rather than as an event inside a budget keeps a broken chain
  // immediate and unambiguous; the guarded await below only observes the rejection it implies.
  assert.equal(first.request.signal.aborted, true, "The caller's cancellation must reach the in-flight catalog request's signal");
  const cancellation = await settledWithin(executed.then(() => undefined, (error: unknown) => error), "the caller's cancellation");
  assert.ok(cancellation instanceof DOMException, "The translation must observe the caller's cancellation");
  assert.equal(cancellation.name, "AbortError");
  assert.equal(cancellation.message, "Translation cancelled");
  await settledWithin(catalog.aborted(0), "the in-flight catalog request's abort");
  context.mock.timers.tick(2_000);
});
