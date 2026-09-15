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
    CREATE ROLE migrator LOGIN INHERIT NOSUPERUSER PASSWORD 'local-test-only';
  END IF;
END $$;
GRANT neon_superuser TO migrator`;

/** Mirror Neon's inherited administrative group without PostgreSQL SUPERUSER. */
export async function migratorRole(client: pg.Client, dsn: string): Promise<string> {
  await client.query(CREATE_ROLES);
  await client.query("GRANT USAGE, CREATE ON SCHEMA public TO neon_superuser; GRANT ALL ON ALL TABLES IN SCHEMA public TO neon_superuser");
  const url = new URL(dsn);
  url.username = "migrator";
  url.password = "local-test-only";
  return url.toString();
}

export function grantDatabaseCreate(client: pg.Client, dsn: string) {
  const database = new URL(dsn).pathname.slice(1);
  return client.query(`GRANT CREATE ON DATABASE "${database}" TO neon_superuser`);
}
