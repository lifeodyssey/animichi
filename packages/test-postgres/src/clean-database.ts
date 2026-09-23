/** The clean-database recipe the migration chain has to be applied to.
 *
 * The image pre-initialises its default database with its own extension set —
 * postgis, vector, documentdb and the objects those bring — so that database is
 * never the pristine schema the chain's clean-apply check needs, and no arm may
 * migrate it. Every arm instead works on a database of its own created from
 * `template0` — the same semantics
 * `scripts/local-gates/db-fresh-schema.sh` uses; `startTestPostgres` clones the
 * migrated template, which the seed builds with this same create.
 *
 * `template0`, not `template1`, because `CREATE DATABASE ... TEMPLATE x` refuses
 * while any other session is attached to `x`, and only after the server has
 * spent 5 s waiting for that session to leave (`CountOtherDBBackends`: 50 tries
 * × 100 ms, SIGTERM for autovacuum workers and patience for everyone else).
 * `template1` is connectable, so this image's preloaded background workers
 * reach it — 2 sessions and 104 ms of session time in fourteen hours on
 * the shared container, rare enough that no sampler of ours caught the holder
 * and often enough to fail `main` twice (#1890). `template0` is the template
 * PostgreSQL keeps unconnectable for exactly this reason, `pg_dump --create`
 * emits it for the same reason, and it is what this package already does one
 * layer up: `migrated-template.ts` protects its seeded template with
 * `ALLOW_CONNECTIONS false`. It costs nothing here: a database created from
 * each of the two compares identical on this image — `plpgsql`, `public`, no
 * relations (measured; PostgreSQL's own guarantee is only that `template0`
 * holds `template1`'s initial contents).
 *
 * What is left. `datallowconn = false` stops sessions, not every backend: a
 * background worker may still pass `BGWORKER_BYPASS_ALLOWCONN`, and autovacuum
 * may connect to `template0` for anti-wraparound work. Neither was observed —
 * `pg_stat_database` records zero sessions and zero transactions on `template0`
 * — and the second would not need waiting out anyway, because
 * `CountOtherDBBackends` SIGTERMs autovacuum workers itself (`procarray.c`). A
 * refusal is therefore thrown once, unchanged, and reissuing it is not this
 * module's job.
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

/** Create `name` from pristine template0 and return the DSN that reaches it. */
export async function createCleanDatabase(baseDsn: string, name: string): Promise<string> {
  await runStatement(baseDsn, `CREATE DATABASE "${name}" TEMPLATE template0`);
  return dsnForDatabase(baseDsn, name);
}

/** Drop `name`, force-closing any session still attached to it.
 *
 * `IF EXISTS` because the failure path and a second `stop()` both reach here
 * without knowing whether the create got that far. */
export async function dropCleanDatabase(baseDsn: string, name: string): Promise<void> {
  await runStatement(baseDsn, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}
