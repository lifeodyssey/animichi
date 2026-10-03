import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { process } from "../test-support/node-globals.ts";

// SUT: the #1929 Workers.dev mirror rings — the API also deployed as its own
// scripts (`animichi-api-staging` / `animichi-api`) beside the old ones, whose
// zone routes stay untouched. The card's failure modes are configuration, not
// code, so this reads every ring through the REAL wrangler parser (the shape
// `deployment-contract.test.ts` established): a value that survives only
// through env-ring inheritance is still what the deploy would send.
//
// The ways this goes wrong, each owned by one test below:
//   - a ring that deploys under a renamed or inherited script name;
//   - the staging host serving outside Access, or the production host opening
//     the exposure #539/#1524 closed;
//   - a brand-new Worker replaying the v1–v6 chain of classes it never
//     exported, or declaring a lifecycle other than the live two classes;
//   - the mirror starting without a secret, binding or identity source the
//     old script holds (per-script secrets do not follow a rename);
//   - a shared rate-limit namespace coupling the mirror's counters to the old
//     script's.
//
// test-type: unit (parses a checked-in config through wrangler; no network,
// no clock, no mocks).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = `${ROOT}workers/api/wrangler.toml`;

const READ_RINGS = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const view = (env) => {
  const c = unstable_readConfig({ config: process.argv[1], ...(env === "default" ? {} : { env }) });
  return { name: c.name, workers_dev: c.workers_dev, preview_urls: c.preview_urls,
    migrations: c.migrations ?? [], exports: c.exports ?? {},
    services: (c.services ?? []).map((s) => [s.binding, s.service]),
    r2: (c.r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]),
    dos: (c.durable_objects?.bindings ?? []).map((b) => [b.name, b.class_name]),
    secrets: (c.secrets_store_secrets ?? []).map((s) => [s.binding, s.secret_name]),
    ratelimits: (c.ratelimits ?? []).map((r) => String(r.namespace_id)),
    jwks: c.vars?.NEON_AUTH_JWKS_URL };
};
const rings = ["default", "staging", "production", "api-staging", "api-production"];
process.stdout.write(JSON.stringify(Object.fromEntries(rings.map((ring) => [ring, view(ring)]))));
`;

interface RingConfig {
  name: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  migrations: unknown[];
  exports: Record<string, { type: string; storage?: string }>;
  services: [string, string][];
  r2: [string, string][];
  dos: [string, string][];
  secrets: [string, string][];
  ratelimits: string[];
  jwks?: string;
}

const readRingConfigs = (): Record<string, RingConfig> => {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", READ_RINGS, CONFIG], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
  });
  return JSON.parse(output) as Record<string, RingConfig>;
};

type RingName = "default" | "staging" | "production" | "api-staging" | "api-production";

const RINGS = readRingConfigs() as Record<RingName, RingConfig>;

const LIVE_EXPORTS = {
  EdgeGuard: { type: "durable-object", storage: "sqlite" },
  AgentSession: { type: "durable-object", storage: "sqlite" },
};

void test("the mirror rings deploy under their own script names", () => {
  assert.equal(RINGS["api-staging"].name, "animichi-api-staging");
  assert.equal(RINGS["api-production"].name, "animichi-api");
});

void test("the staging mirror serves a workers.dev host and production's stays closed", () => {
  assert.equal(RINGS["api-staging"].workers_dev, true, "staging mirror workers.dev is the CD smoke surface");
  assert.equal(RINGS["api-production"].workers_dev, false, "production has no Access application (#1524)");
  assert.equal(RINGS["api-staging"].preview_urls, false, "preview URLs are behind no Access application");
  assert.equal(RINGS["api-production"].preview_urls, false, "preview URLs are behind no Access application");
});

void test("the mirror scripts declare the live classes through exports, never the old chain", () => {
  // A brand-new Worker cannot replay v1–v6 for classes it never exported, and
  // `exports` is mutually exclusive with `migrations`: the empty override must
  // hold against the inherited top-level chain, and only the live classes may
  // carry the sqlite lifecycle.
  for (const ring of ["api-staging", "api-production"] as const) {
    assert.deepEqual(RINGS[ring].migrations, [], `${ring} must not inherit any migration tag`);
    assert.deepEqual(RINGS[ring].exports, LIVE_EXPORTS, `${ring} declarative exports`);
  }
});

void test("the staging mirror binds everything the old staging script binds", () => {
  // Per-script secrets do not follow a rename (#1929 ways-this-can-go-wrong):
  // a binding the old ring holds and the mirror lacks starts the new script
  // without a credential the old one had, with no red anywhere.
  const old = RINGS.staging;
  const mirror = RINGS["api-staging"];
  assert.deepEqual(mirror.services, old.services);
  assert.deepEqual(mirror.r2, old.r2);
  assert.deepEqual(mirror.dos, old.dos);
  assert.deepEqual(mirror.secrets, old.secrets);
  assert.equal(mirror.jwks, old.jwks, "both staging scripts verify the same branch JWKS");
});

void test("the production mirror binds everything the old production script binds", () => {
  const old = RINGS.production;
  const mirror = RINGS["api-production"];
  assert.deepEqual(mirror.services, old.services);
  assert.deepEqual(mirror.r2, old.r2);
  assert.deepEqual(mirror.dos, old.dos);
  assert.deepEqual(mirror.secrets, old.secrets);
});

void test("every rate-limit namespace on the account stays distinct", () => {
  // Two bindings sharing a namespace_id share one global counter; a mirror
  // reusing the old script's id would couple the two scripts' counters.
  assert.deepEqual(
    ([["default"], ["staging"], ["production"], ["api-staging"], ["api-production"]] as const)
      .flatMap(([ring]) => RINGS[ring].ratelimits)
      .sort(),
    ["100001", "100002", "100003", "100004", "100005"],
  );
});
