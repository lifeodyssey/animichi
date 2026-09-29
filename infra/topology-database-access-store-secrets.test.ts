/** Every Secrets Store secret the `database-access` program emits, as its
 * (Pulumi logical name, real store `name`) pair.
 *
 * #1940 replaced four inline `new cloudflare.SecretsStoreSecret` blocks with a
 * `storeSecret(name, value, comment)` factory that passed one string as BOTH.
 * For those four the logical name was never the real name, so the next staging
 * apply renamed `CATALOG_ADMIN_TOKEN` — Cloudflare deletes on rename — and the
 * deploy died at "Secrets Store binding 'CATALOG_ADMIN_TOKEN' … not found"
 * (staging CD run 35952003521). The DSN and runtime-password secrets kept
 * identical pairs throughout.
 *
 * This reads the resources the program constructs, not its declaration text,
 * because the defect lived at the call sites: a factory signature is not
 * evidence of what its callers pass. `testing/database-access.ts` explains how
 * the program loads without the release-time-generated Neon SDK.
 *
 * Staging, with the three Auth keys set: staging is the stack the rename broke,
 * and the Auth secrets are config-gated, so a stack that leaves the keys unset
 * provisions none of them and would pin three pairs as absent. The last seven
 * rows come from `database-access/runtime-secrets.ts`, which `index.ts`
 * re-exports — they are pinned here too because staging and production share
 * ONE store, so the whole name space is one contract.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ofType, type Built } from "./testing/harness.ts";
import { buildDatabaseAccess } from "./testing/database-access.ts";

const STORE_SECRET_TYPE = "cloudflare:index/secretsStoreSecret:SecretsStoreSecret";

/** One row per secret, sorted by logical name for the comparison: the order the
 * graph happens to build them in is not a contract, the pairs are. */
const EXPECTED: readonly (readonly [string, string])[] = [
  ["AGENT_SVC_DATABASE_URL", "AGENT_SVC_DATABASE_URL"],
  ["AGENT_SVC_PASSWORD", "AGENT_SVC_PASSWORD"],
  ["ANON_ID_SECRET", "ANON_ID_SECRET"],
  ["CATALOG_DATABASE_URL", "CATALOG_DATABASE_URL"],
  ["CATALOG_SVC_PASSWORD", "CATALOG_SVC_PASSWORD"],
  ["GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_API_KEY"],
  ["INGEST_SIGNING_KEY", "INGEST_SIGNING_KEY"],
  ["LOGFIRE_TOKEN", "LOGFIRE_TOKEN"],
  ["MIGRATOR_DATABASE_URL", "MIGRATOR_DATABASE_URL"],
  ["MIMO_API_KEY", "MIMO_API_KEY"],
  ["TURNSTILE_SECRET", "TURNSTILE_SECRET"],
  ["USERS_DATABASE_URL", "USERS_DATABASE_URL"],
  ["USERS_SVC_PASSWORD", "USERS_SVC_PASSWORD"],
  ["ZEN_GO_API_KEY", "ZEN_GO_API_KEY"],
  ["catalog-admin-token", "CATALOG_ADMIN_TOKEN"],
  ["neon-auth-jwks-url", "NEON_AUTH_JWKS_URL"],
  ["qa-neon-user-email", "QA_NEON_USER_EMAIL"],
  ["qa-neon-user-password", "QA_NEON_USER_PASSWORD"],
];

const built: Built[] = await buildDatabaseAccess("staging");

test("staging emits exactly these store secrets, logical name and real name apart", () => {
  const pairs = ofType(built, STORE_SECRET_TYPE).map(
    (secret): readonly [string, string] => [secret.name, String(secret.inputs.name)],
  );
  assert.deepEqual(
    pairs.sort(),
    [...EXPECTED].sort(),
    "a store secret's logical name is Pulumi's state identity and its `name` is what every "
      + "wrangler binding resolves; conflating them renames the store secret, and Cloudflare "
      + "deletes on rename (#1940 deleted CATALOG_ADMIN_TOKEN this way)",
  );
});
