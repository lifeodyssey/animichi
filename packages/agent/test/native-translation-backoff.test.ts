import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/pi-agent-core/harness/context";
import { translateAnimeTitle } from "@animichi/agent/tools";
import { fixture } from "./native-tool-fixture.ts";
import { catalogClock, pendingCatalog, settledWithin } from "./catalog-clock.ts";

void test("translation observes caller cancellation while the official catalog retry is waiting", async (context) => {
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
  caller.cancel(new DOMException("Translation cancelled", "AbortError"));
  await assert.rejects(settledWithin(executed, "the caller's cancellation"), { name: "AbortError", message: "Translation cancelled" });
  await settledWithin(catalog.aborted(0), "the in-flight catalog request's abort");
  assert.equal(first.request.signal.aborted, true);
  context.mock.timers.tick(2_000);
});
