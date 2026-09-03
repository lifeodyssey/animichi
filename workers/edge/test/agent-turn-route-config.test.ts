/**
 * W1-7 (#1256): the deployed VALUES of the agent-tier switch, per environment.
 *
 * The env-var three-touchpoint rule (feedback_env_var_three_touchpoints) is why
 * this file exists at all: a flag that only lives in `src/env.ts` is a flag
 * whose staging value nobody can see, and a flag only in `wrangler.toml` is one
 * the Worker never reads. All three touchpoints are asserted here — the config
 * per environment, the Env declaration, and the package guide that tells the
 * next reader which environment is on which tier.
 *
 * test-type: unit (all cases parse checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const wranglerToml = repoFile("../wrangler.toml");

/** The `wrangler.toml` section starting at `header`, up to the next section. */
function blockForHeader(header: string): string {
  const headerIndex = wranglerToml.indexOf(`\n${header}\n`);
  assert.ok(headerIndex >= 0, `wrangler.toml must contain a "${header}" section header line`);
  const nextHeaderIndex = wranglerToml.indexOf("\n[", headerIndex + header.length);
  return wranglerToml.slice(headerIndex, nextHeaderIndex === -1 ? undefined : nextHeaderIndex);
}

function turnRouteIn(header: string): string | undefined {
  return /^AGENT_TURN_ROUTE = "([^"]+)"/m.exec(blockForHeader(header))?.[1];
}

void test("staging is the environment the rewritten agent tier actually serves", () => {
  assert.equal(turnRouteIn("[env.staging.vars]"), "edge");
});

void test("production is untouched by this card — it still forwards to the container", () => {
  assert.equal(turnRouteIn("[env.production.vars]"), "container");
});

void test("the default (wrangler dev) block forwards to the container too", () => {
  assert.equal(turnRouteIn("[vars]"), "container");
});

void test("the Worker declares the variable it reads, so the flag is not a stringly env lookup", () => {
  assert.match(repoFile("../src/env.ts"), /AGENT_TURN_ROUTE\?: string;/);
});

void test("the package guide names the flag, so the next reader is not left to grep", () => {
  assert.match(repoFile("../AGENTS.md"), /AGENT_TURN_ROUTE/);
});

void test("the flag is consumed by the edge itself and never forwarded to the container", () => {
  assert.equal(repoFile("../src/container/container-env.ts").includes("AGENT_TURN_ROUTE"), false);
});

void test("the anonymous daily allowance the edge tier enforces is set in all three environments", () => {
  const configured = ["[vars]", "[env.production.vars]", "[env.staging.vars]"].map(
    (header) => /^ANON_DAILY_MESSAGE_QUOTA = "([^"]+)"/m.exec(blockForHeader(header))?.[1],
  );
  assert.deepEqual(configured, ["20", "20", "20"]);
});
