/**
 * A column as a bare name.
 *
 * An INSERT column list, an ON CONFLICT target, and the left side of an UPDATE
 * ... SET all take an unqualified name, where drizzle's own interpolation of a
 * column renders the table-qualified reference a SELECT wants. Both agent-tier
 * adapters that write through the `src/db/schema.ts` mapping need exactly this,
 * so the concept is named once here rather than re-declared beside each of them.
 */
import { sql, type Name } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function bareName(column: AnyPgColumn): Name {
  return sql.identifier(column.name);
}
