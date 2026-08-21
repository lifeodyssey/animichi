import type { ChainSource } from "../src/chain";
import { QueueLock } from "../src/lock";
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

const BODIES: Record<string, string> = { [FILE_A]: BODY_A, [FILE_B]: BODY_B };
const FIXTURE_SUM = ["h1:fixture-directory-sum", `${FILE_A} ${HASH_A}`, `${FILE_B} ${HASH_B}`, ""].join("\n");

export const fixtureChain: ChainSource = {
  atlasSum: (): string => FIXTURE_SUM,
  file: (name: string): string => bodyOf(BODIES, name),
};

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
  readonly revisions: RevisionInsert[] = [];
  failBody: string | undefined;
  private gate: Promise<void> | undefined;
  private gateBody: string | undefined;

  alreadyApplied(version: string): void {
    this.revisions.push(appliedRow(version));
  }

  holdOn(body: string, gate: Promise<void>): void {
    this.gateBody = body;
    this.gate = gate;
  }

  connect = (_dsn: string): SqlClient => this;

  async query(sql: string, params?: SqlParams): Promise<unknown> {
    this.statements.push(sql);
    if (sql.includes("SELECT") && sql.includes("atlas_schema_revisions")) return this.selectApplied();
    if (sql.includes("INSERT") && sql.includes("atlas_schema_revisions")) return this.insert(params);
    return await this.execUnit(sql);
  }

  head(): string | null {
    const row = this.revisions.at(-1);
    if (row === undefined || row.applied < 1) return null;
    return `${row.version}_${row.description}`;
  }

  private selectApplied(): { version: string }[] {
    return this.revisions.filter((row) => row.applied >= 1).map((row) => ({ version: row.version }));
  }

  private insert(params?: SqlParams): unknown[] {
    this.revisions.push(revisionFrom(params ?? []));
    return [];
  }

  private async execUnit(sql: string): Promise<unknown[]> {
    this.units.push(sql);
    if (this.gateBody === sql && this.gate !== undefined) await this.gate;
    if (this.failBody === sql) throw new Error("sql failed");
    return [];
  }
}

function bodyOf(files: Record<string, string>, name: string): string {
  const body = files[name];
  if (body === undefined) throw new Error("missing fixture file");
  return body;
}

function appliedRow(version: string): RevisionInsert {
  return {
    version,
    description: "preapplied",
    applied: 1,
    executedAt: FIXED_NOW.toISOString(),
    executionTime: 0,
    error: null,
    errorStmt: null,
    hash: "h1:pre",
    operatorVersion: "atlas",
  };
}

function revisionFrom(params: SqlParams): RevisionInsert {
  return {
    version: str(params, 0),
    description: str(params, 1),
    applied: num(params, 2),
    executedAt: str(params, 3),
    executionTime: num(params, 4),
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

export function applyFixture(db: FakeSql, extra: Partial<HttpApplyInput> = {}): Promise<unknown> {
  return applyHttp({
    dsn: DSN,
    source: fixtureChain,
    connect: db.connect,
    lock: extra.lock ?? new QueueLock(),
    now: (): Date => FIXED_NOW,
    ...extra,
  });
}
