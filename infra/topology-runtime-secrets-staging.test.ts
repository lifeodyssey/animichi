/** The staging runtime-secret graph (#1676 AC4).
 *
 * `runtimeConfig()` carries the four VENDOR_KEYS only: neither TURNSTILE_SECRET
 * nor ANON_ID_SECRET exists in stack config any more, so a `requireSecret` for
 * either would fail this whole process with `ConfigMissingError`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { only, unseal } from "./testing/harness.ts";
import {
  buildRuntimeSecrets,
  GENERATED_IDENTITY_SEED,
  RUNTIME_KEYS,
  storeSecrets,
  TURNSTILE_WIDGET_SECRET,
  TURNSTILE_WIDGET_SITEKEY,
  VENDOR_KEYS,
} from "./testing/runtime-secrets.ts";

const resources = await buildRuntimeSecrets("staging");

test("staging provisions all six runtime secrets with exact names", () => {
  assert.deepEqual(storeSecrets(resources).map((resource) => resource.name).sort(), [...RUNTIME_KEYS].sort());
});

for (const name of VENDOR_KEYS) {
  test(`staging ${name} is worker-scoped and its resource input is secret-marked`, () => {
    const resource = storeSecrets(resources).find((resource) => resource.name === name);
    assert.ok(resource);
    assert.equal(resource.type, "cloudflare:index/secretsStoreSecret:SecretsStoreSecret");
    assert.equal(resource.inputs.accountId, "account-fixture");
    assert.equal(resource.inputs.storeId, "store-fixture");
    assert.deepEqual(resource.inputs.scopes, ["workers"]);
    assert.deepEqual(unseal(resource.inputs.value), { isSecret: true, value: `fixture-${resource.name}` });
  });
}

test("staging adopts the account's one Turnstile widget instead of creating it", () => {
  const widget = only(resources, "cloudflare:index/turnstileWidget:TurnstileWidget");
  assert.equal(widget.id, `account-fixture/${TURNSTILE_WIDGET_SITEKEY}`);
  assert.deepEqual(widget.inputs, {
    accountId: "account-fixture",
    name: "animichi.com (Spin)",
    domains: ["127.0.0.1", "animichi.com", "localhost"],
    mode: "managed",
  });
});

test("TURNSTILE_SECRET is the widget's provider output, not stack config", () => {
  const resource = storeSecrets(resources).find((resource) => resource.name === "TURNSTILE_SECRET");
  assert.ok(resource);
  assert.deepEqual(unseal(resource.inputs.value), { isSecret: true, value: TURNSTILE_WIDGET_SECRET });
});

test("ANON_ID_SECRET is generated, not stack config", () => {
  const resource = storeSecrets(resources).find((resource) => resource.name === "ANON_ID_SECRET");
  assert.ok(resource);
  assert.deepEqual(unseal(resource.inputs.value), { isSecret: true, value: GENERATED_IDENTITY_SEED });
  assert.deepEqual(only(resources, "random:index/randomPassword:RandomPassword").inputs, {
    length: 48,
    special: false,
  });
});
