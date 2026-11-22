import { type PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { readStoreOrString, type Env } from "../env.ts";
import { nativeClient } from "../native-client.ts";
import { ADOPT_TURN_KEY_PREFIX } from "./session-adoption-marker.ts";

export type AdoptionNoopClass = "adopted" | "no_anonymous_identity" | "no_rows";

export interface SessionAdoptionResult {
  readonly adopted: number;
  readonly noop_class: AdoptionNoopClass;
  readonly revisions_bumped: number;
}

export interface SessionAdoptionStore {
  adopt(fromAnonId: string, toUserId: string): Promise<SessionAdoptionResult>;
}

type AdoptionDatabase = PostgresClient<Contract>;
type AdoptionTransaction = Parameters<Parameters<AdoptionDatabase["transaction"]>[0]>[0];
interface AdoptionCounts { readonly adopted: number; readonly markers: number }
const MARKER_CTE_COLUMNS = {
  session_id: "pg/text@1", turn_key: "pg/text@1", payer: "pg/text@1",
  identity_id: { codecId: "pg/text@1", nullable: true }, revision: "pg/int4@1",
  digest: { codecId: "pg/text@1", nullable: true }, status: "pg/text@1",
} as const;

function ownershipCte(db: AdoptionDatabase, fromAnonId: string, toUserId: string) {
  return db.raw.sql`UPDATE sessions SET user_id = ${toUserId}, updated_at = now() WHERE user_id = ${fromAnonId} RETURNING id`
    .returnsRow({ id: "pg/text@1" });
}

function markerCte(db: AdoptionDatabase) {
  return db.raw.sql`SELECT adopted.id AS session_id, ${ADOPT_TURN_KEY_PREFIX} || adopted.id AS turn_key, 'anon' AS payer,
    NULL::text AS identity_id, coalesce(max(reservation.revision), 0) + 1 AS revision, NULL::text AS digest, 'completed' AS status
    FROM adopted LEFT JOIN turn_reservations reservation ON reservation.session_id = adopted.id GROUP BY adopted.id`
    .returnsRow(MARKER_CTE_COLUMNS);
}

function insertCte(db: AdoptionDatabase) {
  return db.raw.sql`INSERT INTO turn_reservations (session_id, turn_key, payer, identity_id, revision, digest, status)
    SELECT session_id, turn_key, payer, identity_id, revision, digest, status FROM markers
    ON CONFLICT ON CONSTRAINT turn_reservations_session_revision DO NOTHING RETURNING session_id`.returnsRow({ session_id: "pg/text@1" });
}

function adoptionStatement(db: AdoptionDatabase, fromAnonId: string, toUserId: string) {
  const adopted = ownershipCte(db, fromAnonId, toUserId);
  const markers = markerCte(db);
  const inserted = insertCte(db);
  return db.raw.sql`WITH adopted AS (${adopted}), markers AS (${markers}), inserted AS (${inserted})
    SELECT (SELECT count(*) FROM adopted)::bigint AS adopted_count,
      (SELECT count(*) FROM inserted)::bigint AS marker_count`
    .returnsRow({ adopted_count: "pg/int8number@1", marker_count: "pg/int8number@1" }).build();
}

async function runAdoption(
  db: AdoptionDatabase, tx: AdoptionTransaction, fromAnonId: string, toUserId: string,
): Promise<AdoptionCounts> {
  const [row] = await tx.query(adoptionStatement(db, fromAnonId, toUserId));
  return { adopted: row?.adopted_count ?? 0, markers: row?.marker_count ?? 0 };
}

function adoptionResult(counts: AdoptionCounts): SessionAdoptionResult {
  return { adopted: counts.adopted, noop_class: counts.adopted === 0 ? "no_rows" : "adopted", revisions_bumped: counts.markers };
}

/** Apply one atomic ownership update and its idempotent revision markers. */
export async function adoptSessions(
  db: AdoptionDatabase, fromAnonId: string, toUserId: string,
): Promise<SessionAdoptionResult> {
  const counts = await db.transaction((tx) => runAdoption(db, tx, fromAnonId, toUserId));
  return adoptionResult(counts);
}

async function openDatabase(env: Env): Promise<AdoptionDatabase> {
  const url = await readStoreOrString(env.AGENT_SVC_DATABASE_URL);
  if (!url) throw new Error("The native agent database is not configured");
  return nativeClient(url);
}

async function adoptWithNativeDatabase(
  env: Env, fromAnonId: string, toUserId: string,
): Promise<SessionAdoptionResult> {
  const db = await openDatabase(env);
  try {
    return await adoptSessions(db, fromAnonId, toUserId);
  } finally {
    await db.close();
  }
}

export function createSessionAdoptionStore(env: Env): SessionAdoptionStore {
  return { adopt: (fromAnonId, toUserId) => adoptWithNativeDatabase(env, fromAnonId, toUserId) };
}
