import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type SqlParam = string | number | null;
export type SqlParams = readonly SqlParam[];

/** Narrow neon-http seam. Tests inject a fake; production uses neon(dsn). */
export interface SqlClient {
  query(sql: string, params?: SqlParams): Promise<unknown>;
  transaction(statements: readonly string[]): Promise<unknown>;
}

export type SqlFactory = (dsn: string) => SqlClient;

type NeonSql = NeonQueryFunction<false, false>;

export function dsnHost(dsn: string): string {
  const noScheme = dsn.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPort = (noScheme.split("@").pop() ?? "").split("/")[0] ?? "";
  return (hostPort.split("?")[0] ?? "").split(":")[0] ?? "";
}

/** Neon schema DDL must use the direct host; PgBouncer is rejected before SQL. */
export function assertDirectDsn(dsn: string): void {
  if (dsnHost(dsn).toLowerCase().includes("-pooler")) {
    throw new Error("pooled endpoint rejected");
  }
}

export function neonClient(dsn: string): SqlClient {
  const sql = neon(dsn);
  return { query: (text, params) => bindQuery(sql, text, params), transaction: (stmts) => bindTx(sql, stmts) };
}

function bindQuery(sql: NeonSql, text: string, params?: SqlParams): Promise<unknown> {
  return params === undefined ? sql.query(text) : sql.query(text, [...params]);
}

function bindTx(sql: NeonSql, stmts: readonly string[]): Promise<unknown> {
  return sql.transaction(stmts.map((s) => sql.query(s)));
}
