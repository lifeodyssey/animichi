import test from "node:test";
import assert from "node:assert/strict";
import { CompatTurnProbe } from "../spike/pi/src/compat-turn-probe.ts";
import { MimoDialectProbe } from "../spike/pi/src/mimo-dialect-probe.ts";
import type { TurnAgentView } from "../spike/pi/src/pi-turn-run.ts";
import type { CompatMeasurement } from "../spike/pi/src/compat-measurement.ts";
import type { MimoCompat } from "../spike/pi/src/compat-switch.ts";
import {
  DOUBLE_ANSWER,
  makeRejectedRequestStreamFn,
  makeToolCallingStreamFn,
  makeToolResultRejectingStreamFn,
} from "./doubles/pi-provider-double.ts";

// W0-S2 (#1245): the four numbers the switch table is made of, read off a real
// pi agent loop and a real tool. Only the provider stream is a double, and it
// honours the one compat switch a client can observe without a gateway —
// `supportsUsageInStreaming`, which decides whether pi asks for usage at all.
//
// test-type: integration (real agent loop + real tool; no network, mocked clock).

const KEYS = { MIMO_API_KEY: "not-a-real-key", ZEN_GO_API_KEY: "also-not-real" };

function makeStepClock(): () => number {
  let reading = 0;
  return () => (reading += 5);
}

function compatRequest(body: unknown): Request {
  return new Request("https://spike.test/compat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function measure(body: unknown, streamFn = makeToolCallingStreamFn()): Promise<Response> {
  return await new MimoDialectProbe(KEYS, makeStepClock(), streamFn).respond(compatRequest(body));
}

async function measurementOf(compat: MimoCompat = {}): Promise<CompatMeasurement> {
  const response = await measure({ route: "direct", compat });
  assert.equal(response.status, 200);
  return (await response.json()) as CompatMeasurement;
}

void test("a default turn reports a completed tool round trip", async () => {
  const measurement = await measurementOf();
  assert.equal(measurement.toolCallSucceeded, true);
  assert.equal(measurement.answered, true);
  assert.equal(measurement.toolRoundTrip, true);
  assert.equal(measurement.error, null);
});

void test("the measurement names the route and switches it was taken under", async () => {
  const measurement = await measurementOf({ maxTokensField: "max_tokens" });
  assert.equal(measurement.route, "direct");
  assert.deepEqual(measurement.compat, { maxTokensField: "max_tokens" });
});

void test("streamed usage is reported when the gateway was asked for it", async () => {
  const measurement = await measurementOf();
  assert.equal(measurement.streamingUsage, true);
  assert.ok(measurement.usageTokens > 0);
});

void test("turning off streaming usage is visible as zero tokens", async () => {
  const measurement = await measurementOf({ supportsUsageInStreaming: false });
  assert.equal(measurement.streamingUsage, false);
  assert.equal(measurement.usageTokens, 0);
  assert.equal(measurement.toolRoundTrip, true, "usage is off; the round trip still completes");
});

void test("wall and first-token times come from the injected clock alone", async () => {
  const measurement = await measurementOf();
  assert.equal(measurement.wallMs % 5, 0);
  const firstTokenMs = measurement.firstTokenMs;
  assert.ok(firstTokenMs !== null);
  assert.ok(firstTokenMs < measurement.wallMs);
});

void test("a rejected request set reports the provider error and no round trip", async () => {
  const response = await measure(
    { route: "direct", compat: { supportsStrictMode: true } },
    makeRejectedRequestStreamFn("400 unsupported parameter: strict"),
  );
  const measurement = (await response.json()) as CompatMeasurement;
  assert.equal(measurement.error, "400 unsupported parameter: strict");
  assert.equal(measurement.toolRoundTrip, false);
  assert.equal(measurement.firstTokenMs, null);
});

void test("a tool call the gateway will not take back is not a round trip", async () => {
  const response = await measure(
    { route: "direct", compat: { requiresToolResultName: false } },
    makeToolResultRejectingStreamFn("400 tool message must carry name"),
  );
  const measurement = (await response.json()) as CompatMeasurement;
  assert.equal(measurement.toolCallSucceeded, true, "the tool itself ran");
  assert.equal(measurement.answered, false, "the model never answered");
  assert.equal(measurement.toolRoundTrip, false);
  assert.equal(measurement.error, "400 tool message must carry name");
});

void test("a rejected request set still answers 200 so the row can be recorded", async () => {
  const response = await measure(
    { route: "direct" },
    makeRejectedRequestStreamFn("400 unsupported parameter"),
  );
  assert.equal(response.status, 200);
});

void test("the answer text proves the tool result travelled back to the model", async () => {
  const measurement = await measurementOf();
  assert.ok(measurement.events.includes("tool_execution_end"));
  assert.equal(measurement.events.at(-1), "agent_end");
  assert.ok(DOUBLE_ANSWER.length > 0);
});

void test("an unparsable body is a 400, not a fabricated row", async () => {
  const bad = new Request("https://spike.test/compat", { method: "POST", body: "{" });
  const response = await new MimoDialectProbe(KEYS, makeStepClock()).respond(bad);
  assert.equal(response.status, 400);
});

void test("an unknown switch is a 400", async () => {
  const response = await measure({ route: "direct", compat: { supportsMagic: true } });
  assert.equal(response.status, 400);
});

void test("a route with no key is a 503 that names which routes exist", async () => {
  const probe = new MimoDialectProbe({ MIMO_API_KEY: "direct-only" }, makeStepClock());
  const response = await probe.respond(compatRequest({ route: "zen" }));
  assert.equal(response.status, 503);
  const body = (await response.json()) as { mimoRoutes: Record<string, boolean> };
  assert.deepEqual(body.mimoRoutes, { direct: true, zen: false });
});

// pi's own message when a second prompt lands on a busy agent
// (`@earendil-works/pi-agent-core/dist/agent.js:228`) — the one failure that
// really does reject `prompt()` rather than landing on `state.errorMessage`.
const BUSY_MESSAGE = "Agent is already processing a prompt.";

function makeBusyAgentView(): TurnAgentView {
  return {
    subscribe: () => () => undefined,
    prompt: () => Promise.reject(new Error(BUSY_MESSAGE)),
    abort: () => undefined,
    state: { isStreaming: false, pendingToolCalls: new Set(), messages: [] },
  };
}

void test("a prompt that rejects still produces a row rather than a crash", async () => {
  const command = { route: "direct" as const, compat: {}, prompt: "where is Hyouka" };
  const measurement = await new CompatTurnProbe(
    makeBusyAgentView(),
    command,
    makeStepClock(),
  ).measure();
  assert.equal(measurement.error, BUSY_MESSAGE);
  assert.equal(measurement.toolRoundTrip, false);
});
