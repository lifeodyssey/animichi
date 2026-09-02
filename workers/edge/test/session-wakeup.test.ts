/**
 * W1-2 (#1251): the wake-up hop the intake performs after its COMMIT, and the
 * request contract card #1252's `AgentSession` implements on the other side.
 *
 * Both halves are pinned here because they are one contract: `armRequest`
 * builds what a session stub receives and `armedRunId` reads it back, so a
 * change to either shape fails rather than silently arming nobody.
 *
 * test-type: unit (in-memory namespaces, no Cloudflare bindings, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { NamedStubs } from "../src/agent/durable-namespace.ts";
import {
  armedRunId,
  durableSessionWakeup,
  SESSION_ARM_PATH,
} from "../src/agent/session/session-wakeup.ts";
import {
  durableRunBackstop,
  RUN_SWEEPER_SINGLETON,
  RUN_SWEEP_SCHEDULE_PATH,
} from "../src/agent/sweeper/run-backstop.ts";

interface Delivery {
  readonly name: string;
  readonly request: Request;
}

/** A namespace that appends every (instance name, request) pair to `log`. */
function makeStubs(log: Delivery[]): NamedStubs {
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: (id) => ({
      fetch: (request) => {
        log.push({ name: id as unknown as string, request });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    }),
  };
}

/** The single delivery a case expects its namespace to have received. */
function onlyDelivery(log: Delivery[]): Delivery {
  const [delivery] = log;
  assert.ok(delivery, "expected exactly one delivery");
  return delivery;
}

void test("arming a session posts the run id to that session's own instance", async () => {
  const log: Delivery[] = [];
  const wakeup = durableSessionWakeup(makeStubs(log), { ensureScheduled: () => Promise.resolve() });
  await wakeup.arm("session-7", "run-3");
  const delivery = onlyDelivery(log);
  assert.equal(delivery.name, "session-7");
  assert.equal(new URL(delivery.request.url).pathname, SESSION_ARM_PATH);
  assert.equal(await armedRunId(delivery.request), "run-3");
});

void test("a sweeper that cannot be scheduled still does not cost the session its arm", async () => {
  const log: Delivery[] = [];
  const wakeup = durableSessionWakeup(makeStubs(log), {
    ensureScheduled: () => Promise.reject(new Error("sweeper unreachable")),
  });
  await assert.rejects(wakeup.arm("session-7", "run-3"), /sweeper unreachable/);
  assert.equal(onlyDelivery(log).name, "session-7", "the session must be armed anyway");
});

void test("a session that cannot be armed still leaves the backstop ticking", async () => {
  let scheduled = 0;
  const failing: NamedStubs = {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.reject(new Error("session unreachable")) }),
  };
  const wakeup = durableSessionWakeup(failing, {
    ensureScheduled: () => { scheduled += 1; return Promise.resolve(); },
  });
  await assert.rejects(wakeup.arm("session-7", "run-3"), /session unreachable/);
  assert.equal(scheduled, 1);
});

void test("a body that names no run arms nothing", async () => {
  const noRun = new Request("https://agent-session/arm", { method: "POST", body: JSON.stringify({}) });
  const emptyRun = new Request("https://agent-session/arm", { method: "POST", body: JSON.stringify({ runId: "" }) });
  const notAnObject = new Request("https://agent-session/arm", { method: "POST", body: JSON.stringify("run-3") });
  // A literal `null` body is the case a bare `payload.runId` would throw on.
  const nothing = new Request("https://agent-session/arm", { method: "POST", body: JSON.stringify(null) });
  assert.equal(await armedRunId(noRun), undefined);
  assert.equal(await armedRunId(emptyRun), undefined);
  assert.equal(await armedRunId(notAnObject), undefined);
  assert.equal(await armedRunId(nothing), undefined);
});

void test("the backstop addresses one singleton sweeper, whoever asks", async () => {
  const log: Delivery[] = [];
  const backstop = durableRunBackstop(makeStubs(log));
  await backstop.ensureScheduled();
  await backstop.ensureScheduled();
  assert.deepEqual(log.map((delivery) => delivery.name), [RUN_SWEEPER_SINGLETON, RUN_SWEEPER_SINGLETON]);
  assert.equal(new URL(onlyDelivery(log.slice(0, 1)).request.url).pathname, RUN_SWEEP_SCHEDULE_PATH);
});
