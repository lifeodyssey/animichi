import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("./release-web-runtime-config.mjs", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const pristine = await import(sourceUrl);
let mutantId = 0;
const baseEnv = {
  VITE_NEON_AUTH_BASE_URL: "https://auth.animichi.com",
  VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  VITE_SHOWCASE_MODE: "false",
};

async function loadMutant(find, replacement) {
  assert.notEqual(source.includes(find), false, `mutation target missing: ${find}`);
  const mutated = source.replace(find, replacement);
  const encoded = Buffer.from(mutated).toString("base64");
  mutantId += 1;
  return import(`data:text/javascript;base64,${encoded}#${mutantId}`);
}

async function killed(label, find, replacement, name, value) {
  const mutant = await loadMutant(find, replacement);
  const env = { ...baseEnv, [name]: value };
  assert.throws(() => pristine.validatePublicEnvironment(env), `${label} is not covered by pristine behavior`);
  assert.doesNotThrow(() => mutant.validatePublicEnvironment(env), `${label} mutation did not weaken the guard`);
  console.log(`PASS: ${label} killed`);
}

await killed("site-key shape guard", "validateSiteKey(siteKey);", "", "VITE_TURNSTILE_SITE_KEY", "short");
await killed("known-prefix guard", "SECRET_PREFIXES.some((prefix) => value.startsWith(prefix))", "false", "VITE_CF_BEACON_TOKEN", "pk_x");
await killed("private-key guard", "PRIVATE_KEY.test(value)", "false", "VITE_CF_BEACON_TOKEN", "-----BEGIN PRIVATE KEY-----");
await killed("long material guard", "value.length >= SECRET_MIN_LENGTH && SECRET_ALPHABET.test(value)", "false", "VITE_CF_BEACON_TOKEN", "A".repeat(40));
await killed("HTTPS URL guard", 'if (url.protocol !== "https:") fail(name, "must use HTTPS");', "", "VITE_AGENT_URL", "http://api.example.test");
await killed("URL credential/query guard", "if (url.username || url.password || url.search || url.hash) {", "if (false) {", "VITE_AGENT_URL", "https://api.example.test?token=secret");
