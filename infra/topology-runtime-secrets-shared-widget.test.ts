/** The shared-widget rule (#1676): the account has exactly ONE Turnstile
 * widget, so only the owner stack may import it. A second stack that needs the
 * secret reads the same widget through the `getTurnstileWidget` data source.
 *
 * Production is that second stack the day anonymous access is enabled there;
 * its own file because a process can only install the mocks and load the
 * runtime-secrets program once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { unseal } from "./testing/harness.ts";
import {
  buildRuntimeSecrets,
  runtimeConfig,
  storeSecret,
  storeSecrets,
  TURNSTILE_WIDGET_SECRET,
  VENDOR_KEYS,
} from "./testing/runtime-secrets.ts";

const config = runtimeConfig();
config["animichi-neon-secrets:anonymousAccessEnabled"] = "true";
const resources = await buildRuntimeSecrets("prod", config);

test("production with anonymous access enabled never imports a second widget", () => {
  assert.equal(resources.some((resource) => resource.type === "cloudflare:index/turnstileWidget:TurnstileWidget"), false);
  assert.equal(
    resources.some((resource) => resource.type === "random:index/randomPassword:RandomPassword"),
    true,
  );
});

test("production reads the shared widget's secret through the data source", () => {
  const resource = storeSecret(resources, "TURNSTILE_SECRET_PROD");
  assert.deepEqual(unseal(resource.inputs.value), { isSecret: true, value: TURNSTILE_WIDGET_SECRET });
});

test("every production runtime secret keeps its _PROD store name", () => {
  const names = storeSecrets(resources).map((resource) => resource.inputs.name).sort();
  assert.deepEqual(names, [
    ...VENDOR_KEYS.map((name) => `${name}_PROD`),
    "ANON_ID_SECRET_PROD", "TURNSTILE_SECRET_PROD",
  ].sort());
});
