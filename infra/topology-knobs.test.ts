/** #688 AC4: the runtime-knob KV namespace. Pulumi owns it — never
 * hand-created — and its title is stack-scoped so a preview stack cannot share
 * the live namespace.
 *
 * The third link, the wrangler `[[kv_namespaces]]` binding, is deliberately not
 * asserted here: a KV namespace id exists only after the first apply of this
 * resource, so the binding that carries the id is the stacked follow-up PR. The
 * Worker's `Env` field is pinned now so the binding name is agreed before the
 * id exists.
 *
 * test-type: unit (mocked Pulumi resources + checked-in config; no cloud).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildStack, only, ofType } from "./testing/harness.ts";

const KV_NAMESPACE = "cloudflare:index/workersKvNamespace:WorkersKvNamespace";
const EDGE_ENV = "../workers/edge/src/env.ts";

const built = await buildStack("prod", { cloudflareAccountId: "acct" });

test("Pulumi builds one runtime-knob namespace on the stack's own account", () => {
  const namespace = only(built, KV_NAMESPACE);
  assert.equal(namespace.inputs.title, "animichi-edge-knobs");
  assert.equal(namespace.inputs.accountId, "acct");
});

test("a preview stack's knob namespace is its own, isolated from both live ones", async () => {
  const { edgeKnobsNamespaceTitleFor } = await import("./src/config.ts");
  assert.equal(edgeKnobsNamespaceTitleFor("preview-688"), "animichi-edge-knobs-preview-688");
  assert.notEqual(edgeKnobsNamespaceTitleFor("preview-688"), edgeKnobsNamespaceTitleFor("staging"));
});

test("no second KV namespace is declared anywhere on this stack", () => {
  assert.deepEqual(ofType(built, KV_NAMESPACE).map((namespace) => namespace.name), ["edge-knobs"]);
});

test("the Worker's Env declares the binding name the stacked config will inject", () => {
  assert.match(readFileSync(fileURLToPath(new URL(EDGE_ENV, import.meta.url)), "utf8"), /EDGE_KNOBS\?: KnobStore;/);
});
