// Disposable-database fixture for the native adoption route (#1601): lifecycle,
// seeds, readers and the route driver the adoption suite asserts against.
// Mirrors `settlement-fixture.ts` / `recovery-fixture.ts`: importing this
// module registers the node:test hooks against the imported database.
import { after, before, beforeEach } from "node:test";
import { process } from "../test-support/node-globals.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import pg from "pg";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import { handleSessionAdopt, ADOPT_TURN_KEY_PREFIX } from "../src/identity/session-adopt.ts";
import { TEST_ANON_SECRET } from "../test/doubles/signed-anonymous-cookie.ts";

export const ANON_ID = "anon_" + "a".repeat(32);
export const ACCOUNT_ID = "account-session-owner";
export const THIRD_PARTY_ID = "other-account";
export const CONFLICT_ANON_ID = "anon_" + "b".repeat(32);
export const CONFLICT_SESSION = "adoption-session-conflict";
export const WITH_RESERVATION = "adoption-session-a";
export const WITHOUT_RESERVATION = "adoption-session-b";
export const THIRD_PARTY_SESSION = "adoption-session-third-party";

export interface OwnerRow { readonly id: string; readonly owner: string | null }
export interface MarkerRow {
  session_id: string | null;
  turn_key: string;
  payer: string;
  identity_id: string | null;
  revision: number;
  status: string;
}
interface SessionWriteRow { readonly id: string; readonly owner: string | null; readonly updated_at: string | null }
export interface AdoptionWriteSnapshot {
  readonly sessions: readonly SessionWriteRow[];
  readonly reservations: number;
}

export let db: PostgresClient<Contract>;
let postgres: TestPostgres | undefined;
let pool: pg.Pool;
const resources: { db?: PostgresClient<Contract>; postgres?: TestPostgres; pool?: pg.Pool } = {};

const MARKER_COLUMNS = {
  session_id: { codecId: "pg/text@1", nullable: true },
  turn_key: "pg/text@1", payer: "pg/text@1", identity_id: { codecId: "pg/text@1", nullable: true },
  revision: "pg/int4@1", status: "pg/text@1",
} as const;
// Both literal values are module constants, never request data: the marker
// pattern is built from the exported `ADOPT_TURN_KEY_PREFIX` so the trigger and
// production cannot drift apart, and the payer identity is this fixture's own
// seed. The executed DDL is byte-identical to the hard-coded `'adopt:%'` form.
const CONFLICT_TRIGGER_FUNCTION_SQL = `CREATE FUNCTION session_adoption_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.turn_key LIKE '${ADOPT_TURN_KEY_PREFIX}%' THEN
      INSERT INTO turn_reservations (session_id, turn_key, payer, identity_id, revision, status)
      VALUES (NEW.session_id, 'concurrent-conflict', 'anon', '${CONFLICT_ANON_ID}', NEW.revision, 'completed');
    END IF;
    RETURN NEW;
  END $$`;
const CONFLICT_TRIGGER_SQL = `CREATE TRIGGER session_adoption_conflict BEFORE INSERT ON turn_reservations
  FOR EACH ROW EXECUTE FUNCTION session_adoption_conflict()`;

before(async () => {
  postgres = resources.postgres = await startTestPostgres({ database: "native_adoption", budget: AGENT_DB_SETUP_BUDGET });
  await promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", postgres.dsn, "--json"], {
    cwd: fileURLToPath(new URL("../../../packages/pi-session-neon/", import.meta.url).href),
    env: { ...process.env, DO_NOT_TRACK: "1" },
  });
  db = resources.db = postgresClient<Contract>({ contractJson, url: postgres.dsn });
  pool = resources.pool = new pg.Pool({ connectionString: postgres.dsn });
});

beforeEach(async () => {
  await clearTables();
  await seedSession(WITH_RESERVATION, ANON_ID);
  await seedSession(WITHOUT_RESERVATION, ANON_ID);
  await seedSession(THIRD_PARTY_SESSION, THIRD_PARTY_ID);
  await db.runtime().execute(db.raw.sql`
    INSERT INTO turn_reservations (session_id, turn_key, payer, identity_id, revision, status)
    VALUES (${WITH_RESERVATION}, 'pre-adoption', 'anon', ${ANON_ID}, 1, 'completed')
  `.affectedCount().build());
});

after(async () => {
  try { await Promise.all([resources.db?.close(), resources.pool?.end()]); }
  finally { await resources.postgres?.stop(); }
});

async function clearTables(): Promise<void> {
  await db.runtime().execute(db.raw.sql`DELETE FROM turn_reservations`.affectedCount().build());
  await db.runtime().execute(db.raw.sql`DELETE FROM sessions`.affectedCount().build());
}

async function seedSession(id: string, owner: string): Promise<void> {
  await db.runtime().execute(db.raw.sql`INSERT INTO sessions (id, user_id) VALUES (${id}, ${owner})`.affectedCount().build());
}

export async function readOwners(): Promise<OwnerRow[]> {
  return db.runtime().query(db.raw.sql`
    SELECT id, user_id AS owner FROM sessions ORDER BY id
  `.returnsRow({ id: "pg/text@1", owner: { codecId: "pg/text@1", nullable: true } }).build());
}

export async function readMarkers(): Promise<MarkerRow[]> {
  return db.runtime().query(db.raw.sql`
    SELECT session_id, turn_key, payer, identity_id, revision, status
    FROM turn_reservations WHERE turn_key LIKE ${ADOPT_TURN_KEY_PREFIX + "%"} ORDER BY session_id
  `.returnsRow(MARKER_COLUMNS).build());
}

export async function readMarkerCount(): Promise<number | undefined> {
  const rows = await db.runtime().query(db.raw.sql`
    SELECT count(*) AS count FROM turn_reservations WHERE turn_key LIKE ${ADOPT_TURN_KEY_PREFIX + "%"}
  `.returnsRow({ count: "pg/int8number@1" }).build());
  return rows[0]?.count;
}

export async function readOwner(id: string): Promise<OwnerRow> {
  const rows = await db.runtime().query(db.raw.sql`SELECT id, user_id AS owner FROM sessions WHERE id = ${id}`
    .returnsRow({ id: "pg/text@1", owner: { codecId: "pg/text@1", nullable: true } }).build());
  return rows[0] ?? { id, owner: null };
}

export async function readConflictRow(): Promise<MarkerRow | undefined> {
  const rows = await db.runtime().query(db.raw.sql`
    SELECT session_id, turn_key, payer, identity_id, revision, status
    FROM turn_reservations WHERE turn_key = 'concurrent-conflict'
  `.returnsRow(MARKER_COLUMNS).build());
  return rows[0];
}

export async function seedConflictSession(): Promise<void> {
  await seedSession(CONFLICT_SESSION, CONFLICT_ANON_ID);
  await db.runtime().execute(db.raw.sql`
    INSERT INTO turn_reservations (session_id, turn_key, payer, identity_id, revision, status)
    VALUES (${CONFLICT_SESSION}, 'pre-conflict', 'anon', ${CONFLICT_ANON_ID}, 1, 'completed')
  `.affectedCount().build());
}

export async function installConflictTrigger(): Promise<void> {
  await pool.query(CONFLICT_TRIGGER_FUNCTION_SQL);
  await pool.query(CONFLICT_TRIGGER_SQL);
}

export async function removeConflictTrigger(): Promise<void> {
  await pool.query("DROP TRIGGER session_adoption_conflict ON turn_reservations");
  await pool.query("DROP FUNCTION session_adoption_conflict()");
}

/** Drive the real adoption route against the disposable database. */
export async function adoptResponse(toUserId: string, cookie?: string): Promise<Response> {
  const env = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: TEST_ANON_SECRET, AGENT_SVC_DATABASE_URL: postgres?.dsn };
  const request = new Request("https://animichi.test/v1/sessions/adopt", {
    method: "POST", headers: cookie === undefined ? {} : { Cookie: cookie },
  });
  return handleSessionAdopt(env as never, request, { userId: toUserId, userType: "human" });
}

/** The write evidence the no-write acceptance criterion reads from the real
 * database: every session row with its trigger-maintained `updated_at`, plus
 * the total reservation row count. */
export async function readAdoptionWrites(): Promise<AdoptionWriteSnapshot> {
  const sessions = await pool.query<{ id: string; user_id: string | null; updated_at: Date | null }>(
    "SELECT id, user_id, updated_at FROM sessions ORDER BY id",
  );
  const reservations = await pool.query<{ count: string }>("SELECT count(*) AS count FROM turn_reservations");
  return {
    sessions: sessions.rows.map((row) => ({ id: row.id, owner: row.user_id, updated_at: row.updated_at?.toISOString() ?? null })),
    reservations: Number(reservations.rows[0]?.count ?? 0),
  };
}
