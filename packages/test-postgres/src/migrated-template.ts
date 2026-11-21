/** One migrated template database per container, cloned per caller (#1769).
 *
 * The seed applies the Prisma chain once, then `datallowconn = false` and
 * `datistemplate = true` — the same isolation `template0` uses — so later
 * callers `CREATE DATABASE ... TEMPLATE` instead of applying the chain. The seed
 * holds the cluster turn; the clone does not.
 *
 * A template is ready when it is PROTECTED, not when it exists. The seed
 * creates the database first, migrates it, and protects it last, so a template
 * that merely exists may still be empty, half migrated, or left behind by a
 * seed that died — and a clone of it carries exactly that. A caller that finds
 * the template unprotected queues on the turn and asks again there: the seed
 * that held the turn has finished by then, or it died, and a template still
 * unprotected under the turn belongs to no live seed, so it is dropped and
 * seeded again.
 */
import pg from "pg";
import { ChainApplyTurn } from "./chain-apply-turn.ts";
import { assertCurrentTemplate, migratedTemplateName } from "./chain-identity.ts";
import { createCleanDatabase, dropCleanDatabase } from "./clean-database.ts";
import { applyPrismaChain } from "./prisma-chain.ts";

export async function createMigratedDatabase(adminDsn: string, name: string): Promise<string> {
  const template = migratedTemplateName();
  await ensureMigratedTemplate(adminDsn, template);
  return cloneFromTemplate(adminDsn, name, template);
}

async function ensureMigratedTemplate(adminDsn: string, template: string): Promise<void> {
  if (await templateReady(adminDsn, template)) return;
  await seedMigratedTemplate(adminDsn, template);
}

async function seedMigratedTemplate(adminDsn: string, template: string): Promise<void> {
  await new ChainApplyTurn(adminDsn).hold(async () => {
    if (await templateReady(adminDsn, template)) return;
    await dropCleanDatabase(adminDsn, template);
    await materializeTemplate(adminDsn, template);
  });
}

async function materializeTemplate(adminDsn: string, template: string): Promise<void> {
  const dsn = await createCleanDatabase(adminDsn, template);
  try {
    await applyAndProtect(dsn, adminDsn, template);
  } catch (failure) {
    await dropCleanDatabase(adminDsn, template);
    throw failure;
  }
}

async function applyAndProtect(dsn: string, adminDsn: string, template: string): Promise<void> {
  await applyPrismaChain(dsn);
  await protectTemplate(adminDsn, template);
  assertCurrentTemplate(template);
}

async function protectTemplate(adminDsn: string, template: string): Promise<void> {
  await withAdmin(adminDsn, async (client) => {
    await terminateSessions(client, template);
    await client.query(`ALTER DATABASE "${template}" ALLOW_CONNECTIONS false`);
    await client.query(`ALTER DATABASE "${template}" IS_TEMPLATE true`);
  });
}

async function terminateSessions(client: pg.Client, template: string): Promise<void> {
  await client.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [template],
  );
}

async function cloneFromTemplate(adminDsn: string, name: string, template: string): Promise<string> {
  await withAdmin(adminDsn, (client) =>
    client.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`).then(() => undefined),
  );
  return dsnForDatabase(adminDsn, name);
}

/** Protected the way the seed's last two statements leave it: refusing
 * connections and marked as a template. Half of that is not ready either — a
 * seed that died between the two statements left a template nobody finished. */
async function templateReady(adminDsn: string, template: string): Promise<boolean> {
  return withAdmin(adminDsn, async (client) => {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1 AND datistemplate AND NOT datallowconn",
      [template],
    );
    return rowCount === 1;
  });
}

async function withAdmin<Result>(dsn: string, work: (client: pg.Client) => Promise<Result>): Promise<Result> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function dsnForDatabase(baseDsn: string, name: string): string {
  const server = baseDsn.split("/").slice(0, 3).join("/");
  return `${server}/${name}?sslmode=disable`;
}
