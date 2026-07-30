import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WRANGLER = readFileSync(`${ROOT}wrangler.toml`, "utf8");
const ENV_BLOCKS = ["[vars]", "[env.production.vars]", "[env.staging.vars]"];
const TOP_LEVEL = WRANGLER.slice(0, WRANGLER.indexOf("\n[vars]\n"));

function blockFor(header: string): string {
  const start = WRANGLER.indexOf(`\n${header}\n`) + 1;
  assert.notEqual(start, 0, `missing Wrangler section ${header}`);
  const next = WRANGLER.indexOf("\n[", start + header.length);
  return WRANGLER.slice(start, next === -1 ? undefined : next);
}

function hasAssignment(block: string, key: string, value: string): boolean {
  return new RegExp(`^${key}\\s*=\\s*"${value}"$`, "m").test(block);
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

test("Neon Auth vars stay on their intended Wrangler paths", () => {
  for (const header of ENV_BLOCKS) {
    const block = blockFor(header);
    assert.equal(hasAssignment(block, "NEON_AUTH_ENABLED", "false"), true, `${header} must keep Neon Auth off`);
    assert.equal(hasAssignment(block, "NEON_AUTH_ISSUER", ""), true, `${header} must declare the public issuer slot`);
  }
});

test("bare Wrangler deploy has no target, while named environments keep theirs", () => {
  assert.equal(/^name\s*=/m.test(TOP_LEVEL), false, "top-level Wrangler config must not select a deploy target");
  assert.equal(hasAssignment(blockFor("[env.production]"), "name", "animichi"), true);
  assert.equal(hasAssignment(blockFor("[env.staging]"), "name", "animichi-staging"), true);
});

test("ci.yml keeps both JWKS secret paths complete", () => {
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

test("deploy.yml keeps its JWKS secret path complete", () => {
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

test("_deploy-component.yml keeps its JWKS declaration and paths complete", () => {
  const workflowText = readFileSync(`${ROOT}.github/workflows/_deploy-component.yml`, "utf8");
  assert.equal(countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL:\s*$/gm), 1, "_deploy-component.yml must declare JWKS");
  assert.equal(
    countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL: \$\{\{ secrets\.NEON_AUTH_JWKS_URL \}\}$/gm),
    2,
    "_deploy-component.yml JWKS secret mappings must stay complete",
  );
  assert.equal(workflowText.includes("NEON_AUTH_ENABLED"), false, "_deploy-component.yml must not turn the disabled public var into a secret");
  assert.equal(workflowText.includes("NEON_AUTH_ISSUER"), false, "_deploy-component.yml must not turn the public issuer into a secret");
});
