/** The clean-database recipe the Atlas chain has to be applied to.
 *
 * The postgis image pre-initialises its default database with the tiger and
 * topology schemas, which Atlas's clean-check refuses, so no arm may migrate
 * that database. Every one of them instead creates its own database from
 * pristine `template1` — the same semantics `apps/agent`'s `conftest_db.py`
 * and `scripts/local-gates/db-fresh-schema.sh` use.
 *
 * Create and drop live together because they are one lifecycle: whoever created
 * a database owns removing it (#1663). `createCleanDatabase` cannot own the
 * drop — a caller may hand the database to someone else — so the package exports
 * both and every creator calls the other half.
 */
import pg from "pg";

/** One statement against the server `baseDsn` names, on a session of our own. */
async function runStatement(baseDsn: string, statement: string): Promise<void> {
  const client = new pg.Client(baseDsn);
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** The same server, with `name` as its database. */
function dsnForDatabase(baseDsn: string, name: string): string {
  const server = baseDsn.split("/").slice(0, 3).join("/");
  return `${server}/${name}?sslmode=disable`;
}

/** Create `name` from pristine template1 and return the DSN that reaches it. */
export async function createCleanDatabase(baseDsn: string, name: string): Promise<string> {
  await runStatement(baseDsn, `CREATE DATABASE "${name}" TEMPLATE template1`);
  return dsnForDatabase(baseDsn, name);
}

/** Drop `name`, force-closing any session still attached to it.
 *
 * `IF EXISTS` because the failure path and a second `stop()` both reach here
 * without knowing whether the create got that far. */
export async function dropCleanDatabase(baseDsn: string, name: string): Promise<void> {
  await runStatement(baseDsn, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}
