import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { RUNTIME_KEYS, VENDOR_KEYS, runtimeConfig } from "./testing/runtime-secrets.ts";

// Only the vendor keys are stack config; TURNSTILE_SECRET comes from the
// adopted widget and ANON_ID_SECRET is generated, so deleting either of those
// from config must stay a no-op (a `requireSecret` for either would turn this
// file red through the staging build in topology-runtime-secrets-staging).
for (const name of VENDOR_KEYS) {
  test(`missing ${name} fails the Pulumi program instead of omitting its resource`, () => {
    const script = `import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";
      const config = runtimeConfig();
      delete config["animichi-neon-secrets:" + process.argv[1]];
      await buildRuntimeSecrets("staging", config);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, name], {
      cwd: new URL(".", import.meta.url), encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`Missing required configuration variable 'animichi-neon-secrets:${name}'`));
  });
}

// The staging build in its own file runs on this exact config, so a
// `requireSecret` for either generated name would fail there with
// ConfigMissingError.
test("no generated runtime secret is required from stack config", () => {
  const configured = Object.keys(runtimeConfig()).map((key) => key.split(":")[1] ?? "");
  assert.deepEqual(configured.filter((name) => RUNTIME_KEYS.includes(name)), VENDOR_KEYS);
});

test("a blank runtime config fails instead of provisioning an unusable credential", () => {
  const script = `import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";
    await buildRuntimeSecrets("staging", { ...runtimeConfig(), "animichi-neon-secrets:MIMO_API_KEY": " " });`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL(".", import.meta.url), encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Empty runtime secret: MIMO_API_KEY/);
});
