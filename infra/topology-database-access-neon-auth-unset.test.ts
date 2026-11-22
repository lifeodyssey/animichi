/** The `database-access` program with the Neon Auth keys unset: production's state.
 *
 * `storeNeonAuthDeclarations` (`database-access/store-secrets.ts`) writes each
 * Auth secret only when its key is set, so an unset `neonAuthBaseUrl` stores no
 * `NEON_AUTH_JWKS_URL` at all, and the API Worker then fails closed on every
 * bearer. The first test is the presence anchor `testing/harness.ts` asks of
 * an absence: a short read of the graph fails it instead of passing the second.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ofType, type Built } from "./testing/harness.ts";
import { buildDatabaseAccess } from "./testing/database-access.ts";

const STORE_SECRET_TYPE = "cloudflare:index/secretsStoreSecret:SecretsStoreSecret";

const built: Built[] = await buildDatabaseAccess("prod", {});
const names = ofType(built, STORE_SECRET_TYPE).map((secret) => secret.name);

test("production still stores the migrator's database URL", () => {
  assert.equal(names.includes("MIGRATOR_DATABASE_URL_PROD"), true);
});

test("an unset Neon Auth base URL stores no JWKS address", () => {
  assert.equal(names.includes("neon-auth-jwks-url"), false);
});
