import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WRANGLER = readFileSync(`${ROOT}workers/edge/wrangler.toml`, "utf8");
const TOP_LEVEL = WRANGLER.slice(0, WRANGLER.indexOf("\n[vars]\n"));
const READ_CONFIG_SCRIPT = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const config = unstable_readConfig({ config: process.argv[1], env: process.argv[2] });
process.stdout.write(String(config.name));
`;

function blockFor(header: string): string {
  const start = WRANGLER.indexOf(`\n${header}\n`) + 1;
  assert.notEqual(start, 0, `missing Wrangler section ${header}`);
  const next = WRANGLER.indexOf("\n[", start + header.length);
  return WRANGLER.slice(start, next === -1 ? undefined : next);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAssignment(block: string, key: string, value: string): boolean {
  return new RegExp(`^${key}\\s*=\\s*"${escapeRegExp(value)}"$`, "m").test(block);
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function parsedWorkerName(environment: string): string {
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", READ_CONFIG_SCRIPT, `${ROOT}workers/edge/wrangler.toml`, environment],
    { encoding: "utf8" },
  );
}

const STAGING_NEON_JWKS =
  "https://REDACTED-NEON-ENDPOINT.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth/.well-known/jwks.json";

// AUTH-2 #950 hard cut: the JWKS URL is the edge's ONLY identity source;
// the activation flag and issuer slot are deleted. Production must not carry
// a JWKS until its branch is provisioned (empty fails closed).
void test("staging pins the Neon Auth JWKS as the only identity source", () => {
  const staging = blockFor("[env.staging.vars]");
  assert.equal(hasAssignment(staging, "NEON_AUTH_JWKS_URL", STAGING_NEON_JWKS), true, "staging must pin the JWKS endpoint");
});

void test("production has no JWKS yet — unprovisioned fails closed", () => {
  const prod = blockFor("[env.production.vars]");
  assert.equal(hasAssignment(prod, "NEON_AUTH_JWKS_URL", ""), false, "production JWKS must stay unset until the branch is provisioned");
});

void test("bare Wrangler deploy has no target, while named environments keep theirs", () => {
  assert.equal(/^name\s*=/m.test(TOP_LEVEL), false, "top-level Wrangler config must not select a deploy target");
  assert.equal(hasAssignment(blockFor("[[containers]]"), "name", "animichi-runtimecontainer"), true);
  assert.equal(hasAssignment(blockFor("[env.production]"), "name", "animichi"), true);
  assert.equal(hasAssignment(blockFor("[env.staging]"), "name", "animichi-staging"), true);
});

void test("named Wrangler environments pass the real config parser", () => {
  const environments = [
    ["staging", "animichi-staging"],
    ["production", "animichi"],
  ] as const;
  for (const [environment, expectedName] of environments) {
    assert.equal(parsedWorkerName(environment), expectedName);
  }
});

void test("ci.yml keeps both JWKS secret paths complete", () => {
  const workflowText = readFileSync(`${ROOT}.github/workflows/ci.yml`, "utf8");
  assert.equal(countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL\s*$/gm), 2, "ci.yml JWKS secret lists must stay complete");
  assert.equal(
    countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL: \$\{\{ secrets\.NEON_AUTH_JWKS_URL \}\}$/gm),
    2,
    "ci.yml JWKS secret mappings must stay complete",
  );
  assert.equal(workflowText.includes("NEON_AUTH_ENABLED"), false, "ci.yml must not turn the disabled public var into a secret");
  assert.equal(workflowText.includes("NEON_AUTH_ISSUER"), false, "ci.yml must not turn the public issuer into a secret");
});

void test("deploy.yml keeps its JWKS secret path complete", () => {
  const workflowText = readFileSync(`${ROOT}.github/workflows/deploy.yml`, "utf8");
  assert.equal(countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL\s*$/gm), 1, "deploy.yml JWKS secret list must stay complete");
  assert.equal(
    countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL: \$\{\{ secrets\.NEON_AUTH_JWKS_URL \}\}$/gm),
    1,
    "deploy.yml JWKS secret mapping must stay complete",
  );
  assert.equal(workflowText.includes("NEON_AUTH_ENABLED"), false, "deploy.yml must not turn the disabled public var into a secret");
  assert.equal(workflowText.includes("NEON_AUTH_ISSUER"), false, "deploy.yml must not turn the public issuer into a secret");
});

void test("reusable-deploy-component.yml keeps its JWKS declaration and paths complete", () => {
  const workflowText = readFileSync(`${ROOT}.github/workflows/reusable-deploy-component.yml`, "utf8");
  assert.equal(countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL:\s*$/gm), 1, "reusable-deploy-component.yml must declare JWKS");
  // PR #751's resolve step legitimately repeats the env block for bash indirect expansion,
  // so NEON_AUTH_JWKS_URL appears once in wrangler env, once in the post-deploy env, and once in the resolve-step env.
  assert.equal(
    countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL: \$\{\{ secrets\.NEON_AUTH_JWKS_URL \}\}$/gm),
    3,
    "reusable-deploy-component.yml JWKS secret mappings must stay complete (wrangler env + post-deploy env + resolve-step env)",
  );
  assert.equal(workflowText.includes("NEON_AUTH_ENABLED"), false, "reusable-deploy-component.yml must not turn the disabled public var into a secret");
  assert.equal(workflowText.includes("NEON_AUTH_ISSUER"), false, "reusable-deploy-component.yml must not turn the public issuer into a secret");
});
