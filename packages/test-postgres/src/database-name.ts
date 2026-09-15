/** The name of ONE database a suite owns on the shared container (#1663).
 *
 * The container is reused, so it outlives every call: "one database per suite"
 * only stays true while the name is unique per call. Two calls in one run, and
 * two runs against the same container, must never land on the same database —
 * a leftover from a killed run is exactly what makes a fixed name dangerous.
 *
 * PostgreSQL truncates identifiers at 63 bytes, so the suffix is budgeted out
 * of the suite name instead of appended past the ceiling: a truncated suffix
 * would collide with its own siblings.
 */
import { randomUUID } from "node:crypto";

/** PostgreSQL's identifier ceiling, in bytes. */
const IDENTIFIER_CEILING = 63;
/** 12 hex characters of a UUIDv4: 48 random bits, and short enough to read. */
const SUFFIX_LENGTH = 12;

/** `suite` plus a per-call suffix, inside PostgreSQL's identifier ceiling. */
export function uniqueDatabaseName(suite: string): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, SUFFIX_LENGTH);
  return `${suite.slice(0, IDENTIFIER_CEILING - SUFFIX_LENGTH - 1)}_${suffix}`;
}
