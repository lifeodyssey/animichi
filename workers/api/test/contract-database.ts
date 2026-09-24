/**
 * The edge fixture's own Prisma-migrated database.
 *
 * The shared cluster (`startTestPostgresCluster`) provides the server, its admin
 * database and the five cluster-global service roles — no database of its own
 * (#1783; spec §4.7: one chain per database). The data-plane schema is cloned
 * from the container's migrated template (#1769). Everything the native routes
 * read and write, including the conversation ledger and the two usage meters,
 * comes from that schema rather than from scaffolding installed beside it.
 */
import { createMigratedDatabase, dropCleanDatabase, uniqueDatabaseName, type TestPostgresCluster } from "@animichi/test-postgres";

/** The fixture's own database on the shared server, and how to remove it (#1663). */
export interface ContractDatabase {
  readonly dsn: string;
  stop(): Promise<void>;
}

/** `<suite>_contract` plus a per-call suffix, cloned from the migrated template.
 * The caller owns the drop, like every database creator. */
export async function startContractDatabase(cluster: TestPostgresCluster, suite: string): Promise<ContractDatabase> {
  const name = uniqueDatabaseName(`${suite}_contract`);
  const dsn = await createMigratedDatabase(cluster.adminDsn, name);
  return { dsn, stop: () => dropCleanDatabase(cluster.adminDsn, name) };
}
