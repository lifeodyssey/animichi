import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTAINER_ENV_KEYS,
  CONTAINER_REQUIRED_KEYS,
  buildContainerEnvVars,
  resolveContainerEnvVars,
} from "../src/container/container-env.ts";

function requiredEnv(): Record<string, string> {
  return { DEEPSEEK_API_KEY: "k", MIMO_API_KEY: "k", SUPABASE_DB_URL: "postgres://x", APP_ENV: "development" };
}

void test("ANON_DAILY_MESSAGE_QUOTA reaches the container (issue #282) — wrangler.toml alone is not the whole contract", () => {
  const envVars = buildContainerEnvVars({ ...requiredEnv(), ANON_DAILY_MESSAGE_QUOTA: "20" });
  assert.equal(envVars.ANON_DAILY_MESSAGE_QUOTA, "20");
});

void test("an unset ANON_DAILY_MESSAGE_QUOTA is simply absent, not forwarded as an empty string", () => {
  const envVars = buildContainerEnvVars(requiredEnv());
  assert.equal("ANON_DAILY_MESSAGE_QUOTA" in envVars, false);
});

void test("photo-search quota settings reach the container", () => {
  const envVars = buildContainerEnvVars({
    ...requiredEnv(),
    PHOTO_SEARCH_QUOTA_ANON: "3",
    PHOTO_SEARCH_QUOTA_MEMBER: "8",
  });
  assert.equal(envVars.PHOTO_SEARCH_QUOTA_ANON, "3");
  assert.equal(envVars.PHOTO_SEARCH_QUOTA_MEMBER, "8");
});

// #284 Task 7 (PR #478 review): `entry.ts` imports `Container` from
// `@cloudflare/containers`, whose ESM build only resolves under workerd's
// module loader (see `containerEnv.ts`'s header comment) — so this cannot be a
// plain `import` + runtime-shape assertion under `node --test`. A source-text
// check is the closest thing to a regression guard we can run outside
// wrangler/workerd: `applyOutboundInterception` hard-throws at container start
// when `ctx.exports.ContainerProxy` is undefined, so losing this export line
// would silently make `deniedHosts` (and any outbound interception) inert.
void test("entry.ts re-exports ContainerProxy from @cloudflare/containers", () => {
  const entrySource = readFileSync(new URL("../src/entry.ts", import.meta.url).pathname, "utf8");
  assert.match(entrySource, /export\s*\{\s*ContainerProxy\s*\}\s*from\s*["']@cloudflare\/containers["']/);
});

void test("entry.ts hydrates Secrets Store env before container start (#1157)", () => {
  const entrySource = readFileSync(new URL("../src/entry.ts", import.meta.url).pathname, "utf8");
  assert.match(entrySource, /resolveContainerEnvVars/);
  assert.match(entrySource, /override async start\(/);
  assert.match(entrySource, /override async startAndWaitForPorts\(/);
});

void test("resolveContainerEnvVars omits absent AGENT_SVC_DATABASE_URL (#1157)", async () => {
  const environmentVars = await resolveContainerEnvVars(requiredEnv());
  assert.equal("AGENT_SVC_DATABASE_URL" in environmentVars, false);
});

void test("resolveContainerEnvVars omits an empty store AGENT_SVC_DATABASE_URL (#1157)", async () => {
  const environmentVars = await resolveContainerEnvVars({
    ...requiredEnv(),
    AGENT_SVC_DATABASE_URL: { get: () => Promise.resolve("") },
  });
  assert.equal("AGENT_SVC_DATABASE_URL" in environmentVars, false);
});

void test("ZEN_GO_API_KEY is forwarded to the container when set (#1160)", () => {
  const environmentVars = buildContainerEnvVars({ ...requiredEnv(), ZEN_GO_API_KEY: "zen-key" });
  assert.equal(environmentVars.ZEN_GO_API_KEY, "zen-key");
});

void test("ZEN_GO_API_KEY is optional on the Worker: absent stays omitted, never required", () => {
  assert.equal(CONTAINER_ENV_KEYS.includes("ZEN_GO_API_KEY"), true);
  assert.equal(CONTAINER_REQUIRED_KEYS.includes("ZEN_GO_API_KEY"), false);
  assert.equal("ZEN_GO_API_KEY" in buildContainerEnvVars(requiredEnv()), false);
});

void test("artifact promotion never ferries model keys through GitHub", () => {
  const cd = readFileSync(new URL("../../../.github/workflows/cd.yml", import.meta.url).pathname, "utf8");
  const promotion = readFileSync(
    new URL("../../../.github/scripts/promote-release-unit.sh", import.meta.url).pathname,
    "utf8",
  );
  for (const key of ["ZEN_GO_API_KEY", "MIMO_API_KEY", "DEEPSEEK_API_KEY"]) {
    assert.doesNotMatch(cd, new RegExp(key));
    assert.doesNotMatch(promotion, new RegExp(key));
  }
  assert.doesNotMatch(promotion, /secret put|worker_secrets/);
});
