/**
 * #688 AC5: the edge var inventory. Every plain var `wrangler.toml` declares in
 * any ring must have a class and a reason, so a new var cannot ship without the
 * operator deciding whether it is a reviewed deploy or a runtime-tunable knob.
 *
 * The classification is also the misuse boundary (#688 AC3): the two classes
 * partition the declared vars, and the runtime-tunable half is exactly the
 * `RUNTIME_KNOBS` registry — no deploy-coupled gate appears in either.
 *
 * test-type: unit (parses a checked-in file; no cloud, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { parse, TomlDate, type TomlTable, type TomlValue } from "smol-toml";
import { EDGE_VARS } from "../src/config/edge-var-inventory.ts";
import { RUNTIME_KNOBS } from "../src/config/edge-vars.ts";

const document = parse(readFileSync(fileURLToPath(new URL("../wrangler.toml", import.meta.url)), "utf8"));

function asTable(value: TomlValue | undefined): TomlTable {
  if (typeof value !== "object" || Array.isArray(value) || value instanceof TomlDate) return {};
  return value;
}

/** The `vars` keys of one ring: the base document for the default ring, the
 * nested `env.<name>` table for a named one. */
function declaredVars(environment?: string): string[] {
  const env = asTable(document.env);
  const ring = environment === undefined ? document : asTable(env[environment]);
  return Object.keys(asTable(ring.vars));
}

const DECLARED = [...new Set([
  ...declaredVars(),
  ...declaredVars("staging"),
  ...declaredVars("production"),
])].sort();

const classifiedNames = EDGE_VARS.map((entry) => entry.name);
const byClass = (edgeVarClass: string) => EDGE_VARS.filter((entry) => entry.class === edgeVarClass).map((entry) => entry.name);
const knobEnvVars = Object.values(RUNTIME_KNOBS).map((knob) => knob.envVar);

void test("the inventory has exactly one entry per name", () => {
  assert.equal(new Set(classifiedNames).size, classifiedNames.length);
});

void test("every var declared in wrangler.toml has an inventory classification", () => {
  const classified = new Set(classifiedNames);
  assert.deepEqual(DECLARED.filter((name) => !classified.has(name)), []);
});

void test("the two classes partition the classified names", () => {
  assert.deepEqual([...byClass("runtime-tunable"), ...byClass("deploy-coupled")].sort(), [...classifiedNames].sort());
});

void test("the runtime-tunable half is exactly the knob registry", () => {
  assert.deepEqual(byClass("runtime-tunable").sort(), [...knobEnvVars].sort());
});

void test("anonymous access, showcase mode and the identity settings stay deploy-coupled", () => {
  const coupled = new Set(byClass("deploy-coupled"));
  for (const gate of ["ANON_ACCESS_ENABLED", "EDGE_SHOWCASE_MODE", "NEON_AUTH_JWKS_URL", "ANON_ID_SECRET", "TURNSTILE_SECRET"]) {
    assert.equal(coupled.has(gate), true, `${gate} must stay deploy-coupled`);
  }
});

void test("no deploy-coupled gate is reachable through the knob store", () => {
  const readable = new Set(knobEnvVars);
  assert.deepEqual(byClass("deploy-coupled").filter((name) => readable.has(name)), []);
});

void test("every classification carries a reason", () => {
  assert.deepEqual(EDGE_VARS.filter((entry) => entry.reason.length === 0).map((entry) => entry.name), []);
});
