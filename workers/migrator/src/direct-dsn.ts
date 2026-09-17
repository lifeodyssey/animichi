/**
 * The one connectivity rule the migrator still owns: Neon schema DDL must reach the DIRECT
 * host, never PgBouncer, because a pooled session cannot hold the advisory lock or the
 * transaction a migration needs. Everything else about talking to PostgreSQL — statements,
 * transactions, the client itself — belongs to Prisma's control client now (#1634).
 */
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
