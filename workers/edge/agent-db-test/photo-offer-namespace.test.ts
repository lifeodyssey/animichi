import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import pg from "pg";

// #1600 (Card F of the #1317 decomposition) AC1, on the database the Atlas chain actually
// applied to: the chain harness underneath `startTestPostgres` applies every committed
// migration/neon file to a database created from pristine template1, so this suite cannot
// start at all if the new migration does not roll forward. What is left to prove is that the
// applied namespace is the one the chain declares, and that the ledger carries it as the
// head — the statements landing, not the text of the statements. The fast lane's counterpart,
// which reads that text, is `workers/edge/test/photo-offer-namespace.test.ts`.
//
// test-type: integration (disposable PostgreSQL through the Atlas chain harness; no Neon, no
// network).

const HEAD = "20260915060017";
const RUNTIME_ROLES = ["agent_svc", "catalog_svc", "users_svc", "jobs_svc", "readonly"];
const CRUD = ["SELECT", "INSERT", "UPDATE", "DELETE"];

interface ColumnRow {
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: string;
}

let postgres: TestPostgres;
let pool: pg.Pool;
const resources: { postgres?: TestPostgres; pool?: pg.Pool } = {};

before(async () => {
  postgres = resources.postgres = await startTestPostgres({ database: "photo_offer_namespace", budget: AGENT_DB_SETUP_BUDGET });
  pool = resources.pool = new pg.Pool({ connectionString: postgres.dsn });
});

after(async () => {
  try { await resources.pool?.end(); }
  finally { await resources.postgres?.stop(); }
});

void test("the applied chain carries the photo-offer namespace and leaves it as the head", async () => {
  const columns = await pool.query<ColumnRow>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'photo_offers' ORDER BY ordinal_position`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: "offer_id", data_type: "text", is_nullable: "NO" },
    { column_name: "identity_id", data_type: "text", is_nullable: "NO" },
    { column_name: "signals", data_type: "jsonb", is_nullable: "NO" },
    { column_name: "candidates", data_type: "jsonb", is_nullable: "NO" },
    { column_name: "expires_at", data_type: "timestamp with time zone", is_nullable: "NO" },
  ]);
  // PostgreSQL 18 records each column's NOT NULL as a `contype = 'n'` row here, so the
  // table constraint read filters those out: nullability is already pinned by the
  // information_schema assertion above, and this query is what catches a future unique,
  // check or foreign-key constraint. The ORDER BY keeps the row order defined.
  const keys = await pool.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid = 'public.photo_offers'::regclass AND contype <> 'n'
     ORDER BY definition`,
  );
  assert.deepEqual(keys.rows, [{ definition: "PRIMARY KEY (offer_id)" }]);
  const index = await pool.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_photo_offers_expiry'",
  );
  assert.deepEqual(index.rows, [
    { indexdef: "CREATE INDEX idx_photo_offers_expiry ON public.photo_offers USING btree (expires_at)" },
  ]);
  const ledger = await pool.query<{ version: string }>(
    "SELECT version FROM public.atlas_schema_revisions ORDER BY version DESC LIMIT 1",
  );
  assert.deepEqual(ledger.rows, [{ version: HEAD }], "the chain applied through this migration");
});

void test("only agent_svc holds a privilege on the applied namespace", async () => {
  const privileges = await pool.query<{ role: string; granted: number }>(
    `SELECT role, count(*) FILTER (WHERE has_table_privilege(role, 'public.photo_offers', capability))::int AS granted
     FROM unnest($1::text[]) AS role CROSS JOIN unnest($2::text[]) AS capability
     GROUP BY role ORDER BY role`,
    [RUNTIME_ROLES, CRUD],
  );
  assert.deepEqual(privileges.rows, [
    { role: "agent_svc", granted: CRUD.length },
    { role: "catalog_svc", granted: 0 },
    { role: "jobs_svc", granted: 0 },
    { role: "readonly", granted: 0 },
    { role: "users_svc", granted: 0 },
  ]);
});
