import { filesFrom, type ChainFile, type ChainSource } from "./chain";
import type { ApplyLock } from "./lock";
import type { ContainerOutcome } from "./migration";
import { assertDirectDsn, type SqlClient, type SqlFactory, type SqlParam } from "./sql";
import { mixedTxMode, needsTxNone, splitSql } from "./sql-split";

/**
 * Atlas v0.30 `public.atlas_schema_revisions` shape this path writes:
 * - version = filename timestamp before first `_`; description = remainder
 * - type = 2 (`RevisionTypeExecute`); applied=total=1 on success; applied=0 on failure
 * - executed_at = timestamptz; execution_time = int64 nanoseconds (HTTP path stores 0)
 * - hash = exact `h1:…` token from atlas.sum; operator_version below
 * - on SQL failure: error + error_stmt, then stop (do not set applied=total)
 */
export const OPERATOR_VERSION = "animichi-http-apply/0.30.0";
const MIXED_TX = "migration mixes transactional statements with CREATE INDEX CONCURRENTLY";

/**
 * Atlas creates the ledger on its own first apply; this path reads it before
 * writing, so a schema with no ledger yet made the first SELECT throw
 * `relation "public.atlas_schema_revisions" does not exist` and the whole apply
 * returned HTTP 500 with nothing applied. That was unreachable while staging was
 * only ever migrated incrementally, and became the normal first state once the
 * staging baseline reset started dropping and recreating `public` (#1216).
 * Columns are Atlas v0.30's own, dumped from a database it migrated.
 */
const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS public.atlas_schema_revisions (
  version varchar NOT NULL,
  description varchar NOT NULL,
  type bigint NOT NULL DEFAULT 2,
  applied bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
  executed_at timestamptz NOT NULL,
  execution_time bigint NOT NULL,
  error text,
  error_stmt text,
  hash varchar NOT NULL,
  partial_hashes jsonb,
  operator_version varchar NOT NULL,
  PRIMARY KEY (version)
)`;
const APPLIED_SQL = "SELECT version FROM public.atlas_schema_revisions WHERE applied >= total";
const UPSERT_SQL = `INSERT INTO public.atlas_schema_revisions (version, description, type, applied, total, executed_at, execution_time, error, error_stmt, hash, operator_version) VALUES ($1, $2, 2, $3, 1, $4, $5, $6, $7, $8, $9) ON CONFLICT (version) DO UPDATE SET applied = EXCLUDED.applied, total = EXCLUDED.total, execution_time = EXCLUDED.execution_time, error = EXCLUDED.error, error_stmt = EXCLUDED.error_stmt, hash = EXCLUDED.hash, operator_version = EXCLUDED.operator_version`;

export interface ApplyInput {
  dsn: string;
  source: ChainSource;
  connect: SqlFactory;
  now: () => Date;
}

export interface HttpApplyInput extends ApplyInput {
  lock: ApplyLock;
}

interface RevisionWrite {
  version: string;
  description: string;
  applied: number;
  executedAt: Date;
  error: string | null;
  errorStmt: string | null;
  hash: string;
}

/** Serialize then apply the bundled chain. Tests inject a fake lock. */
export function applyHttp(input: HttpApplyInput): Promise<ContainerOutcome> {
  return input.lock.runExclusive(() => applyChain(input));
}

/** Apply committed files over neon-http. Rejects `-pooler` before connect/SQL. */
export async function applyChain(input: ApplyInput): Promise<ContainerOutcome> {
  assertDirectDsn(input.dsn);
  return applyFiles(input);
}

async function applyFiles(input: ApplyInput): Promise<ContainerOutcome> {
  const sql = input.connect(input.dsn);
  await sql.query(LEDGER_SQL);
  const applied = await loadApplied(sql);
  return applyPending(sql, filesFrom(input.source), applied, input.now);
}

async function applyPending(
  sql: SqlClient,
  files: ChainFile[],
  applied: Set<string>,
  now: () => Date,
): Promise<ContainerOutcome> {
  for (const file of files) {
    const failed = await applyOne(sql, file, applied, now);
    if (failed !== undefined) return failed;
  }
  return { kind: "success", exitCode: 0 };
}

async function applyOne(
  sql: SqlClient,
  file: ChainFile,
  applied: Set<string>,
  now: () => Date,
): Promise<ContainerOutcome | undefined> {
  if (applied.has(file.version)) return undefined;
  const error = await execUnit(sql, file.body);
  if (error !== undefined) return recordFailure(sql, file, error, now());
  await writeRevision(sql, okRow(file, now()));
  applied.add(file.version);
  return undefined;
}

async function execUnit(sql: SqlClient, body: string): Promise<Error | undefined> {
  return execCaught(() => applyStatements(sql, splitSql(body)));
}

async function execCaught(run: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function applyStatements(sql: SqlClient, statements: readonly string[]): Promise<unknown> {
  if (statements.length === 0) return Promise.resolve();
  if (mixedTxMode(statements)) return Promise.reject(new Error(MIXED_TX));
  if (statements.some(needsTxNone)) return runSerial(sql, statements);
  return sql.transaction(statements);
}

async function runSerial(sql: SqlClient, statements: readonly string[]): Promise<void> {
  for (const stmt of statements) await sql.query(stmt);
}

async function recordFailure(sql: SqlClient, file: ChainFile, error: Error, at: Date): Promise<ContainerOutcome> {
  await writeRevision(sql, failRow(file, error, at));
  return { kind: "failure", exitCode: 1, error: error.message };
}

async function loadApplied(sql: SqlClient): Promise<Set<string>> {
  return new Set(versionsIn(await sql.query(APPLIED_SQL)));
}

function versionsIn(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(versionCell);
}

function versionCell(row: unknown): string[] {
  if (typeof row !== "object" || row === null || !("version" in row)) return [];
  return typeof row.version === "string" ? [row.version] : [];
}

async function writeRevision(sql: SqlClient, row: RevisionWrite): Promise<void> {
  await sql.query(UPSERT_SQL, revisionParams(row));
}

function revisionParams(row: RevisionWrite): SqlParam[] {
  return [row.version, row.description, row.applied, row.executedAt.toISOString(), 0, row.error, row.errorStmt, row.hash, OPERATOR_VERSION];
}

function okRow(file: ChainFile, at: Date): RevisionWrite {
  return { ...file, applied: 1, executedAt: at, error: null, errorStmt: null };
}

function failRow(file: ChainFile, error: Error, at: Date): RevisionWrite {
  return { ...okRow(file, at), applied: 0, error: error.message, errorStmt: file.body };
}
