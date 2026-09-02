import test from "node:test";
import assert from "node:assert/strict";
import { SseTurnChannel } from "../spike/pi/src/sse-turn-channel.ts";
import {
  MIMO_DIRECT_BASE_URL,
  MIMO_ZEN_BASE_URL,
  configuredProviders,
  mimoRouteOf,
} from "../spike/pi/src/spike-models.ts";
import { abortRequiredFor, routeOf } from "../spike/pi/src/spike-routes.ts";
import { DEFAULT_TURN_PROMPT, parseTurnCommand } from "../spike/pi/src/turn-command.ts";

// W0-S1 (#1244): the probe Worker's request surface — routing, command
// validation, provider-key selection and SSE framing. All pure; the Durable
// Object and the providers themselves are exercised on the deployed Worker by
// scripts/spike/pi-s1-measure.sh.
//
// test-type: unit (no network, no clock, no bindings).

const FAKE_DIRECT_KEY = "aaaa-direct";
const FAKE_ZEN_KEY = "bbbb-zen";

void test("the probe Worker exposes exactly three routes", () => {
  assert.equal(routeOf("GET", "/healthz"), "healthz");
  assert.equal(routeOf("POST", "/turn"), "turn");
  assert.equal(routeOf("POST", "/turn/abort"), "turn_abort");
});

void test("anything outside the three routes is a 404", () => {
  assert.equal(routeOf("POST", "/healthz"), "not_found");
  assert.equal(routeOf("GET", "/turn"), "not_found");
  assert.equal(routeOf("POST", "/v1/chat"), "not_found");
});

void test("only the abort route demands an abort point", () => {
  assert.equal(abortRequiredFor("turn_abort"), true);
  assert.equal(abortRequiredFor("turn"), false);
});

void test("a turn command names one of the three providers", () => {
  const parsed = parseTurnCommand({ provider: "gemini" }, false);
  assert.equal(parsed.ok && parsed.command.provider, "gemini");
});

void test("an unknown provider is rejected rather than defaulted", () => {
  const parsed = parseTurnCommand({ provider: "gpt-9" }, false);
  assert.equal(parsed.ok, false);
});

void test("a non-object body is rejected", () => {
  assert.equal(parseTurnCommand("mimo", false).ok, false);
  assert.equal(parseTurnCommand(["mimo"], false).ok, false);
});

void test("the abort route rejects a missing or unknown break point", () => {
  assert.equal(parseTurnCommand({ provider: "mimo" }, true).ok, false);
  assert.equal(parseTurnCommand({ provider: "mimo", abortPoint: "later" }, true).ok, false);
});

void test("the plain turn route ignores an abort point it was handed", () => {
  const parsed = parseTurnCommand({ provider: "mimo", abortPoint: "tool_call" }, false);
  assert.equal(parsed.ok && parsed.command.abortPoint, null);
});

void test("a turn without a prompt falls back to the spike prompt", () => {
  const parsed = parseTurnCommand({ provider: "mimo" }, false);
  assert.equal(parsed.ok && parsed.command.prompt, DEFAULT_TURN_PROMPT);
});

void test("mimo prefers the direct endpoint and falls back to the zen gateway", () => {
  const both = mimoRouteOf({ MIMO_API_KEY: FAKE_DIRECT_KEY, ZEN_GO_API_KEY: FAKE_ZEN_KEY });
  assert.equal(both?.baseUrl, MIMO_DIRECT_BASE_URL);
  const zenOnly = mimoRouteOf({ ZEN_GO_API_KEY: FAKE_ZEN_KEY });
  assert.equal(zenOnly?.baseUrl, MIMO_ZEN_BASE_URL);
  assert.equal(mimoRouteOf({}), null);
});

void test("healthz reports provider readiness without disclosing a key", () => {
  const keys = { ZEN_GO_API_KEY: FAKE_ZEN_KEY, GEMINI_API_KEY: "cccc-gemini" };
  const reported = configuredProviders(keys);
  assert.deepEqual(reported, { mimo: true, anthropic: false, gemini: true });
  assert.equal(JSON.stringify(reported).includes(FAKE_ZEN_KEY), false);
});

async function readChannel(channel: SseTurnChannel): Promise<string> {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  for await (const chunk of channel.body) chunks.push(decoder.decode(chunk));
  return chunks.join("");
}

void test("each agent event becomes one SSE frame", async () => {
  const channel = new SseTurnChannel();
  const reading = readChannel(channel);
  await channel.send("turn_start", {});
  await channel.send("outcome", { clean: true });
  await channel.close();
  assert.equal(await reading, 'event: turn_start\ndata: {}\n\nevent: outcome\ndata: {"clean":true}\n\n');
});

void test("a turn keeps running after its reader disconnects", async () => {
  const channel = new SseTurnChannel();
  await channel.body.cancel();
  await channel.send("turn_start", {});
  assert.equal(channel.clientGone, true);
});
