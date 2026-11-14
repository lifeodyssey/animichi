/**
 * A Postgres `timestamptz` as the users runtime hands it over: a `Date` under
 * Node and text under workerd. Every adapter that reads one maps it to the ISO
 * string the public model and the idempotency ledger carry, so the mapping has
 * one home rather than one copy per adapter.
 */

/** Normalize a timestamptz to its ISO string. */
export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/** Normalize a nullable timestamptz; null stays null rather than becoming 1970. */
export function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
