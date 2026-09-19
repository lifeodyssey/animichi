import test from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeSecrets, runtimeConfig, storeSecrets } from "./testing/runtime-secrets.ts";

test("production with anonymous access disabled needs neither identity nor Turnstile secrets", async () => {
  const config = runtimeConfig();
  config["animichi-neon-secrets:anonymousAccessEnabled"] = "false";
  const resources = await buildRuntimeSecrets("prod", config);
  assert.deepEqual(storeSecrets(resources).map((resource) => resource.inputs.name).sort(), [
    "GOOGLE_MAPS_API_KEY_PROD", "INGEST_SIGNING_KEY_PROD", "LOGFIRE_TOKEN_PROD",
    "MIMO_API_KEY_PROD", "ZEN_GO_API_KEY_PROD",
  ]);
  // anonymous access off means the stack never touches the widget: no adopted
  // resource and no data-source read either (the one owner is staging).
  assert.equal(resources.some((resource) => resource.type.includes("Turnstile") || resource.type.includes("randomPassword")), false);
});
