import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { readMigrationSchema } from "./migration-schema.ts";

// #1600 (Card F of the #1317 decomposition): the durable home for the photo-offer
// namespace. The chain under `migrations/neon` is the authority for what a database has
// after Atlas applies it, so these read it rather than a transcription of it — one test for
// the row the namespace stores, one for who may touch it. #1604 deleted the photo
// search API, but the chain it pinned is unchanged and retires with the Prisma flip
// (#1626), so this text pin stays with the other chain pins
// (`identity-policy-matrix.test.ts`, `staging-baseline-reset.test.ts`,
// `migrator-ac3-proof.test.ts`) until then. Its applied counterpart, which ran the chain
// against disposable PostgreSQL, was retired with the API in #1604.
//
// test-type: unit (reads checked-in migrations; no network, no clock, no Docker).

const MIGRATIONS = fileURLToPath(new URL("../../../migrations/neon", import.meta.url));
const offers = readMigrationSchema(MIGRATIONS).get("photo_offers");

void test("the chain declares one row per sessionless photo offer", () => {
  assert.ok(offers, "migrations/neon must create photo_offers");
  assert.deepEqual(
    [...offers.columns].map(([name, column]) => [name, column.type, column.notNull]),
    [
      ["offer_id", "text", true],
      ["identity_id", "text", true],
      ["signals", "jsonb", true],
      ["candidates", "jsonb", true],
      ["expires_at", "timestamptz", true],
    ],
    "the writer stamps every one of these, and expires_at is the 10-minute TTL the sweep reads",
  );
  assert.deepEqual(offers.primaryKey, ["offer_id"], "an offer is keyed by its own id, never by a session");
});

void test("agent_svc is the only role with any photo_offers privilege", () => {
  assert.ok(offers, "migrations/neon must create photo_offers");
  assert.deepEqual(
    [...offers.grants],
    [["agent_svc", ["SELECT", "INSERT", "DELETE", "UPDATE"]]],
    "agent_svc must hold all four, and catalog_svc, users_svc, jobs_svc and readonly must hold none",
  );
});
