/** A database a fixture opens for itself on the shared server (#1663).
 *
 * The container is reused and outlives every call, so a database a fixture
 * creates is the fixture's to remove: `stop()` when its setup succeeded, and
 * `useOwnedDatabase` when the work on it failed. Nothing here stops the server.
 */
import pg from "pg";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName } from "@animichi/test-postgres";

/** A database this fixture created on the shared server: the session on it,
 * and the drop that gives its name back. */
export interface OwnedDatabase {
  readonly dsn: string;
  readonly client: pg.Client;
  stop(): Promise<void>;
}

/** Run `work` on a resource this call created; a failure hands the resource
 * back before the error continues, so a failed setup cannot leak it (#1663). */
export async function useOwnedDatabase<Result>(resource: { stop(): Promise<void> }, work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (failure) {
    await resource.stop();
    throw failure;
  }
}

/** Create `suite`'s database on `baseDsn` and open a session on it. A session
 * that cannot open gives the database back before it throws. */
export async function openOwnedDatabase(baseDsn: string, suite: string): Promise<OwnedDatabase> {
  const name = uniqueDatabaseName(suite);
  const dsn = await createCleanDatabase(baseDsn, name);
  const owned = ownSessionOn(dsn, () => dropCleanDatabase(baseDsn, name));
  return useOwnedDatabase(owned, () => connectOwned(owned));
}

/** The session on `dsn`, ending with the drop that gives its name back. */
function ownSessionOn(dsn: string, drop: () => Promise<void>): OwnedDatabase {
  const client = new pg.Client(dsn);
  return { dsn, client, stop: async () => { await client.end(); await drop(); } };
}

/** Open the session the handle was built for. */
async function connectOwned(owned: OwnedDatabase): Promise<OwnedDatabase> {
  await owned.client.connect();
  return owned;
}
