import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WRANGLER = readFileSync(`${ROOT}wrangler.toml`, "utf8");
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/deploy.yml", ".github/workflows/_deploy-component.yml"]
  .map((path) => readFileSync(`${ROOT}${path}`, "utf8"));
const ENV_BLOCKS = ["[vars]", "[env.production.vars]", "[env.staging.vars]"];

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

test("Neon Auth vars and JWKS secret stay on their intended deployment paths", () => {
  for (const header of ENV_BLOCKS) {
    const block = blockFor(header);
    assert.equal(hasAssignment(block, "NEON_AUTH_ENABLED", "false"), true, `${header} must keep Neon Auth off`);
    assert.equal(hasAssignment(block, "NEON_AUTH_ISSUER", ""), true, `${header} must declare the public issuer slot`);
  }

  const workflowText = WORKFLOWS.join("\n");
  assert.equal(countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL\s*$/gm), 3, "JWKS secret lists must stay complete");
  assert.equal(
    countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL: \$\{\{ secrets\.NEON_AUTH_JWKS_URL \}\}$/gm),
    5,
    "JWKS secret mappings must stay complete",
  );
  assert.equal(countMatches(workflowText, /^\s+NEON_AUTH_JWKS_URL:\s*$/gm), 1, "reusable workflow must declare JWKS");
  assert.equal(workflowText.includes("NEON_AUTH_ENABLED"), false, "the disabled public var must not become a secret");
  assert.equal(workflowText.includes("NEON_AUTH_ISSUER"), false, "the public issuer must not become a secret");
});
