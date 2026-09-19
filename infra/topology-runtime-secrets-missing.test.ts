import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { RUNTIME_KEYS, VENDOR_KEYS, runtimeConfig } from "./testing/runtime-secrets.ts";

/** Load the program in its own process: it installs mocks and reads config at
 * import time, so one config permutation is one process. */
function runProgram(script: string, name: string) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", script, name], {
    cwd: new URL(".", import.meta.url), encoding: "utf8",
  });
}

// Only the vendor keys are stack config; TURNSTILE_SECRET comes from the
// adopted widget and ANON_ID_SECRET is generated, so deleting either of those
// from config must stay a no-op (a `requireSecret` for either would turn this
// file red through the staging build in topology-runtime-secrets-staging).
//
// Absent and blank are two ways the same key goes unset, and they fail in two
// different places: Pulumi raises ConfigMissingError for the key that is not
// there, and `requiredVendorSecret` raises for the one that is there and empty.
// Checking only presence would provision an empty credential that everything
// downstream accepts and no caller can authenticate with.
for (const name of VENDOR_KEYS) {
  test(`missing ${name} fails the Pulumi program instead of omitting its resource`, () => {
    const script = `import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";
      const config = runtimeConfig();
      delete config["animichi-neon-secrets:" + process.argv[1]];
      await buildRuntimeSecrets("staging", config);`;
    const result = runProgram(script, name);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`Missing required configuration variable 'animichi-neon-secrets:${name}'`));
  });

  test(`blank ${name} fails the Pulumi program instead of provisioning an unusable credential`, () => {
    const script = `import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";
      const config = runtimeConfig();
      config["animichi-neon-secrets:" + process.argv[1]] = " ";
      await buildRuntimeSecrets("staging", config);`;
    const result = runProgram(script, name);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`Empty runtime secret: ${name}`));
  });
}

// The staging build in its own file runs on this exact config, so a
// `requireSecret` for either generated name would fail there with
// ConfigMissingError.
test("no generated runtime secret is required from stack config", () => {
  const configured = Object.keys(runtimeConfig()).map((key) => key.split(":")[1] ?? "");
  assert.deepEqual(configured.filter((name) => RUNTIME_KEYS.includes(name)), VENDOR_KEYS);
});
