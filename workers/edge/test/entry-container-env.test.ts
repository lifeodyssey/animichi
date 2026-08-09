import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildContainerEnvVars } from "../src/container/container-env.ts";

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
