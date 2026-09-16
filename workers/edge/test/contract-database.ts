/**
 * The Prisma-only database an edge fixture migrates.
 *
 * The chain owns the whole data plane, so it may not run against the
 * Atlas-applied database `startTestPostgres` returns — that one stays the
 * cluster's admin and role source (spec §4.7: one chain per database). The
 * agent-domain shapes below are installed here because the #1626 contract
 * deliberately omits them (spec §4.12) and #1607 retires them with
 * `apps/agent`: the runtime still writes `sessions`, and the executable
 * examples count quota in the two aggregates.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";
import { process } from "../test-support/node-globals.ts";
import pg from "pg";
import { QUOTA_AGGREGATES } from "@animichi/pi-session-neon/quota-aggregates";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName, type TestPostgres } from "@animichi/test-postgres";

const PI_SESSION_NEON = fileURLToPath(new URL("../../../packages/pi-session-neon/", import.meta.url));

const AGENT_SESSIONS = `
  CREATE TABLE public.sessions (
    id text NOT NULL, user_id text NULL, title text NULL, first_query text NULL,
    state jsonb NOT NULL DEFAULT '{}', metadata jsonb NULL DEFAULT '{}',
    lifecycle text NULL DEFAULT 'active', created_at timestamptz NULL DEFAULT now(),
    updated_at timestamptz NULL DEFAULT now(), expires_at timestamptz NULL,
    PRIMARY KEY (id)
  );
  CREATE INDEX idx_sessions_lifecycle ON public.sessions (lifecycle);
  CREATE INDEX idx_sessions_user ON public.sessions (user_id);
  CREATE INDEX idx_sessions_user_updated ON public.sessions (user_id, updated_at DESC);
  CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()`;

/** `migrations/neon/20260826000004_agent.sql`'s `turn_reservations`, the adoption marker the
 * native adoption route writes. Both unique constraints are load-bearing: `adoptSessions`
 * conflicts on `turn_reservations_session_revision` by name. */
const AGENT_TURN_RESERVATIONS = `
  CREATE TABLE public.turn_reservations (
    id uuid NOT NULL DEFAULT uuidv7(),
    session_id text NULL,
    turn_key text NOT NULL,
    payer text NOT NULL,
    identity_id text NULL,
    revision integer NOT NULL,
    digest text NULL,
    status text NOT NULL DEFAULT 'reserved',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text NOT NULL DEFAULT '',
    lease_expires_at timestamptz NOT NULL DEFAULT now(),
    request_digest text NULL,
    outcome_payload jsonb NULL,
    PRIMARY KEY (id),
    CONSTRAINT turn_reservations_session_revision UNIQUE (session_id, revision),
    CONSTRAINT turn_reservations_session_turn_key UNIQUE (session_id, turn_key),
    CONSTRAINT turn_reservations_payer_check CHECK (payer = ANY(ARRAY['anon'::text, 'user'::text, 'byok'::text])),
    CONSTRAINT turn_reservations_status_check CHECK (status = ANY(ARRAY['reserved'::text, 'running'::text, 'completed'::text, 'failed'::text]))
  );
  CREATE INDEX idx_turn_reservations_session_revision ON public.turn_reservations (session_id, revision DESC);
  CREATE INDEX idx_turn_reservations_sweep ON public.turn_reservations (status, lease_expires_at) WHERE (status = ANY(ARRAY['reserved'::text, 'running'::text]));
  CREATE UNIQUE INDEX turn_reservations_null_session_key ON public.turn_reservations (turn_key) WHERE (session_id IS null)`;

function migrate(dsn: string): Promise<unknown> {
  return promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", dsn, "--json"], {
    cwd: PI_SESSION_NEON, env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
}

async function installScaffolding(dsn: string): Promise<void> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    await client.query(AGENT_SESSIONS);
    await client.query(AGENT_TURN_RESERVATIONS);
    await client.query(QUOTA_AGGREGATES);
  } finally { await client.end(); }
}

/** The fixture's own database on the shared server, and how to remove it (#1663). */
export interface ContractDatabase {
  readonly dsn: string;
  stop(): Promise<void>;
}

/** `<suite>_contract` plus a per-call suffix, created from pristine `template1`, migrated by the
 * one chain, scaffolding installed. The caller owns the drop, like every database creator. */
export async function startContractDatabase(postgres: TestPostgres, suite: string): Promise<ContractDatabase> {
  const name = uniqueDatabaseName(`${suite}_contract`);
  const dsn = await createCleanDatabase(postgres.dsn, name);
  await migrate(dsn);
  await installScaffolding(dsn);
  return { dsn, stop: () => dropCleanDatabase(postgres.dsn, name) };
}
