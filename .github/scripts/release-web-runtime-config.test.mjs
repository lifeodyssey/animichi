import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildRuntimePayload, validatePublicEnvironment } from "./release-web-runtime-config.mjs";

const VALID = {
  VITE_SITE_ORIGIN: "https://animichi.com",
  VITE_CATALOG_URL: "https://animichi.com/v1/catalog",
  VITE_USERS_URL: "https://animichi.com/v1/users",
  VITE_AGENT_URL: "https://animichi.com/v1",
  VITE_NEON_AUTH_BASE_URL: "https://auth.animichi.com",
  VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  VITE_CF_BEACON_TOKEN: "00000000-0000-0000-0000-000000000000",
  VITE_SHOWCASE_MODE: "false",
};

function rejectsWithoutLeaking(name, value, message) {
  const env = { ...VALID, [name]: value };
  assert.throws(() => validatePublicEnvironment(env), message);
  try {
    validatePublicEnvironment(env);
  } catch (error) {
    if (value) assert.equal(String(error).includes(value), false, `${name} value leaked in the error`);
  }
}

validatePublicEnvironment(VALID);
assert.deepEqual(buildRuntimePayload(VALID), {
  schemaVersion: 1,
  api: {
    siteOrigin: "https://animichi.com",
    catalogUrl: "https://animichi.com/v1/catalog",
    usersUrl: "https://animichi.com/v1/users",
    agentUrl: "https://animichi.com/v1",
  },
  neonAuthBaseUrl: "https://auth.animichi.com",
  turnstileSiteKey: "1x00000000000000000000AA",
  showcaseMode: "false",
  cfBeaconToken: "00000000-0000-0000-0000-000000000000",
  featureFlags: {},
});

rejectsWithoutLeaking("VITE_TURNSTILE_SITE_KEY", "0".repeat(35), /public site-key shape/);
rejectsWithoutLeaking("VITE_SITE_ORIGIN", `ghp_${"x".repeat(36)}`, /secret-shaped/);
rejectsWithoutLeaking("VITE_CF_BEACON_TOKEN", "-----BEGIN PRIVATE KEY-----", /private-key/);
rejectsWithoutLeaking("VITE_AGENT_URL", "A".repeat(40), /secret-shaped/);
rejectsWithoutLeaking("VITE_SHOWCASE_MODE", "yes", /true or false/);
rejectsWithoutLeaking("VITE_NEON_AUTH_BASE_URL", "not-a-url", /valid URL/);
rejectsWithoutLeaking("VITE_CATALOG_URL", "also-not-a-url", /valid URL/);
rejectsWithoutLeaking("VITE_NEON_AUTH_BASE_URL", "", /required/);
for (const unsafeUrl of [
  "http://api.example.test",
  "https://user:secret@api.example.test",
  "https://api.example.test?token=secret",
  "https://api.example.test/#secret",
]) {
  rejectsWithoutLeaking("VITE_AGENT_URL", unsafeUrl, /HTTPS|credentials/);
}

const work = mkdtempSync(join(tmpdir(), "release-web-runtime-config-"));
const config = join(work, "wrangler.jsonc");
const injector = new URL("./inject-release-web-runtime-config.mjs", import.meta.url);
const original = '{"env":{"staging":{"vars":{}},"production":{"vars":{}}}}\n';
writeFileSync(config, original);

function runInjector(overrides) {
  return spawnSync(process.execPath, [injector.pathname], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, WEB_CONFIG_PATH: config, TARGET_ENVIRONMENT: "staging", ...VALID, ...overrides },
  });
}

const secret = `ghp_${"x".repeat(36)}`;
const rejected = runInjector({ VITE_CF_BEACON_TOKEN: secret });
assert.notEqual(rejected.status, 0);
assert.equal(readFileSync(config, "utf8"), original, "rejected input must not modify the release config");
assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(secret), false, "CLI output leaked a rejected value");

const accepted = runInjector({});
assert.equal(accepted.status, 0, accepted.stderr);
assert.match(readFileSync(config, "utf8"), /RUNTIME_CONFIG/);
for (const value of Object.values(VALID)) {
  assert.equal(`${accepted.stdout}${accepted.stderr}`.includes(value), false, "CLI output leaked a public config value");
}

console.log("release web runtime config: valid public values accepted; secret-shaped values rejected without disclosure");
