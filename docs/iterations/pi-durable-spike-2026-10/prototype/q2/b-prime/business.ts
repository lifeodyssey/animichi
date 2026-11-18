/**
 * Route (b′)'s covering layers in miniature, in the spike's own database: admission in front of Pi's `submit`, and
 * settlement after Pi settles, shaped like today's (`workers/edge/src/agent/admission/request-intent.ts:7-24`, the
 * recovery scans in `session-agent.ts:146-160,185-212`). The admission row commits before Pi sees the input. Settlement
 * writes the charge and marks the admission settled in one statement, and inserts at most once, so a rerun after a crash
 * settles nothing twice.
 */
import type { Sql } from "../pg-storage/rows.ts";

export const BUSINESS_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS biz_admissions (session_id text NOT NULL, operation_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('model', 'selection')),
    digest text NOT NULL, input text NOT NULL, state text NOT NULL CHECK (state IN ('admitted', 'settled')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (session_id, operation_id))`,
  `CREATE TABLE IF NOT EXISTS biz_settlements (session_id text NOT NULL, operation_id text NOT NULL, outcome text NOT NULL, charged_tokens bigint NOT NULL,
    first_entry bigint, last_entry bigint, settled_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (session_id, operation_id))`,
];

export type AdmissionKind = "model" | "selection";
export type Admitted = { kind: "created" } | { kind: "existing"; state: string } | { kind: "conflict" };

export async function digestOf(kind: AdmissionKind, input: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, input]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The same id with the same digest is the existing admission; with another digest, a conflict (409); a new id commits. */
export async function admit(db: Sql, session: string, operationId: string, kind: AdmissionKind, input: string): Promise<Admitted> {
  const digest = await digestOf(kind, input);
  const inserted = await db.query(`INSERT INTO biz_admissions (session_id, operation_id, kind, digest, input, state) VALUES ($1, $2, $3, $4, $5, 'admitted')
    ON CONFLICT (session_id, operation_id) DO NOTHING RETURNING operation_id`, [session, operationId, kind, digest, input]);
  if (inserted.rows.length > 0) return { kind: "created" };
  const existing = (await db.query("SELECT digest, state FROM biz_admissions WHERE session_id = $1 AND operation_id = $2", [session, operationId])).rows[0];
  return existing?.digest === digest ? { kind: "existing", state: String(existing.state) } : { kind: "conflict" };
}

/** The recovery scan: every admission of the session not yet settled, oldest first. */
export async function admitted(db: Sql, session: string): Promise<{ operationId: string; kind: AdmissionKind; input: string }[]> {
  const { rows } = await db.query("SELECT operation_id, kind, input FROM biz_admissions WHERE session_id = $1 AND state = 'admitted' ORDER BY created_at", [session]);
  return rows.map((row) => ({ operationId: String(row.operation_id), kind: row.kind as AdmissionKind, input: String(row.input) }));
}

/** Banks one operation's charge and settles its admission, atomically and at most once. */
export async function settle(db: Sql, session: string, operationId: string, outcome: string, charged: number, firstEntry: number | null, lastEntry: number | null) {
  const { rows } = await db.query(`WITH banked AS (INSERT INTO biz_settlements (session_id, operation_id, outcome, charged_tokens, first_entry, last_entry)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (session_id, operation_id) DO NOTHING RETURNING operation_id)
    UPDATE biz_admissions SET state = 'settled' WHERE session_id = $1 AND operation_id = $2 RETURNING (SELECT count(*) FROM banked)::int AS banked`,
  [session, operationId, outcome, charged, firstEntry, lastEntry]);
  return { banked: Number(rows[0]?.banked ?? 0) };
}
