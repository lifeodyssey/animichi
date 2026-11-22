/**
 * A Postgres `timestamptz` as the users runtime hands it over. Since Prisma
 * rc.21 the contract's `pg/timestamptz-string@1` reads it as the UTC instant in
 * ISO 8601 with every fractional digit the server sent
 * (`2026-07-13T12:34:56.123456Z`), on workerd and Node alike. Every adapter
 * maps it to the millisecond ISO string the public model and the idempotency
 * ledger carry, the one form `apps/web` can sort as text
 * (`pickContinueFrom`), so the mapping has one home rather than one copy per
 * adapter.
 */

/** Normalize a timestamptz to its ISO string. */
export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/** Normalize a nullable timestamptz; null stays null rather than becoming 1970. */
export function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
