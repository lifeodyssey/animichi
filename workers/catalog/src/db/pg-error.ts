/**
 * PostgreSQL failure classification for the catalog's write paths (#1630).
 *
 * The Prisma runtime surfaces a driver failure with the SQLSTATE on the error
 * itself (`sqlState`) and the untouched `pg` error as its `cause`. The two codes
 * the ingest needs are named here so the call sites read as the condition they
 * mean rather than as a string literal.
 */

/** `23505` — `unique_violation`: the row a caller tried to create already exists. */
export function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === "23505";
}

/** The SQLSTATE of a runtime failure, wherever the driver attached it. */
export function sqlStateOf(error: unknown): string | undefined {
  const direct = stateField(error);
  if (direct !== undefined) return direct;
  return stateField(causeOf(error));
}

/** The `sqlState` a Prisma runtime failure carries, if it is one. */
function stateField(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("sqlState" in value)) return undefined;
  const state = value.sqlState;
  return typeof state === "string" ? state : undefined;
}

/** The driver error a runtime failure wraps. */
function causeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("cause" in error)) return undefined;
  return error.cause;
}
