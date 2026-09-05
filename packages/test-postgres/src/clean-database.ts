/** The clean-database recipe the Atlas chain has to be applied to.
 *
 * The postgis image pre-initialises its default database with the tiger and
 * topology schemas, which Atlas's clean-check refuses, so no arm may migrate
 * that database. Every one of them instead creates its own database from
 * pristine `template1` — the same semantics `apps/agent`'s `conftest_db.py`
 * and `scripts/local-gates/db-fresh-schema.sh` use.
 */
import pg from "pg";

/** Create `name` from pristine template1 and return the DSN that reaches it. */
export async function createCleanDatabase(baseDsn: string, name: string): Promise<string> {
  const client = new pg.Client(baseDsn);
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}" TEMPLATE template1`);
  } finally {
    await client.end();
  }
  const server = baseDsn.split("/").slice(0, 3).join("/");
  return `${server}/${name}?sslmode=disable`;
}
