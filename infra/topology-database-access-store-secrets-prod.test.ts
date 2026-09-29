/** The production stack's half of the Secrets Store pair table.
 *
 * The staging table (`topology-database-access-store-secrets.test.ts`) loads
 * the program as the `staging` stack, and a process can load it once, so the
 * production case is this file of its own. Building `prod` is the point: the
 * suffix derives from the stack name (`pulumi.getStack()`), so a table that
 * only ever built staging would pass a broken suffix vacuously — #1947's
 * second way this can go wrong. Each pair is the (Pulumi logical name, real
 * store `name`) pair #1940 broke and every wrangler binding resolves.
 *
 * The three config-gated Auth pairs are UNSUFFIXED because the program
 * composes their names without `nameSuffix` on every stack
 * (`database-access/store-secrets.ts`); the committed prod stack config leaves
 * those keys unset and so writes none of them, but the harness sets the keys
 * to pin the whole graph rather than the stacks' shared subset — exactly the
 * staging table's choice. The seven `_PROD` runtime rows come from
 * `database-access/runtime-secrets.ts`, which `index.ts` re-exports: staging
 * and production share ONE Cloudflare Secrets Store, so the whole name space
 * is one contract.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ofType, type Built } from "./testing/harness.ts";
import { buildDatabaseAccess } from "./testing/database-access.ts";

const STORE_SECRET_TYPE = "cloudflare:index/secretsStoreSecret:SecretsStoreSecret";

/** One row per secret, sorted by logical name for the comparison: the order the
 * graph happens to build them in is not a contract, the pairs are. */
const EXPECTED: readonly (readonly [string, string])[] = [
  ["AGENT_SVC_DATABASE_URL_PROD", "AGENT_SVC_DATABASE_URL_PROD"],
  ["AGENT_SVC_PASSWORD_PROD", "AGENT_SVC_PASSWORD_PROD"],
  ["ANON_ID_SECRET_PROD", "ANON_ID_SECRET_PROD"],
  ["CATALOG_DATABASE_URL_PROD", "CATALOG_DATABASE_URL_PROD"],
  ["CATALOG_SVC_PASSWORD_PROD", "CATALOG_SVC_PASSWORD_PROD"],
  ["GOOGLE_MAPS_API_KEY_PROD", "GOOGLE_MAPS_API_KEY_PROD"],
  ["INGEST_SIGNING_KEY_PROD", "INGEST_SIGNING_KEY_PROD"],
  ["LOGFIRE_TOKEN_PROD", "LOGFIRE_TOKEN_PROD"],
  ["MIGRATOR_DATABASE_URL_PROD", "MIGRATOR_DATABASE_URL_PROD"],
  ["MIMO_API_KEY_PROD", "MIMO_API_KEY_PROD"],
  ["TURNSTILE_SECRET_PROD", "TURNSTILE_SECRET_PROD"],
  ["USERS_DATABASE_URL_PROD", "USERS_DATABASE_URL_PROD"],
  ["USERS_SVC_PASSWORD_PROD", "USERS_SVC_PASSWORD_PROD"],
  ["ZEN_GO_API_KEY_PROD", "ZEN_GO_API_KEY_PROD"],
  ["catalog-admin-token_PROD", "CATALOG_ADMIN_TOKEN_PROD"],
  ["neon-auth-jwks-url", "NEON_AUTH_JWKS_URL"],
  ["qa-neon-user-email", "QA_NEON_USER_EMAIL"],
  ["qa-neon-user-password", "QA_NEON_USER_PASSWORD"],
];

const built: Built[] = await buildDatabaseAccess("prod");

test("production emits exactly these store secrets, logical name and real name apart", () => {
  const pairs = ofType(built, STORE_SECRET_TYPE).map(
    (secret): readonly [string, string] => [secret.name, String(secret.inputs.name)],
  );
  assert.deepEqual(
    pairs.sort(),
    [...EXPECTED].sort(),
    "the prod stack's store-secret names carry the \"_PROD\" suffix (#1048), and staging and "
      + "production share ONE store: a name that lost the suffix would not fail loudly — the "
      + "production apply would overwrite staging's secret, and Cloudflare deletes on rename, "
      + "which is how #1940 lost CATALOG_ADMIN_TOKEN",
  );
});
