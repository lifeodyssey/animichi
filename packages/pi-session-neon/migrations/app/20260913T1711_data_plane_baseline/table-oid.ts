/**
 * One `public` table's `pg_class` OID, as a scalar subquery.
 *
 * Postcheck SQL cannot reach a table through `'public.x'::regclass`: PostgreSQL resolves that
 * cast while PLANNING the statement, and a migration's checks are planned alongside the DDL
 * that creates the table, so the cast raises `relation "public.x" does not exist` before the
 * check ever runs. A subquery is resolved at execution time instead, and it yields NULL for a
 * missing table — which makes the enclosing predicate NULL, so an object dropped from the
 * migration fails its own named postcheck rather than aborting the whole apply with a cast
 * error. `triggers.ts` and `generated-columns.ts` join `pg_class` by name for the same reason.
 */
export const tableOid = (table: string) => `(
    SELECT target_table.oid FROM pg_class AS target_table
    JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
    WHERE target_namespace.nspname = 'public' AND target_table.relname = '${table}'
  )`;
