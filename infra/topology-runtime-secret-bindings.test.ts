/** The wrangler half of the runtime-secrets contract: which Worker binds which
 * store secret, in which environment, under which name.
 *
 * One table covers every Worker that carries a runtime binding, and one loop
 * asserts it for all of them, deliberately. This file used to read
 * `workers/edge/wrangler.toml` and nothing else, so a runtime secret could be
 * provisioned by the Pulumi program while the Worker that needs it declared no
 * binding at all — the state `INGEST_SIGNING_KEY` (#1792) arrived in, with
 * catalog's anitabi egress fail-closed behind it. A copy of this file for the
 * next Worker would drift from it the same way, so a Worker is added to WORKERS
 * and to RUNTIME_BINDERS instead.
 *
 * Scope: the RUNTIME_KEYS names, plus the one negative list below. A Worker's
 * other bindings — the DSNs, the catalog admin token — belong to their own
 * contracts and are ignored here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { parse } from "smol-toml";
import { RUNTIME_KEYS } from "./testing/runtime-secrets.ts";

/** The account's one default Secrets Store. Staging and production share it, so
 * the secret NAME is the only thing separating their credentials. */
const STORE_ID = "66c9bb0faef644b4a0671bb7d90d98bd";

/** Every Worker that carries runtime bindings, under the name a failure has to
 * say out loud. */
const WORKERS = [
  { worker: "edge", wrangler: "../workers/edge/wrangler.toml" },
  { worker: "catalog", wrangler: "../workers/catalog/wrangler.toml" },
] as const;

type WorkerName = (typeof WORKERS)[number]["worker"];
type Environment = "staging" | "production";

/** Which Workers bind each runtime secret, per environment — one row per
 * RUNTIME_KEYS entry, which the coverage test below pins in both directions. So
 * a secret cannot be provisioned and reach no Worker, and a Worker cannot
 * quietly grow a runtime binding it does not consume.
 *
 * `INGEST_SIGNING_KEY` is catalog's alone: catalog signs its anitabi fetches for
 * the egress service in `apps/anitabi-egress`, and the edge never signs.
 * Production disables anonymous access, so the two anonymous secrets have no
 * production binder — the stack provisions neither there. */
const RUNTIME_BINDERS: Record<string, Record<Environment, readonly WorkerName[]>> = {
  MIMO_API_KEY: { staging: ["edge"], production: ["edge"] },
  ZEN_GO_API_KEY: { staging: ["edge"], production: ["edge"] },
  GOOGLE_MAPS_API_KEY: { staging: ["edge"], production: ["edge"] },
  LOGFIRE_TOKEN: { staging: ["edge"], production: ["edge"] },
  TURNSTILE_SECRET: { staging: ["edge"], production: [] },
  ANON_ID_SECRET: { staging: ["edge"], production: [] },
  INGEST_SIGNING_KEY: { staging: ["catalog"], production: ["catalog"] },
};

/** Store bindings that must not come back, in any Worker. Neither is a
 * RUNTIME_KEYS name, so the contract above cannot see them — a stray one would
 * dangle at deploy time, naming a store secret the program no longer
 * provisions. `SUPABASE_DB_URL` was retired with #1370's forwarding removal and
 * `DEEPSEEK_API_KEY` with the MiMo-only runtime. They keep their own list
 * rather than a hand-copied assertion per Worker, which is how they were lost
 * once already. */
const RETIRED_BINDINGS: readonly string[] = ["SUPABASE_DB_URL", "DEEPSEEK_API_KEY"];

/** Each stack's imported ESC environment, store-name suffix, and the
 * anonymous-access flag that gates the two identity secrets. */
const ENVIRONMENTS = [
  { environment: "staging", stack: "staging", suffix: "", anonymousAccess: true },
  { environment: "production", stack: "prod", suffix: "_PROD", anonymousAccess: false },
] as const;

/** One `secrets_store_secrets` entry. A type alias rather than an interface,
 * deliberately: only an object literal type is given the implicit index
 * signature that makes it comparable to smol-toml's `TomlTable`, so `parse(...)
 * as ...` is rejected (TS2352) when this is spelled `interface`. */
type StoreBinding = {
  binding: string;
  store_id: string;
  secret_name: string;
};

function wranglerSource(wrangler: string): string {
  return readFileSync(fileURLToPath(new URL(wrangler, import.meta.url)), "utf8");
}

function escEnvironment(stack: string): string {
  return readFileSync(new URL(`./database-access/Pulumi.${stack}.yaml`, import.meta.url), "utf8");
}

/** Every store binding a Worker declares in `environment`, runtime or not: the
 * contract below needs the whole list to assert a retired name is absent, and
 * the store each runtime binding resolves through and the name it must carry
 * are checked in the same deepEqual. */
function declaredStoreBindings(worker: (typeof WORKERS)[number], environment: Environment): StoreBinding[] {
  const document = parse(wranglerSource(worker.wrangler)) as {
    env: Record<string, { secrets_store_secrets: StoreBinding[] }>;
  };
  return document.env[environment].secrets_store_secrets;
}

/** The runtime bindings a Worker must declare: its row in RUNTIME_BINDERS, in
 * RUNTIME_KEYS order, under the environment's store-name suffix. */
function requiredBindings(worker: WorkerName, environment: Environment, suffix: string): StoreBinding[] {
  return RUNTIME_KEYS
    .filter((name) => RUNTIME_BINDERS[name][environment].includes(worker))
    .map((name) => ({ binding: name, store_id: STORE_ID, secret_name: `${name}${suffix}` }));
}

for (const { environment, stack, suffix, anonymousAccess } of ENVIRONMENTS) {
  test(`${environment}: each Worker binds exactly the runtime secrets it consumes`, () => {
    for (const worker of WORKERS) {
      const declared = declaredStoreBindings(worker, environment);
      assert.deepEqual(
        declared.filter((binding) => RUNTIME_KEYS.includes(binding.binding)),
        requiredBindings(worker.worker, environment, suffix),
        `${worker.worker} must bind exactly its RUNTIME_BINDERS row in ${environment}`,
      );
      assert.deepEqual(
        declared.map((binding) => binding.binding).filter((name) => RETIRED_BINDINGS.includes(name)),
        [],
        `${worker.worker} must not declare a retired store binding in ${environment}`,
      );
    }
  });

  test(`${stack} imports its explicitly assigned ESC environment without inline runtime values`, () => {
    const document = load(escEnvironment(stack)) as {
      environment: string[];
      config: Record<string, unknown>;
    };
    assert.deepEqual(document.environment, [`animichi/${stack}`]);
    // Edge-only: the anonymous-access flag gates the edge Worker's two identity
    // secrets, and the ESC environment is where the deploy reads it from.
    const edge = parse(wranglerSource("../workers/edge/wrangler.toml")) as {
      env: Record<string, { vars: { ANON_ACCESS_ENABLED: string } }>;
    };
    assert.equal(document.config["animichi-neon-secrets:anonymousAccessEnabled"], anonymousAccess);
    assert.equal(edge.env[environment].vars.ANON_ACCESS_ENABLED, String(anonymousAccess));
    assert.deepEqual(Object.keys(document.config).filter((key) => RUNTIME_KEYS.some((name) => key.endsWith(`:${name}`))), []);
  });
}

test("every runtime secret has a binder, and every binder is a runtime secret", () => {
  // RUNTIME_KEYS is what the Pulumi program provisions; RUNTIME_BINDERS is who
  // consumes it. A name in one and not the other is either a secret no Worker
  // can read or a binding nothing provisions.
  assert.deepEqual(Object.keys(RUNTIME_BINDERS).sort(), [...RUNTIME_KEYS].sort());
});
