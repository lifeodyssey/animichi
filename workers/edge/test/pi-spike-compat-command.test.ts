import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOLEAN_SWITCHES,
  MAX_TOKENS_FIELDS,
  MIMO_ROUTES,
} from "../spike/pi/src/compat-switch.ts";
import { DEFAULT_COMPAT_PROMPT, parseCompatCommand } from "../spike/pi/src/compat-command.ts";

// W0-S2 (#1245): the /compat request vocabulary. Every switch the matrix can
// flip has to survive the JSON boundary with its type intact, and anything the
// operator mistypes has to come back as a 400 rather than as a silently
// dropped override — a dropped override would make the measured row a lie
// about which dialect was in force.
//
// test-type: unit (pure parsing; no network, no clock, no bindings).

function commandOf(body: unknown) {
  const parsed = parseCompatCommand(body);
  assert.ok(parsed.ok, `expected a valid command, got ${parsed.ok ? "" : parsed.error}`);
  return parsed.command;
}

void test("the matrix knows both mimo routes", () => {
  assert.deepEqual([...MIMO_ROUTES], ["direct", "zen"]);
});

void test("a command names the route it measures", () => {
  assert.equal(commandOf({ route: "zen" }).route, "zen");
  assert.equal(commandOf({ route: "direct" }).route, "direct");
});

void test("a missing or unknown route is rejected rather than defaulted", () => {
  assert.equal(parseCompatCommand({}).ok, false);
  assert.equal(parseCompatCommand({ route: "openrouter" }).ok, false);
});

void test("a non-object body is rejected", () => {
  assert.equal(parseCompatCommand("direct").ok, false);
  assert.equal(parseCompatCommand([{ route: "direct" }]).ok, false);
  assert.equal(parseCompatCommand(null).ok, false);
});

void test("an absent compat object means pi's own auto-detection", () => {
  assert.deepEqual(commandOf({ route: "direct" }).compat, {});
});

void test("every boolean switch survives the JSON boundary", () => {
  for (const name of BOOLEAN_SWITCHES) {
    const command = commandOf({ route: "direct", compat: { [name]: false } });
    assert.deepEqual(command.compat, { [name]: false }, `${name} must reach the model`);
  }
});

void test("both max token fields are accepted", () => {
  for (const field of MAX_TOKENS_FIELDS) {
    assert.deepEqual(commandOf({ route: "direct", compat: { maxTokensField: field } }).compat, {
      maxTokensField: field,
    });
  }
});

void test("a boolean switch handed a non-boolean is rejected", () => {
  assert.equal(parseCompatCommand({ route: "direct", compat: { supportsStore: "no" } }).ok, false);
  assert.equal(parseCompatCommand({ route: "direct", compat: { supportsStore: 0 } }).ok, false);
});

void test("an unknown max tokens field is rejected", () => {
  const parsed = parseCompatCommand({ route: "direct", compat: { maxTokensField: "max_new" } });
  assert.equal(parsed.ok, false);
});

void test("an unknown switch is rejected rather than ignored", () => {
  const parsed = parseCompatCommand({ route: "direct", compat: { supportsMagic: true } });
  assert.ok(!parsed.ok);
  assert.match(parsed.error, /supportsMagic/);
});

void test("a non-object compat field is rejected", () => {
  assert.equal(parseCompatCommand({ route: "direct", compat: "strict" }).ok, false);
});

void test("a command without a prompt falls back to the tool-calling prompt", () => {
  assert.equal(commandOf({ route: "direct" }).prompt, DEFAULT_COMPAT_PROMPT);
  assert.match(DEFAULT_COMPAT_PROMPT, /lookup_spot|tool/i);
});
