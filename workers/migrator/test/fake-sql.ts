import type { SqlClient, SqlParam, SqlParams, SqlStatement } from "../src/sql";

// #1124 — fake neon-http seam for the apply tests.
// #1338 — a neon-http request is the unit of commit: effects are staged here and
// land only when every statement in the request succeeds, so a rolled-back
// transaction is distinguishable from a committed one. `units` is the attempt
// log; `committed` is what survived.

/** Inert clock for pre-seeded rows; no assertion reads a seeded row's stamp. */
const PRE_APPLIED_AT = "2026-08-21T00:00:00.000Z";
const DUPLICATE_OBJECT = "42P07";

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

/** Effects of one neon-http request, applied only once the request completes. */
class PendingCommit {
  readonly units: string[] = [];
  readonly revisions: RevisionInsert[] = [];
}

export class FakeSql implements SqlClient {
  readonly units: string[] = [];
  readonly committed: string[] = [];
  readonly statements: string[] = [];
  readonly transactions: string[][] = [];
  readonly revisions: RevisionInsert[] = [];
  /**
   * Starts absent, exactly as a freshly reset `public` schema does. This double
   * used to answer the ledger SELECT with `[]` whether or not the table existed,
   * which is why every test stayed green through the HTTP 500 that a reset
   * staging database actually produced (#1216).
   */
  ledgerExists = false;
  failBody: string | undefined;
  duplicateBody: string | undefined;
  failLedgerWrite = false;
  gate: Promise<void> | undefined;
  gateBody: string | undefined;

  alreadyApplied(version: string): void {
    this.revisions.push({ ...revisionStamp(), version, description: "preapplied", applied: 1 });
  }

  /** An attempt that never finished — what `recordFailure` leaves behind. */
  attemptFailed(version: string, hash: string): void {
    this.revisions.push({ ...revisionStamp(), version, description: "attempted", applied: 0, hash });
  }

  holdOn(body: string, gate: Promise<void>): void {
    this.gateBody = body;
    this.gate = gate;
  }

  connect = (_dsn: string): SqlClient => this;
  query = (sql: string, params?: SqlParams): Promise<unknown> => fakeQuery(this, sql, params);
  transaction = (statements: readonly SqlStatement[]): Promise<unknown> => fakeTx(this, statements);

  head(): string | null {
    const row = this.revisions.at(-1);
    if (row === undefined || row.applied < 1) return null;
    return `${row.version}_${row.description}`;
  }
}

function fakeQuery(db: FakeSql, sql: string, params?: SqlParams): Promise<unknown> {
  db.statements.push(sql);
  return runRequest(db, [{ text: sql, params: params ?? [] }]);
}

function fakeTx(db: FakeSql, statements: readonly SqlStatement[]): Promise<unknown> {
  db.transactions.push(statements.map((statement) => statement.text));
  return runRequest(db, statements);
}

/** All-or-nothing: a statement that throws discards the whole request's effects. */
async function runRequest(db: FakeSql, statements: readonly SqlStatement[]): Promise<unknown> {
  const pending = new PendingCommit();
  const rows: unknown[] = [];
  for (const statement of statements) rows.push(await runStatement(db, pending, statement));
  db.committed.push(...pending.units);
  db.revisions.push(...pending.revisions);
  return rows.at(-1) ?? [];
}

async function runStatement(db: FakeSql, pending: PendingCommit, statement: SqlStatement): Promise<unknown> {
  const { text, params } = statement;
  if (text.includes("CREATE TABLE IF NOT EXISTS public.atlas_schema_revisions")) return createLedger(db);
  if (!text.includes("atlas_schema_revisions")) return execUnit(db, pending, text);
  requireLedger(db);
  return text.includes("SELECT") ? selectRevisions(db, text) : insertRevision(db, pending, params);
}

function createLedger(db: FakeSql): unknown[] {
  db.ledgerExists = true;
  return [];
}

/** Postgres rejects a read or write of a table that has not been created yet. */
function requireLedger(db: FakeSql): void {
  if (db.ledgerExists) return;
  throw new Error('relation "public.atlas_schema_revisions" does not exist');
}

function selectRevisions(db: FakeSql, text: string): unknown[] {
  return text.includes("applied < total") ? unfinishedRows(db) : appliedVersions(db);
}

function appliedVersions(db: FakeSql): { version: string }[] {
  return db.revisions.filter((row) => row.applied >= 1).map((row) => ({ version: row.version }));
}

function unfinishedRows(db: FakeSql): { version: string; hash: string }[] {
  return db.revisions.filter((row) => row.applied < 1).map((row) => ({ version: row.version, hash: row.hash }));
}

function insertRevision(db: FakeSql, pending: PendingCommit, params: SqlParams): unknown[] {
  if (db.failLedgerWrite) throw new Error("ledger write failed");
  pending.revisions.push(revisionFrom(params));
  return [];
}

async function execUnit(db: FakeSql, pending: PendingCommit, sql: string): Promise<unknown[]> {
  db.units.push(sql);
  if (db.gateBody === sql && db.gate !== undefined) await db.gate;
  if (db.failBody === sql) throw new Error("sql failed");
  if (db.duplicateBody === sql) throw duplicateObjectError(sql);
  pending.units.push(sql);
  return [];
}

/**
 * Postgres answers SQLSTATE 42P07 when the relation is already there. The code
 * is restated here rather than imported from `src/`, so that a wrong constant in
 * the production path disagrees with this double instead of matching it.
 */
function duplicateObjectError(sql: string): Error {
  return Object.assign(new Error(`relation already exists: ${sql}`), { code: DUPLICATE_OBJECT });
}

function revisionStamp(): Omit<RevisionInsert, "version" | "description" | "applied"> {
  return {
    executedAt: PRE_APPLIED_AT,
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
