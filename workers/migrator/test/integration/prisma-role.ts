import type pg from "pg";

/** Roles are cluster-wide and the container is now shared (#1663), so a second
 * run meets the roles the first one created: create-if-absent, then re-grant. */
const CREATE_ROLES = `DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'neon_superuser') THEN
    CREATE ROLE neon_superuser NOLOGIN NOSUPERUSER;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN INHERIT NOSUPERUSER CREATEROLE PASSWORD 'local-test-only';
  END IF;
END $$;
GRANT neon_superuser TO migrator`;

/** The container is reused, so an earlier run may have created `migrator` before #1915 gave
 * the fixture role CREATEROLE; the ALTER restates the whole shape either way. */
const MIGRATOR_SHAPE = "ALTER ROLE migrator WITH LOGIN INHERIT NOSUPERUSER CREATEROLE PASSWORD 'local-test-only'";

/** Mirror Neon's inherited administrative group without PostgreSQL SUPERUSER. The five
 * service roles ride along with ADMIN OPTION, because #1915 makes the migrator's SQL step —
 * not a Neon-API role create — the owner of their attributes, memberships and passwords. The
 * platform's own schema USAGE rides along too: on Neon, `neon_superuser` membership is what
 * makes every platform-gated capability usable, and this image gates procedural access to the
 * role catalogs behind its bundled extension's schemas the same way. */
const GRANT_ADMINISTRATIVE_POWER = [
  "GRANT USAGE, CREATE ON SCHEMA public TO neon_superuser",
  "GRANT ALL ON ALL TABLES IN SCHEMA public TO neon_superuser",
  "GRANT agent_svc, catalog_svc, jobs_svc, readonly, users_svc TO neon_superuser WITH ADMIN OPTION",
].join("; ");

/** The bundled extension's schemas, when this image ships them. */
async function grantPlatformSchemaUsage(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ nspname: string }>(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'documentdb%'");
  if (rows.length === 0) return;
  const names = rows.map(({ nspname }) => `"${nspname}"`).join(", ");
  await client.query(`GRANT USAGE ON SCHEMA ${names} TO neon_superuser`);
}

/** The DSN the migrator role answers on, without touching any role: the URL
 * rewrite `migratorRole` returns, for a caller that needs the string before
 * any SQL runs. */
export function migratorDsn(dsn: string): string {
  const url = new URL(dsn);
  url.username = "migrator";
  url.password = "local-test-only";
  return url.toString();
}

export async function migratorRole(client: pg.Client, dsn: string): Promise<string> {
  await client.query(CREATE_ROLES);
  await client.query(MIGRATOR_SHAPE);
  await client.query(GRANT_ADMINISTRATIVE_POWER);
  await grantPlatformSchemaUsage(client);
  return migratorDsn(dsn);
}

export function grantDatabaseCreate(client: pg.Client, dsn: string) {
  const database = new URL(dsn).pathname.slice(1);
  return client.query(`GRANT CREATE ON DATABASE "${database}" TO neon_superuser`);
}
