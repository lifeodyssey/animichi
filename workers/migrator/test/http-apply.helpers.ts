import { mapSource, type ChainSource } from "../src/chain";
import { QueueLock } from "../src/lock";
import type { ContainerOutcome } from "../src/migration";
import type { SqlClient, SqlParam, SqlParams } from "../src/sql";
import { applyHttp, type HttpApplyInput } from "../src/http-apply";

// #1124 — fixture chain + fake neon-http for Option 2 apply tests.
// Tests inject this ChainSource; they never load the wrangler SQL glob.

export const DSN = "postgresql://migrator:x@ep-direct.neon.tech/neondb";
export const POOLER_DSN = "postgresql://migrator:x@ep-broad-frost-pooler.neon.tech/neondb";
export const FIXED_NOW = new Date("2026-08-21T00:00:00.000Z");

export const FILE_A = "20260811000001_turn_outcome.sql";
export const FILE_B = "20260814191301_turn_idempotency_outbox.sql";
export const HASH_A = "h1:hash-turn-outcome-aaaaaaaaaaaaaaaaaaaaaaa=";
export const HASH_B = "h1:hash-turn-outbox-bbbbbbbbbbbbbbbbbbbbbbbb=";
export const BODY_A = "CREATE TABLE public.turn_outcome (id int);";
export const BODY_B = "CREATE TABLE public.turn_outbox_events (id int);";
export const HEAD_B = "20260814191301_turn_idempotency_outbox";
export const STMT_1 = "CREATE TABLE public.t1 (id int);";
export const STMT_2 = "CREATE TABLE public.t2 (id int);";
export const TWO_BODY = `${STMT_1} ${STMT_2}`;
export const TWO_FILE = "20260821000000_two_stmt.sql";
export const CONCURRENT_BODY = "CREATE INDEX CONCURRENTLY idx_t ON public.t (id);";

const BODIES: Record<string, string> = { [FILE_A]: BODY_A, [FILE_B]: BODY_B };
const FIXTURE_SUM = ["h1:fixture-directory-sum", `${FILE_A} ${HASH_A}`, `${FILE_B} ${HASH_B}`, ""].join("\n");

export const fixtureChain: ChainSource = {
  atlasSum: (): string => FIXTURE_SUM,
  file: (name: string): string => bodyOf(BODIES, name),
};

export const twoStmtChain: ChainSource = chainOf(TWO_FILE, TWO_BODY);

export interface RevisionInsert {
  version: string;
  description: string;
  applied: number;
  executedAt: string;
  executionTime: number;
  error: string | null;
  errorStmt: string | null;
  hash: string;
  operatorVersion: string;
}

export class FakeSql implements SqlClient {
  readonly units: string[] = [];
  readonly statements: string[] = [];
  readonly transactions: string[][] = [];
  readonly revisions: RevisionInsert[] = [];
  failBody: string | undefined;
  gate: Promise<void> | undefined;
  gateBody: string | undefined;

  alreadyApplied(version: string): void {
    this.revisions.push(appliedRow(version));
  }

  holdOn(body: string, gate: Promise<void>): void {
    this.gateBody = body;
    this.gate = gate;
  }

  connect = (_dsn: string): SqlClient => this;
  query = (sql: string, params?: SqlParams): Promise<unknown> => fakeQuery(this, sql, params);
  transaction = (statements: readonly string[]): Promise<unknown> => fakeTx(this, statements);

  head(): string | null {
    const row = this.revisions.at(-1);
    if (row === undefined || row.applied < 1) return null;
    return `${row.version}_${row.description}`;
  }
}

async function fakeQuery(db: FakeSql, sql: string, params?: SqlParams): Promise<unknown> {
  db.statements.push(sql);
  if (sql.includes("SELECT") && sql.includes("atlas_schema_revisions")) return selectApplied(db);
  if (sql.includes("INSERT") && sql.includes("atlas_schema_revisions")) return insertRevision(db, params);
  return execUnit(db, sql);
}

async function fakeTx(db: FakeSql, statements: readonly string[]): Promise<unknown> {
  db.transactions.push([...statements]);
  for (const stmt of statements) await execUnit(db, stmt);
  return [];
}

function selectApplied(db: FakeSql): { version: string }[] {
  return db.revisions.filter((row) => row.applied >= 1).map((row) => ({ version: row.version }));
}

function insertRevision(db: FakeSql, params?: SqlParams): unknown[] {
  db.revisions.push(revisionFrom(params ?? []));
  return [];
}

async function execUnit(db: FakeSql, sql: string): Promise<unknown[]> {
  db.units.push(sql);
  if (db.gateBody === sql && db.gate !== undefined) await db.gate;
  if (db.failBody === sql) throw new Error("sql failed");
  return [];
}

function bodyOf(files: Record<string, string>, name: string): string {
  const body = files[name];
  if (body === undefined) throw new Error("missing fixture file");
  return body;
}

function appliedRow(version: string): RevisionInsert {
  return { ...revisionStamp(), version, description: "preapplied", applied: 1 };
}

function revisionStamp(): Omit<RevisionInsert, "version" | "description" | "applied"> {
  return {
    executedAt: FIXED_NOW.toISOString(),
    executionTime: 0,
    error: null,
    errorStmt: null,
    hash: "h1:pre",
    operatorVersion: "atlas",
  };
}

function revisionFrom(params: SqlParams): RevisionInsert {
  return { ...revisionHead(params), ...revisionTail(params) };
}

function revisionHead(params: SqlParams): Pick<RevisionInsert, "version" | "description" | "applied" | "executedAt" | "executionTime"> {
  return {
    version: str(params, 0),
    description: str(params, 1),
    applied: num(params, 2),
    executedAt: str(params, 3),
    executionTime: num(params, 4),
  };
}

function revisionTail(params: SqlParams): Pick<RevisionInsert, "error" | "errorStmt" | "hash" | "operatorVersion"> {
  return {
    error: nullable(params[5]),
    errorStmt: nullable(params[6]),
    hash: str(params, 7),
    operatorVersion: str(params, 8),
  };
}

function str(params: SqlParams, i: number): string {
  return String(params[i] ?? "");
}

function num(params: SqlParams, i: number): number {
  return Number(params[i] ?? 0);
}

function nullable(value: SqlParam | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function chainOf(filename: string, body: string): ChainSource {
  return mapSource(`h1:sum\n${filename} h1:hash-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=\n`, { [filename]: body });
}

export function applyFixture(db: FakeSql, extra: Partial<HttpApplyInput> = {}): Promise<ContainerOutcome> {
  return applyHttp({
    dsn: DSN,
    source: fixtureChain,
    connect: db.connect,
    lock: extra.lock ?? new QueueLock(),
    now: (): Date => FIXED_NOW,
    ...extra,
  });
}

export function workerHttpDeps(db: FakeSql) {
  return {
    runContainer: (dsn: string) => applyFixture(db, { dsn }),
    readAppliedHead: (): Promise<string | null> => Promise.resolve(db.head()),
  };
}
